/**
 * Villager Professions Addon - Village Population & Discovery Manager (Namespace: rpc)
 * Ensures that when a village loads for the first time:
 * 1. The village center is discovered (via minecraft:bell or villager clusters).
 * 2. The village is populated with ALL kinds of villagers (all 13 distinct professions).
 * 3. The overall village population is significantly increased.
 * 4. Villagers spawn without nametags, equipped with authentic tools and behavior routines.
 * 5. Persistent tracking ensures each village is populated only once on first load.
 */

import { world, system, ItemStack, EquipmentSlot } from "@minecraft/server";
import { VILLAGER_PROFESSIONS } from "./summonHelper.js";
import { getVillagerProfession, registerVillagerIntoManager } from "./professionHelper.js";
import { distance, playSoundSafe, spawnParticleSafe, isSolidGround, isPassableBlock } from "./utils.js";
import { addPoiToCache } from "./villageExpansionManager.js";

const DYNAMIC_PROPERTY_KEY = "rpc:populated_villages";
const VILLAGE_SEPARATION_RADIUS = 100; // Minimum block distance between distinct villages
const scannedAreasCooldown = new Map();

export class VillagePopulationManager {
    constructor(managers = {}) {
        this.managers = managers;
        /** @type {Array<{ x: number, y: number, z: number, dimensionId: string }>} */
        this.initializedVillages = [];
        this.scanIntervalTicks = 0;
        this.loadInitializedVillages();
    }

    /**
     * Loads saved village coordinates from world dynamic properties.
     */
    loadInitializedVillages() {
        try {
            const raw = world.getDynamicProperty(DYNAMIC_PROPERTY_KEY);
            if (typeof raw === "string" && raw.length > 0) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    this.initializedVillages = parsed;
                }
            }
        } catch (e) {
            console.warn(`[VillagePopulation] Error reading village dynamic property: ${e}`);
        }
    }

    /**
     * Persists initialized villages to world dynamic properties.
     */
    saveInitializedVillages() {
        try {
            const json = JSON.stringify(this.initializedVillages);
            world.setDynamicProperty(DYNAMIC_PROPERTY_KEY, json);
        } catch (e) {
            console.warn(`[VillagePopulation] Error saving village dynamic property: ${e}`);
        }
    }

    /**
     * Checks if a village near the given coordinate was already populated.
     * @param {string} dimensionId 
     * @param {Vector3} location 
     * @returns {boolean}
     */
    isVillageInitialized(dimensionId, location) {
        for (const v of this.initializedVillages) {
            if (v.dimensionId === dimensionId) {
                const dist = Math.hypot(location.x - v.x, location.z - v.z);
                if (dist < VILLAGE_SEPARATION_RADIUS) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Registers a new village location as populated.
     * @param {string} dimensionId 
     * @param {Vector3} location 
     */
    markVillageInitialized(dimensionId, location) {
        this.initializedVillages.push({
            x: Math.floor(location.x),
            y: Math.floor(location.y),
            z: Math.floor(location.z),
            dimensionId
        });
        this.saveInitializedVillages();
    }

    /**
     * Main update loop: scans around players and loaded villagers for unpopulated villages.
     */
    update() {
        this.scanIntervalTicks++;
        if (this.scanIntervalTicks % 100 !== 0) return; // Check every 5 seconds (fast & light)

        try {
            const players = world.getAllPlayers();
            for (const player of players) {
                if (!player || !player.isValid()) continue;
                this.checkAreaForVillage(player.dimension, player.location);
            }
        } catch {}
    }

    /**
     * Checks an area for village indicators (bell or villager clusters) and populates if first-time load.
     * @param {Dimension} dimension 
     * @param {Vector3} origin 
     */
    checkAreaForVillage(dimension, origin) {
        if (!dimension || !origin) return;
        const dimId = dimension.id;

        // FAST SKIP: If this location is already in an initialized village, exit instantly (0ms)!
        if (this.isVillageInitialized(dimId, origin)) return;

        // THROTTLE: Only scan each 48-block sector once every 2 minutes
        const sectorKey = `${dimId}:${Math.floor(origin.x / 48)},${Math.floor(origin.z / 48)}`;
        const now = Date.now();
        if (now < (scannedAreasCooldown.get(sectorKey) || 0)) return;
        scannedAreasCooldown.set(sectorKey, now + 120000);

        // 1. First search for a village Bell within 40 blocks using fast sparse probe
        const bellPos = this.findNearbyBell(dimension, origin, 40);
        if (bellPos) {
            if (!this.isVillageInitialized(dimId, bellPos)) {
                this.markVillageInitialized(dimId, bellPos);
                this.populateVillage(dimension, bellPos);
            }
            return;
        }

        // 2. Fallback: Search for naturally clustered villagers (2+ villagers within 36 blocks)
        try {
            const villagers = dimension.getEntities({
                type: "minecraft:villager_v2",
                location: origin,
                maxDistance: 36
            });

            if (villagers.length >= 2) {
                // Determine approximate center of the villager group
                let sumX = 0, sumY = 0, sumZ = 0;
                for (const v of villagers) {
                    const l = v.location;
                    sumX += l.x;
                    sumY += l.y;
                    sumZ += l.z;
                }
                const centerPos = {
                    x: Math.floor(sumX / villagers.length),
                    y: Math.floor(sumY / villagers.length),
                    z: Math.floor(sumZ / villagers.length)
                };

                if (!this.isVillageInitialized(dimId, centerPos)) {
                    this.markVillageInitialized(dimId, centerPos);
                    this.populateVillage(dimension, centerPos);
                }
            }
        } catch {}
    }

    /**
     * Scans for a bell block within radius using POI cache first and sparse probing.
     * @param {Dimension} dimension 
     * @param {Vector3} origin 
     * @param {number} radius 
     * @returns {Vector3|null}
     */
    findNearbyBell(dimension, origin, radius = 40) {
        const dimId = dimension.id;

        // 1. O(1) Cache Lookup first
        for (const [key, poi] of villagePoiCache.entries()) {
            if (poi.dimId === dimId && poi.typeId === "minecraft:bell") {
                if (distance(origin, poi.pos) <= radius) {
                    return poi.pos;
                }
            }
        }

        const ox = Math.floor(origin.x);
        const oy = Math.floor(origin.y);
        const oz = Math.floor(origin.z);

        // 2. High-performance sparse search: step 6 horizontally, step 3 vertically
        for (let dx = -radius; dx <= radius; dx += 6) {
            for (let dz = -radius; dz <= radius; dz += 6) {
                for (let dy = -4; dy <= 6; dy += 3) {
                    const pos = { x: ox + dx, y: oy + dy, z: oz + dz };
                    try {
                        const block = dimension.getBlock(pos);
                        if (block && block.typeId === "minecraft:bell") {
                            addPoiToCache(dimId, pos, "minecraft:bell");
                            return pos;
                        }
                    } catch {}
                }
            }
        }
        return null;
    }

    /**
     * Populates an uninitialized village so it spawns all 13 villager professions and more villagers!
     * @param {Dimension} dimension 
     * @param {Vector3} centerPos 
     */
    populateVillage(dimension, centerPos) {
        if (!dimension || !centerPos) return;

        // Query existing villagers within 64 blocks
        let existingVillagers = [];
        try {
            existingVillagers = dimension.getEntities({
                type: "minecraft:villager_v2",
                location: centerPos,
                maxDistance: 64
            });
        } catch {}

        const existingProfessions = new Set();
        for (const v of existingVillagers) {
            const p = getVillagerProfession(v);
            if (p) existingProfessions.add(p);
        }

        // Determine which of the 13 professions need to be spawned
        // Guarantee every single profession is present in the newly loaded village!
        const professionsToSpawn = [];
        for (const prof of VILLAGER_PROFESSIONS) {
            if (!existingProfessions.has(prof.id)) {
                professionsToSpawn.push(prof);
            }
        }

        // If village was sparse or empty, ensure at least 8-13 villagers are spawned
        if (professionsToSpawn.length < 5) {
            // Add any essential trades to increase overall village population
            const essentials = ["farmer", "fisherman", "fletcher", "cleric", "weaponsmith", "armorer", "librarian"];
            for (const id of essentials) {
                const def = VILLAGER_PROFESSIONS.find(p => p.id === id);
                if (def && professionsToSpawn.length < 13) {
                    professionsToSpawn.push(def);
                }
            }
        }

        // Spawn villagers staggered around safe ground spots near the village center
        let spawnIndex = 0;
        for (const prof of professionsToSpawn) {
            const delay = spawnIndex * 3; // Stagger every 3 ticks
            const currentProf = prof;
            const angle = (spawnIndex / professionsToSpawn.length) * 2 * Math.PI;
            const distRadius = 4 + (spawnIndex % 4) * 3; // 4 to 13 blocks out

            system.runTimeout(() => {
                try {
                    const targetX = Math.floor(centerPos.x + Math.cos(angle) * distRadius);
                    const targetZ = Math.floor(centerPos.z + Math.sin(angle) * distRadius);
                    const spawnLoc = this.findSafeSurfaceSpot(dimension, targetX, centerPos.y, targetZ);

                    if (!spawnLoc) return;

                    const villager = dimension.spawnEntity("minecraft:villager_v2", spawnLoc);
                    if (!villager || !villager.isValid()) return;

                    // Ensure NO nametag is set!
                    villager.nameTag = "";

                    // Trigger Bedrock profession event
                    villager.triggerEvent(currentProf.event);
                    if (currentProf.customEvent) {
                        villager.triggerEvent(currentProf.customEvent);
                    }

                    // Add profession tags
                    for (const t of currentProf.tags) {
                        villager.addTag(t);
                    }

                    // Equip default profession tool in hand
                    if (currentProf.defaultItem) {
                        try {
                            const equippable = villager.getComponent("minecraft:equippable");
                            if (equippable) {
                                equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack(currentProf.defaultItem, 1));
                            }
                        } catch {
                            villager.runCommandAsync(`replaceitem entity @s slot.weapon.mainhand 0 ${currentProf.defaultItem}`).catch(() => {});
                        }
                    }

                    // Register with AI managers
                    registerVillagerIntoManager(villager, currentProf.id, this.managers);
                    this.managers.villageExpansionManager?.registerVillager(villager);

                    // Authentic happy villager celebration particles
                    spawnParticleSafe(dimension, "minecraft:villager_happy", {
                        x: spawnLoc.x + 0.5,
                        y: spawnLoc.y + 1.2,
                        z: spawnLoc.z + 0.5
                    });
                    spawnParticleSafe(dimension, "minecraft:totem_particle", {
                        x: spawnLoc.x + 0.5,
                        y: spawnLoc.y + 1.0,
                        z: spawnLoc.z + 0.5
                    });
                    playSoundSafe(dimension, "mob.villager.yes", spawnLoc, { volume: 0.8, pitch: 1.05 });

                } catch (err) {
                    console.error(`[VillagePopulation] Error spawning ${currentProf.id}: ${err}`);
                }
            }, delay);

            spawnIndex++;
        }
    }

    /**
     * Finds a solid ground block with 2 air blocks above for safe villager spawning.
     * @param {Dimension} dimension 
     * @param {number} x 
     * @param {number} startY 
     * @param {number} z 
     * @returns {Vector3|null}
     */
    findSafeSurfaceSpot(dimension, x, startY, z) {
        for (let dy = 6; dy >= -10; dy--) {
            const y = Math.floor(startY + dy);
            try {
                const ground = dimension.getBlock({ x, y: y - 1, z });
                const feet = dimension.getBlock({ x, y, z });
                const head = dimension.getBlock({ x, y: y + 1, z });

                if (isSolidGround(ground) && isPassableBlock(feet) && isPassableBlock(head)) {
                    return { x: x + 0.5, y, z: z + 0.5 };
                }
            } catch {}
        }
        return null;
    }
}

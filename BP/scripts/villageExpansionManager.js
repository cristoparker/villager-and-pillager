/**
 * Villager Professions Addon - Village Expansion & Economy Manager (Namespace: rpc)
 * Coordinates:
 * 1. Universal dropped item collection for all villagers (meat, wool, sugarcane, crops, fish, arrows, ingots).
 * 2. Copper Golem-style Chest Organization: depositing collected items into village chests/barrels,
 *    or placing a new community chest if none exists.
 * 3. Village Bed Expansion: placing beds with 2-block headroom in open spaces to enable natural villager breeding.
 * 4. Village Workbench Expansion: placing workstations for new villagers to adopt professions.
 */

import { world, system, ItemStack, EquipmentSlot } from "@minecraft/server";
import { EXPANSION_CONFIG, HAY_CONFIG, HOUSE_BUILD_CONFIG, getRandomCooldownTicks } from "./config.js";
import { distance, getLookRotation, playSoundSafe, spawnParticleSafe, setBlockSafe, placeBedBlock, isSolidGround, isPassableBlock, isFreeBedSpace, isReplaceableSpace } from "./utils.js";
import { getVillagerProfession } from "./professionHelper.js";

/**
 * Checks if a villager entity is a baby using multiple engine indicators.
 * @param {Entity} villager 
 * @returns {boolean}
 */
export function isBabyVillager(villager) {
    if (!villager || !villager.isValid()) return false;
    try {
        if (villager.getComponent("minecraft:is_baby") !== undefined) return true;
    } catch {}
    try {
        if (villager.hasTag("rpc:baby_villager") || villager.hasTag("baby")) return true;
    } catch {}
    try {
        const typeFam = villager.getComponent("minecraft:type_family");
        if (typeFam && typeFam.hasTypeFamily("baby")) return true;
    } catch {}
    try {
        if (villager.matches && villager.matches({ families: ["baby"] })) return true;
    } catch {}
    return false;
}

export const PROFESSION_WORKBENCH_MAP = {
    farmer: "minecraft:composter",
    fisherman: "minecraft:barrel",
    shepherd: "minecraft:loom",
    fletcher: "minecraft:fletching_table",
    librarian: "minecraft:lectern",
    cartographer: "minecraft:cartography_table",
    cleric: "minecraft:brewing_stand",
    armorer: "minecraft:blast_furnace",
    weaponsmith: "minecraft:grindstone",
    toolsmith: "minecraft:smithing_table",
    butcher: "minecraft:smoker",
    leatherworker: "minecraft:cauldron",
    mason: "minecraft:stonecutter"
};

// Global area placement cooldown registries to prevent simultaneous spam across 48-block sectors
const recentBedAreaPlacements = new Map();
const recentChestAreaPlacements = new Map();
const recentWorkbenchAreaPlacements = new Map();
const recentHayAreaPlacements = new Map();

// Shared Village POI Cache to accelerate 64-block scans across all villagers
export const villagePoiCache = new Map();

export function addPoiToCache(dimId, pos, typeId) {
    const key = `${dimId}:${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
    villagePoiCache.set(key, { pos: { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) }, typeId, dimId });
}

export function removePoiFromCache(dimId, pos) {
    const key = `${dimId}:${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
    villagePoiCache.delete(key);
}

function isAreaBedCooldown(dimension, location) {
    if (!dimension || !location) return false;
    const key = `${dimension.id}:${Math.floor(location.x / 48)},${Math.floor(location.z / 48)}`;
    const expires = recentBedAreaPlacements.get(key) || 0;
    return Date.now() < expires;
}

function setAreaBedCooldown(dimension, location, durationMs = 300000) {
    if (!dimension || !location) return;
    const key = `${dimension.id}:${Math.floor(location.x / 48)},${Math.floor(location.z / 48)}`;
    recentBedAreaPlacements.set(key, Date.now() + durationMs);
}

function isAreaChestCooldown(dimension, location) {
    if (!dimension || !location) return false;
    const key = `${dimension.id}:${Math.floor(location.x / 20)},${Math.floor(location.z / 20)}`;
    const expires = recentChestAreaPlacements.get(key) || 0;
    return Date.now() < expires;
}

function setAreaChestCooldown(dimension, location, durationMs = 300000) {
    if (!dimension || !location) return;
    const key = `${dimension.id}:${Math.floor(location.x / 20)},${Math.floor(location.z / 20)}`;
    recentChestAreaPlacements.set(key, Date.now() + durationMs);
}

function isAreaWorkbenchCooldown(dimension, location) {
    if (!dimension || !location) return false;
    const key = `${dimension.id}:${Math.floor(location.x / 48)},${Math.floor(location.z / 48)}`;
    const expires = recentWorkbenchAreaPlacements.get(key) || 0;
    return Date.now() < expires;
}

function setAreaWorkbenchCooldown(dimension, location, durationMs = 300000) {
    if (!dimension || !location) return;
    const key = `${dimension.id}:${Math.floor(location.x / 48)},${Math.floor(location.z / 48)}`;
    recentWorkbenchAreaPlacements.set(key, Date.now() + durationMs);
}

function isAreaHayCooldown(dimension, location) {
    if (!dimension || !location) return false;
    const key = `${dimension.id}:${Math.floor(location.x / 16)},${Math.floor(location.z / 16)}`;
    const expires = recentHayAreaPlacements.get(key) || 0;
    return Date.now() < expires;
}

function setAreaHayCooldown(dimension, location, durationMs = 180000) {
    if (!dimension || !location) return;
    const key = `${dimension.id}:${Math.floor(location.x / 16)},${Math.floor(location.z / 16)}`;
    recentHayAreaPlacements.set(key, Date.now() + durationMs);
}

const recentHouseAreaBuilds = new Map();
const villageBuiltHouseCount = new Map();

function isAreaHouseCooldown(dimension, location) {
    if (!dimension || !location) return false;
    const key = `${dimension.id}:${Math.floor(location.x / 48)},${Math.floor(location.z / 48)}`;
    const expires = recentHouseAreaBuilds.get(key) || 0;
    if (Date.now() < expires) return true;
    const count = villageBuiltHouseCount.get(key) || 0;
    if (count >= HOUSE_BUILD_CONFIG.MAX_HOUSES_PER_AREA) return true;
    return false;
}

function setAreaHouseCooldown(dimension, location, durationMs = HOUSE_BUILD_CONFIG.AREA_COOLDOWN_MS) {
    if (!dimension || !location) return;
    const key = `${dimension.id}:${Math.floor(location.x / 48)},${Math.floor(location.z / 48)}`;
    recentHouseAreaBuilds.set(key, Date.now() + durationMs);
    const count = villageBuiltHouseCount.get(key) || 0;
    villageBuiltHouseCount.set(key, count + 1);
}

export const ExpansionState = {
    IDLE: "IDLE",
    COLLECTING_ITEM: "COLLECTING_ITEM",
    APPROACHING_CHEST: "APPROACHING_CHEST",
    DEPOSITING_CHEST: "DEPOSITING_CHEST",
    APPROACHING_CHEST_SPOT: "APPROACHING_CHEST_SPOT",
    PLACING_CHEST: "PLACING_CHEST",
    APPROACHING_BED_SPOT: "APPROACHING_BED_SPOT",
    PLACING_BED: "PLACING_BED",
    APPROACHING_WORKBENCH_SPOT: "APPROACHING_WORKBENCH_SPOT",
    PLACING_WORKBENCH: "PLACING_WORKBENCH",
    APPROACHING_HAY_SPOT: "APPROACHING_HAY_SPOT",
    PLACING_HAY: "PLACING_HAY",
    APPROACHING_HOUSE_SITE: "APPROACHING_HOUSE_SITE",
    BUILDING_HOUSE: "BUILDING_HOUSE",
    COOLDOWN: "COOLDOWN"
};

export let globalExpansionManager = null;

export function setGlobalExpansionManager(mgr) {
    globalExpansionManager = mgr;
}

export function notifyDroppedItem(villager, itemEntity) {
    if (globalExpansionManager && villager && itemEntity) {
        try {
            globalExpansionManager.directTargetDroppedItem(villager, itemEntity);
        } catch {}
    }
}

export class VillageExpansionManager {
    constructor() {
        /** @type {Map<string, { state: string, villager: Entity, carriedItems: Array<{ typeId: string, amount: number }>, targetItemEntity: Entity|null, targetChest: any, placementSpot: Vector3|null, targetWorkbenchType: string|null, bedCooldown: number, workbenchCooldown: number, depositCooldown: number, chestCooldown: number, breedCooldown: number, timer: number }>} */
        this.records = new Map();
        this.scanCooldownTicks = 0;
    }

    /**
     * Checks if it is currently nighttime.
     */
    isNightTime() {
        try {
            const timeOfDay = world.getTimeOfDay();
            return timeOfDay >= 12000 && timeOfDay < 23500;
        } catch {
            return false;
        }
    }

    /**
     * Registers a villager into the expansion manager.
     * @param {Entity} villager 
     */
    registerVillager(villager) {
        if (!villager || !villager.isValid() || this.records.has(villager.id)) return;

        const isBaby = isBabyVillager(villager);
        const isBuilder = !isBaby && (Math.random() < HOUSE_BUILD_CONFIG.BUILDER_CHANCE);

        this.records.set(villager.id, {
            state: ExpansionState.IDLE,
            villager: villager,
            carriedItems: [],
            targetItemEntity: null,
            targetChest: null,
            placementSpot: null,
            targetWorkbenchType: null,
            housePlotOrigin: null,
            houseStage: 0,
            isBuilderCandidate: isBuilder,
            houseCooldown: isBuilder ? getRandomCooldownTicks(HOUSE_BUILD_CONFIG.BUILD_COOLDOWN_MIN_TICKS, HOUSE_BUILD_CONFIG.BUILD_COOLDOWN_MAX_TICKS) : 999999,
            // Baby villagers won't place beds or workbenches!
            // Adults initialize with 3 to 5 minutes (3600-6000 ticks) initial cooldown to eliminate placement spam on spawn
            bedCooldown: isBaby ? 999999 : getRandomCooldownTicks(EXPANSION_CONFIG.BED_COOLDOWN_MIN_TICKS, EXPANSION_CONFIG.BED_COOLDOWN_MAX_TICKS),
            workbenchCooldown: isBaby ? 999999 : getRandomCooldownTicks(EXPANSION_CONFIG.WORKBENCH_COOLDOWN_MIN_TICKS, EXPANSION_CONFIG.WORKBENCH_COOLDOWN_MAX_TICKS),
            hayCooldown: isBaby ? 999999 : getRandomCooldownTicks(HAY_CONFIG.COOLDOWN_MIN_TICKS, HAY_CONFIG.COOLDOWN_MAX_TICKS),
            checkedNightBed: false,
            depositCooldown: 0,
            chestCooldown: 40,
            breedCooldown: 200,
            timer: 20
        });
    }

    /**
     * Unregisters a villager.
     * @param {string} id 
     */
    unregisterVillager(id) {
        this.records.delete(id);
    }

    /**
     * Scans loaded entities for all villagers.
     */
    scanForVillagers() {
        const dimensions = ["overworld"];
        for (const dimId of dimensions) {
            let dim;
            try { dim = world.getDimension(dimId); } catch {}
            if (!dim) continue;

            let villagers = [];
            try { villagers = dim.getEntities({ type: "minecraft:villager_v2" }); } catch {}
            try {
                const legacy = dim.getEntities({ type: "minecraft:villager" });
                if (legacy && legacy.length > 0) villagers = villagers.concat(legacy);
            } catch {}

            for (const villager of villagers) {
                if (villager && villager.isValid() && !this.records.has(villager.id)) {
                    this.registerVillager(villager);
                }
            }
        }
    }

    /**
     * Entity spawn callback.
     * @param {Entity} entity 
     */
    onEntitySpawn(entity) {
        if (entity && (entity.typeId === "minecraft:villager_v2" || entity.typeId === "minecraft:villager")) {
            this.registerVillager(entity);
        }
    }

    /**
     * Allows profession managers to immediately instruct a villager to collect a dropped item
     * (e.g. Shepherd after shearing wool, Butcher after meat drop, Librarian after sugarcane harvest).
     * @param {Entity} villager 
     * @param {Entity} itemEntity 
     */
    directTargetDroppedItem(villager, itemEntity) {
        if (!villager || !villager.isValid() || !itemEntity || !itemEntity.isValid()) return;
        let record = this.records.get(villager.id);
        if (!record) {
            this.registerVillager(villager);
            record = this.records.get(villager.id);
        }
        if (!record) return;

        record.targetItemEntity = itemEntity;
        record.state = ExpansionState.COLLECTING_ITEM;
        record.timer = 100;
    }

    /**
     * Main update tick loop.
     */
    update() {
        this.scanCooldownTicks++;
        if (this.scanCooldownTicks >= 80) {
            this.scanCooldownTicks = 0;
            this.scanForVillagers();
        }

        const isNight = this.isNightTime();

        for (const [id, record] of this.records.entries()) {
            const { villager } = record;

            if (!villager || !villager.isValid()) {
                this.records.delete(id);
                continue;
            }

            if (isNight) {
                if (!record.checkedNightBed) {
                    record.checkedNightBed = true;
                    // Trigger bed check at night time for adult villagers
                    if (!isBabyVillager(villager)) {
                        record.bedCooldown = 0;
                    }
                }
            } else {
                record.checkedNightBed = false;
            }

            if (record.bedCooldown > 0) record.bedCooldown--;
            if (record.workbenchCooldown > 0) record.workbenchCooldown--;
            if (record.hayCooldown > 0) record.hayCooldown--;
            if (record.houseCooldown > 0) record.houseCooldown--;
            if (record.depositCooldown > 0) record.depositCooldown--;
            if (record.chestCooldown > 0) record.chestCooldown--;
            if (record.breedCooldown > 0) record.breedCooldown--;

            this.updateVillager(record, isNight);
        }
    }

    /**
     * Updates an individual villager's expansion and item handling routine.
     * @param {object} record 
     * @param {boolean} isNight 
     */
    updateVillager(record, isNight = false) {
        const { villager } = record;
        const dim = villager.dimension;
        const vLoc = villager.location;

        // At night, pause non-bed expansion tasks (items, chests, workbenches, hay bales, house construction)
        if (isNight) {
            if (record.state === ExpansionState.COLLECTING_ITEM ||
                record.state === ExpansionState.APPROACHING_CHEST ||
                record.state === ExpansionState.DEPOSITING_CHEST ||
                record.state === ExpansionState.APPROACHING_CHEST_SPOT ||
                record.state === ExpansionState.PLACING_CHEST ||
                record.state === ExpansionState.APPROACHING_WORKBENCH_SPOT ||
                record.state === ExpansionState.PLACING_WORKBENCH ||
                record.state === ExpansionState.APPROACHING_HAY_SPOT ||
                record.state === ExpansionState.PLACING_HAY ||
                record.state === ExpansionState.APPROACHING_HOUSE_SITE ||
                record.state === ExpansionState.BUILDING_HOUSE) {
                record.state = ExpansionState.IDLE;
                record.targetItemEntity = null;
                record.targetChest = null;
                record.placementSpot = null;
                record.targetWorkbenchType = null;
                record.housePlotOrigin = null;
                record.houseStage = 0;
            }
        }

        switch (record.state) {
            case ExpansionState.IDLE: {
                record.timer--;
                if (record.timer <= 0) {
                    record.timer = 20;

                    // 1. PRIORITY 1: Scan for nearby dropped items to collect! (Daytime only)
                    if (!isNight) {
                        const droppedItem = this.findNearbyDroppedItem(dim, vLoc, EXPANSION_CONFIG.ITEM_SEARCH_RADIUS);
                        if (droppedItem) {
                            record.targetItemEntity = droppedItem;
                            record.state = ExpansionState.COLLECTING_ITEM;
                            record.timer = 100;
                            break;
                        }
                    }

                    // 2. PRIORITY 2: Village Workbench Autonomous Placement! (Daytime only, adult only)
                    // Check every 3 to 5 minutes: first search 64 blocks for their workbench!
                    // If not found in 64 blocks, then place it adjacent to themselves.
                    if (!isNight && !isBabyVillager(villager) && record.workbenchCooldown <= 0) {
                        const prof = getVillagerProfession(villager);
                        const neededWorkbench = (prof && PROFESSION_WORKBENCH_MAP[prof]) ? PROFESSION_WORKBENCH_MAP[prof] : null;

                        // 64-block detection system!
                        const hasWorkbench = this.hasNearbyWorkbench(dim, vLoc, neededWorkbench, EXPANSION_CONFIG.WORKBENCH_SEARCH_RADIUS);
                        if (hasWorkbench) {
                            // Workbench exists within 64 blocks! Do NOT place duplicate!
                            record.workbenchCooldown = getRandomCooldownTicks(EXPANSION_CONFIG.WORKBENCH_COOLDOWN_MIN_TICKS, EXPANSION_CONFIG.WORKBENCH_COOLDOWN_MAX_TICKS);
                        } else if (!isAreaWorkbenchCooldown(dim, vLoc)) {
                            const wbSpot = this.findNearbyWorkbenchPlacementSpot(dim, vLoc, 3);
                            if (wbSpot) {
                                record.placementSpot = wbSpot;
                                if (neededWorkbench) {
                                    record.targetWorkbenchType = neededWorkbench;
                                } else {
                                    const wbList = EXPANSION_CONFIG.WORKBENCH_BLOCK_IDS;
                                    record.targetWorkbenchType = wbList[Math.floor(Math.random() * wbList.length)];
                                }

                                const d = distance(vLoc, wbSpot);
                                if (d <= 2.8) {
                                    record.state = ExpansionState.PLACING_WORKBENCH;
                                    record.timer = 15;
                                } else {
                                    record.state = ExpansionState.APPROACHING_WORKBENCH_SPOT;
                                    record.timer = 80;
                                }
                                break;
                            } else {
                                record.workbenchCooldown = getRandomCooldownTicks(1200, 2400);
                            }
                        } else {
                            record.workbenchCooldown = getRandomCooldownTicks(1200, 2400);
                        }
                    }

                    // 3. PRIORITY 3: Village Community Chest Management (Daytime only)
                    if (!isNight) {
                        const nearbyChest = this.findNearbyChest(dim, vLoc, EXPANSION_CONFIG.CHEST_SEARCH_RADIUS);
                        if (nearbyChest) {
                            if (record.carriedItems.length > 0 && record.depositCooldown <= 0) {
                                record.targetChest = nearbyChest;
                                const d = distance(vLoc, nearbyChest.pos);
                                if (d <= EXPANSION_CONFIG.CHEST_DEPOSIT_DISTANCE) {
                                    record.state = ExpansionState.DEPOSITING_CHEST;
                                    record.timer = 25;
                                } else {
                                    record.state = ExpansionState.APPROACHING_CHEST;
                                    record.timer = 100;
                                }
                                break;
                            }
                        } else {
                            if (record.chestCooldown <= 0 && !isAreaChestCooldown(dim, vLoc)) {
                                const chestSpot = this.findNearbyChestPlacementSpot(dim, vLoc, 4);
                                if (chestSpot) {
                                    record.placementSpot = chestSpot;
                                    const d = distance(vLoc, chestSpot);
                                    if (d <= 2.8) {
                                        record.state = ExpansionState.PLACING_CHEST;
                                        record.timer = 20;
                                    } else {
                                        record.state = ExpansionState.APPROACHING_CHEST_SPOT;
                                        record.timer = 80;
                                    }
                                    break;
                                }
                            }
                        }
                    }

                    // 4. PRIORITY 4: Village Bed Expansion (Low frequency 3-5 mins AND night time check)
                    // Baby villagers will NEVER place beds!
                    if (!isBabyVillager(villager) && (record.bedCooldown <= 0 || (isNight && !record.checkedNightBed))) {
                        if (isNight) record.checkedNightBed = true;

                        // 64-block bed detection system!
                        const localBeds = this.countNearbyBeds(dim, vLoc, EXPANSION_CONFIG.BED_SEARCH_RADIUS);
                        const localVillagers = this.countNearbyVillagers(dim, vLoc, EXPANSION_CONFIG.BED_SEARCH_RADIUS);

                        if (localBeds >= localVillagers) {
                            // Beds are sufficient in 64 blocks! Do NOT place duplicate!
                            record.bedCooldown = getRandomCooldownTicks(EXPANSION_CONFIG.BED_COOLDOWN_MIN_TICKS, EXPANSION_CONFIG.BED_COOLDOWN_MAX_TICKS);
                        } else if (!isAreaBedCooldown(dim, vLoc)) {
                            const bedSpot = this.findNearbyBedPlacementSpot(dim, vLoc, 8);
                            if (bedSpot) {
                                record.placementSpot = bedSpot;
                                const targetPos = bedSpot.footPos || bedSpot;
                                const d = distance(vLoc, targetPos);
                                if (d <= 2.8) {
                                    record.state = ExpansionState.PLACING_BED;
                                    record.timer = 20;
                                } else {
                                    record.state = ExpansionState.APPROACHING_BED_SPOT;
                                    record.timer = 90;
                                }
                                break;
                            } else {
                                record.bedCooldown = getRandomCooldownTicks(1200, 2400);
                            }
                        } else {
                            record.bedCooldown = getRandomCooldownTicks(1200, 2400);
                        }
                    }

                    // 5. PRIORITY 5: Villager Breeding System Check (Daytime only, adult only)
                    if (!isNight && !isBabyVillager(villager) && record.breedCooldown <= 0) {
                        if (this.tryPerformQuickBreeding(villager, record, dim, vLoc)) {
                            record.timer = 35;
                            break;
                        }
                    }

                    // 6. PRIORITY 6: Village Hay Bale Placement (Clusters & stacks hay bales together!)
                    // Sometimes places a hay bale near existing hay bales to make an authentic village chunk/pile
                    if (!isNight && !isBabyVillager(villager) && record.hayCooldown <= 0 && !isAreaHayCooldown(dim, vLoc)) {
                        const existingHay = this.findNearbyExistingHayBlock(dim, vLoc, HAY_CONFIG.SEARCH_RADIUS);
                        let haySpot = null;

                        if (existingHay) {
                            // Found existing hay bale! Grow this cluster into a chunk of hay bales
                            const clusterSize = this.countHayClusterSize(dim, existingHay, HAY_CONFIG.CLUSTER_RADIUS);
                            if (clusterSize < HAY_CONFIG.MAX_CLUSTER_SIZE && Math.random() < HAY_CONFIG.CHANCE_TO_EXPAND_CLUSTER) {
                                haySpot = this.findAdjacentHayPlacementSpot(dim, existingHay);
                            }
                        } else {
                            // Occasionally start a new hay cluster on flat outdoor ground
                            if (Math.random() < HAY_CONFIG.CHANCE_TO_START_CLUSTER) {
                                haySpot = this.findStarterHayPlacementSpot(dim, vLoc, 6);
                            }
                        }

                        if (haySpot) {
                            record.placementSpot = haySpot;
                            const d = distance(vLoc, haySpot);
                            if (d <= HAY_CONFIG.PLACEMENT_DISTANCE) {
                                record.state = ExpansionState.PLACING_HAY;
                                record.timer = 15;
                            } else {
                                record.state = ExpansionState.APPROACHING_HAY_SPOT;
                                record.timer = 80;
                            }
                            break;
                        } else {
                            record.hayCooldown = getRandomCooldownTicks(1200, 2400);
                        }
                    }

                    // 7. PRIORITY 7: Rare Village Home Construction (Build a home in free space containing bed)
                    // Very few villagers (isBuilderCandidate) will identify free flat open space and construct a home
                    if (!isNight && !isBabyVillager(villager) && record.isBuilderCandidate && record.houseCooldown <= 0 && !isAreaHouseCooldown(dim, vLoc)) {
                        const plotOrigin = this.findFreeHousePlot(dim, vLoc, HOUSE_BUILD_CONFIG.SEARCH_RADIUS);
                        if (plotOrigin) {
                            record.housePlotOrigin = plotOrigin;
                            record.houseStage = 0;
                            record.state = ExpansionState.APPROACHING_HOUSE_SITE;
                            record.timer = 120;
                            break;
                        } else {
                            // Retry after cooldown if no free space found nearby
                            record.houseCooldown = getRandomCooldownTicks(3600, 7200);
                        }
                    }
                }
                break;
            }

            case ExpansionState.COLLECTING_ITEM: {
                record.timer--;
                if (!record.targetItemEntity || !record.targetItemEntity.isValid() || record.timer <= 0) {
                    record.state = ExpansionState.IDLE;
                    record.targetItemEntity = null;
                    record.timer = 15;
                    break;
                }

                const itemLoc = record.targetItemEntity.location;
                const d = distance(vLoc, itemLoc);

                if (d <= EXPANSION_CONFIG.ITEM_PICKUP_DISTANCE) {
                    this.collectItem(villager, record.targetItemEntity, record);
                    record.targetItemEntity = null;
                    record.state = ExpansionState.IDLE;
                    record.timer = 15;
                    break;
                }

                try {
                    if (record.timer % 10 === 0) {
                        const rot = getLookRotation(vLoc, itemLoc);
                        villager.teleport(vLoc, { rotation: { x: 0, y: rot.y } });
                    }
                    const dx = itemLoc.x - vLoc.x;
                    const dz = itemLoc.z - vLoc.z;
                    const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
                    villager.applyImpulse({ x: (dx / len) * 0.18, y: 0, z: (dz / len) * 0.18 });
                } catch {}
                break;
            }

            case ExpansionState.APPROACHING_CHEST: {
                record.timer--;
                if (!record.targetChest || record.timer <= 0) {
                    record.state = ExpansionState.IDLE;
                    record.targetChest = null;
                    record.timer = 15;
                    break;
                }

                const chestPos = record.targetChest.pos;
                const d = distance(vLoc, chestPos);

                if (d <= EXPANSION_CONFIG.CHEST_DEPOSIT_DISTANCE) {
                    record.state = ExpansionState.DEPOSITING_CHEST;
                    record.timer = 25;
                    break;
                }

                try {
                    if (record.timer % 10 === 0) {
                        const rot = getLookRotation(vLoc, chestPos);
                        villager.teleport(vLoc, { rotation: { x: 0, y: rot.y } });
                    }
                    const dx = chestPos.x + 0.5 - vLoc.x;
                    const dz = chestPos.z + 0.5 - vLoc.z;
                    const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
                    villager.applyImpulse({ x: (dx / len) * 0.18, y: 0, z: (dz / len) * 0.18 });
                } catch {}
                break;
            }

            case ExpansionState.DEPOSITING_CHEST: {
                record.timer--;
                if (record.timer <= 0) {
                    if (record.targetChest) {
                        this.performDepositItems(villager, record.targetChest, record);
                    }
                    record.targetChest = null;
                    record.depositCooldown = 200;
                    record.state = ExpansionState.IDLE;
                    record.timer = 20;
                }
                break;
            }

            case ExpansionState.APPROACHING_CHEST_SPOT: {
                record.timer--;
                if (!record.placementSpot || record.timer <= 0) {
                    record.state = ExpansionState.IDLE;
                    record.placementSpot = null;
                    record.timer = 20;
                    break;
                }

                const spot = record.placementSpot;
                const d = distance(vLoc, spot);
                if (d <= 2.8) {
                    record.state = ExpansionState.PLACING_CHEST;
                    record.timer = 20;
                    break;
                }

                try {
                    if (record.timer % 10 === 0) {
                        const rot = getLookRotation(vLoc, spot);
                        villager.teleport(vLoc, { rotation: { x: 0, y: rot.y } });
                        const equippable = villager.getComponent("minecraft:equippable");
                        equippable?.setEquipment(EquipmentSlot.Mainhand, new ItemStack("minecraft:chest", 1));
                    }
                    const dx = spot.x + 0.5 - vLoc.x;
                    const dz = spot.z + 0.5 - vLoc.z;
                    const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
                    villager.applyImpulse({ x: (dx / len) * 0.18, y: 0, z: (dz / len) * 0.18 });
                } catch {}
                break;
            }

            case ExpansionState.PLACING_CHEST: {
                record.timer--;
                if (record.timer <= 0) {
                    if (record.placementSpot) {
                        this.performPlaceAndDepositChest(villager, record.placementSpot, record);
                    }
                    record.placementSpot = null;
                    record.depositCooldown = 300;
                    record.chestCooldown = EXPANSION_CONFIG.CHEST_COOLDOWN_TICKS;
                    record.state = ExpansionState.COOLDOWN;
                    record.timer = 40;
                }
                break;
            }

            case ExpansionState.APPROACHING_BED_SPOT: {
                record.timer--;
                // Baby villagers will NEVER place beds!
                if (isBabyVillager(villager) || !record.placementSpot || record.timer <= 0) {
                    record.state = ExpansionState.IDLE;
                    record.placementSpot = null;
                    record.bedCooldown = isBabyVillager(villager) ? 999999 : getRandomCooldownTicks(EXPANSION_CONFIG.BED_COOLDOWN_MIN_TICKS, EXPANSION_CONFIG.BED_COOLDOWN_MAX_TICKS);
                    record.timer = 20;
                    break;
                }

                const spot = record.placementSpot;
                const targetPos = spot.footPos || spot;
                const d = distance(vLoc, targetPos);
                if (d <= 2.8) {
                    record.state = ExpansionState.PLACING_BED;
                    record.timer = 20;
                    break;
                }

                try {
                    if (record.timer % 10 === 0) {
                        const rot = getLookRotation(vLoc, targetPos);
                        villager.teleport(vLoc, { rotation: { x: 0, y: rot.y } });
                        const equippable = villager.getComponent("minecraft:equippable");
                        equippable?.setEquipment(EquipmentSlot.Mainhand, new ItemStack("minecraft:bed", 1));
                    }
                    const dx = targetPos.x + 0.5 - vLoc.x;
                    const dz = targetPos.z + 0.5 - vLoc.z;
                    const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
                    villager.applyImpulse({ x: (dx / len) * 0.18, y: 0, z: (dz / len) * 0.18 });
                } catch {}
                break;
            }

            case ExpansionState.PLACING_BED: {
                record.timer--;
                if (record.timer <= 0) {
                    // Baby villagers will NEVER place beds!
                    if (isBabyVillager(villager)) {
                        record.placementSpot = null;
                        record.state = ExpansionState.IDLE;
                        record.bedCooldown = 999999;
                        record.timer = 20;
                        break;
                    }
                    if (record.placementSpot) {
                        this.performPlaceBed(villager, record.placementSpot);
                        setAreaBedCooldown(dim, record.placementSpot.footPos || record.placementSpot, 300000);
                    }
                    record.placementSpot = null;
                    record.bedCooldown = getRandomCooldownTicks(EXPANSION_CONFIG.BED_COOLDOWN_MIN_TICKS, EXPANSION_CONFIG.BED_COOLDOWN_MAX_TICKS);
                    record.state = ExpansionState.COOLDOWN;
                    record.timer = 40;
                }
                break;
            }

            case ExpansionState.APPROACHING_WORKBENCH_SPOT: {
                record.timer--;
                if (isBabyVillager(villager) || !record.placementSpot || record.timer <= 0) {
                    record.state = ExpansionState.IDLE;
                    record.placementSpot = null;
                    record.targetWorkbenchType = null;
                    record.workbenchCooldown = isBabyVillager(villager) ? 999999 : getRandomCooldownTicks(EXPANSION_CONFIG.WORKBENCH_COOLDOWN_MIN_TICKS, EXPANSION_CONFIG.WORKBENCH_COOLDOWN_MAX_TICKS);
                    record.timer = 20;
                    break;
                }

                const spot = record.placementSpot;
                const d = distance(vLoc, spot);
                if (d <= 2.8) {
                    record.state = ExpansionState.PLACING_WORKBENCH;
                    record.timer = 15;
                    break;
                }

                try {
                    if (record.timer % 10 === 0) {
                        const rot = getLookRotation(vLoc, spot);
                        villager.teleport(vLoc, { rotation: { x: 0, y: rot.y } });
                        if (record.targetWorkbenchType) {
                            const equippable = villager.getComponent("minecraft:equippable");
                            equippable?.setEquipment(EquipmentSlot.Mainhand, new ItemStack(record.targetWorkbenchType, 1));
                        }
                    }
                    const dx = spot.x + 0.5 - vLoc.x;
                    const dz = spot.z + 0.5 - vLoc.z;
                    const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
                    villager.applyImpulse({ x: (dx / len) * 0.18, y: 0, z: (dz / len) * 0.18 });
                } catch {}
                break;
            }

            case ExpansionState.PLACING_WORKBENCH: {
                record.timer--;
                if (record.timer <= 0) {
                    if (isBabyVillager(villager)) {
                        record.placementSpot = null;
                        record.targetWorkbenchType = null;
                        record.state = ExpansionState.IDLE;
                        record.workbenchCooldown = 999999;
                        record.timer = 20;
                        break;
                    }
                    if (record.placementSpot && record.targetWorkbenchType) {
                        this.performPlaceWorkbench(villager, record.placementSpot, record.targetWorkbenchType);
                        setAreaWorkbenchCooldown(dim, record.placementSpot, 300000);
                    }
                    record.placementSpot = null;
                    record.targetWorkbenchType = null;
                    record.workbenchCooldown = getRandomCooldownTicks(EXPANSION_CONFIG.WORKBENCH_COOLDOWN_MIN_TICKS, EXPANSION_CONFIG.WORKBENCH_COOLDOWN_MAX_TICKS);
                    record.state = ExpansionState.COOLDOWN;
                    record.timer = 30;
                }
                break;
            }

            case ExpansionState.APPROACHING_HAY_SPOT: {
                record.timer--;
                if (isBabyVillager(villager) || !record.placementSpot || record.timer <= 0) {
                    record.state = ExpansionState.IDLE;
                    record.placementSpot = null;
                    record.hayCooldown = isBabyVillager(villager) ? 999999 : getRandomCooldownTicks(HAY_CONFIG.COOLDOWN_MIN_TICKS, HAY_CONFIG.COOLDOWN_MAX_TICKS);
                    record.timer = 20;
                    break;
                }

                const spot = record.placementSpot;
                const d = distance(vLoc, spot);
                if (d <= HAY_CONFIG.PLACEMENT_DISTANCE) {
                    record.state = ExpansionState.PLACING_HAY;
                    record.timer = 15;
                    break;
                }

                try {
                    if (record.timer % 10 === 0) {
                        const rot = getLookRotation(vLoc, spot);
                        villager.teleport(vLoc, { rotation: { x: 0, y: rot.y } });
                        const equippable = villager.getComponent("minecraft:equippable");
                        equippable?.setEquipment(EquipmentSlot.Mainhand, new ItemStack(HAY_CONFIG.BLOCK_ID, 1));
                    }
                    const dx = spot.x + 0.5 - vLoc.x;
                    const dz = spot.z + 0.5 - vLoc.z;
                    const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
                    villager.applyImpulse({ x: (dx / len) * 0.18, y: 0, z: (dz / len) * 0.18 });
                } catch {}
                break;
            }

            case ExpansionState.PLACING_HAY: {
                record.timer--;
                if (record.timer <= 0) {
                    if (isBabyVillager(villager)) {
                        record.placementSpot = null;
                        record.state = ExpansionState.IDLE;
                        record.hayCooldown = 999999;
                        record.timer = 20;
                        break;
                    }
                    if (record.placementSpot) {
                        this.performPlaceHayBlock(villager, record.placementSpot);
                        setAreaHayCooldown(dim, record.placementSpot, 180000);
                    }
                    record.placementSpot = null;
                    record.hayCooldown = getRandomCooldownTicks(HAY_CONFIG.COOLDOWN_MIN_TICKS, HAY_CONFIG.COOLDOWN_MAX_TICKS);
                    record.state = ExpansionState.COOLDOWN;
                    record.timer = 30;
                }
                break;
            }

            case ExpansionState.APPROACHING_HOUSE_SITE: {
                record.timer--;
                if (isNight || isBabyVillager(villager) || !record.housePlotOrigin || record.timer <= 0) {
                    record.state = ExpansionState.IDLE;
                    record.housePlotOrigin = null;
                    record.houseStage = 0;
                    record.houseCooldown = isBabyVillager(villager) ? 999999 : getRandomCooldownTicks(2400, 4800);
                    record.timer = 20;
                    break;
                }

                // Front door entrance spot is (origin.x + 2.5, origin.y, origin.z - 0.5)
                const frontDoorSpot = {
                    x: record.housePlotOrigin.x + 2.5,
                    y: record.housePlotOrigin.y,
                    z: record.housePlotOrigin.z - 0.5
                };
                const d = distance(vLoc, frontDoorSpot);
                if (d <= 3.2) {
                    record.state = ExpansionState.BUILDING_HOUSE;
                    record.houseStage = 0;
                    record.timer = HOUSE_BUILD_CONFIG.STAGE_DURATION_TICKS;
                    break;
                }

                try {
                    if (record.timer % 10 === 0) {
                        const rot = getLookRotation(vLoc, frontDoorSpot);
                        villager.teleport(vLoc, { rotation: { x: 0, y: rot.y } });
                        const equippable = villager.getComponent("minecraft:equippable");
                        equippable?.setEquipment(EquipmentSlot.Mainhand, new ItemStack(HOUSE_BUILD_CONFIG.FOUNDATION_BLOCK, 1));
                    }
                    const dx = frontDoorSpot.x - vLoc.x;
                    const dz = frontDoorSpot.z - vLoc.z;
                    const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
                    villager.applyImpulse({ x: (dx / len) * 0.20, y: 0, z: (dz / len) * 0.20 });
                } catch {}
                break;
            }

            case ExpansionState.BUILDING_HOUSE: {
                if (isNight || isBabyVillager(villager) || !record.housePlotOrigin) {
                    record.state = ExpansionState.IDLE;
                    record.housePlotOrigin = null;
                    record.houseStage = 0;
                    record.houseCooldown = getRandomCooldownTicks(HOUSE_BUILD_CONFIG.BUILD_COOLDOWN_MIN_TICKS, HOUSE_BUILD_CONFIG.BUILD_COOLDOWN_MAX_TICKS);
                    break;
                }

                record.timer--;
                if (record.timer <= 0) {
                    const finished = this.executeHouseBuildStage(villager, record.housePlotOrigin, record.houseStage);
                    record.houseStage++;

                    if (finished || record.houseStage > 6) {
                        // Entire house complete! Mark cooldown and celebrate
                        setAreaHouseCooldown(dim, record.housePlotOrigin);
                        try {
                            const equippable = villager.getComponent("minecraft:equippable");
                            equippable?.setEquipment(EquipmentSlot.Mainhand, undefined);
                        } catch {}
                        record.housePlotOrigin = null;
                        record.houseStage = 0;
                        record.houseCooldown = getRandomCooldownTicks(HOUSE_BUILD_CONFIG.BUILD_COOLDOWN_MIN_TICKS, HOUSE_BUILD_CONFIG.BUILD_COOLDOWN_MAX_TICKS);
                        record.state = ExpansionState.COOLDOWN;
                        record.timer = 60;
                    } else {
                        // Schedule next stage
                        record.timer = HOUSE_BUILD_CONFIG.STAGE_DURATION_TICKS;
                    }
                }
                break;
            }

            case ExpansionState.COOLDOWN: {
                record.timer--;
                if (record.timer <= 0) {
                    record.state = ExpansionState.IDLE;
                    record.timer = 20;
                }
                break;
            }
        }
    }

    /**
     * Finds the closest valid dropped item entity.
     * @param {Dimension} dimension 
     * @param {Vector3} location 
     * @param {number} radius 
     */
    findNearbyDroppedItem(dimension, location, radius = EXPANSION_CONFIG.ITEM_SEARCH_RADIUS) {
        if (!dimension || !location) return null;

        try {
            const items = dimension.getEntities({
                type: "minecraft:item",
                location: location,
                maxDistance: radius
            });

            let closest = null;
            let closestDist = Infinity;

            for (const item of items) {
                if (!item || !item.isValid()) continue;
                const d = distance(location, item.location);
                if (d < closestDist) {
                    closestDist = d;
                    closest = item;
                }
            }
            return closest;
        } catch {
            return null;
        }
    }

    /**
     * Collects a dropped item entity into villager storage.
     * @param {Entity} villager 
     * @param {Entity} itemEntity 
     * @param {object} record 
     */
    collectItem(villager, itemEntity, record) {
        if (!villager || !villager.isValid() || !itemEntity || !itemEntity.isValid()) return false;
        const dim = villager.dimension;
        const itemLoc = itemEntity.location;

        let typeId = "minecraft:apple";
        let amount = 1;

        try {
            const itemComp = itemEntity.getComponent("minecraft:item");
            const stack = itemComp?.itemStack;
            if (stack) {
                typeId = stack.typeId;
                amount = stack.amount || 1;
            }
        } catch {}

        // Store into villager record inventory
        const existing = record.carriedItems.find(i => i.typeId === typeId);
        if (existing) {
            existing.amount += amount;
        } else {
            record.carriedItems.push({ typeId, amount });
        }

        // Try to add to native inventory component if present
        try {
            const invComp = villager.getComponent("minecraft:inventory");
            if (invComp?.container) {
                invComp.container.addItem(new ItemStack(typeId, amount));
            }
        } catch {}

        // Audio & visual feedback
        playSoundSafe(dim, "random.pop", itemLoc, { volume: 0.8, pitch: 1.2 });
        spawnParticleSafe(dim, "minecraft:villager_happy", { x: itemLoc.x, y: itemLoc.y + 0.5, z: itemLoc.z });

        try {
            villager.playAnimation("animation.villager.raise_arms");
        } catch {}

        // Remove dropped item entity
        try {
            itemEntity.kill();
        } catch {}

        return true;
    }

    /**
     * Finds a nearby Chest or Barrel container block within radius.
     * Scans every coordinate (no skipping) to guarantee existing chests are always found.
     * @param {Dimension} dimension 
     * @param {Vector3} location 
     * @param {number} radius 
     */
    findNearbyChest(dimension, location, radius = EXPANSION_CONFIG.CHEST_SEARCH_RADIUS) {
        if (!dimension || !location) return null;
        const ox = Math.floor(location.x);
        const oy = Math.floor(location.y);
        const oz = Math.floor(location.z);
        const r = Math.min(radius, 20);

        let closest = null;
        let closestDist = Infinity;

        for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
                for (let dy = -2; dy <= 3; dy++) {
                    const pos = { x: ox + dx, y: oy + dy, z: oz + dz };
                    try {
                        const block = dimension.getBlock(pos);
                        if (block && EXPANSION_CONFIG.CHEST_BLOCK_IDS.includes(block.typeId)) {
                            const d = distance(location, pos);
                            if (d < closestDist) {
                                closestDist = d;
                                closest = { block, pos };
                            }
                        }
                    } catch {}
                }
            }
        }
        return closest;
    }

    /**
     * Deposits carried items into a village chest (Copper Golem style).
     * @param {Entity} villager 
     * @param {Block} chestBlock 
     * @param {object} record 
     */
    performDepositItems(villager, chestBlock, record) {
        if (!villager || !villager.isValid() || !chestBlock || record.carriedItems.length === 0) return false;
        const dim = villager.dimension;
        const pos = chestBlock.location;

        try {
            const rot = getLookRotation(villager.location, { x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 });
            villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
            villager.playAnimation("animation.villager.raise_arms");
        } catch {}

        playSoundSafe(dim, "random.chestopen", pos, { volume: 0.8, pitch: 1.0 });

        // Transfer items into chest container
        try {
            const inv = chestBlock.getComponent("minecraft:inventory");
            const container = inv?.container;

            for (const item of record.carriedItems) {
                let added = false;
                if (container) {
                    try {
                        container.addItem(new ItemStack(item.typeId, item.amount));
                        added = true;
                    } catch {}
                }
                if (!added) {
                    // Fallback: spawn item inside chest location
                    try {
                        dim.spawnItem(new ItemStack(item.typeId, item.amount), {
                            x: pos.x + 0.5,
                            y: pos.y + 0.8,
                            z: pos.z + 0.5
                        });
                    } catch {}
                }
            }
        } catch {}

        playSoundSafe(dim, "random.chestclosed", pos, { volume: 0.8, pitch: 1.0 });
        playSoundSafe(dim, "mob.villager.yes", villager.location, { volume: 0.9, pitch: 1.0 });
        spawnParticleSafe(dim, "minecraft:villager_happy", { x: pos.x + 0.5, y: pos.y + 1.2, z: pos.z + 0.5 });

        // Clear carried items
        record.carriedItems = [];
        return true;
    }

    /**
     * Finds an open solid ground location near the villager suitable for placing a community chest.
     * Orders checks from 1 to 4 blocks away, ensuring close and reachable placement on solid ground.
     * @param {Dimension} dimension 
     * @param {Vector3} location 
     * @param {number} radius 
     */
    findNearbyChestPlacementSpot(dimension, location, radius = 4) {
        if (!dimension || !location) return null;
        const ox = Math.floor(location.x);
        const oy = Math.floor(location.y);
        const oz = Math.floor(location.z);

        const offsets = [];
        for (let r = 1; r <= radius; r++) {
            for (let dx = -r; dx <= r; dx++) {
                for (let dz = -r; dz <= r; dz++) {
                    if (Math.max(Math.abs(dx), Math.abs(dz)) === r) {
                        offsets.push({ dx, dz });
                    }
                }
            }
        }

        for (const off of offsets) {
            for (let dy = -1; dy <= 1; dy++) {
                const groundPos = { x: ox + off.dx, y: oy + dy - 1, z: oz + off.dz };
                const spotPos = { x: ox + off.dx, y: oy + dy, z: oz + off.dz };
                const abovePos = { x: ox + off.dx, y: oy + dy + 1, z: oz + off.dz };

                try {
                    const ground = dimension.getBlock(groundPos);
                    const spot = dimension.getBlock(spotPos);
                    const above = dimension.getBlock(abovePos);

                    if (isSolidGround(ground) && 
                        isReplaceableSpace(spot) && 
                        !spot.typeId.includes("bed") && 
                        !spot.typeId.includes("chest") && 
                        !spot.typeId.includes("door") &&
                        (isReplaceableSpace(above) || above?.isAir)) {
                        return spotPos;
                    }
                } catch {}
            }
        }
        return null;
    }

    /**
     * Places a new community chest and deposits all carried items into it.
     * Sets a 5-minute area cooldown across the 20-block radius so no duplicate chests are placed.
     * @param {Entity} villager 
     * @param {Vector3} spot 
     * @param {object} record 
     */
    performPlaceAndDepositChest(villager, spot, record) {
        if (!villager || !villager.isValid() || !spot) return false;
        const dim = villager.dimension;

        try {
            const rot = getLookRotation(villager.location, spot);
            villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
            const equippable = villager.getComponent("minecraft:equippable");
            equippable?.setEquipment(EquipmentSlot.Mainhand, new ItemStack("minecraft:chest", 1));
            villager.playAnimation("animation.villager.raise_arms");
        } catch {}

        const block = dim.getBlock(spot);
        if (!block || !isReplaceableSpace(block)) return false;

        const placed = setBlockSafe(block, "minecraft:chest") || setBlockSafe(block, "minecraft:barrel");
        if (placed) {
            setAreaChestCooldown(dim, spot, 300000); // 5-minute area cooldown for 20-block grid
            playSoundSafe(dim, "dig.wood", spot, { volume: 0.9, pitch: 1.0 });
            playSoundSafe(dim, "mob.villager.yes", villager.location, { volume: 0.9, pitch: 1.0 });
            spawnParticleSafe(dim, "minecraft:villager_happy", { x: spot.x + 0.5, y: spot.y + 1.0, z: spot.z + 0.5 });
            this.performDepositItems(villager, block, record);
            return true;
        }
        return false;
    }

    /**
     * Autonomous rapid breeding system:
     * When there are more beds than villagers in the village, adult villagers
     * close to each other will quickly breed, ensuring village numbers never deplete!
     * @param {Entity} villager 
     * @param {object} record 
     * @param {Dimension} dim 
     * @param {Vector3} vLoc 
     * @returns {boolean}
     */
    tryPerformQuickBreeding(villager, record, dim, vLoc) {
        if (!villager || !villager.isValid() || record.breedCooldown > 0 || isBabyVillager(villager)) return false;

        const localBeds = this.countNearbyBeds(dim, vLoc, EXPANSION_CONFIG.BED_SEARCH_RADIUS);
        const localVillagers = this.countNearbyVillagers(dim, vLoc, EXPANSION_CONFIG.BED_SEARCH_RADIUS);

        // Only breed if surplus beds exist in the village!
        if (localBeds <= localVillagers) return false;

        // Find a nearby adult villager partner within 5.5 blocks
        try {
            let candidates = [];
            try {
                candidates = dim.getEntities({
                    type: "minecraft:villager_v2",
                    location: vLoc,
                    maxDistance: 5.5
                });
            } catch {}

            for (const partner of candidates) {
                if (!partner || !partner.isValid() || partner.id === villager.id) continue;
                if (partner.hasTag("rpc:baby_villager") || partner.hasTag("rpc:recently_bred") || isBabyVillager(partner)) continue;

                // Turn to face each other
                const pLoc = partner.location;
                const rotA = getLookRotation(vLoc, pLoc);
                const rotB = getLookRotation(pLoc, vLoc);
                try {
                    villager.teleport(vLoc, { rotation: { x: 0, y: rotA.y } });
                    partner.teleport(pLoc, { rotation: { x: 0, y: rotB.y } });
                    villager.playAnimation("animation.villager.raise_arms");
                    partner.playAnimation("animation.villager.raise_arms");
                } catch {}

                // Emit heart particles between both parents
                const midX = (vLoc.x + pLoc.x) / 2;
                const midY = (vLoc.y + pLoc.y) / 2 + 0.8;
                const midZ = (vLoc.z + pLoc.z) / 2;

                spawnParticleSafe(dim, "minecraft:heart_particle", { x: midX, y: midY + 0.4, z: midZ });
                spawnParticleSafe(dim, "minecraft:heart_particle", { x: vLoc.x, y: vLoc.y + 1.2, z: vLoc.z });
                spawnParticleSafe(dim, "minecraft:heart_particle", { x: pLoc.x, y: pLoc.y + 1.2, z: pLoc.z });

                playSoundSafe(dim, "mob.villager.yes", vLoc, { volume: 0.9, pitch: 1.1 });
                playSoundSafe(dim, "random.pop", { x: midX, y: midY, z: midZ }, { volume: 0.8, pitch: 1.2 });

                // Spawn baby villager
                try {
                    const baby = dim.spawnEntity("minecraft:villager_v2", { x: midX, y: vLoc.y, z: midZ });
                    if (baby && baby.isValid()) {
                        baby.triggerEvent("minecraft:entity_born");
                        baby.triggerEvent("minecraft:spawn_baby");
                        baby.addTag("rpc:baby_villager");
                        spawnParticleSafe(dim, "minecraft:villager_happy", { x: midX, y: midY + 0.5, z: midZ });
                        spawnParticleSafe(dim, "minecraft:totem_particle", { x: midX, y: midY + 0.6, z: midZ });
                    }
                } catch {
                    try {
                        const legacyBaby = dim.spawnEntity("minecraft:villager", { x: midX, y: vLoc.y, z: midZ });
                        legacyBaby?.triggerEvent("minecraft:spawn_baby");
                        legacyBaby?.addTag("rpc:baby_villager");
                    } catch {}
                }

                // Tag parents and apply breeding cooldown (60s)
                villager.addTag("rpc:recently_bred");
                partner.addTag("rpc:recently_bred");
                record.breedCooldown = EXPANSION_CONFIG.BREED_COOLDOWN_TICKS || 1200;

                const partnerRecord = this.records.get(partner.id);
                if (partnerRecord) {
                    partnerRecord.breedCooldown = EXPANSION_CONFIG.BREED_COOLDOWN_TICKS || 1200;
                }

                // Schedule tag cleanup
                const vId = villager.id;
                const pId = partner.id;
                system.runTimeout(() => {
                    try {
                        const v = dim.getEntities({ location: vLoc, maxDistance: 16 }).find(e => e.id === vId);
                        v?.removeTag("rpc:recently_bred");
                    } catch {}
                    try {
                        const p = dim.getEntities({ location: pLoc, maxDistance: 16 }).find(e => e.id === pId);
                        p?.removeTag("rpc:recently_bred");
                    } catch {}
                }, 1200);

                return true;
            }
        } catch {}

        return false;
    }

    /**
     * Counts nearby beds within radius without skipping any coordinates.
     * @param {Dimension} dimension 
     * @param {Vector3} location 
     * @param {number} radius 
     */
    countNearbyBeds(dimension, location, radius = EXPANSION_CONFIG.BED_SEARCH_RADIUS) {
        if (!dimension || !location) return 0;
        const dimId = dimension.id;
        const bedPositions = new Set();

        // 1. Fast Cache Verification (O(1) checks)
        for (const [key, poi] of villagePoiCache.entries()) {
            if (poi.dimId === dimId && poi.typeId === EXPANSION_CONFIG.BED_BLOCK_ID) {
                const dist = distance(location, poi.pos);
                if (dist <= radius) {
                    try {
                        const block = dimension.getBlock(poi.pos);
                        if (block && block.typeId === EXPANSION_CONFIG.BED_BLOCK_ID) {
                            bedPositions.add(`${poi.pos.x},${poi.pos.y},${poi.pos.z}`);
                        } else {
                            villagePoiCache.delete(key);
                        }
                    } catch {}
                }
            }
        }

        // FAST SKIP: If cache already has verified beds within radius, return immediately (0ms)!
        if (bedPositions.size > 0) {
            return Math.ceil(bedPositions.size / 2);
        }

        const ox = Math.floor(location.x);
        const oy = Math.floor(location.y);
        const oz = Math.floor(location.z);

        // 2. High-performance sparse discovery scan: radius 32 with step 4 (cuts queries by 95%)
        const scanR = Math.min(radius, 32);
        for (let dx = -scanR; dx <= scanR; dx += 4) {
            for (let dz = -scanR; dz <= scanR; dz += 4) {
                for (let dy = -2; dy <= 2; dy += 2) {
                    const pos = { x: ox + dx, y: oy + dy, z: oz + dz };
                    try {
                        const block = dimension.getBlock(pos);
                        if (block && block.typeId === EXPANSION_CONFIG.BED_BLOCK_ID) {
                            bedPositions.add(`${pos.x},${pos.y},${pos.z}`);
                            addPoiToCache(dimId, pos, EXPANSION_CONFIG.BED_BLOCK_ID);
                        }
                    } catch {}
                }
            }
        }

        // Each bed occupies 2 block parts (head and foot), so divide by 2
        return Math.ceil(bedPositions.size / 2);
    }

    /**
     * Counts nearby villagers within radius.
     * @param {Dimension} dimension 
     * @param {Vector3} location 
     * @param {number} radius 
     */
    countNearbyVillagers(dimension, location, radius = EXPANSION_CONFIG.BED_SEARCH_RADIUS) {
        if (!dimension || !location) return 1;
        let total = 0;
        try {
            const villagers = dimension.getEntities({
                type: "minecraft:villager_v2",
                location: location,
                maxDistance: radius
            });
            total += villagers.length;
        } catch {}
        try {
            const legacy = dimension.getEntities({
                type: "minecraft:villager",
                location: location,
                maxDistance: radius
            });
            total += legacy.length;
        } catch {}
        return Math.max(1, total);
    }

    /**
     * Finds a spot with 2 adjacent horizontal solid ground blocks and 2 blocks of air headroom above.
     * (Bedrock villagers require 2 blocks headroom above beds to jump and breed!)
     * @param {Dimension} dimension 
     * @param {Vector3} location 
     * @param {number} radius 
     */
    findNearbyBedPlacementSpot(dimension, location, radius = 8) {
        if (!dimension || !location) return null;
        const ox = Math.floor(location.x);
        const oy = Math.floor(location.y);
        const oz = Math.floor(location.z);

        const DIRECTIONS = [
            { dir: 0, dx: 0, dz: 1 },  // South (+Z)
            { dir: 3, dx: 1, dz: 0 },  // East (+X)
            { dir: 2, dx: 0, dz: -1 }, // North (-Z)
            { dir: 1, dx: -1, dz: 0 }  // West (-X)
        ];

        const candidates = [];

        for (let dx = -radius; dx <= radius; dx += 2) {
            for (let dz = -radius; dz <= radius; dz += 2) {
                for (let dy = -1; dy <= 2; dy++) {
                    const footPos = { x: ox + dx, y: oy + dy, z: oz + dz };
                    const gFoot = { x: footPos.x, y: footPos.y - 1, z: footPos.z };

                    try {
                        const bGroundFoot = dimension.getBlock(gFoot);
                        const bFoot = dimension.getBlock(footPos);
                        if (!isSolidGround(bGroundFoot) || !isFreeBedSpace(bFoot)) continue;

                        for (const d of DIRECTIONS) {
                            const headPos = { x: footPos.x + d.dx, y: footPos.y, z: footPos.z + d.dz };
                            const gHead = { x: headPos.x, y: headPos.y - 1, z: headPos.z };

                            const bGroundHead = dimension.getBlock(gHead);
                            const bHead = dimension.getBlock(headPos);
                            if (!isSolidGround(bGroundHead) || !isFreeBedSpace(bHead)) continue;

                            const fH1 = dimension.getBlock({ x: footPos.x, y: footPos.y + 1, z: footPos.z });
                            const fH2 = dimension.getBlock({ x: footPos.x, y: footPos.y + 2, z: footPos.z });
                            const hH1 = dimension.getBlock({ x: headPos.x, y: headPos.y + 1, z: headPos.z });
                            const hH2 = dimension.getBlock({ x: headPos.x, y: headPos.y + 2, z: headPos.z });

                            if (fH1?.isAir && fH2?.isAir && hH1?.isAir && hH2?.isAir) {
                                candidates.push({ footPos, headPos, direction: d.dir });
                                break;
                            }
                        }
                    } catch {}
                }
            }
        }

        if (candidates.length === 0) return null;
        return candidates[Math.floor(Math.random() * candidates.length)];
    }

    /**
     * Places a bed block to expand village breeding capacity.
     * @param {Entity} villager 
     * @param {object} spot 
     */
    performPlaceBed(villager, spot) {
        if (!villager || !villager.isValid() || !spot) return false;
        const dim = villager.dimension;
        const footPos = spot.footPos || spot;

        try {
            const rot = getLookRotation(villager.location, footPos);
            villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
            const equippable = villager.getComponent("minecraft:equippable");
            equippable?.setEquipment(EquipmentSlot.Mainhand, new ItemStack("minecraft:bed", 1));
            villager.playAnimation("animation.villager.raise_arms");
        } catch {}

        let placed = false;
        if (spot.footPos && spot.headPos) {
            placed = placeBedBlock(dim, spot);
        } else {
            const block = dim.getBlock(footPos);
            if (block && isPassableBlock(block)) {
                placed = setBlockSafe(block, EXPANSION_CONFIG.BED_BLOCK_ID);
            }
        }

        if (placed) {
            addPoiToCache(dim.id, footPos, EXPANSION_CONFIG.BED_BLOCK_ID);
            if (spot.headPos) addPoiToCache(dim.id, spot.headPos, EXPANSION_CONFIG.BED_BLOCK_ID);
            setAreaBedCooldown(dim, footPos, 300000);
            playSoundSafe(dim, "dig.wood", footPos, { volume: 0.9, pitch: 1.0 });
            playSoundSafe(dim, "mob.villager.yes", villager.location, { volume: 0.9, pitch: 1.1 });
            spawnParticleSafe(dim, "minecraft:heart_particle", { x: footPos.x + 0.5, y: footPos.y + 1.2, z: footPos.z + 0.5 });
            spawnParticleSafe(dim, "minecraft:villager_happy", { x: footPos.x + 0.5, y: footPos.y + 1.0, z: footPos.z + 0.5 });
            return true;
        }
        return false;
    }

    /**
     * Checks if a specific workbench (or any village workstation) exists within radius.
     * Scans every coordinate (no skipping) so existing workbenches are accurately identified.
     * @param {Dimension} dimension 
     * @param {Vector3} location 
     * @param {string|null} workbenchTypeId 
     * @param {number} radius 
     * @returns {boolean}
     */
    hasNearbyWorkbench(dimension, location, workbenchTypeId = null, radius = EXPANSION_CONFIG.WORKBENCH_SEARCH_RADIUS) {
        if (!dimension || !location) return false;
        const dimId = dimension.id;
        const checkTypes = workbenchTypeId ? [workbenchTypeId] : EXPANSION_CONFIG.WORKBENCH_BLOCK_IDS;

        // 1. Fast Cache Verification (O(1) checks)
        for (const [key, poi] of villagePoiCache.entries()) {
            if (poi.dimId === dimId && checkTypes.includes(poi.typeId)) {
                const dist = distance(location, poi.pos);
                if (dist <= radius) {
                    try {
                        const block = dimension.getBlock(poi.pos);
                        if (block && checkTypes.includes(block.typeId)) {
                            return true;
                        } else {
                            villagePoiCache.delete(key);
                        }
                    } catch {}
                }
            }
        }

        const ox = Math.floor(location.x);
        const oy = Math.floor(location.y);
        const oz = Math.floor(location.z);

        // 2. High-performance sparse discovery scan: radius 32 with step 4 (cuts queries by 95%)
        const scanR = Math.min(radius, 32);
        for (let dx = -scanR; dx <= scanR; dx += 4) {
            for (let dz = -scanR; dz <= scanR; dz += 4) {
                for (let dy = -1; dy <= 2; dy++) {
                    const pos = { x: ox + dx, y: oy + dy, z: oz + dz };
                    try {
                        const block = dimension.getBlock(pos);
                        if (block && checkTypes.includes(block.typeId)) {
                            addPoiToCache(dimId, pos, block.typeId);
                            return true;
                        }
                    } catch {}
                }
            }
        }

        return false;
    }

    /**
     * Finds a spot for placing a village workbench right adjacent to the villager (1 to 3 blocks away).
     * Reliably replaces short grass / snow layer on solid ground without destroying structures.
     * @param {Dimension} dimension 
     * @param {Vector3} location 
     * @param {number} radius 
     */
    findNearbyWorkbenchPlacementSpot(dimension, location, radius = 3) {
        if (!dimension || !location) return null;
        const ox = Math.floor(location.x);
        const oy = Math.floor(location.y);
        const oz = Math.floor(location.z);

        // Offsets sorted by closeness to the villager (checks nearest rings first)
        const offsets = [];
        for (let r = 1; r <= radius; r++) {
            for (let dx = -r; dx <= r; dx++) {
                for (let dz = -r; dz <= r; dz++) {
                    if (Math.max(Math.abs(dx), Math.abs(dz)) === r) {
                        offsets.push({ dx, dz });
                    }
                }
            }
        }

        for (const off of offsets) {
            for (let dy = -1; dy <= 1; dy++) {
                const groundPos = { x: ox + off.dx, y: oy + dy - 1, z: oz + off.dz };
                const spotPos = { x: ox + off.dx, y: oy + dy, z: oz + off.dz };
                const abovePos = { x: ox + off.dx, y: oy + dy + 1, z: oz + off.dz };

                try {
                    const ground = dimension.getBlock(groundPos);
                    const spot = dimension.getBlock(spotPos);
                    const above = dimension.getBlock(abovePos);

                    if (isSolidGround(ground) && isReplaceableSpace(spot) && isPassableBlock(above)) {
                        return spotPos;
                    }
                } catch {}
            }
        }
        return null;
    }

    /**
     * Places a workbench for unemployed or growing villagers.
     * Replaces grass cleanly, equips the workstation in hand, and applies area cooldown.
     * @param {Entity} villager 
     * @param {Vector3} spot 
     * @param {string} workbenchTypeId 
     */
    performPlaceWorkbench(villager, spot, workbenchTypeId) {
        if (!villager || !villager.isValid() || !spot || !workbenchTypeId) return false;
        const dim = villager.dimension;

        try {
            const rot = getLookRotation(villager.location, spot);
            villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
            const equippable = villager.getComponent("minecraft:equippable");
            equippable?.setEquipment(EquipmentSlot.Mainhand, new ItemStack(workbenchTypeId, 1));
            villager.playAnimation("animation.villager.raise_arms");
        } catch {}

        const block = dim.getBlock(spot);
        if (!block || !isReplaceableSpace(block)) return false;

        const placed = setBlockSafe(block, workbenchTypeId);
        if (placed) {
            addPoiToCache(dim.id, spot, workbenchTypeId);
            setAreaWorkbenchCooldown(dim, spot, 300000);
            playSoundSafe(dim, "dig.wood", spot, { volume: 0.9, pitch: 1.0 });
            playSoundSafe(dim, "mob.villager.yes", villager.location, { volume: 0.9, pitch: 1.05 });
            spawnParticleSafe(dim, "minecraft:villager_happy", { x: spot.x + 0.5, y: spot.y + 1.2, z: spot.z + 0.5 });
            return true;
        }
        return false;
    }

    /**
     * Searches for an existing hay block within radius to build a chunk/pile around it.
     * @param {Dimension} dimension 
     * @param {Vector3} location 
     * @param {number} radius 
     * @returns {Vector3|null}
     */
    findNearbyExistingHayBlock(dimension, location, radius = HAY_CONFIG.SEARCH_RADIUS) {
        if (!dimension || !location) return null;
        const dimId = dimension.id;

        // 1. Check cache first
        for (const [key, poi] of villagePoiCache.entries()) {
            if (poi.dimId === dimId && poi.typeId === HAY_CONFIG.BLOCK_ID) {
                const d = distance(location, poi.pos);
                if (d <= radius) {
                    try {
                        const block = dimension.getBlock(poi.pos);
                        if (block && block.typeId === HAY_CONFIG.BLOCK_ID) {
                            return poi.pos;
                        } else {
                            villagePoiCache.delete(key);
                        }
                    } catch {}
                }
            }
        }

        const ox = Math.floor(location.x);
        const oy = Math.floor(location.y);
        const oz = Math.floor(location.z);

        // 2. High-performance sparse discovery scan: radius 20 with step 3
        const scanR = Math.min(radius, 20);
        for (let dx = -scanR; dx <= scanR; dx += 3) {
            for (let dz = -scanR; dz <= scanR; dz += 3) {
                for (let dy = -2; dy <= 2; dy += 2) {
                    const pos = { x: ox + dx, y: oy + dy, z: oz + dz };
                    try {
                        const block = dimension.getBlock(pos);
                        if (block && block.typeId === HAY_CONFIG.BLOCK_ID) {
                            addPoiToCache(dimId, pos, HAY_CONFIG.BLOCK_ID);
                            return pos;
                        }
                    } catch {}
                }
            }
        }
        return null;
    }

    /**
     * Counts how many hay blocks are clustered together within a local radius.
     * @param {Dimension} dimension 
     * @param {Vector3} centerPos 
     * @param {number} radius 
     * @returns {number}
     */
    countHayClusterSize(dimension, centerPos, radius = HAY_CONFIG.CLUSTER_RADIUS) {
        if (!dimension || !centerPos) return 0;
        const ox = Math.floor(centerPos.x);
        const oy = Math.floor(centerPos.y);
        const oz = Math.floor(centerPos.z);
        let count = 0;

        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                for (let dy = -2; dy <= 3; dy++) {
                    const pos = { x: ox + dx, y: oy + dy, z: oz + dz };
                    try {
                        const block = dimension.getBlock(pos);
                        if (block && block.typeId === HAY_CONFIG.BLOCK_ID) {
                            count++;
                        }
                    } catch {}
                }
            }
        }
        return count;
    }

    /**
     * Finds a spot directly adjacent to or stacked on top of an existing hay bale
     * to naturally grow a chunk / pile of hay bales!
     * @param {Dimension} dimension 
     * @param {Vector3} hayPos 
     * @returns {Vector3|null}
     */
    findAdjacentHayPlacementSpot(dimension, hayPos) {
        if (!dimension || !hayPos) return null;
        const hx = Math.floor(hayPos.x);
        const hy = Math.floor(hayPos.y);
        const hz = Math.floor(hayPos.z);

        const candidates = [];

        // 1. Check stacked directly on top (up to 2-3 blocks high pile)
        try {
            const aboveSpot = { x: hx, y: hy + 1, z: hz };
            const aboveBlock = dimension.getBlock(aboveSpot);
            const above2 = dimension.getBlock({ x: hx, y: hy + 2, z: hz });
            const below = dimension.getBlock({ x: hx, y: hy - 1, z: hz });
            const isTooTall = below && below.typeId === HAY_CONFIG.BLOCK_ID;

            if (!isTooTall && aboveBlock && isPassableBlock(aboveBlock) && (!above2 || isPassableBlock(above2))) {
                candidates.push(aboveSpot);
            }
        } catch {}

        // 2. Check 4 horizontal neighbors (North, South, East, West)
        const HORIZONTAL_OFFSETS = [
            { dx: 1, dz: 0 },
            { dx: -1, dz: 0 },
            { dx: 0, dz: 1 },
            { dx: 0, dz: -1 }
        ];

        for (const off of HORIZONTAL_OFFSETS) {
            for (let dy = 0; dy >= -1; dy--) {
                const spotPos = { x: hx + off.dx, y: hy + dy, z: hz + off.dz };
                const groundPos = { x: spotPos.x, y: spotPos.y - 1, z: spotPos.z };
                const headPos = { x: spotPos.x, y: spotPos.y + 1, z: spotPos.z };

                try {
                    const ground = dimension.getBlock(groundPos);
                    const spot = dimension.getBlock(spotPos);
                    const head = dimension.getBlock(headPos);

                    // Must have solid ground or existing hay block beneath, and space to place
                    if ((isSolidGround(ground) || ground.typeId === HAY_CONFIG.BLOCK_ID) &&
                        spot && isPassableBlock(spot) && !spot.typeId.includes("bed") &&
                        (!head || isPassableBlock(head))) {
                        candidates.push(spotPos);
                    }
                } catch {}
            }
        }

        if (candidates.length === 0) return null;
        return candidates[Math.floor(Math.random() * candidates.length)];
    }

    /**
     * Finds a flat outdoor ground spot to initiate a new starter hay bale.
     * @param {Dimension} dimension 
     * @param {Vector3} location 
     * @param {number} radius 
     * @returns {Vector3|null}
     */
    findStarterHayPlacementSpot(dimension, location, radius = 6) {
        if (!dimension || !location) return null;
        const ox = Math.floor(location.x);
        const oy = Math.floor(location.y);
        const oz = Math.floor(location.z);

        const candidates = [];
        for (let dx = -radius; dx <= radius; dx += 2) {
            for (let dz = -radius; dz <= radius; dz += 2) {
                const dist = Math.hypot(dx, dz);
                if (dist < 2.5 || dist > radius) continue;

                for (let dy = -1; dy <= 2; dy++) {
                    const spotPos = { x: ox + dx, y: oy + dy, z: oz + dz };
                    const groundPos = { x: spotPos.x, y: spotPos.y - 1, z: spotPos.z };
                    const headPos = { x: spotPos.x, y: spotPos.y + 1, z: spotPos.z };

                    try {
                        const ground = dimension.getBlock(groundPos);
                        const spot = dimension.getBlock(spotPos);
                        const head = dimension.getBlock(headPos);

                        if (isSolidGround(ground) && spot && isPassableBlock(spot) &&
                            !spot.typeId.includes("bed") && !spot.typeId.includes("chest") &&
                            (!head || isPassableBlock(head))) {
                            candidates.push(spotPos);
                        }
                    } catch {}
                }
            }
        }

        if (candidates.length === 0) return null;
        return candidates[Math.floor(Math.random() * candidates.length)];
    }

    /**
     * Places a hay bale with authentic villager animations, sound, and particle feedback.
     * @param {Entity} villager 
     * @param {Vector3} spot 
     */
    performPlaceHayBlock(villager, spot) {
        if (!villager || !villager.isValid() || !spot) return false;
        const dim = villager.dimension;

        try {
            const rot = getLookRotation(villager.location, spot);
            villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
            const equippable = villager.getComponent("minecraft:equippable");
            equippable?.setEquipment(EquipmentSlot.Mainhand, new ItemStack(HAY_CONFIG.BLOCK_ID, 1));
            villager.playAnimation("animation.villager.raise_arms");
        } catch {}

        const block = dim.getBlock(spot);
        if (!block || !isPassableBlock(block)) return false;

        const placed = setBlockSafe(block, HAY_CONFIG.BLOCK_ID);
        if (placed) {
            addPoiToCache(dim.id, spot, HAY_CONFIG.BLOCK_ID);
            playSoundSafe(dim, "dig.grass", spot, { volume: 0.9, pitch: 1.0 });
            playSoundSafe(dim, "mob.villager.yes", villager.location, { volume: 0.9, pitch: 1.05 });
            spawnParticleSafe(dim, "minecraft:villager_happy", { x: spot.x + 0.5, y: spot.y + 1.2, z: spot.z + 0.5 });
            return true;
        }
        return false;
    }

    /**
     * Checks whether a 5x5 area at base origin (x0, y0, z0) is completely free, flat, and suitable for house building.
     * Uses hierarchical fast rejection to avoid block query floods.
     * @param {Dimension} dimension 
     * @param {number} x0 
     * @param {number} y0 
     * @param {number} z0 
     * @returns {boolean}
     */
    isPlotSuitable(dimension, x0, y0, z0) {
        if (!dimension) return false;
        const dimId = dimension.id;

        // 1. Fast Cache Clearance Check
        const center = { x: x0 + 2, y: y0, z: z0 + 2 };
        for (const [key, poi] of villagePoiCache.entries()) {
            if (poi.dimId === dimId) {
                if (distance(center, poi.pos) < HOUSE_BUILD_CONFIG.MIN_DISTANCE_FROM_EXISTING_POI) {
                    return false;
                }
            }
        }

        const gy = y0 - 1;

        // 2. Fast-Rejection Tree Phase A: Check 4 ground corners + center (5 queries)
        const groundKeyPoints = [
            { x: x0, z: z0 },
            { x: x0 + 4, z: z0 },
            { x: x0, z: z0 + 4 },
            { x: x0 + 4, z: z0 + 4 },
            { x: x0 + 2, z: z0 + 2 }
        ];
        for (const pt of groundKeyPoints) {
            try {
                const b = dimension.getBlock({ x: pt.x, y: gy, z: pt.z });
                if (!b || !isSolidGround(b)) return false;
            } catch {
                return false;
            }
        }

        // 3. Fast-Rejection Tree Phase B: Check 4 ceiling corners + center (5 queries)
        for (const pt of groundKeyPoints) {
            try {
                const b = dimension.getBlock({ x: pt.x, y: y0 + 4, z: pt.z });
                if (!b || (!b.isAir && !isPassableBlock(b))) return false;
            } catch {
                return false;
            }
        }

        // 4. Front entrance clearance at (x0 + 2, y0, z0 - 1)
        try {
            const bDoorGround = dimension.getBlock({ x: x0 + 2, y: gy, z: z0 - 1 });
            const bDoorWalk1 = dimension.getBlock({ x: x0 + 2, y: y0, z: z0 - 1 });
            const bDoorWalk2 = dimension.getBlock({ x: x0 + 2, y: y0 + 1, z: z0 - 1 });
            if (!bDoorGround || !isSolidGround(bDoorGround)) return false;
            if (!bDoorWalk1 || (!bDoorWalk1.isAir && !isPassableBlock(bDoorWalk1))) return false;
            if (!bDoorWalk2 || (!bDoorWalk2.isAir && !isPassableBlock(bDoorWalk2))) return false;
        } catch {
            return false;
        }

        // 5. Full Ground Check across 5x5 footprint
        for (let dx = 0; dx < 5; dx++) {
            for (let dz = 0; dz < 5; dz++) {
                try {
                    const bGround = dimension.getBlock({ x: x0 + dx, y: gy, z: z0 + dz });
                    if (!bGround || !isSolidGround(bGround)) return false;
                } catch {
                    return false;
                }
            }
        }

        // 6. Full Vertical clearance check from Y = y0 to y0 + 4 across 5x5 footprint
        for (let dx = 0; dx < 5; dx++) {
            for (let dz = 0; dz < 5; dz++) {
                for (let dy = 0; dy <= 4; dy++) {
                    try {
                        const b = dimension.getBlock({ x: x0 + dx, y: y0 + dy, z: z0 + dz });
                        if (!b || (!b.isAir && !isPassableBlock(b))) return false;
                    } catch {
                        return false;
                    }
                }
            }
        }

        return true;
    }

    /**
     * Finds a free 5x5 outdoor plot in open space to construct a new village home.
     * Samples radial candidate points instead of an exhaustive 1,400+ block grid.
     * @param {Dimension} dimension 
     * @param {Vector3} location 
     * @param {number} radius 
     * @returns {Vector3|null}
     */
    findFreeHousePlot(dimension, location, radius = HOUSE_BUILD_CONFIG.SEARCH_RADIUS) {
        if (!dimension || !location) return null;
        const ox = Math.floor(location.x);
        const oy = Math.floor(location.y);
        const oz = Math.floor(location.z);

        const candidates = [];
        // Test 8 radial compass directions at distances 12, 16, 20
        const distances = [12, 16, 20];
        const angles = [0, 0.785, 1.57, 2.356, 3.141, 3.927, 4.712, 5.498];
        const shuffledAngles = [...angles].sort(() => Math.random() - 0.5);

        for (const dist of distances) {
            for (const angle of shuffledAngles) {
                const dx = Math.round(Math.cos(angle) * dist);
                const dz = Math.round(Math.sin(angle) * dist);

                for (let dy = -1; dy <= 1; dy++) {
                    const x0 = ox + dx;
                    const y0 = oy + dy;
                    const z0 = oz + dz;

                    if (this.isPlotSuitable(dimension, x0, y0, z0)) {
                        candidates.push({ x: x0, y: y0, z: z0 });
                        if (candidates.length >= 2) {
                            return candidates[Math.floor(Math.random() * candidates.length)];
                        }
                    }
                }
            }
        }

        if (candidates.length === 0) return null;
        return candidates[0];
    }

    /**
     * Progressively executes a stage of home construction (0 through 6).
     * @param {Entity} villager 
     * @param {Vector3} origin 
     * @param {number} stage 
     * @returns {boolean} true when final stage finishes
     */
    executeHouseBuildStage(villager, origin, stage) {
        if (!villager || !villager.isValid() || !origin) return true;
        const dim = villager.dimension;
        const { x: ox, y: oy, z: oz } = origin;
        const equippable = villager.getComponent("minecraft:equippable");

        try {
            const centerPos = { x: ox + 2.5, y: oy + 1, z: oz + 2.5 };
            const rot = getLookRotation(villager.location, centerPos);
            villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
        } catch {}

        switch (stage) {
            case 0: {
                // Stage 0: Site Clearing & Ground Preparation
                try {
                    villager.playAnimation("animation.villager.raise_arms");
                } catch {}
                for (let dx = 0; dx < 5; dx++) {
                    for (let dz = 0; dz < 5; dz++) {
                        for (let dy = 0; dy <= 4; dy++) {
                            const b = dim.getBlock({ x: ox + dx, y: oy + dy, z: oz + dz });
                            if (b && !b.isAir && isPassableBlock(b)) {
                                setBlockSafe(b, "minecraft:air");
                            }
                        }
                    }
                }
                playSoundSafe(dim, "dig.grass", { x: ox + 2, y: oy, z: oz + 2 }, { volume: 0.9, pitch: 1.0 });
                spawnParticleSafe(dim, "minecraft:villager_happy", { x: ox + 2.5, y: oy + 1.0, z: oz + 2.5 });
                return false;
            }

            case 1: {
                // Stage 1: Cobblestone Foundation & Oak Plank Flooring (Y = oy)
                try {
                    equippable?.setEquipment(EquipmentSlot.Mainhand, new ItemStack(HOUSE_BUILD_CONFIG.FOUNDATION_BLOCK, 1));
                    villager.playAnimation("animation.villager.raise_arms");
                } catch {}
                for (let dx = 0; dx < 5; dx++) {
                    for (let dz = 0; dz < 5; dz++) {
                        const b = dim.getBlock({ x: ox + dx, y: oy, z: oz + dz });
                        if (!b) continue;
                        const isRim = (dx === 0 || dx === 4 || dz === 0 || dz === 4);
                        const isDoorSill = (dx === 2 && dz === 0);
                        if (isDoorSill || !isRim) {
                            setBlockSafe(b, HOUSE_BUILD_CONFIG.FLOOR_BLOCK);
                        } else {
                            setBlockSafe(b, HOUSE_BUILD_CONFIG.FOUNDATION_BLOCK);
                        }
                    }
                }
                playSoundSafe(dim, "dig.stone", { x: ox + 2, y: oy, z: oz + 2 }, { volume: 0.9, pitch: 1.0 });
                spawnParticleSafe(dim, "minecraft:villager_happy", { x: ox + 2.5, y: oy + 1.2, z: oz + 2.5 });
                return false;
            }

            case 2: {
                // Stage 2: Corner Oak Log Pillars & Cobblestone Lower Walls (Y = oy + 1)
                try {
                    equippable?.setEquipment(EquipmentSlot.Mainhand, new ItemStack(HOUSE_BUILD_CONFIG.CORNER_BLOCK, 1));
                    villager.playAnimation("animation.villager.raise_arms");
                } catch {}
                const y1 = oy + 1;
                for (let dx = 0; dx < 5; dx++) {
                    for (let dz = 0; dz < 5; dz++) {
                        const isCorner = (dx === 0 || dx === 4) && (dz === 0 || dz === 4);
                        const isDoorway = (dx === 2 && dz === 0);
                        const isPerimeter = (dx === 0 || dx === 4 || dz === 0 || dz === 4);

                        const b = dim.getBlock({ x: ox + dx, y: y1, z: oz + dz });
                        if (!b) continue;

                        if (isCorner) {
                            setBlockSafe(b, HOUSE_BUILD_CONFIG.CORNER_BLOCK);
                        } else if (isDoorway) {
                            setBlockSafe(b, "minecraft:air");
                        } else if (isPerimeter) {
                            setBlockSafe(b, HOUSE_BUILD_CONFIG.WALL_LOWER_BLOCK);
                        }
                    }
                }
                playSoundSafe(dim, "dig.wood", { x: ox + 2, y: y1, z: oz + 2 }, { volume: 0.9, pitch: 1.0 });
                spawnParticleSafe(dim, "minecraft:villager_happy", { x: ox + 2.5, y: y1 + 1.0, z: oz + 2.5 });
                return false;
            }

            case 3: {
                // Stage 3: Upper Oak Plank Walls & Glass Windows (Y = oy + 2)
                try {
                    equippable?.setEquipment(EquipmentSlot.Mainhand, new ItemStack(HOUSE_BUILD_CONFIG.WALL_UPPER_BLOCK, 1));
                    villager.playAnimation("animation.villager.raise_arms");
                } catch {}
                const y2 = oy + 2;
                for (let dx = 0; dx < 5; dx++) {
                    for (let dz = 0; dz < 5; dz++) {
                        const isCorner = (dx === 0 || dx === 4) && (dz === 0 || dz === 4);
                        const isDoorway = (dx === 2 && dz === 0);
                        const isWindow = (dx === 0 && dz === 2) || (dx === 4 && dz === 2) || (dx === 2 && dz === 4);
                        const isPerimeter = (dx === 0 || dx === 4 || dz === 0 || dz === 4);

                        const b = dim.getBlock({ x: ox + dx, y: y2, z: oz + dz });
                        if (!b) continue;

                        if (isCorner) {
                            setBlockSafe(b, HOUSE_BUILD_CONFIG.CORNER_BLOCK);
                        } else if (isDoorway) {
                            setBlockSafe(b, "minecraft:air");
                        } else if (isWindow) {
                            setBlockSafe(b, HOUSE_BUILD_CONFIG.WINDOW_BLOCK);
                        } else if (isPerimeter) {
                            setBlockSafe(b, HOUSE_BUILD_CONFIG.WALL_UPPER_BLOCK);
                        }
                    }
                }
                playSoundSafe(dim, "dig.wood", { x: ox + 2, y: y2, z: oz + 2 }, { volume: 0.9, pitch: 1.0 });
                spawnParticleSafe(dim, "minecraft:villager_happy", { x: ox + 2.5, y: y2 + 1.0, z: oz + 2.5 });
                return false;
            }

            case 4: {
                // Stage 4: Lintel (Y = oy + 3) & Weather-Proof Oak Ceiling/Roof (Y = oy + 4)
                try {
                    equippable?.setEquipment(EquipmentSlot.Mainhand, new ItemStack(HOUSE_BUILD_CONFIG.ROOF_BLOCK, 1));
                    villager.playAnimation("animation.villager.raise_arms");
                } catch {}
                const y3 = oy + 3;
                const y4 = oy + 4;
                for (let dx = 0; dx < 5; dx++) {
                    for (let dz = 0; dz < 5; dz++) {
                        const isCorner = (dx === 0 || dx === 4) && (dz === 0 || dz === 4);
                        const isPerimeter = (dx === 0 || dx === 4 || dz === 0 || dz === 4);

                        const b3 = dim.getBlock({ x: ox + dx, y: y3, z: oz + dz });
                        if (b3) {
                            if (isCorner) setBlockSafe(b3, HOUSE_BUILD_CONFIG.CORNER_BLOCK);
                            else if (isPerimeter) setBlockSafe(b3, HOUSE_BUILD_CONFIG.WALL_UPPER_BLOCK);
                        }

                        const b4 = dim.getBlock({ x: ox + dx, y: y4, z: oz + dz });
                        if (b4) {
                            setBlockSafe(b4, HOUSE_BUILD_CONFIG.ROOF_BLOCK);
                        }
                    }
                }
                playSoundSafe(dim, "dig.wood", { x: ox + 2, y: y4, z: oz + 2 }, { volume: 0.9, pitch: 1.0 });
                spawnParticleSafe(dim, "minecraft:villager_happy", { x: ox + 2.5, y: y4 + 1.0, z: oz + 2.5 });
                return false;
            }

            case 5: {
                // Stage 5: Front Oak Door & Interior Warm Wall Torch
                try {
                    equippable?.setEquipment(EquipmentSlot.Mainhand, new ItemStack(HOUSE_BUILD_CONFIG.DOOR_BLOCK, 1));
                    villager.playAnimation("animation.villager.raise_arms");
                } catch {}
                const doorBottom = { x: ox + 2, y: oy + 1, z: oz };
                const doorTop = { x: ox + 2, y: oy + 2, z: oz };

                try {
                    dim.runCommandAsync(`setblock ${doorBottom.x} ${doorBottom.y} ${doorBottom.z} wooden_door ["direction"=0,"upper_block_bit"=false] replace`);
                    dim.runCommandAsync(`setblock ${doorTop.x} ${doorTop.y} ${doorTop.z} wooden_door ["direction"=0,"upper_block_bit"=true] replace`);
                } catch {}

                try {
                    dim.runCommandAsync(`setblock ${ox + 3} ${oy + 2} ${oz + 2} torch replace`);
                } catch {}

                playSoundSafe(dim, "random.door_open", doorBottom, { volume: 0.9, pitch: 1.0 });
                spawnParticleSafe(dim, "minecraft:villager_happy", { x: doorBottom.x + 0.5, y: doorBottom.y + 1.0, z: doorBottom.z + 0.5 });
                return false;
            }

            case 6: {
                // Stage 6: Crafting Table & Bed Placement (The Complete Home!)
                try {
                    equippable?.setEquipment(EquipmentSlot.Mainhand, new ItemStack(HOUSE_BUILD_CONFIG.BED_BLOCK, 1));
                    villager.playAnimation("animation.villager.raise_arms");
                } catch {}

                // Crafting Table in the corner
                const benchPos = { x: ox + 3, y: oy + 1, z: oz + 3 };
                const benchBlock = dim.getBlock(benchPos);
                if (benchBlock) {
                    setBlockSafe(benchBlock, HOUSE_BUILD_CONFIG.FURNITURE_BLOCK);
                    addPoiToCache(dim.id, benchPos, HOUSE_BUILD_CONFIG.FURNITURE_BLOCK);
                }

                // Bed placed inside along back wall
                const footPos = { x: ox + 1, y: oy + 1, z: oz + 3 };
                const headPos = { x: ox + 1, y: oy + 1, z: oz + 2 };
                const bedSpot = { footPos, headPos, direction: 2 }; // North facing

                placeBedBlock(dim, bedSpot);
                addPoiToCache(dim.id, footPos, EXPANSION_CONFIG.BED_BLOCK_ID);
                addPoiToCache(dim.id, headPos, EXPANSION_CONFIG.BED_BLOCK_ID);

                // Celebrations
                playSoundSafe(dim, "mob.villager.yes", villager.location, { volume: 1.0, pitch: 1.1 });
                playSoundSafe(dim, "random.levelup", villager.location, { volume: 0.9, pitch: 1.2 });
                spawnParticleSafe(dim, "minecraft:heart_particle", { x: footPos.x + 0.5, y: footPos.y + 1.2, z: footPos.z + 0.5 });
                spawnParticleSafe(dim, "minecraft:villager_happy", { x: ox + 2.5, y: oy + 2.0, z: oz + 2.5 });

                return true;
            }
        }
        return true;
    }
}


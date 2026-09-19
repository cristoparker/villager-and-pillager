/**
 * Fisherman Villager Addon - Shepherd Manager Module (Namespace: rpc)
 * Coordinates detection of shepherd villagers, ensures 2 starter sheep spawn connected with leashes,
 * equips shears in hand, oversees native non-jumping movement towards sheep,
 * executes authentic shearing routines, and enforces day/night sleeping schedules.
 */

import { world } from "@minecraft/server";
import { SHEPHERD_CONFIG } from "./config.js";
import { distance } from "./utils.js";
import { 
    equipShears, 
    unequipShears, 
    isShearableSheep, 
    findNearbyShearableSheep, 
    spawnStarterSheep, 
    performShear 
} from "./shepherdBehavior.js";

export const ShepherdState = {
    IDLE: "IDLE",
    APPROACHING: "APPROACHING",
    SHEARING: "SHEARING",
    COOLDOWN: "COOLDOWN",
    SLEEPING: "SLEEPING"
};

export class ShepherdManager {
    constructor() {
        /** @type {Map<string, { state: string, villager: Entity, targetSheep: Entity|null, timer: number }>} */
        this.records = new Map();
        this.scanCooldownTicks = 0;
    }

    /**
     * Checks if it is currently nighttime in the overworld (clock 12000 to 23500).
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
     * Checks if an entity is a Shepherd villager.
     * @param {Entity} entity 
     * @returns {boolean}
     */
    isShepherdVillager(entity) {
        if (!entity || !entity.isValid()) return false;

        try {
            if (entity.matches({ families: ["shepherd"] })) return true;
        } catch {}

        try {
            if (entity.hasTag("rpc:shepherd") || entity.hasTag("shepherd")) return true;
        } catch {}

        try {
            if (entity.nameTag && entity.nameTag.toLowerCase().includes("shepherd")) return true;
        } catch {}

        try {
            const variantComp = entity.getComponent("minecraft:variant");
            if (variantComp && variantComp.value === 3) return true;
        } catch {}

        return false;
    }

    /**
     * Scans loaded chunks for shepherd villagers.
     */
    scanForShepherds() {
        const overworld = world.getDimension("overworld");
        if (!overworld) return;

        let villagers = [];
        try {
            villagers = overworld.getEntities({ type: "minecraft:villager_v2" });
        } catch {
            try {
                villagers = overworld.getEntities({ type: "minecraft:villager" });
            } catch {}
        }

        for (const villager of villagers) {
            if (!this.records.has(villager.id)) {
                if (this.isShepherdVillager(villager)) {
                    this.registerShepherd(villager);
                }
            }
        }
    }

    /**
     * Registers a new shepherd villager and initializes starter sheep if needed.
     * @param {Entity} villager 
     */
    registerShepherd(villager) {
        if (!villager || this.records.has(villager.id)) return;

        // Spawn 2 leashed sheep if this shepherd has never spawned them yet
        if (!villager.hasTag("rpc:shepherd_sheeps_spawned")) {
            villager.addTag("rpc:shepherd_sheeps_spawned");
            spawnStarterSheep(villager);
        }

        // Equip shears in hand during daytime
        const isNight = this.isNightTime();
        if (!isNight) {
            equipShears(villager);
        }

        this.records.set(villager.id, {
            state: isNight ? ShepherdState.SLEEPING : ShepherdState.IDLE,
            villager: villager,
            targetSheep: null,
            timer: 20
        });
    }

    /**
     * Main update tick executed every game tick.
     */
    update() {
        // Scan for new shepherds every 30 ticks (1.5 seconds)
        this.scanCooldownTicks++;
        if (this.scanCooldownTicks >= 30) {
            this.scanCooldownTicks = 0;
            this.scanForShepherds();
        }

        const isNight = this.isNightTime();

        for (const [id, record] of this.records.entries()) {
            const { villager } = record;

            // Handle despawned or unloaded entities
            if (!villager || !villager.isValid()) {
                this.records.delete(id);
                continue;
            }

            // NIGHTTIME CHECK: Put away shears and sleep
            if (isNight && record.state !== ShepherdState.SLEEPING) {
                unequipShears(villager);
                try {
                    villager.triggerEvent("minecraft:schedule_bed_villager");
                } catch {}

                record.state = ShepherdState.SLEEPING;
                record.targetSheep = null;
                continue;
            }

            this.updateShepherd(record, isNight);
        }
    }

    /**
     * Updates an individual shepherd's cycle.
     * @param {object} record 
     * @param {boolean} isNight 
     */
    updateShepherd(record, isNight) {
        const { villager } = record;

        switch (record.state) {
            case ShepherdState.SLEEPING: {
                // Wait for sunrise
                if (!isNight) {
                    try {
                        villager.triggerEvent("minecraft:schedule_work");
                    } catch {}
                    equipShears(villager);
                    record.state = ShepherdState.IDLE;
                    record.timer = 40; // Give time to wake up
                }
                break;
            }

            case ShepherdState.IDLE: {
                record.timer--;
                if (record.timer <= 0) {
                    record.timer = 20; // Scan every 1 second

                    // Ensure shears are equipped
                    equipShears(villager);

                    // Scan for closest shearable sheep
                    const sheep = findNearbyShearableSheep(villager.dimension, villager.location, SHEPHERD_CONFIG.SHEEP_SEARCH_RADIUS);
                    if (sheep) {
                        record.targetSheep = sheep;
                        const dist = distance(villager.location, sheep.location);
                        if (dist <= SHEPHERD_CONFIG.SHEAR_DISTANCE) {
                            record.state = ShepherdState.SHEARING;
                            record.timer = SHEPHERD_CONFIG.SHEAR_ANIMATION_TICKS;
                        } else {
                            record.state = ShepherdState.APPROACHING;
                            record.timer = 120; // Max 6 seconds pursuing this sheep
                        }
                    }
                }
                break;
            }

            case ShepherdState.APPROACHING: {
                record.timer--;

                // Target sheep became invalid or already sheared
                if (!record.targetSheep || !record.targetSheep.isValid() || !isShearableSheep(record.targetSheep)) {
                    record.state = ShepherdState.IDLE;
                    record.targetSheep = null;
                    record.timer = 10;
                    break;
                }

                // Check distance: shepherd moves using native follow_mob behavior
                const dist = distance(villager.location, record.targetSheep.location);
                if (dist <= SHEPHERD_CONFIG.SHEAR_DISTANCE) {
                    record.state = ShepherdState.SHEARING;
                    record.timer = SHEPHERD_CONFIG.SHEAR_ANIMATION_TICKS;
                } else if (record.timer <= 0) {
                    // Timeout approaching this sheep, pick new sheep or idle
                    record.state = ShepherdState.IDLE;
                    record.targetSheep = null;
                    record.timer = 20;
                }
                break;
            }

            case ShepherdState.SHEARING: {
                record.timer--;

                if (record.timer <= 0) {
                    if (record.targetSheep && record.targetSheep.isValid() && isShearableSheep(record.targetSheep)) {
                        performShear(villager, record.targetSheep);
                    }

                    record.targetSheep = null;
                    record.state = ShepherdState.COOLDOWN;
                    record.timer = SHEPHERD_CONFIG.SHEAR_COOLDOWN_TICKS;
                }
                break;
            }

            case ShepherdState.COOLDOWN: {
                record.timer--;
                if (record.timer <= 0) {
                    record.state = ShepherdState.IDLE;
                    record.timer = 10;
                }
                break;
            }
        }
    }

    /**
     * Entity spawn listener helper.
     * @param {Entity} entity 
     */
    onEntitySpawn(entity) {
        if (this.isShepherdVillager(entity)) {
            this.registerShepherd(entity);
        }
    }
}

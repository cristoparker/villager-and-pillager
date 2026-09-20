/**
 * Fisherman Villager Addon - Shepherd Manager Module (Namespace: rpc)
 * Coordinates detection of shepherd villagers, ensures 2 starter sheep spawn connected with leashes,
 * equips shears in hand, oversees native non-jumping movement towards sheep,
 * executes authentic shearing routines, and enforces day/night sleeping schedules.
 */

import { world } from "@minecraft/server";
import { SHEPHERD_CONFIG } from "./config.js";
import { distance } from "./utils.js";
import { getVillagerProfession } from "./professionHelper.js";
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

        const liveProf = getVillagerProfession(entity);
        if (liveProf !== null) {
            return liveProf === "shepherd";
        }

        try {
            if (entity.hasTag("rpc:shepherd") || entity.hasTag("shepherd")) return true;
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
                } else {
                    // Safety check: if an entity is NOT a shepherd but happens to hold shears, unequip it
                    try {
                        const equippable = villager.getComponent("minecraft:equippable");
                        const item = equippable?.getEquipment("Mainhand");
                        if (item && (item.typeId === "minecraft:shears" || item.typeId === "rpc:shears")) {
                            unequipShears(villager);
                        }
                    } catch {}
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
            try {
                villager.triggerEvent("minecraft:schedule_wander_villager");
            } catch {}
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

            // Handle despawned, unloaded, or changed entities
            if (!villager || !villager.isValid() || !this.isShepherdVillager(villager)) {
                if (villager && villager.isValid()) {
                    try { villager.triggerEvent("rpc:stop_approach_sheep"); } catch {}
                    unequipShears(villager);
                }
                this.records.delete(id);
                continue;
            }

            // NIGHTTIME CHECK: Put away shears and sleep
            if (isNight && record.state !== ShepherdState.SLEEPING) {
                try { villager.triggerEvent("rpc:stop_approach_sheep"); } catch {}
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
                        villager.triggerEvent("minecraft:schedule_wander_villager");
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
                            try {
                                villager.triggerEvent("rpc:start_approach_sheep");
                            } catch {}
                        }
                    }
                }
                break;
            }

            case ShepherdState.APPROACHING: {
                record.timer--;

                // Target sheep became invalid or already sheared
                if (!record.targetSheep || !record.targetSheep.isValid() || !isShearableSheep(record.targetSheep)) {
                    try {
                        villager.triggerEvent("rpc:stop_approach_sheep");
                    } catch {}
                    record.state = ShepherdState.IDLE;
                    record.targetSheep = null;
                    record.timer = 10;
                    break;
                }

                // Check distance: shepherd moves using native follow_mob behavior
                const dist = distance(villager.location, record.targetSheep.location);
                if (dist <= SHEPHERD_CONFIG.SHEAR_DISTANCE) {
                    try {
                        villager.triggerEvent("rpc:stop_approach_sheep");
                    } catch {}
                    record.state = ShepherdState.SHEARING;
                    record.timer = SHEPHERD_CONFIG.SHEAR_ANIMATION_TICKS;
                } else if (record.timer <= 0) {
                    // Timeout approaching this sheep, pick new sheep or idle
                    try {
                        villager.triggerEvent("rpc:stop_approach_sheep");
                    } catch {}
                    record.state = ShepherdState.IDLE;
                    record.targetSheep = null;
                    record.timer = 20;
                    try {
                        villager.triggerEvent("minecraft:schedule_wander_villager");
                    } catch {}
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
                    try {
                        villager.triggerEvent("minecraft:schedule_wander_villager");
                    } catch {}
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

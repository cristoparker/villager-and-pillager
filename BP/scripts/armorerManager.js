/**
 * Villager Professions Addon - Armorer Manager Module (Namespace: rpc)
 * Coordinates detection of Armorer villagers, equips iron ingot in hand,
 * scans for damaged Iron Golems to repair, interacts with blast furnaces,
 * and enforces day/night sleeping schedules.
 */

import { world } from "@minecraft/server";
import { ARMORER_CONFIG } from "./config.js";
import { distance } from "./utils.js";
import { getVillagerProfession } from "./professionHelper.js";
import {
    equipIngot,
    unequipIngot,
    findNearbyDamagedGolem,
    findNearbyBlastFurnace,
    performRepairGolem,
    performForgeArmor
} from "./armorerBehavior.js";

export const ArmorerState = {
    IDLE: "IDLE",
    APPROACHING_GOLEM: "APPROACHING_GOLEM",
    REPAIRING: "REPAIRING",
    APPROACHING_FURNACE: "APPROACHING_FURNACE",
    FORGING: "FORGING",
    COOLDOWN: "COOLDOWN",
    SLEEPING: "SLEEPING"
};

export class ArmorerManager {
    constructor() {
        /** @type {Map<string, { state: string, villager: Entity, targetGolem: Entity|null, blastFurnace: any, timer: number }>} */
        this.records = new Map();
        this.scanCooldownTicks = 0;
    }

    /**
     * Checks if it is currently nighttime in the overworld.
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
     * Checks if an entity is an Armorer villager.
     * @param {Entity} entity 
     * @returns {boolean}
     */
    isArmorerVillager(entity) {
        if (!entity || !entity.isValid()) return false;

        const liveProf = getVillagerProfession(entity);
        if (liveProf !== null) {
            return liveProf === "armorer";
        }

        try {
            if (entity.hasTag("rpc:armorer") || entity.hasTag("armorer")) return true;
        } catch {}

        return false;
    }

    /**
     * Scans loaded entities for Armorer villagers.
     */
    scanForArmorers() {
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
                if (this.isArmorerVillager(villager)) {
                    this.registerArmorer(villager);
                }
            }
        }
    }

    /**
     * Registers a new Armorer villager.
     * @param {Entity} villager 
     */
    registerArmorer(villager) {
        if (!villager || !villager.isValid()) return;

        equipIngot(villager);

        this.records.set(villager.id, {
            state: ArmorerState.IDLE,
            villager: villager,
            targetGolem: null,
            blastFurnace: null,
            timer: 20
        });
    }

    /**
     * Called when an entity spawns or transforms.
     * @param {Entity} entity 
     */
    onEntitySpawn(entity) {
        if (this.isArmorerVillager(entity)) {
            this.registerArmorer(entity);
        }
    }

    /**
     * Main update tick loop.
     */
    update() {
        this.scanCooldownTicks++;
        if (this.scanCooldownTicks >= 30) {
            this.scanCooldownTicks = 0;
            this.scanForArmorers();
        }

        const isNight = this.isNightTime();

        for (const [id, record] of this.records.entries()) {
            const { villager } = record;

            if (!villager || !villager.isValid() || !this.isArmorerVillager(villager)) {
                if (villager && villager.isValid()) {
                    unequipIngot(villager);
                }
                this.records.delete(id);
                continue;
            }

            if (isNight && record.state !== ArmorerState.SLEEPING) {
                unequipIngot(villager);
                try {
                    villager.triggerEvent("minecraft:schedule_bed_villager");
                } catch {}

                record.state = ArmorerState.SLEEPING;
                record.targetGolem = null;
                record.blastFurnace = null;
                continue;
            }

            this.updateArmorer(record, isNight);
        }
    }

    /**
     * Updates an individual Armorer's routine.
     * @param {object} record 
     * @param {boolean} isNight 
     */
    updateArmorer(record, isNight) {
        const { villager } = record;

        switch (record.state) {
            case ArmorerState.SLEEPING: {
                if (!isNight) {
                    try {
                        villager.triggerEvent("minecraft:schedule_wander_villager");
                    } catch {}
                    equipIngot(villager);
                    record.state = ArmorerState.IDLE;
                    record.timer = 40;
                }
                break;
            }

            case ArmorerState.IDLE: {
                record.timer--;
                if (record.timer <= 0) {
                    record.timer = 25;
                    equipIngot(villager);

                    // 1. Scan for damaged Iron Golems
                    const golem = findNearbyDamagedGolem(villager.dimension, villager.location, ARMORER_CONFIG.GOLEM_SEARCH_RADIUS);
                    if (golem) {
                        record.targetGolem = golem;
                        const dist = distance(villager.location, golem.location);
                        if (dist <= ARMORER_CONFIG.REPAIR_DISTANCE) {
                            record.state = ArmorerState.REPAIRING;
                            record.timer = ARMORER_CONFIG.REPAIR_ANIMATION_TICKS;
                        } else {
                            record.state = ArmorerState.APPROACHING_GOLEM;
                            record.timer = 100;
                        }
                        break;
                    }

                    // 2. Visit Blast Furnace
                    if (Math.random() < 0.3) {
                        const furnace = findNearbyBlastFurnace(villager.dimension, villager.location, 14);
                        if (furnace) {
                            record.blastFurnace = furnace;
                            record.state = ArmorerState.APPROACHING_FURNACE;
                            record.timer = 100;
                            break;
                        }
                    }
                }
                break;
            }

            case ArmorerState.APPROACHING_GOLEM: {
                record.timer--;

                if (!record.targetGolem || !record.targetGolem.isValid()) {
                    record.state = ArmorerState.IDLE;
                    record.targetGolem = null;
                    record.timer = 10;
                    break;
                }

                const dist = distance(villager.location, record.targetGolem.location);
                if (dist <= ARMORER_CONFIG.REPAIR_DISTANCE) {
                    record.state = ArmorerState.REPAIRING;
                    record.timer = ARMORER_CONFIG.REPAIR_ANIMATION_TICKS;
                } else if (record.timer <= 0) {
                    if (dist <= 6.0) {
                        record.state = ArmorerState.REPAIRING;
                        record.timer = ARMORER_CONFIG.REPAIR_ANIMATION_TICKS;
                    } else {
                        record.state = ArmorerState.IDLE;
                        record.targetGolem = null;
                        record.timer = 20;
                    }
                }
                break;
            }

            case ArmorerState.REPAIRING: {
                record.timer--;
                if (record.timer <= 0) {
                    if (record.targetGolem && record.targetGolem.isValid()) {
                        performRepairGolem(villager, record.targetGolem);
                    }
                    record.targetGolem = null;
                    record.state = ArmorerState.COOLDOWN;
                    record.timer = ARMORER_CONFIG.REPAIR_COOLDOWN_TICKS;
                }
                break;
            }

            case ArmorerState.APPROACHING_FURNACE: {
                record.timer--;
                if (!record.blastFurnace) {
                    record.state = ArmorerState.IDLE;
                    break;
                }

                const dist = distance(villager.location, record.blastFurnace.pos);
                if (dist <= 2.8) {
                    record.state = ArmorerState.FORGING;
                    record.timer = 24;
                } else if (record.timer <= 0) {
                    record.state = ArmorerState.IDLE;
                    record.blastFurnace = null;
                    record.timer = 20;
                }
                break;
            }

            case ArmorerState.FORGING: {
                record.timer--;
                if (record.timer <= 0) {
                    if (record.blastFurnace) {
                        performForgeArmor(villager, record.blastFurnace);
                    }
                    record.blastFurnace = null;
                    record.state = ArmorerState.COOLDOWN;
                    record.timer = 40;
                }
                break;
            }

            case ArmorerState.COOLDOWN: {
                record.timer--;
                if (record.timer <= 0) {
                    record.state = ArmorerState.IDLE;
                    record.timer = 15;
                }
                break;
            }
        }
    }
}

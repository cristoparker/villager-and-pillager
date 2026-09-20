/**
 * Villager Professions Addon - Farmer Manager Module (Namespace: rpc)
 * Coordinates detection of Farmer villagers, equips iron hoe in hand,
 * scans for ripe crops (wheat, carrots, potatoes, beetroot), manages harvesting & replanting,
 * handles composter interaction, and enforces day/night sleeping schedules.
 */

import { world } from "@minecraft/server";
import { FARMER_CONFIG } from "./config.js";
import { distance } from "./utils.js";
import {
    equipHoe,
    unequipHoe,
    findNearbyRipeCrop,
    findNearbyComposter,
    performHarvest,
    performCompost
} from "./farmerBehavior.js";

export const FarmerState = {
    IDLE: "IDLE",
    APPROACHING_CROP: "APPROACHING_CROP",
    HARVESTING: "HARVESTING",
    APPROACHING_COMPOSTER: "APPROACHING_COMPOSTER",
    COMPOSTING: "COMPOSTING",
    COOLDOWN: "COOLDOWN",
    SLEEPING: "SLEEPING"
};

export class FarmerManager {
    constructor() {
        /** @type {Map<string, { state: string, villager: Entity, targetCrop: any, composter: any, timer: number }>} */
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
     * Checks if an entity is a Farmer villager.
     * @param {Entity} entity 
     * @returns {boolean}
     */
    isFarmerVillager(entity) {
        if (!entity || !entity.isValid()) return false;

        // Exclude other custom professions
        try {
            if (entity.hasTag("rpc:butcher") || entity.hasTag("rpc:fletcher") || entity.hasTag("rpc:fisherman") || entity.hasTag("rpc:shepherd")) {
                return false;
            }
        } catch {}

        try {
            if (entity.matches({ families: ["farmer"] })) return true;
        } catch {}

        try {
            if (entity.hasTag("rpc:farmer") || entity.hasTag("farmer")) return true;
        } catch {}

        try {
            if (entity.nameTag && entity.nameTag.toLowerCase().includes("farmer")) return true;
        } catch {}

        try {
            const variantComp = entity.getComponent("minecraft:variant");
            if (variantComp && variantComp.value === 1) return true;
        } catch {}

        return false;
    }

    /**
     * Scans loaded entities for Farmer villagers.
     */
    scanForFarmers() {
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
                if (this.isFarmerVillager(villager)) {
                    this.registerFarmer(villager);
                }
            }
        }
    }

    /**
     * Registers a new Farmer villager into the manager.
     * @param {Entity} villager 
     */
    registerFarmer(villager) {
        if (!villager || !villager.isValid()) return;

        equipHoe(villager);

        this.records.set(villager.id, {
            state: FarmerState.IDLE,
            villager: villager,
            targetCrop: null,
            composter: null,
            timer: 20
        });
    }

    /**
     * Called when an entity spawns or is transformed.
     * @param {Entity} entity 
     */
    onEntitySpawn(entity) {
        if (this.isFarmerVillager(entity)) {
            this.registerFarmer(entity);
        }
    }

    /**
     * Main update tick executed every game tick.
     */
    update() {
        this.scanCooldownTicks++;
        if (this.scanCooldownTicks >= 30) {
            this.scanCooldownTicks = 0;
            this.scanForFarmers();
        }

        const isNight = this.isNightTime();

        for (const [id, record] of this.records.entries()) {
            const { villager } = record;

            if (!villager || !villager.isValid() || !this.isFarmerVillager(villager)) {
                if (villager && villager.isValid()) {
                    unequipHoe(villager);
                }
                this.records.delete(id);
                continue;
            }

            if (isNight && record.state !== FarmerState.SLEEPING) {
                unequipHoe(villager);
                try {
                    villager.triggerEvent("minecraft:schedule_bed_villager");
                } catch {}

                record.state = FarmerState.SLEEPING;
                record.targetCrop = null;
                record.composter = null;
                continue;
            }

            this.updateFarmer(record, isNight);
        }
    }

    /**
     * Updates an individual Farmer's routine.
     * @param {object} record 
     * @param {boolean} isNight 
     */
    updateFarmer(record, isNight) {
        const { villager } = record;

        switch (record.state) {
            case FarmerState.SLEEPING: {
                if (!isNight) {
                    try {
                        villager.triggerEvent("minecraft:schedule_work_farmer");
                    } catch {}
                    equipHoe(villager);
                    record.state = FarmerState.IDLE;
                    record.timer = 40;
                }
                break;
            }

            case FarmerState.IDLE: {
                record.timer--;
                if (record.timer <= 0) {
                    record.timer = 25;
                    equipHoe(villager);

                    // 1. Scan for ripe crops
                    const ripeCrop = findNearbyRipeCrop(villager.dimension, villager.location, FARMER_CONFIG.CROP_SEARCH_RADIUS);
                    if (ripeCrop) {
                        record.targetCrop = ripeCrop;
                        const dist = distance(villager.location, ripeCrop.pos);
                        if (dist <= FARMER_CONFIG.CROP_HARVEST_DISTANCE) {
                            record.state = FarmerState.HARVESTING;
                            record.timer = FARMER_CONFIG.HARVEST_ANIMATION_TICKS;
                        } else {
                            record.state = FarmerState.APPROACHING_CROP;
                            record.timer = 120; // 6 seconds to approach
                        }
                        break;
                    }

                    // 2. Occasionally visit composter if available
                    if (Math.random() < 0.25) {
                        const composter = findNearbyComposter(villager.dimension, villager.location, 14);
                        if (composter) {
                            record.composter = composter;
                            record.state = FarmerState.APPROACHING_COMPOSTER;
                            record.timer = 100;
                            break;
                        }
                    }
                }
                break;
            }

            case FarmerState.APPROACHING_CROP: {
                record.timer--;

                if (!record.targetCrop || !record.targetCrop.block) {
                    record.state = FarmerState.IDLE;
                    record.targetCrop = null;
                    record.timer = 10;
                    break;
                }

                const dist = distance(villager.location, record.targetCrop.pos);
                if (dist <= FARMER_CONFIG.CROP_HARVEST_DISTANCE) {
                    record.state = FarmerState.HARVESTING;
                    record.timer = FARMER_CONFIG.HARVEST_ANIMATION_TICKS;
                } else if (record.timer <= 0) {
                    // Harvest anyway if within moderate range (up to 4 blocks) or return to idle
                    if (dist <= 4.0) {
                        record.state = FarmerState.HARVESTING;
                        record.timer = FARMER_CONFIG.HARVEST_ANIMATION_TICKS;
                    } else {
                        record.state = FarmerState.IDLE;
                        record.targetCrop = null;
                        record.timer = 20;
                    }
                }
                break;
            }

            case FarmerState.HARVESTING: {
                record.timer--;
                if (record.timer <= 0) {
                    if (record.targetCrop) {
                        performHarvest(villager, record.targetCrop);
                    }
                    record.targetCrop = null;
                    record.state = FarmerState.COOLDOWN;
                    record.timer = FARMER_CONFIG.COOLDOWN_TICKS;
                }
                break;
            }

            case FarmerState.APPROACHING_COMPOSTER: {
                record.timer--;
                if (!record.composter) {
                    record.state = FarmerState.IDLE;
                    break;
                }

                const dist = distance(villager.location, record.composter.pos);
                if (dist <= 2.8) {
                    record.state = FarmerState.COMPOSTING;
                    record.timer = 20;
                } else if (record.timer <= 0) {
                    record.state = FarmerState.IDLE;
                    record.composter = null;
                    record.timer = 20;
                }
                break;
            }

            case FarmerState.COMPOSTING: {
                record.timer--;
                if (record.timer <= 0) {
                    if (record.composter) {
                        performCompost(villager, record.composter);
                    }
                    record.composter = null;
                    record.state = FarmerState.COOLDOWN;
                    record.timer = 40;
                }
                break;
            }

            case FarmerState.COOLDOWN: {
                record.timer--;
                if (record.timer <= 0) {
                    record.state = FarmerState.IDLE;
                    record.timer = 15;
                }
                break;
            }
        }
    }
}

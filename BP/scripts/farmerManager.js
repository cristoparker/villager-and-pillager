/**
 * Villager Professions Addon - Farmer Manager Module (Namespace: rpc)
 * Coordinates detection of Farmer villagers, equips iron hoe in hand,
 * scans for ripe crops (wheat, carrots, potatoes, beetroot), manages harvesting & replanting,
 * handles composter interaction, and enforces day/night sleeping schedules.
 */

import { world } from "@minecraft/server";
import { FARMER_CONFIG } from "./config.js";
import { distance, getLookRotation } from "./utils.js";
import { getVillagerProfession } from "./professionHelper.js";
import {
    equipHoe,
    unequipHoe,
    findNearbyRipeCrop,
    findNearbyEmptyFarmland,
    performPlantCropOnFarmland,
    findNearbyUngrownCrop,
    performBoneMealCrop,
    findNearbyComposter,
    performHarvest,
    performCompost,
    findNearbyFlowerPlantingSpot,
    performPlantFlower,
    findNearbySaplingPlantingSpot,
    performPlantSapling,
    findNearbySapling,
    performBoneMealSapling,
    findNearbyMonsters,
    performAttackMonster
} from "./farmerBehavior.js";

export const FarmerState = {
    IDLE: "IDLE",
    COMBAT: "COMBAT",
    APPROACHING_CROP: "APPROACHING_CROP",
    HARVESTING: "HARVESTING",
    APPROACHING_EMPTY_FARMLAND: "APPROACHING_EMPTY_FARMLAND",
    PLANTING_CROP: "PLANTING_CROP",
    APPROACHING_BONEMEAL_CROP: "APPROACHING_BONEMEAL_CROP",
    BONEMEALING_CROP: "BONEMEALING_CROP",
    APPROACHING_COMPOSTER: "APPROACHING_COMPOSTER",
    COMPOSTING: "COMPOSTING",
    APPROACHING_FLOWER_SPOT: "APPROACHING_FLOWER_SPOT",
    PLANTING_FLOWER: "PLANTING_FLOWER",
    APPROACHING_SAPLING_SPOT: "APPROACHING_SAPLING_SPOT",
    PLANTING_SAPLING: "PLANTING_SAPLING",
    APPROACHING_BONEMEAL_SAPLING: "APPROACHING_BONEMEAL_SAPLING",
    BONEMEALING_SAPLING: "BONEMEALING_SAPLING",
    COOLDOWN: "COOLDOWN",
    SLEEPING: "SLEEPING"
};

export class FarmerManager {
    constructor() {
        /** @type {Map<string, { state: string, villager: Entity, targetCrop: any, composter: any, flowerSpot: any, saplingSpot: any, targetSapling: any, targetMonster: any, timer: number }>} */
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

        const liveProf = getVillagerProfession(entity);
        if (liveProf !== null) {
            return liveProf === "farmer";
        }

        try {
            if (entity.hasTag("rpc:farmer") || entity.hasTag("farmer")) return true;
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
            emptyFarmland: null,
            targetUngrownCrop: null,
            composter: null,
            flowerSpot: null,
            saplingSpot: null,
            targetSapling: null,
            targetMonster: null,
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
                record.emptyFarmland = null;
                record.targetUngrownCrop = null;
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

        // Threat Priority: Check for nearby monsters threatening the farm (unless sleeping)
        if (record.state !== FarmerState.SLEEPING && record.state !== FarmerState.COMBAT) {
            const monster = findNearbyMonsters(villager.dimension, villager.location, FARMER_CONFIG.MONSTER_SEARCH_RADIUS);
            if (monster) {
                record.targetMonster = monster;
                record.state = FarmerState.COMBAT;
                record.timer = 5;
                equipHoe(villager);
            }
        }

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

            case FarmerState.COMBAT: {
                equipHoe(villager);
                record.timer--;

                if (!record.targetMonster || !record.targetMonster.isValid()) {
                    record.targetMonster = null;
                    record.state = FarmerState.COOLDOWN;
                    record.timer = 20;
                    break;
                }

                const dist = distance(villager.location, record.targetMonster.location);
                if (dist > 16.0) {
                    record.targetMonster = null;
                    record.state = FarmerState.COOLDOWN;
                    record.timer = 20;
                    break;
                }

                // Face monster
                try {
                    if (record.timer % 10 === 0) {
                        const rot = getLookRotation(villager.location, record.targetMonster.location);
                        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
                    }
                } catch {}

                // Close the distance
                if (dist > FARMER_CONFIG.ATTACK_DISTANCE) {
                    const dx = record.targetMonster.location.x - villager.location.x;
                    const dz = record.targetMonster.location.z - villager.location.z;
                    const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
                    try {
                        villager.applyImpulse({ x: (dx / len) * 0.16, y: 0, z: (dz / len) * 0.16 });
                    } catch {}
                }

                if (dist <= FARMER_CONFIG.ATTACK_DISTANCE + 0.5 && record.timer <= 0) {
                    performAttackMonster(villager, record.targetMonster);
                    record.timer = 20; // 1 second attack swing rate
                }
                break;
            }

            case FarmerState.IDLE: {
                record.timer--;
                if (record.timer <= 0) {
                    record.timer = 25;
                    equipHoe(villager);

                    // 1. Primary: Scan for ripe crops to harvest
                    const ripeCrop = findNearbyRipeCrop(villager.dimension, villager.location, FARMER_CONFIG.CROP_SEARCH_RADIUS);
                    if (ripeCrop) {
                        record.targetCrop = ripeCrop;
                        const dist = distance(villager.location, ripeCrop.pos);
                        if (dist <= FARMER_CONFIG.CROP_HARVEST_DISTANCE) {
                            record.state = FarmerState.HARVESTING;
                            record.timer = FARMER_CONFIG.HARVEST_ANIMATION_TICKS;
                        } else {
                            record.state = FarmerState.APPROACHING_CROP;
                            record.timer = 100;
                        }
                        break;
                    }

                    // 2. Scan for empty hoed farmland to plant crops/seeds
                    const emptyFarmland = findNearbyEmptyFarmland(villager.dimension, villager.location, FARMER_CONFIG.CROP_SEARCH_RADIUS);
                    if (emptyFarmland) {
                        record.emptyFarmland = emptyFarmland;
                        const dist = distance(villager.location, emptyFarmland.pos);
                        if (dist <= 2.5) {
                            record.state = FarmerState.PLANTING_CROP;
                            record.timer = 20;
                        } else {
                            record.state = FarmerState.APPROACHING_EMPTY_FARMLAND;
                            record.timer = 100;
                        }
                        break;
                    }

                    // 3. Scan for un-grown crops to fertilize with bone meal
                    const ungrownCrop = findNearbyUngrownCrop(villager.dimension, villager.location, 14);
                    if (ungrownCrop) {
                        record.targetUngrownCrop = ungrownCrop;
                        const dist = distance(villager.location, ungrownCrop.pos);
                        if (dist <= 2.5) {
                            record.state = FarmerState.BONEMEALING_CROP;
                            record.timer = 20;
                        } else {
                            record.state = FarmerState.APPROACHING_BONEMEAL_CROP;
                            record.timer = 90;
                        }
                        break;
                    }

                    // 4. Scan for saplings to bone meal
                    const sapling = findNearbySapling(villager.dimension, villager.location, FARMER_CONFIG.BONEMEAL_SEARCH_RADIUS);
                    if (sapling) {
                        record.targetSapling = sapling;
                        const dist = distance(villager.location, sapling.pos);
                        if (dist <= 2.5) {
                            record.state = FarmerState.BONEMEALING_SAPLING;
                            record.timer = 25;
                        } else {
                            record.state = FarmerState.APPROACHING_BONEMEAL_SAPLING;
                            record.timer = 90;
                        }
                        break;
                    }

                    // 5. Chance-based secondary tasks: flowers, saplings, composter
                    const roll = Math.random();
                    if (roll < 0.35) {
                        const flowerSpot = findNearbyFlowerPlantingSpot(villager.dimension, villager.location, FARMER_CONFIG.FLOWER_SEARCH_RADIUS);
                        if (flowerSpot) {
                            record.flowerSpot = flowerSpot;
                            const dist = distance(villager.location, flowerSpot.pos);
                            if (dist <= 2.5) {
                                record.state = FarmerState.PLANTING_FLOWER;
                                record.timer = 22;
                            } else {
                                record.state = FarmerState.APPROACHING_FLOWER_SPOT;
                                record.timer = 80;
                            }
                            break;
                        }
                    } else if (roll < 0.70) {
                        const saplingSpot = findNearbySaplingPlantingSpot(villager.dimension, villager.location, FARMER_CONFIG.SAPLING_SEARCH_RADIUS);
                        if (saplingSpot) {
                            record.saplingSpot = saplingSpot;
                            const dist = distance(villager.location, saplingSpot.pos);
                            if (dist <= 2.5) {
                                record.state = FarmerState.PLANTING_SAPLING;
                                record.timer = 22;
                            } else {
                                record.state = FarmerState.APPROACHING_SAPLING_SPOT;
                                record.timer = 80;
                            }
                            break;
                        }
                    } else {
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

                // Face crop and actively walk towards it!
                try {
                    const targetPos = { x: record.targetCrop.pos.x + 0.5, y: record.targetCrop.pos.y, z: record.targetCrop.pos.z + 0.5 };
                    if (record.timer % 10 === 0) {
                        const rot = getLookRotation(villager.location, targetPos);
                        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
                    }
                    const dx = targetPos.x - villager.location.x;
                    const dz = targetPos.z - villager.location.z;
                    const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
                    villager.applyImpulse({ x: (dx / len) * 0.18, y: 0, z: (dz / len) * 0.18 });
                } catch {}

                const dist = distance(villager.location, record.targetCrop.pos);
                if (dist <= FARMER_CONFIG.CROP_HARVEST_DISTANCE) {
                    record.state = FarmerState.HARVESTING;
                    record.timer = FARMER_CONFIG.HARVEST_ANIMATION_TICKS;
                } else if (record.timer <= 0) {
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

            case FarmerState.APPROACHING_EMPTY_FARMLAND: {
                record.timer--;
                if (!record.emptyFarmland || !record.emptyFarmland.pos) {
                    record.state = FarmerState.IDLE;
                    record.emptyFarmland = null;
                    record.timer = 10;
                    break;
                }

                // Face hoed farmland and walk towards it!
                try {
                    const targetPos = { x: record.emptyFarmland.pos.x + 0.5, y: record.emptyFarmland.pos.y, z: record.emptyFarmland.pos.z + 0.5 };
                    if (record.timer % 10 === 0) {
                        const rot = getLookRotation(villager.location, targetPos);
                        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
                    }
                    const dx = targetPos.x - villager.location.x;
                    const dz = targetPos.z - villager.location.z;
                    const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
                    villager.applyImpulse({ x: (dx / len) * 0.18, y: 0, z: (dz / len) * 0.18 });
                } catch {}

                const dist = distance(villager.location, record.emptyFarmland.pos);
                if (dist <= 2.5) {
                    record.state = FarmerState.PLANTING_CROP;
                    record.timer = 20;
                } else if (record.timer <= 0) {
                    record.state = FarmerState.IDLE;
                    record.emptyFarmland = null;
                    record.timer = 20;
                }
                break;
            }

            case FarmerState.PLANTING_CROP: {
                record.timer--;
                if (record.timer <= 0) {
                    if (record.emptyFarmland) {
                        performPlantCropOnFarmland(villager, record.emptyFarmland);
                    }
                    record.emptyFarmland = null;
                    record.state = FarmerState.COOLDOWN;
                    record.timer = 30;
                }
                break;
            }

            case FarmerState.APPROACHING_BONEMEAL_CROP: {
                record.timer--;
                if (!record.targetUngrownCrop || !record.targetUngrownCrop.pos) {
                    record.state = FarmerState.IDLE;
                    record.targetUngrownCrop = null;
                    record.timer = 10;
                    break;
                }

                // Face un-grown crop and walk towards it!
                try {
                    const targetPos = { x: record.targetUngrownCrop.pos.x + 0.5, y: record.targetUngrownCrop.pos.y, z: record.targetUngrownCrop.pos.z + 0.5 };
                    if (record.timer % 10 === 0) {
                        const rot = getLookRotation(villager.location, targetPos);
                        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
                    }
                    const dx = targetPos.x - villager.location.x;
                    const dz = targetPos.z - villager.location.z;
                    const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
                    villager.applyImpulse({ x: (dx / len) * 0.18, y: 0, z: (dz / len) * 0.18 });
                } catch {}

                const dist = distance(villager.location, record.targetUngrownCrop.pos);
                if (dist <= 2.5) {
                    record.state = FarmerState.BONEMEALING_CROP;
                    record.timer = 20;
                } else if (record.timer <= 0) {
                    record.state = FarmerState.IDLE;
                    record.targetUngrownCrop = null;
                    record.timer = 20;
                }
                break;
            }

            case FarmerState.BONEMEALING_CROP: {
                record.timer--;
                if (record.timer <= 0) {
                    if (record.targetUngrownCrop) {
                        performBoneMealCrop(villager, record.targetUngrownCrop);
                    }
                    record.targetUngrownCrop = null;
                    record.state = FarmerState.COOLDOWN;
                    record.timer = 35;
                }
                break;
            }

            case FarmerState.APPROACHING_BONEMEAL_SAPLING: {
                record.timer--;
                if (!record.targetSapling) {
                    record.state = FarmerState.IDLE;
                    break;
                }

                // Face sapling and walk towards it!
                try {
                    const targetPos = { x: record.targetSapling.pos.x + 0.5, y: record.targetSapling.pos.y, z: record.targetSapling.pos.z + 0.5 };
                    if (record.timer % 10 === 0) {
                        const rot = getLookRotation(villager.location, targetPos);
                        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
                    }
                    const dx = targetPos.x - villager.location.x;
                    const dz = targetPos.z - villager.location.z;
                    const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
                    villager.applyImpulse({ x: (dx / len) * 0.18, y: 0, z: (dz / len) * 0.18 });
                } catch {}

                const dist = distance(villager.location, record.targetSapling.pos);
                if (dist <= 2.6) {
                    record.state = FarmerState.BONEMEALING_SAPLING;
                    record.timer = 25;
                } else if (record.timer <= 0) {
                    record.state = FarmerState.IDLE;
                    record.targetSapling = null;
                    record.timer = 20;
                }
                break;
            }

            case FarmerState.BONEMEALING_SAPLING: {
                record.timer--;
                if (record.timer <= 0) {
                    if (record.targetSapling) {
                        performBoneMealSapling(villager, record.targetSapling);
                    }
                    record.targetSapling = null;
                    record.state = FarmerState.COOLDOWN;
                    record.timer = 40;
                }
                break;
            }

            case FarmerState.APPROACHING_FLOWER_SPOT: {
                record.timer--;
                if (!record.flowerSpot) {
                    record.state = FarmerState.IDLE;
                    break;
                }

                try {
                    const targetPos = { x: record.flowerSpot.pos.x + 0.5, y: record.flowerSpot.pos.y, z: record.flowerSpot.pos.z + 0.5 };
                    if (record.timer % 10 === 0) {
                        const rot = getLookRotation(villager.location, targetPos);
                        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
                    }
                    const dx = targetPos.x - villager.location.x;
                    const dz = targetPos.z - villager.location.z;
                    const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
                    villager.applyImpulse({ x: (dx / len) * 0.18, y: 0, z: (dz / len) * 0.18 });
                } catch {}

                const dist = distance(villager.location, record.flowerSpot.pos);
                if (dist <= 2.6) {
                    record.state = FarmerState.PLANTING_FLOWER;
                    record.timer = 22;
                } else if (record.timer <= 0) {
                    record.state = FarmerState.IDLE;
                    record.flowerSpot = null;
                    record.timer = 20;
                }
                break;
            }

            case FarmerState.PLANTING_FLOWER: {
                record.timer--;
                if (record.timer <= 0) {
                    if (record.flowerSpot) {
                        performPlantFlower(villager, record.flowerSpot.pos);
                    }
                    record.flowerSpot = null;
                    record.state = FarmerState.COOLDOWN;
                    record.timer = 40;
                }
                break;
            }

            case FarmerState.APPROACHING_SAPLING_SPOT: {
                record.timer--;
                if (!record.saplingSpot) {
                    record.state = FarmerState.IDLE;
                    break;
                }

                try {
                    const targetPos = { x: record.saplingSpot.pos.x + 0.5, y: record.saplingSpot.pos.y, z: record.saplingSpot.pos.z + 0.5 };
                    if (record.timer % 10 === 0) {
                        const rot = getLookRotation(villager.location, targetPos);
                        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
                    }
                    const dx = targetPos.x - villager.location.x;
                    const dz = targetPos.z - villager.location.z;
                    const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
                    villager.applyImpulse({ x: (dx / len) * 0.18, y: 0, z: (dz / len) * 0.18 });
                } catch {}

                const dist = distance(villager.location, record.saplingSpot.pos);
                if (dist <= 2.6) {
                    record.state = FarmerState.PLANTING_SAPLING;
                    record.timer = 22;
                } else if (record.timer <= 0) {
                    record.state = FarmerState.IDLE;
                    record.saplingSpot = null;
                    record.timer = 20;
                }
                break;
            }

            case FarmerState.PLANTING_SAPLING: {
                record.timer--;
                if (record.timer <= 0) {
                    if (record.saplingSpot) {
                        performPlantSapling(villager, record.saplingSpot.pos);
                    }
                    record.saplingSpot = null;
                    record.state = FarmerState.COOLDOWN;
                    record.timer = 40;
                }
                break;
            }

            case FarmerState.APPROACHING_COMPOSTER: {
                record.timer--;
                if (!record.composter) {
                    record.state = FarmerState.IDLE;
                    break;
                }

                try {
                    const targetPos = { x: record.composter.pos.x + 0.5, y: record.composter.pos.y, z: record.composter.pos.z + 0.5 };
                    if (record.timer % 10 === 0) {
                        const rot = getLookRotation(villager.location, targetPos);
                        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
                    }
                    const dx = targetPos.x - villager.location.x;
                    const dz = targetPos.z - villager.location.z;
                    const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
                    villager.applyImpulse({ x: (dx / len) * 0.18, y: 0, z: (dz / len) * 0.18 });
                } catch {}

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

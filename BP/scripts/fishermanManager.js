/**
 * Fisherman Villager Addon - Fisherman Manager Module (Namespace: rpc)
 * Coordinates detection of fisherman villagers, manages smooth river walking,
 * enforces day/night sleeping schedules (returning to bed at sunset/night and fishing at sunrise),
 * and manages continuous fishing routines silently.
 */

import { world, EquipmentSlot } from "@minecraft/server";
import { SCAN_CONFIG, FISHING_CONFIG } from "./config.js";
import { findBestFishingSpot, isWaterNear } from "./waterScanner.js";
import { checkNavigationProgress } from "./pathfinder.js";
import { 
    startFishing, 
    tickFishing, 
    cleanupSession, 
    equipFishingRod, 
    unequipFishingRod,
    equipFish,
    equipBucket,
    findNearbyStrayCat,
    performFeedAndTameCat,
    findNearbyCampfire,
    performCookFish,
    findNearbyPondWater,
    performRestockFish
} from "./fishingBehavior.js";
import { getLookRotation, distance } from "./utils.js";
import { getVillagerProfession } from "./professionHelper.js";

export const FishermanState = {
    IDLE: "IDLE",
    NAVIGATING: "NAVIGATING",
    FISHING: "FISHING",
    APPROACHING_CAT: "APPROACHING_CAT",
    FEEDING_CAT: "FEEDING_CAT",
    APPROACHING_CAMPFIRE: "APPROACHING_CAMPFIRE",
    COOKING_CAMPFIRE: "COOKING_CAMPFIRE",
    APPROACHING_POND: "APPROACHING_POND",
    RESTOCKING_POND: "RESTOCKING_POND",
    COOLDOWN: "COOLDOWN",
    SLEEPING: "SLEEPING"
};

export class FishermanManager {
    constructor() {
        /** @type {Map<string, { state: string, villager: Entity, spot: any, navState: any, fishingSession: any, targetCat: Entity|null, targetCampfire: any, targetPond: any, timer: number }>} */
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
     * Checks if an entity is a Fisherman villager.
     */
    isFishermanVillager(entity) {
        if (!entity || !entity.isValid()) return false;

        const liveProf = getVillagerProfession(entity);
        if (liveProf !== null) {
            return liveProf === "fisherman";
        }

        try {
            if (entity.hasTag("rpc:fisherman") || entity.hasTag("fisherman")) {
                return true;
            }
        } catch {}

        return false;
    }

    /**
     * Discovers and registers fisherman villagers across loaded chunks.
     */
    scanForFishermen() {
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
                const isFisher = this.isFishermanVillager(villager);
                if (isFisher) {
                    this.registerFisherman(villager);
                } else {
                    try {
                        const equippable = villager.getComponent("minecraft:equippable");
                        const mainhand = equippable?.getEquipment("Mainhand");
                        if (mainhand && mainhand.typeId === "rpc:fishing_rod") {
                            equippable.setEquipment("Mainhand", undefined);
                        }
                    } catch {}
                }
            }
        }
    }

    /**
     * Registers a new fisherman villager.
     */
    registerFisherman(villager) {
        if (!villager || this.records.has(villager.id)) return;

        equipFishingRod(villager);

        this.records.set(villager.id, {
            state: FishermanState.IDLE,
            villager: villager,
            spot: null,
            timer: 30,
            fishingSession: null,
            navState: { lastPos: null, stuckTicks: 0, totalTicks: 0 }
        });
    }

    /**
     * Main update tick executed every game tick.
     */
    update() {
        // Scan for new fishermen every 30 ticks (1.5 seconds)
        this.scanCooldownTicks++;
        if (this.scanCooldownTicks >= 30) {
            this.scanCooldownTicks = 0;
            this.scanForFishermen();
        }

        const isNight = this.isNightTime();

        for (const [id, record] of this.records.entries()) {
            const { villager } = record;

            // Handle despawned, unloaded, or changed entities
            if (!villager || !villager.isValid() || !this.isFishermanVillager(villager)) {
                if (record.fishingSession) {
                    cleanupSession(record.fishingSession);
                }
                if (villager && villager.isValid()) {
                    unequipFishingRod(villager);
                }
                this.records.delete(id);
                continue;
            }

            // NIGHTTIME CHECK: At sunset/night, stop fishing and let villager go to bed
            if (isNight && record.state !== FishermanState.SLEEPING) {
                if (record.fishingSession) {
                    cleanupSession(record.fishingSession);
                    record.fishingSession = null;
                }
                try {
                    villager.triggerEvent("rpc:stop_fishing");
                    villager.triggerEvent("minecraft:schedule_bed_villager");
                } catch {}
                unequipFishingRod(villager);

                record.state = FishermanState.SLEEPING;
                record.spot = null;
                record.navState = { lastPos: null, stuckTicks: 0, totalTicks: 0 };
                continue;
            }

            this.updateVillager(record, isNight);
        }
    }

    /**
     * Updates an individual villager's fishing cycle.
     */
    updateVillager(record, isNight) {
        const { villager } = record;

        switch (record.state) {
            case FishermanState.SLEEPING: {
                if (!isNight) {
                    try {
                        villager.triggerEvent("minecraft:schedule_work_fisher");
                    } catch {}
                    equipFishingRod(villager);
                    record.state = FishermanState.IDLE;
                    record.timer = 40;
                }
                break;
            }

            case FishermanState.IDLE: {
                equipFishingRod(villager);
                record.timer--;
                if (record.timer <= 0) {
                    record.timer = SCAN_CONFIG.SEARCH_INTERVAL_TICKS;

                    // 1. If already standing near water shore, start fishing directly
                    const nearWater = isWaterNear(villager.dimension, villager.location, 2.8);
                    if (nearWater) {
                        const session = startFishing(villager, null);
                        if (session) {
                            record.fishingSession = session;
                            record.state = FishermanState.FISHING;
                            break;
                        }
                    }

                    // 2. Secondary: Scan for stray village cats to feed and befriend
                    if (Math.random() < 0.4) {
                        const cat = findNearbyStrayCat(villager.dimension, villager.location, FISHERMAN_CONFIG.CAT_SEARCH_RADIUS);
                        if (cat) {
                            record.targetCat = cat;
                            equipFish(villager, "minecraft:cod");
                            const dist = distance(villager.location, cat.location);
                            if (dist <= FISHERMAN_CONFIG.CAT_FEED_DISTANCE) {
                                record.state = FishermanState.FEEDING_CAT;
                                record.timer = 25;
                            } else {
                                record.state = FishermanState.APPROACHING_CAT;
                                record.timer = 90;
                            }
                            break;
                        }
                    }

                    // 3. Secondary: Scan for Campfire to cook caught fish
                    if (Math.random() < 0.35) {
                        const campfire = findNearbyCampfire(villager.dimension, villager.location, FISHERMAN_CONFIG.CAMPFIRE_SEARCH_RADIUS);
                        if (campfire) {
                            record.targetCampfire = campfire;
                            equipFish(villager, "minecraft:salmon");
                            const dist = distance(villager.location, campfire.pos);
                            if (dist <= 2.5) {
                                record.state = FishermanState.COOKING_CAMPFIRE;
                                record.timer = 25;
                            } else {
                                record.state = FishermanState.APPROACHING_CAMPFIRE;
                                record.timer = 90;
                            }
                            break;
                        }
                    }

                    // 4. Secondary: Scan for pond water to restock tropical fish
                    if (Math.random() < 0.3) {
                        const pond = findNearbyPondWater(villager.dimension, villager.location, 14);
                        if (pond) {
                            record.targetPond = pond;
                            equipBucket(villager, FISHERMAN_CONFIG.TROPICAL_FISH_BUCKET);
                            const dist = distance(villager.location, pond.pos);
                            if (dist <= 2.5) {
                                record.state = FishermanState.RESTOCKING_POND;
                                record.timer = 25;
                            } else {
                                record.state = FishermanState.APPROACHING_POND;
                                record.timer = 90;
                            }
                            break;
                        }
                    }

                    // 5. Scan for rivers and water bodies up to 48 blocks
                    const spot = findBestFishingSpot(villager.dimension, villager.location);
                    if (spot) {
                        record.spot = spot;
                        record.state = FishermanState.NAVIGATING;
                        record.navState = { lastPos: null, stuckTicks: 0, totalTicks: 0 };
                    }
                }
                break;
            }

            case FishermanState.APPROACHING_CAT: {
                record.timer--;
                if (!record.targetCat || !record.targetCat.isValid()) {
                    record.state = FishermanState.IDLE;
                    record.targetCat = null;
                    equipFishingRod(villager);
                    record.timer = 10;
                    break;
                }

                if (record.timer % 20 === 0) equipFish(villager, "minecraft:cod");

                try {
                    const cLoc = record.targetCat.location;
                    if (record.timer % 10 === 0) {
                        const rot = getLookRotation(villager.location, cLoc);
                        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
                    }
                    const dx = cLoc.x - villager.location.x;
                    const dz = cLoc.z - villager.location.z;
                    const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
                    villager.applyImpulse({ x: (dx / len) * 0.16, y: 0, z: (dz / len) * 0.16 });
                } catch {}

                const dist = distance(villager.location, record.targetCat.location);
                if (dist <= FISHERMAN_CONFIG.CAT_FEED_DISTANCE) {
                    record.state = FishermanState.FEEDING_CAT;
                    record.timer = 25;
                } else if (record.timer <= 0) {
                    record.state = FishermanState.IDLE;
                    record.targetCat = null;
                    equipFishingRod(villager);
                    record.timer = 20;
                }
                break;
            }

            case FishermanState.FEEDING_CAT: {
                record.timer--;
                if (record.timer <= 0) {
                    if (record.targetCat && record.targetCat.isValid()) {
                        performFeedAndTameCat(villager, record.targetCat);
                    }
                    record.targetCat = null;
                    equipFishingRod(villager);
                    record.state = FishermanState.COOLDOWN;
                    record.timer = 40;
                }
                break;
            }

            case FishermanState.APPROACHING_CAMPFIRE: {
                record.timer--;
                if (!record.targetCampfire) {
                    record.state = FishermanState.IDLE;
                    equipFishingRod(villager);
                    record.timer = 10;
                    break;
                }

                if (record.timer % 20 === 0) equipFish(villager, "minecraft:salmon");

                try {
                    const cPos = { x: record.targetCampfire.pos.x + 0.5, y: record.targetCampfire.pos.y, z: record.targetCampfire.pos.z + 0.5 };
                    if (record.timer % 10 === 0) {
                        const rot = getLookRotation(villager.location, cPos);
                        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
                    }
                    const dx = cPos.x - villager.location.x;
                    const dz = cPos.z - villager.location.z;
                    const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
                    villager.applyImpulse({ x: (dx / len) * 0.16, y: 0, z: (dz / len) * 0.16 });
                } catch {}

                const dist = distance(villager.location, record.targetCampfire.pos);
                if (dist <= 2.5) {
                    record.state = FishermanState.COOKING_CAMPFIRE;
                    record.timer = 25;
                } else if (record.timer <= 0) {
                    record.state = FishermanState.IDLE;
                    record.targetCampfire = null;
                    equipFishingRod(villager);
                    record.timer = 20;
                }
                break;
            }

            case FishermanState.COOKING_CAMPFIRE: {
                record.timer--;
                if (record.timer <= 0) {
                    if (record.targetCampfire) {
                        performCookFish(villager, record.targetCampfire.pos);
                    }
                    record.targetCampfire = null;
                    equipFishingRod(villager);
                    record.state = FishermanState.COOLDOWN;
                    record.timer = 40;
                }
                break;
            }

            case FishermanState.APPROACHING_POND: {
                record.timer--;
                if (!record.targetPond) {
                    record.state = FishermanState.IDLE;
                    equipFishingRod(villager);
                    record.timer = 10;
                    break;
                }

                if (record.timer % 20 === 0) equipBucket(villager, FISHERMAN_CONFIG.TROPICAL_FISH_BUCKET);

                try {
                    const pPos = { x: record.targetPond.pos.x + 0.5, y: record.targetPond.pos.y, z: record.targetPond.pos.z + 0.5 };
                    if (record.timer % 10 === 0) {
                        const rot = getLookRotation(villager.location, pPos);
                        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
                    }
                    const dx = pPos.x - villager.location.x;
                    const dz = pPos.z - villager.location.z;
                    const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
                    villager.applyImpulse({ x: (dx / len) * 0.16, y: 0, z: (dz / len) * 0.16 });
                } catch {}

                const dist = distance(villager.location, record.targetPond.pos);
                if (dist <= 2.5) {
                    record.state = FishermanState.RESTOCKING_POND;
                    record.timer = 25;
                } else if (record.timer <= 0) {
                    record.state = FishermanState.IDLE;
                    record.targetPond = null;
                    equipFishingRod(villager);
                    record.timer = 20;
                }
                break;
            }

            case FishermanState.RESTOCKING_POND: {
                record.timer--;
                if (record.timer <= 0) {
                    if (record.targetPond) {
                        performRestockFish(villager, record.targetPond.pos);
                    }
                    record.targetPond = null;
                    equipFishingRod(villager);
                    record.state = FishermanState.COOLDOWN;
                    record.timer = 40;
                }
                break;
            }

            case FishermanState.NAVIGATING: {
                equipFishingRod(villager);

                if (record.spot && record.spot.standPos) {
                    try {
                        const rot = getLookRotation(villager.location, record.spot.standPos);
                        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
                        const dx = record.spot.standPos.x - villager.location.x;
                        const dz = record.spot.standPos.z - villager.location.z;
                        const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
                        villager.applyImpulse({ x: (dx / len) * 0.16, y: 0, z: (dz / len) * 0.16 });
                    } catch {}
                }

                const result = checkNavigationProgress(villager, record.spot, record.navState);
                if (result.reached) {
                    const session = startFishing(villager, record.spot);
                    if (session) {
                        record.fishingSession = session;
                        record.state = FishermanState.FISHING;
                    } else {
                        record.state = FishermanState.COOLDOWN;
                        record.timer = 20;
                    }
                } else if (result.stuck) {
                    record.state = FishermanState.COOLDOWN;
                    record.timer = 25;
                    record.spot = null;
                }
                break;
            }

            case FishermanState.FISHING: {
                if (!record.fishingSession) {
                    record.state = FishermanState.COOLDOWN;
                    record.timer = 15;
                    break;
                }

                const stillFishing = tickFishing(record.fishingSession);
                if (!stillFishing) {
                    record.fishingSession = null;
                    record.state = FishermanState.COOLDOWN;
                    record.timer = FISHING_CONFIG.COOLDOWN_TICKS;
                    record.spot = null;
                }
                break;
            }

            case FishermanState.COOLDOWN: {
                equipFishingRod(villager);
                record.timer--;
                if (record.timer <= 0) {
                    record.state = FishermanState.IDLE;
                    record.timer = 5;
                }
                break;
            }
        }
    }

    /**
     * Handles entity spawn events to register fisherman immediately.
     */
    onEntitySpawn(entity) {
        if (this.isFishermanVillager(entity)) {
            this.registerFisherman(entity);
        }
    }
}

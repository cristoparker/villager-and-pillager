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
import { startFishing, tickFishing, cleanupSession, equipFishingRod, unequipFishingRod } from "./fishingBehavior.js";
import { getLookRotation } from "./utils.js";
import { getVillagerProfession } from "./professionHelper.js";

export const FishermanState = {
    IDLE: "IDLE",
    NAVIGATING: "NAVIGATING",
    FISHING: "FISHING",
    COOLDOWN: "COOLDOWN",
    SLEEPING: "SLEEPING"
};

export class FishermanManager {
    constructor() {
        /** @type {Map<string, { state: string, villager: Entity, spot: any, navState: any, fishingSession: any, timer: number }>} */
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
                // Wait for sunrise (clock time 0 / 23500+)
                if (!isNight) {
                    try {
                        villager.triggerEvent("minecraft:schedule_work_fisher");
                    } catch {}
                    equipFishingRod(villager);
                    record.state = FishermanState.IDLE;
                    record.timer = 40; // Give villager 2 seconds to get out of bed
                }
                break;
            }

            case FishermanState.IDLE: {
                equipFishingRod(villager);
                record.timer--;
                if (record.timer <= 0) {
                    record.timer = SCAN_CONFIG.SEARCH_INTERVAL_TICKS;

                    // If already standing near water shore, fish right here on the land
                    const nearWater = isWaterNear(villager.dimension, villager.location, 2.8);
                    if (nearWater) {
                        const session = startFishing(villager, null);
                        if (session) {
                            record.fishingSession = session;
                            record.state = FishermanState.FISHING;
                            break;
                        }
                    }

                    // Scan for rivers and water bodies up to 48 blocks
                    const spot = findBestFishingSpot(villager.dimension, villager.location);
                    if (spot) {
                        record.spot = spot;
                        record.state = FishermanState.NAVIGATING;
                        record.navState = { lastPos: null, stuckTicks: 0, totalTicks: 0 };
                    }
                }
                break;
            }

            case FishermanState.NAVIGATING: {
                equipFishingRod(villager);

                // Smooth impulse navigation towards fishing shore spot
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

                // Check if villager arrived at the shoreline
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
                    // Caught fish! Quick cooldown (1.5s) then repeat
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

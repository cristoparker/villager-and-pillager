/**
 * Fisherman Villager Addon - Fisherman Manager Module (Namespace: rpc)
 * Coordinates detection of fisherman villagers, manages smooth river walking,
 * enforces day/night sleeping schedules (returning to bed at sunset/night and fishing at sunrise),
 * and manages continuous fishing routines with chat debug logs.
 */

import { world, EquipmentSlot } from "@minecraft/server";
import { SCAN_CONFIG, FISHING_CONFIG } from "./config.js";
import { findBestFishingSpot, isWaterNear } from "./waterScanner.js";
import { checkNavigationProgress } from "./pathfinder.js";
import { startFishing, tickFishing, cleanupSession } from "./fishingBehavior.js";

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
        this.debugHeartbeatTicks = 0;
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
     * Broadcasts an action bar status message to players near the villager.
     */
    notifyNearbyPlayers(villager, message) {
        try {
            const players = villager.dimension.getPlayers({
                location: villager.location,
                maxDistance: 32
            });
            for (const p of players) {
                p.onScreenDisplay.setActionBar(message);
            }
        } catch {}
    }

    /**
     * Checks if an entity is a Fisherman villager.
     */
    isFishermanVillager(entity) {
        if (!entity || !entity.isValid()) return false;

        try {
            if (entity.matches({ families: ["fisherman"] })) {
                return true;
            }
        } catch {}

        try {
            if (entity.hasTag("rpc:fisherman") || entity.hasTag("fisherman")) {
                return true;
            }
        } catch {}

        try {
            if (entity.nameTag && entity.nameTag.toLowerCase().includes("fisherman")) {
                return true;
            }
        } catch {}

        try {
            const equippable = entity.getComponent("minecraft:equippable");
            const mainhand = equippable?.getEquipment("Mainhand");
            if (mainhand && mainhand.typeId === "rpc:fishing_rod") {
                return true;
            }
        } catch {}

        try {
            const variantComp = entity.getComponent("minecraft:variant");
            if (variantComp && variantComp.value === 2) {
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

        // Heartbeat log every 10 seconds
        this.debugHeartbeatTicks++;
        if (this.debugHeartbeatTicks >= 10) {
            this.debugHeartbeatTicks = 0;
            const time = world.getTimeOfDay();
            const timeStr = this.isNightTime() ? "Night (Sleeping)" : "Day (Fishing)";
            world.sendMessage(`§7[DEBUG] Villagers: ${villagers.length}, Active fishermen: ${this.records.size} | Time: ${time} [${timeStr}]`);
        }

        for (const villager of villagers) {
            if (!this.records.has(villager.id)) {
                const isFisher = this.isFishermanVillager(villager);
                if (isFisher) {
                    this.registerFisherman(villager);
                }
            }
        }
    }

    /**
     * Registers a new fisherman villager.
     */
    registerFisherman(villager) {
        if (!villager || this.records.has(villager.id)) return;

        world.sendMessage(`§a[DEBUG] Registered Fisherman Villager (ID: ${villager.id})!`);

        this.records.set(villager.id, {
            state: FishermanState.IDLE,
            villager: villager,
            spot: null,
            navState: { lastPos: null, stuckTicks: 0, totalTicks: 0 },
            fishingSession: null,
            timer: 2
        });
    }

    /**
     * Main update tick executed every game tick.
     */
    update() {
        // Refresh fisherman search every 20 ticks (1 second)
        this.scanCooldownTicks++;
        if (this.scanCooldownTicks >= 20) {
            this.scanCooldownTicks = 0;
            this.scanForFishermen();
        }

        const isNight = this.isNightTime();

        for (const [id, record] of this.records.entries()) {
            const { villager } = record;

            // Handle despawned or unloaded entities
            if (!villager || !villager.isValid()) {
                if (record.fishingSession) {
                    cleanupSession(record.fishingSession);
                }
                this.records.delete(id);
                continue;
            }

            // NIGHTTIME CHECK: At sunset/night, stop fishing and let villager go to bed!
            if (isNight && record.state !== FishermanState.SLEEPING) {
                if (record.fishingSession) {
                    cleanupSession(record.fishingSession);
                    record.fishingSession = null;
                }
                try {
                    villager.triggerEvent("rpc:stop_fishing");
                } catch {}
                try {
                    const equippable = villager.getComponent("minecraft:equippable");
                    equippable?.setEquipment(EquipmentSlot.Mainhand, undefined);
                } catch {}

                record.state = FishermanState.SLEEPING;
                world.sendMessage(`§6[DEBUG] Sunset/Night arrived! Villager ${id} walking back to bed to sleep.`);
                this.notifyNearbyPlayers(villager, "§6[Fisherman]§r Sunset! Heading to bed to sleep...");
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
                    record.state = FishermanState.IDLE;
                    record.timer = 40; // 2 seconds after waking up before heading to river
                    world.sendMessage(`§e[DEBUG] Sunrise! Villager ${villager.id} woke up and preparing to fish.`);
                    this.notifyNearbyPlayers(villager, "§e[Fisherman]§r Sunrise! Heading to river to fish.");
                }
                break;
            }

            case FishermanState.IDLE: {
                record.timer--;
                if (record.timer <= 0) {
                    record.timer = SCAN_CONFIG.SEARCH_INTERVAL_TICKS;

                    // If already standing near water shore, fish right here on the land!
                    const nearWater = isWaterNear(villager.dimension, villager.location, 2.8);
                    if (nearWater) {
                        world.sendMessage("§b[DEBUG] Standing on land at shore! Casting rod...");
                        const session = startFishing(villager, null);
                        if (session) {
                            record.fishingSession = session;
                            record.state = FishermanState.FISHING;
                            this.notifyNearbyPlayers(villager, "§b[Fisherman]§r Casting fishing rod into water!");
                            break;
                        }
                    }

                    // Scan for rivers and water bodies up to 48 blocks
                    const spot = findBestFishingSpot(villager.dimension, villager.location);
                    if (spot) {
                        record.spot = spot;
                        record.state = FishermanState.NAVIGATING;
                        record.navState = { lastPos: null, stuckTicks: 0, totalTicks: 0 };
                        const name = spot.isRiver ? "River" : "Water";
                        world.sendMessage(`§b[DEBUG] Found ${name} ${Math.round(spot.distance)}m away! Walking smoothly to shore...`);
                        this.notifyNearbyPlayers(villager, `§b[Fisherman]§r Found ${name}! Walking to shore...`);
                    }
                }
                break;
            }

            case FishermanState.NAVIGATING: {
                // Check if villager arrived at the shoreline
                const result = checkNavigationProgress(villager, record.spot, record.navState);
                if (result.reached) {
                    world.sendMessage("§a[DEBUG] Reached land edge at shore! Standing on land to fish.");
                    const session = startFishing(villager, record.spot);
                    if (session) {
                        record.fishingSession = session;
                        record.state = FishermanState.FISHING;
                        this.notifyNearbyPlayers(villager, "§b[Fisherman]§r Casting fishing rod into river!");
                    } else {
                        record.state = FishermanState.COOLDOWN;
                        record.timer = 20;
                    }
                } else if (result.stuck) {
                    world.sendMessage("§6[DEBUG] Pathfinding stuck. Resetting search...");
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
                    // Caught fish! Quick cooldown (1.5s) then repeat!
                    this.notifyNearbyPlayers(villager, "§a[Fisherman]§r Caught a fish!");
                    record.fishingSession = null;
                    record.state = FishermanState.COOLDOWN;
                    record.timer = FISHING_CONFIG.COOLDOWN_TICKS;
                    record.spot = null;
                }
                break;
            }

            case FishermanState.COOLDOWN: {
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

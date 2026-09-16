/**
 * Fisherman Villager Addon - Fisherman Manager Module (Namespace: rpc)
 * Coordinates detection of fisherman villagers, triggers river scanning and movement,
 * and manages continuous fishing routines with detailed chat debug logs.
 */

import { world } from "@minecraft/server";
import { SCAN_CONFIG, FISHING_CONFIG } from "./config.js";
import { findBestFishingSpot, isWaterNear } from "./waterScanner.js";
import { checkNavigationProgress } from "./pathfinder.js";
import { startFishing, tickFishing, cleanupSession } from "./fishingBehavior.js";

export const FishermanState = {
    IDLE: "IDLE",
    NAVIGATING: "NAVIGATING",
    FISHING: "FISHING",
    COOLDOWN: "COOLDOWN"
};

export class FishermanManager {
    constructor() {
        /** @type {Map<string, { state: string, villager: Entity, spot: any, navState: any, fishingSession: any, timer: number }>} */
        this.records = new Map();
        this.scanCooldownTicks = 0;
        this.debugHeartbeatTicks = 0;
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

        // Also check variant
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

        // Heartbeat log every 5 seconds
        this.debugHeartbeatTicks++;
        if (this.debugHeartbeatTicks >= 5) {
            this.debugHeartbeatTicks = 0;
            world.sendMessage(`§7[DEBUG] Scan: ${villagers.length} villagers found. Registered fishermen: ${this.records.size}`);
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

        world.sendMessage(`§a[DEBUG] Registered Fisherman Villager (ID: ${villager.id})! Initializing fishing cycle...`);

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

        for (const [id, record] of this.records.entries()) {
            const { villager } = record;

            // Handle despawned or unloaded entities
            if (!villager || !villager.isValid()) {
                if (record.fishingSession) {
                    cleanupSession(record.fishingSession);
                }
                this.records.delete(id);
                world.sendMessage(`§c[DEBUG] Fisherman ${id} despawned/unloaded.`);
                continue;
            }

            this.updateVillager(record);
        }
    }

    /**
     * Updates an individual villager's fishing cycle.
     */
    updateVillager(record) {
        const { villager } = record;

        switch (record.state) {
            case FishermanState.IDLE: {
                record.timer--;
                if (record.timer <= 0) {
                    record.timer = SCAN_CONFIG.SEARCH_INTERVAL_TICKS;

                    // If already at water, start fishing immediately!
                    const nearWater = isWaterNear(villager.dimension, villager.location, 3.5);
                    if (nearWater) {
                        world.sendMessage("§b[DEBUG] Villager is already at water! Casting rod...");
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
                        world.sendMessage(`§b[DEBUG] Found ${name} at distance ${Math.round(spot.distance)} blocks! Pathfinding...`);
                        this.notifyNearbyPlayers(villager, `§b[Fisherman]§r Found ${name}! Moving to shore...`);
                    } else {
                        world.sendMessage("§7[DEBUG] No water found within 48 blocks. Waiting...");
                    }
                }
                break;
            }

            case FishermanState.NAVIGATING: {
                // If villager reached water or spot
                const result = checkNavigationProgress(villager, record.spot, record.navState);
                if (result.reached) {
                    world.sendMessage("§a[DEBUG] Reached water shore! Casting fishing rod into river!");
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
                    world.sendMessage("§6[DEBUG] Stuck while pathfinding. Resetting search...");
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
            world.sendMessage(`§a[DEBUG] Entity spawned with Fisherman traits (ID: ${entity.id})`);
            this.registerFisherman(entity);
        }
    }
}

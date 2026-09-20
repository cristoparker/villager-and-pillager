/**
 * Fisherman Villager Addon - Fletcher Manager Module (Namespace: rpc)
 * Coordinates detection of Fletcher villagers, equips them with Bow or Crossbow,
 * manages village monster defense (Skeleton bow attack & Pillager crossbow attack via native Bedrock AI),
 * and conducts archery practice on nearby Target blocks during free time.
 */

import { world } from "@minecraft/server";
import { FLETCHER_CONFIG } from "./config.js";
import { distance, playSoundSafe } from "./utils.js";
import { getVillagerProfession } from "./professionHelper.js";
import { 
    equipRangedWeapon, 
    unequipRangedWeapon, 
    isHoldingCrossbow, 
    findNearbyMonsters, 
    findNearbyTargetBlock, 
    findShootingSpot, 
    shootArrowAtBlock,
    shootArrowAtMonster 
} from "./fletcherBehavior.js";

export const FletcherState = {
    IDLE: "IDLE",
    COMBAT: "COMBAT",
    APPROACHING_TARGET: "APPROACHING_TARGET",
    PRACTICE_AIMING: "PRACTICE_AIMING",
    COOLDOWN: "COOLDOWN",
    SLEEPING: "SLEEPING"
};

export class FletcherManager {
    constructor() {
        /** @type {Map<string, { state: string, villager: Entity, targetBlock: any, shootingSpot: any, preferredWeapon: string, timer: number }>} */
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
     * Checks if an entity is a Fletcher villager.
     * @param {Entity} entity 
     * @returns {boolean}
     */
    isFletcherVillager(entity) {
        if (!entity || !entity.isValid()) return false;

        const liveProf = getVillagerProfession(entity);
        if (liveProf !== null) {
            return liveProf === "fletcher";
        }

        try {
            if (entity.hasTag("rpc:fletcher") || entity.hasTag("fletcher")) return true;
        } catch {}

        return false;
    }

    /**
     * Scans loaded chunks for Fletcher villagers.
     */
    scanForFletchers() {
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
                if (this.isFletcherVillager(villager)) {
                    this.registerFletcher(villager);
                } else {
                    // Safety check: if an entity is NOT a fletcher but happens to hold a bow/crossbow, unequip it
                    try {
                        const equippable = villager.getComponent("minecraft:equippable");
                        const item = equippable?.getEquipment("Mainhand");
                        if (item && (item.typeId === FLETCHER_CONFIG.BOW_ITEM_ID || item.typeId === FLETCHER_CONFIG.CROSSBOW_ITEM_ID)) {
                            unequipRangedWeapon(villager);
                        }
                    } catch {}
                }
            }
        }
    }

    /**
     * Registers a new Fletcher villager and equips weapon.
     * @param {Entity} villager 
     * @param {string} weaponType 
     */
    registerFletcher(villager, weaponType = FLETCHER_CONFIG.BOW_ITEM_ID) {
        if (!villager || this.records.has(villager.id)) return;

        const isNight = this.isNightTime();
        if (!isNight) {
            equipRangedWeapon(villager, weaponType);
            try {
                villager.triggerEvent("minecraft:schedule_wander_villager");
            } catch {}
        }

        this.records.set(villager.id, {
            state: isNight ? FletcherState.SLEEPING : FletcherState.IDLE,
            villager: villager,
            targetBlock: null,
            shootingSpot: null,
            preferredWeapon: weaponType,
            timer: 20
        });
    }

    /**
     * Sets the preferred weapon for a Fletcher (Bow or Crossbow).
     * @param {Entity} villager 
     * @param {string} weaponType 
     */
    setWeapon(villager, weaponType) {
        if (!villager || !villager.isValid()) return;
        const record = this.records.get(villager.id);
        if (record) {
            record.preferredWeapon = weaponType;
            if (record.state !== FletcherState.SLEEPING) {
                equipRangedWeapon(villager, weaponType);
            }
        } else {
            this.registerFletcher(villager, weaponType);
        }
    }

    /**
     * Main update tick executed every game tick.
     */
    update() {
        // Scan for new fletchers every 30 ticks (1.5 seconds)
        this.scanCooldownTicks++;
        if (this.scanCooldownTicks >= 30) {
            this.scanCooldownTicks = 0;
            this.scanForFletchers();
        }

        const isNight = this.isNightTime();

        for (const [id, record] of this.records.entries()) {
            const { villager } = record;

            // Handle despawned, unloaded, or changed entities
            if (!villager || !villager.isValid() || !this.isFletcherVillager(villager)) {
                if (villager && villager.isValid()) {
                    unequipRangedWeapon(villager);
                }
                this.records.delete(id);
                continue;
            }

            // NIGHTTIME CHECK: Put away weapon and sleep in bed
            if (isNight && record.state !== FletcherState.SLEEPING) {
                try {
                    villager.triggerEvent("rpc:stop_approach_target");
                } catch {}
                unequipRangedWeapon(villager);
                try {
                    villager.triggerEvent("minecraft:schedule_bed_villager");
                } catch {}

                record.state = FletcherState.SLEEPING;
                record.targetBlock = null;
                record.shootingSpot = null;
                continue;
            }

            this.updateFletcher(record, isNight);
        }
    }

    /**
     * Updates an individual fletcher's routine.
     * @param {object} record 
     * @param {boolean} isNight 
     */
    updateFletcher(record, isNight) {
        const { villager } = record;

        switch (record.state) {
            case FletcherState.SLEEPING: {
                // Wait for sunrise
                if (!isNight) {
                    try {
                        villager.triggerEvent("minecraft:schedule_wander_villager");
                    } catch {}
                    equipRangedWeapon(villager, record.preferredWeapon);
                    record.state = FletcherState.IDLE;
                    record.timer = 40; // Wake up delay
                }
                break;
            }

            case FletcherState.IDLE: {
                record.timer--;
                if (record.timer <= 0) {
                    record.timer = 20;

                    // Ensure weapon is equipped
                    equipRangedWeapon(villager, record.preferredWeapon);

                    // 1. PRIORITY 1: Check for nearby hostile monsters to shoot
                    const monster = findNearbyMonsters(villager.dimension, villager.location, FLETCHER_CONFIG.MONSTER_SEARCH_RADIUS);
                    if (monster) {
                        record.targetMonster = monster;
                        record.state = FletcherState.COMBAT;
                        record.timer = 5; // Fast first shot
                        break;
                    }

                    // 2. PRIORITY 2: Check for nearby Target block in free time
                    const targetBlock = findNearbyTargetBlock(villager.dimension, villager.location, FLETCHER_CONFIG.TARGET_BLOCK_SEARCH_RADIUS);
                    if (targetBlock) {
                        record.targetBlock = targetBlock;
                        const d = distance(villager.location, targetBlock);

                        if (d >= FLETCHER_CONFIG.PRACTICE_DISTANCE_MIN && d <= FLETCHER_CONFIG.PRACTICE_DISTANCE_MAX) {
                            // Already in good position
                            record.state = FletcherState.PRACTICE_AIMING;
                            record.timer = FLETCHER_CONFIG.AIM_DURATION_TICKS;
                        } else {
                            // Needs to get into comfortable shooting spot
                            record.shootingSpot = findShootingSpot(villager.dimension, villager.location, targetBlock, FLETCHER_CONFIG.PRACTICE_DISTANCE_MIN, FLETCHER_CONFIG.PRACTICE_DISTANCE_MAX);
                            record.state = FletcherState.APPROACHING_TARGET;
                            record.timer = 140; // 7 seconds timeout to approach
                            try {
                                villager.triggerEvent("rpc:start_approach_target");
                            } catch {}
                        }
                    }
                }
                break;
            }

            case FletcherState.COMBAT: {
                equipRangedWeapon(villager, record.preferredWeapon);

                record.timer--;

                if (!record.targetMonster || !record.targetMonster.isValid()) {
                    record.targetMonster = findNearbyMonsters(villager.dimension, villager.location, FLETCHER_CONFIG.MONSTER_SEARCH_RADIUS);
                    if (!record.targetMonster) {
                        record.state = FletcherState.COOLDOWN;
                        record.timer = 30;
                        try {
                            villager.triggerEvent("minecraft:schedule_wander_villager");
                        } catch {}
                        break;
                    }
                }

                const dist = distance(villager.location, record.targetMonster.location);
                if (dist > FLETCHER_CONFIG.MONSTER_SEARCH_RADIUS + 4.0) {
                    record.targetMonster = null;
                    record.state = FletcherState.IDLE;
                    record.timer = 15;
                    break;
                }

                // Face monster
                try {
                    const rot = getLookRotation(villager.location, record.targetMonster.location);
                    villager.teleport(villager.location, { rotation: { x: rot.x * 0.4, y: rot.y } });
                } catch {}

                // Tactical repositioning: advance if too far, back up if too close
                if (dist > 12.0) {
                    const dx = record.targetMonster.location.x - villager.location.x;
                    const dz = record.targetMonster.location.z - villager.location.z;
                    const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
                    try {
                        villager.applyImpulse({ x: (dx / len) * 0.15, y: 0, z: (dz / len) * 0.15 });
                    } catch {}
                } else if (dist < 3.0) {
                    const dx = villager.location.x - record.targetMonster.location.x;
                    const dz = villager.location.z - record.targetMonster.location.z;
                    const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
                    try {
                        villager.applyImpulse({ x: (dx / len) * 0.12, y: 0, z: (dz / len) * 0.12 });
                    } catch {}
                }

                // Shoot arrow at monster!
                if (record.timer <= 0) {
                    shootArrowAtMonster(villager, record.targetMonster, isHoldingCrossbow(villager));
                    record.timer = FLETCHER_CONFIG.ATTACK_INTERVAL_TICKS || 26; // ~1.3 seconds per shot
                }
                break;
            }

            case FletcherState.APPROACHING_TARGET: {
                // Immediate monster interruption check
                const hostile = findNearbyMonsters(villager.dimension, villager.location, FLETCHER_CONFIG.MONSTER_SEARCH_RADIUS);
                if (hostile) {
                    try {
                        villager.triggerEvent("rpc:stop_approach_target");
                    } catch {}
                    record.targetMonster = hostile;
                    record.state = FletcherState.COMBAT;
                    record.timer = 5;
                    break;
                }

                record.timer--;

                if (!record.targetBlock) {
                    try {
                        villager.triggerEvent("rpc:stop_approach_target");
                    } catch {}
                    record.state = FletcherState.IDLE;
                    record.timer = 10;
                    break;
                }

                // Face shooting spot / target block and walk towards it!
                const dest = record.shootingSpot || record.targetBlock;
                if (dest) {
                    try {
                        const rot = getLookRotation(villager.location, dest);
                        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
                        const dx = dest.x - villager.location.x;
                        const dz = dest.z - villager.location.z;
                        const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
                        villager.applyImpulse({ x: (dx / len) * 0.18, y: 0, z: (dz / len) * 0.18 });
                    } catch {}
                }

                const dist = distance(villager.location, record.targetBlock);
                if ((dist >= FLETCHER_CONFIG.PRACTICE_DISTANCE_MIN && dist <= FLETCHER_CONFIG.PRACTICE_DISTANCE_MAX) || record.timer <= 0) {
                    try {
                        villager.triggerEvent("rpc:stop_approach_target");
                    } catch {}
                    record.state = FletcherState.PRACTICE_AIMING;
                    record.timer = FLETCHER_CONFIG.AIM_DURATION_TICKS;
                }
                break;
            }

            case FletcherState.PRACTICE_AIMING: {
                // Immediate monster interruption check
                const hostile = findNearbyMonsters(villager.dimension, villager.location, FLETCHER_CONFIG.MONSTER_SEARCH_RADIUS);
                if (hostile) {
                    record.state = FletcherState.COMBAT;
                    record.timer = 20;
                    break;
                }

                record.timer--;

                // Prepare shot: play bow draw sound
                if (record.timer === Math.floor(FLETCHER_CONFIG.AIM_DURATION_TICKS / 2)) {
                    const isCrossbow = isHoldingCrossbow(villager);
                    if (isCrossbow) {
                        playSoundSafe(villager.dimension, "crossbow.loading_start", villager.location, { volume: 0.8, pitch: 1.0 });
                    } else {
                        playSoundSafe(villager.dimension, "random.bow", villager.location, { volume: 0.6, pitch: 0.9 });
                    }
                    try {
                        villager.playAnimation("animation.villager.raise_arms");
                    } catch {}
                }

                // Release arrow at the target block!
                if (record.timer <= 0) {
                    if (record.targetBlock) {
                        const isCrossbow = isHoldingCrossbow(villager);
                        shootArrowAtBlock(villager, record.targetBlock, isCrossbow);
                    }

                    record.state = FletcherState.COOLDOWN;
                    record.timer = FLETCHER_CONFIG.PRACTICE_INTERVAL_TICKS;
                    try {
                        villager.triggerEvent("minecraft:schedule_wander_villager");
                    } catch {}
                }
                break;
            }

            case FletcherState.COOLDOWN: {
                // If a monster enters during cooldown, immediately engage combat
                const hostile = findNearbyMonsters(villager.dimension, villager.location, FLETCHER_CONFIG.MONSTER_SEARCH_RADIUS);
                if (hostile) {
                    record.state = FletcherState.COMBAT;
                    record.timer = 20;
                    break;
                }

                record.timer--;
                if (record.timer <= 0) {
                    record.state = FletcherState.IDLE;
                    record.timer = 20;
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
        if (this.isFletcherVillager(entity)) {
            // 50% chance bow, 50% chance crossbow for natural spawns
            const weapon = Math.random() < 0.5 ? FLETCHER_CONFIG.BOW_ITEM_ID : FLETCHER_CONFIG.CROSSBOW_ITEM_ID;
            this.registerFletcher(entity, weapon);
        }
    }
}

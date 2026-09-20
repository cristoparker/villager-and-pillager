/**
 * Fisherman Villager Addon - Fletcher Manager Module (Namespace: rpc)
 * Coordinates detection of Fletcher villagers, equips them with Bow or Crossbow,
 * manages village monster defense (shooting zombies, creepers, spiders, etc.),
 * and conducts archery practice on nearby Target blocks during free time.
 */

import { world } from "@minecraft/server";
import { FLETCHER_CONFIG } from "./config.js";
import { distance, playSoundSafe } from "./utils.js";
import { 
    equipRangedWeapon, 
    unequipRangedWeapon, 
    isHoldingCrossbow, 
    findNearbyMonsters, 
    findNearbyTargetBlock, 
    findShootingSpot, 
    shootArrowAtEntity, 
    shootArrowAtBlock 
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
        /** @type {Map<string, { state: string, villager: Entity, targetMonster: Entity|null, targetBlock: any, shootingSpot: any, preferredWeapon: string, timer: number }>} */
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

        try {
            if (entity.matches({ families: ["fletcher"] })) return true;
        } catch {}

        try {
            if (entity.hasTag("rpc:fletcher") || entity.hasTag("fletcher")) return true;
        } catch {}

        try {
            if (entity.nameTag && entity.nameTag.toLowerCase().includes("fletcher")) return true;
        } catch {}

        try {
            const variantComp = entity.getComponent("minecraft:variant");
            if (variantComp && (variantComp.value === 4 || variantComp.value === 7)) return true;
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
            targetMonster: null,
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

            // Handle despawned or unloaded entities
            if (!villager || !villager.isValid()) {
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
                record.targetMonster = null;
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
                    record.timer = 15;

                    // Ensure weapon is equipped
                    equipRangedWeapon(villager, record.preferredWeapon);

                    // 1. PRIORITY 1: Check for nearby hostile monsters
                    const monster = findNearbyMonsters(villager.dimension, villager.location, FLETCHER_CONFIG.MONSTER_SEARCH_RADIUS);
                    if (monster) {
                        record.targetMonster = monster;
                        record.state = FletcherState.COMBAT;
                        record.timer = 10; // Rapid reaction time (0.5s)
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
                // Instantly re-verify monster target
                if (!record.targetMonster || !record.targetMonster.isValid()) {
                    // Check if other monsters are still nearby
                    const nextMob = findNearbyMonsters(villager.dimension, villager.location, FLETCHER_CONFIG.MONSTER_SEARCH_RADIUS);
                    if (nextMob) {
                        record.targetMonster = nextMob;
                        record.timer = 10;
                    } else {
                        // All monsters cleared!
                        record.targetMonster = null;
                        record.state = FletcherState.COOLDOWN;
                        record.timer = 30;
                        try {
                            villager.triggerEvent("minecraft:schedule_wander_villager");
                        } catch {}
                    }
                    break;
                }

                // Check distance
                const dist = distance(villager.location, record.targetMonster.location);
                if (dist > FLETCHER_CONFIG.MONSTER_SEARCH_RADIUS + 4.0) {
                    // Monster walked out of range
                    record.targetMonster = null;
                    record.state = FletcherState.IDLE;
                    record.timer = 10;
                    break;
                }

                record.timer--;

                // Prepare shot: play draw sound when aiming starts
                if (record.timer === FLETCHER_CONFIG.AIM_DURATION_TICKS - 4) {
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

                // Shoot arrow at monster!
                if (record.timer <= 0) {
                    const isCrossbow = isHoldingCrossbow(villager);
                    shootArrowAtEntity(villager, record.targetMonster, isCrossbow);

                    // Reset attack cooldown for next shot
                    record.timer = FLETCHER_CONFIG.ATTACK_INTERVAL_TICKS;
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
                    record.timer = 10;
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
                    record.targetMonster = hostile;
                    record.state = FletcherState.COMBAT;
                    record.timer = 10;
                    break;
                }

                record.timer--;

                // Prepare shot: play bow draw sound
                if (record.timer === FLETCHER_CONFIG.AIM_DURATION_TICKS - 4) {
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
                    record.targetMonster = hostile;
                    record.state = FletcherState.COMBAT;
                    record.timer = 10;
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

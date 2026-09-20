/**
 * Villager Professions Addon - Cleric Manager Module (Namespace: rpc)
 * Coordinates detection of Cleric villagers, equips splash potions in hand,
 * scans for injured allies (villagers, iron golems, players), executes healing rituals,
 * interacts with brewing stands, and enforces day/night sleeping schedules.
 */

import { world } from "@minecraft/server";
import { CLERIC_CONFIG } from "./config.js";
import { distance, getLookRotation } from "./utils.js";
import { getVillagerProfession } from "./professionHelper.js";
import {
    equipPotion,
    unequipPotion,
    findNearbyInjuredAlly,
    findNearbyBrewingStand,
    performHeal,
    performBrew,
    performWitcherRegen,
    isRaidOrMonsterThreatNearby,
    findNearbyPillagersAndMonsters,
    performOffensiveSplashPotion
} from "./clericBehavior.js";

export const ClericState = {
    IDLE: "IDLE",
    RAID_COMBAT: "RAID_COMBAT",
    DRINKING_POTION: "DRINKING_POTION",
    OFFENSIVE_SPLASH: "OFFENSIVE_SPLASH",
    APPROACHING_ALLY: "APPROACHING_ALLY",
    HEALING: "HEALING",
    APPROACHING_BREW: "APPROACHING_BREW",
    BREWING: "BREWING",
    COOLDOWN: "COOLDOWN",
    SLEEPING: "SLEEPING"
};

export class ClericManager {
    constructor() {
        /** @type {Map<string, { state: string, villager: Entity, targetAlly: Entity|null, targetEnemy: Entity|null, brewingStand: any, witcherCooldown: number, offensiveCooldown: number, timer: number }>} */
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
     * Checks if an entity is a Cleric villager.
     * @param {Entity} entity 
     * @returns {boolean}
     */
    isClericVillager(entity) {
        if (!entity || !entity.isValid()) return false;

        const liveProf = getVillagerProfession(entity);
        if (liveProf !== null) {
            return liveProf === "cleric";
        }

        try {
            if (entity.hasTag("rpc:cleric") || entity.hasTag("cleric")) return true;
        } catch {}

        return false;
    }

    /**
     * Scans loaded entities for Cleric villagers.
     */
    scanForClerics() {
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
                if (this.isClericVillager(villager)) {
                    this.registerCleric(villager);
                }
            }
        }
    }

    /**
     * Registers a new Cleric villager into the manager.
     * @param {Entity} villager 
     */
    registerCleric(villager) {
        if (!villager || !villager.isValid()) return;

        equipPotion(villager);

        this.records.set(villager.id, {
            state: ClericState.IDLE,
            villager: villager,
            targetAlly: null,
            targetEnemy: null,
            brewingStand: null,
            witcherCooldown: 0,
            offensiveCooldown: 0,
            timer: 20
        });
    }

    /**
     * Called when an entity spawns or transforms.
     * @param {Entity} entity 
     */
    onEntitySpawn(entity) {
        if (this.isClericVillager(entity)) {
            this.registerCleric(entity);
        }
    }

    /**
     * Main update tick loop.
     */
    update() {
        this.scanCooldownTicks++;
        if (this.scanCooldownTicks >= 30) {
            this.scanCooldownTicks = 0;
            this.scanForClerics();
        }

        const isNight = this.isNightTime();

        for (const [id, record] of this.records.entries()) {
            const { villager } = record;

            if (!villager || !villager.isValid() || !this.isClericVillager(villager)) {
                if (villager && villager.isValid()) {
                    unequipPotion(villager);
                }
                this.records.delete(id);
                continue;
            }

            if (isNight && record.state !== ClericState.SLEEPING) {
                unequipPotion(villager);
                try {
                    villager.triggerEvent("minecraft:schedule_bed_villager");
                } catch {}

                record.state = ClericState.SLEEPING;
                record.targetAlly = null;
                record.brewingStand = null;
                continue;
            }

            this.updateCleric(record, isNight);
        }
    }

    /**
     * Updates an individual Cleric's routine.
     * @param {object} record 
     * @param {boolean} isNight 
     */
    updateCleric(record, isNight) {
        const { villager } = record;

        if (record.witcherCooldown > 0) record.witcherCooldown--;
        if (record.offensiveCooldown > 0) record.offensiveCooldown--;

        switch (record.state) {
            case ClericState.SLEEPING: {
                if (!isNight) {
                    try {
                        villager.triggerEvent("minecraft:schedule_wander_villager");
                    } catch {}
                    equipPotion(villager);
                    record.state = ClericState.IDLE;
                    record.timer = 40;
                }
                break;
            }

            case ClericState.DRINKING_POTION: {
                record.timer--;
                if (record.timer <= 0) {
                    performWitcherRegen(villager);
                    record.witcherCooldown = 200; // 10s cooldown
                    record.state = ClericState.COOLDOWN;
                    record.timer = 20;
                }
                break;
            }

            case ClericState.OFFENSIVE_SPLASH: {
                record.timer--;
                if (record.timer <= 0) {
                    if (record.targetEnemy && record.targetEnemy.isValid()) {
                        performOffensiveSplashPotion(villager, record.targetEnemy);
                    }
                    record.targetEnemy = null;
                    record.offensiveCooldown = CLERIC_CONFIG.POTION_COOLDOWN_TICKS || 40;
                    record.state = ClericState.COOLDOWN;
                    record.timer = 20;
                }
                break;
            }

            case ClericState.IDLE: {
                record.timer--;
                if (record.timer <= 0) {
                    record.timer = 20;
                    equipPotion(villager);

                    // Check for Raid or Monster threats nearby
                    const inDanger = isRaidOrMonsterThreatNearby(villager.dimension, villager.location, CLERIC_CONFIG.RAID_SEARCH_RADIUS);
                    if (inDanger) {
                        // 1. Self-preservation: Witcher-style potion drinking
                        let shouldDrink = false;
                        try {
                            const health = villager.getComponent("minecraft:health");
                            if (health && (health.currentValue / health.effectiveMax) <= CLERIC_CONFIG.SELF_REGEN_HEALTH_THRESHOLD) {
                                shouldDrink = true;
                            }
                        } catch {}

                        if ((shouldDrink || Math.random() < 0.25) && record.witcherCooldown <= 0) {
                            record.state = ClericState.DRINKING_POTION;
                            record.timer = 15;
                            break;
                        }

                        // 2. Scan for injured allies strictly: villagers and player only
                        const injured = findNearbyInjuredAlly(villager.dimension, villager.location, CLERIC_CONFIG.ALLIED_SEARCH_RADIUS);
                        if (injured) {
                            record.targetAlly = injured;
                            const dist = distance(villager.location, injured.location);
                            if (dist <= CLERIC_CONFIG.HEAL_DISTANCE) {
                                record.state = ClericState.HEALING;
                                record.timer = CLERIC_CONFIG.HEAL_ANIMATION_TICKS;
                            } else {
                                record.state = ClericState.APPROACHING_ALLY;
                                record.timer = 60;
                            }
                            break;
                        }

                        // 3. Attack pillagers/monsters with offensive splash potions (slowness, poison, harming)
                        if (record.offensiveCooldown <= 0) {
                            const enemy = findNearbyPillagersAndMonsters(villager.dimension, villager.location, CLERIC_CONFIG.OFFENSIVE_SEARCH_RADIUS);
                            if (enemy) {
                                record.targetEnemy = enemy;
                                record.state = ClericState.OFFENSIVE_SPLASH;
                                record.timer = 12;
                                break;
                            }
                        }
                    }

                    // Peaceful routine
                    // 1. Scan for injured allies (villager, player)
                    const injured = findNearbyInjuredAlly(villager.dimension, villager.location, CLERIC_CONFIG.ALLIED_SEARCH_RADIUS);
                    if (injured) {
                        record.targetAlly = injured;
                        const dist = distance(villager.location, injured.location);
                        if (dist <= CLERIC_CONFIG.HEAL_DISTANCE) {
                            record.state = ClericState.HEALING;
                            record.timer = CLERIC_CONFIG.HEAL_ANIMATION_TICKS;
                        } else {
                            record.state = ClericState.APPROACHING_ALLY;
                            record.timer = 100;
                        }
                        break;
                    }

                    // 2. Interact with brewing stand
                    if (Math.random() < 0.3) {
                        const stand = findNearbyBrewingStand(villager.dimension, villager.location, 14);
                        if (stand) {
                            record.brewingStand = stand;
                            record.state = ClericState.APPROACHING_BREW;
                            record.timer = 100;
                            break;
                        }
                    }
                }
                break;
            }

            case ClericState.APPROACHING_ALLY: {
                record.timer--;

                if (!record.targetAlly || !record.targetAlly.isValid()) {
                    record.state = ClericState.IDLE;
                    record.targetAlly = null;
                    record.timer = 10;
                    break;
                }

                try {
                    const rot = getLookRotation(villager.location, record.targetAlly.location);
                    villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
                } catch {}

                const dist = distance(villager.location, record.targetAlly.location);
                if (dist <= CLERIC_CONFIG.HEAL_DISTANCE) {
                    record.state = ClericState.HEALING;
                    record.timer = CLERIC_CONFIG.HEAL_ANIMATION_TICKS;
                } else if (record.timer <= 0) {
                    // Try healing anyway if within reasonable range (up to 10 blocks)
                    if (dist <= 10.0) {
                        record.state = ClericState.HEALING;
                        record.timer = CLERIC_CONFIG.HEAL_ANIMATION_TICKS;
                    } else {
                        record.state = ClericState.IDLE;
                        record.targetAlly = null;
                        record.timer = 20;
                    }
                }
                break;
            }

            case ClericState.HEALING: {
                record.timer--;
                if (record.timer <= 0) {
                    if (record.targetAlly && record.targetAlly.isValid()) {
                        performHeal(villager, record.targetAlly);
                    }
                    record.targetAlly = null;
                    record.state = ClericState.COOLDOWN;
                    record.timer = CLERIC_CONFIG.HEAL_COOLDOWN_TICKS;
                }
                break;
            }

            case ClericState.APPROACHING_BREW: {
                record.timer--;
                if (!record.brewingStand) {
                    record.state = ClericState.IDLE;
                    break;
                }

                const dist = distance(villager.location, record.brewingStand.pos);
                if (dist <= 2.8) {
                    record.state = ClericState.BREWING;
                    record.timer = 24;
                } else if (record.timer <= 0) {
                    record.state = ClericState.IDLE;
                    record.brewingStand = null;
                    record.timer = 20;
                }
                break;
            }

            case ClericState.BREWING: {
                record.timer--;
                if (record.timer <= 0) {
                    if (record.brewingStand) {
                        performBrew(villager, record.brewingStand);
                    }
                    record.brewingStand = null;
                    record.state = ClericState.COOLDOWN;
                    record.timer = 40;
                }
                break;
            }

            case ClericState.COOLDOWN: {
                record.timer--;
                if (record.timer <= 0) {
                    record.state = ClericState.IDLE;
                    record.timer = 15;
                }
                break;
            }
        }
    }
}

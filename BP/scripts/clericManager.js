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
    equipGoldenApple,
    findNearbyInjuredAlly,
    findNearbyBrewingStand,
    performHeal,
    performBrew,
    performBrewPotions,
    performWitcherRegen,
    isRaidOrMonsterThreatNearby,
    findNearbyPillagersAndMonsters,
    performOffensiveSplashPotion,
    findNearbyZombieVillager,
    performCureZombieVillager,
    performHolySanctuary
} from "./clericBehavior.js";

export const ClericState = {
    IDLE: "IDLE",
    RAID_COMBAT: "RAID_COMBAT",
    DRINKING_POTION: "DRINKING_POTION",
    OFFENSIVE_SPLASH: "OFFENSIVE_SPLASH",
    HOLY_SANCTUARY: "HOLY_SANCTUARY",
    APPROACHING_ALLY: "APPROACHING_ALLY",
    HEALING: "HEALING",
    APPROACHING_ZOMBIE_VILLAGER: "APPROACHING_ZOMBIE_VILLAGER",
    CURING_ZOMBIE_VILLAGER: "CURING_ZOMBIE_VILLAGER",
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
            targetZombieVillager: null,
            brewingStand: null,
            witcherCooldown: 0,
            offensiveCooldown: 0,
            sanctuaryCooldown: 0,
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
        if (record.sanctuaryCooldown > 0) record.sanctuaryCooldown--;

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

            case ClericState.HOLY_SANCTUARY: {
                record.timer--;
                if (record.timer <= 0) {
                    performHolySanctuary(villager);
                    record.sanctuaryCooldown = 300; // 15 seconds
                    record.state = ClericState.COOLDOWN;
                    record.timer = 30;
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

                        // 2. Holy Sanctuary defensive aura (repels hostiles and buffs all allies)
                        if (record.sanctuaryCooldown <= 0 && Math.random() < 0.40) {
                            record.state = ClericState.HOLY_SANCTUARY;
                            record.timer = 25;
                            break;
                        }

                        // 3. Scan for injured allies strictly: villagers and player only
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

                        // 4. Attack pillagers/monsters with offensive splash potions (slowness, poison, harming)
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
                    // 1. Scan for Zombie Villager in need of golden apple & weakness curing ritual!
                    const zombieVillager = findNearbyZombieVillager(villager.dimension, villager.location, CLERIC_CONFIG.ZOMBIE_VILLAGER_SEARCH_RADIUS);
                    if (zombieVillager) {
                        record.targetZombieVillager = zombieVillager;
                        const dist = distance(villager.location, zombieVillager.location);
                        if (dist <= 3.0) {
                            record.state = ClericState.CURING_ZOMBIE_VILLAGER;
                            record.timer = 35;
                            equipGoldenApple(villager);
                        } else {
                            record.state = ClericState.APPROACHING_ZOMBIE_VILLAGER;
                            record.timer = 90;
                        }
                        break;
                    }

                    // 2. Scan for injured allies (villager, player)
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

                    // 3. Interact with brewing stand (brew and drop potions)
                    if (Math.random() < 0.35) {
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

                if (!record.targetAlly || !record.targetAlly.isValid() || record.timer <= 0) {
                    record.state = ClericState.IDLE;
                    record.targetAlly = null;
                    record.timer = 20;
                    break;
                }

                const allyLoc = record.targetAlly.location;
                const dist = distance(villager.location, allyLoc);
                if (dist <= CLERIC_CONFIG.HEAL_DISTANCE) {
                    record.state = ClericState.HEALING;
                    record.timer = CLERIC_CONFIG.HEAL_ANIMATION_TICKS;
                    break;
                }

                try {
                    if (record.timer % 10 === 0) {
                        const rot = getLookRotation(villager.location, allyLoc);
                        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
                    }
                    const dx = allyLoc.x - villager.location.x;
                    const dz = allyLoc.z - villager.location.z;
                    const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
                    villager.applyImpulse({ x: (dx / len) * 0.18, y: 0, z: (dz / len) * 0.18 });
                } catch {}
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

            case ClericState.APPROACHING_ZOMBIE_VILLAGER: {
                record.timer--;
                if (!record.targetZombieVillager || !record.targetZombieVillager.isValid() || record.timer <= 0) {
                    record.state = ClericState.IDLE;
                    record.targetZombieVillager = null;
                    record.timer = 20;
                    break;
                }

                const zLoc = record.targetZombieVillager.location;
                const dist = distance(villager.location, zLoc);
                if (dist <= 3.0) {
                    record.state = ClericState.CURING_ZOMBIE_VILLAGER;
                    record.timer = 35;
                    equipGoldenApple(villager);
                    break;
                }

                try {
                    if (record.timer % 10 === 0) {
                        const rot = getLookRotation(villager.location, zLoc);
                        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
                    }
                    const dx = zLoc.x - villager.location.x;
                    const dz = zLoc.z - villager.location.z;
                    const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
                    villager.applyImpulse({ x: (dx / len) * 0.18, y: 0, z: (dz / len) * 0.18 });
                } catch {}
                break;
            }

            case ClericState.CURING_ZOMBIE_VILLAGER: {
                record.timer--;
                if (record.timer <= 0) {
                    if (record.targetZombieVillager && record.targetZombieVillager.isValid()) {
                        performCureZombieVillager(villager, record.targetZombieVillager);
                    }
                    record.targetZombieVillager = null;
                    record.state = ClericState.COOLDOWN;
                    record.timer = 60;
                }
                break;
            }

            case ClericState.APPROACHING_BREW: {
                record.timer--;
                if (!record.brewingStand || record.timer <= 0) {
                    record.state = ClericState.IDLE;
                    record.brewingStand = null;
                    record.timer = 20;
                    break;
                }

                const standPos = record.brewingStand.pos;
                const dist = distance(villager.location, standPos);
                if (dist <= 2.8) {
                    record.state = ClericState.BREWING;
                    record.timer = 30;
                    break;
                }

                try {
                    if (record.timer % 10 === 0) {
                        const rot = getLookRotation(villager.location, standPos);
                        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
                    }
                    const dx = standPos.x + 0.5 - villager.location.x;
                    const dz = standPos.z + 0.5 - villager.location.z;
                    const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
                    villager.applyImpulse({ x: (dx / len) * 0.18, y: 0, z: (dz / len) * 0.18 });
                } catch {}
                break;
            }

            case ClericState.BREWING: {
                record.timer--;
                if (record.timer <= 0) {
                    if (record.brewingStand) {
                        performBrewPotions(villager, record.brewingStand);
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

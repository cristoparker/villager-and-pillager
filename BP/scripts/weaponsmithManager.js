/**
 * Villager Professions Addon - Weaponsmith Manager Module (Namespace: rpc)
 * Coordinates detection of Weaponsmith villagers, equips iron sword in hand,
 * manages grindstone maintenance routines, defends against monsters,
 * and enforces day/night sleeping schedules.
 */

import { world } from "@minecraft/server";
import { WEAPONSMITH_CONFIG } from "./config.js";
import { distance, getLookRotation } from "./utils.js";
import { getVillagerProfession } from "./professionHelper.js";
import {
    equipSword,
    unequipSword,
    equipAxe,
    equipHorn,
    findNearbyGrindstone,
    findNearbyMonsters,
    performSharpen,
    findNearbyCombatAllies,
    performSharpenAlly,
    performCallToArms,
    performAttackMonster
} from "./weaponsmithBehavior.js";

export const WeaponsmithState = {
    IDLE: "IDLE",
    COMBAT: "COMBAT",
    CALL_TO_ARMS: "CALL_TO_ARMS",
    APPROACHING_ALLY: "APPROACHING_ALLY",
    SHARPENING_ALLY: "SHARPENING_ALLY",
    APPROACHING_GRINDSTONE: "APPROACHING_GRINDSTONE",
    SHARPENING: "SHARPENING",
    COOLDOWN: "COOLDOWN",
    SLEEPING: "SLEEPING"
};

export class WeaponsmithManager {
    constructor() {
        /** @type {Map<string, { state: string, villager: Entity, grindstone: any, targetMonster: Entity|null, targetAlly: Entity|null, hasCalledHorn: boolean, timer: number }>} */
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
     * Checks if an entity is a Weaponsmith villager.
     * @param {Entity} entity 
     * @returns {boolean}
     */
    isWeaponsmithVillager(entity) {
        if (!entity || !entity.isValid()) return false;

        const liveProf = getVillagerProfession(entity);
        if (liveProf !== null) {
            return liveProf === "weaponsmith";
        }

        try {
            if (entity.hasTag("rpc:weaponsmith") || entity.hasTag("weaponsmith")) return true;
        } catch {}

        return false;
    }

    /**
     * Scans loaded entities for Weaponsmith villagers.
     */
    scanForWeaponsmiths() {
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
                if (this.isWeaponsmithVillager(villager)) {
                    this.registerWeaponsmith(villager);
                }
            }
        }
    }

    /**
     * Registers a new Weaponsmith into the manager.
     * @param {Entity} villager 
     */
    registerWeaponsmith(villager) {
        if (!villager || !villager.isValid()) return;

        equipSword(villager);

        this.records.set(villager.id, {
            state: WeaponsmithState.IDLE,
            villager: villager,
            grindstone: null,
            timer: 20
        });
    }

    /**
     * Called when an entity spawns or transforms.
     * @param {Entity} entity 
     */
    onEntitySpawn(entity) {
        if (this.isWeaponsmithVillager(entity)) {
            this.registerWeaponsmith(entity);
        }
    }

    /**
     * Main update loop.
     */
    update() {
        this.scanCooldownTicks++;
        if (this.scanCooldownTicks >= 30) {
            this.scanCooldownTicks = 0;
            this.scanForWeaponsmiths();
        }

        const isNight = this.isNightTime();

        for (const [id, record] of this.records.entries()) {
            const { villager } = record;

            if (!villager || !villager.isValid() || !this.isWeaponsmithVillager(villager)) {
                if (villager && villager.isValid()) {
                    unequipSword(villager);
                }
                this.records.delete(id);
                continue;
            }

            if (isNight && record.state !== WeaponsmithState.SLEEPING) {
                // If actively fighting monster, don't sleep immediately
                const monster = findNearbyMonsters(villager.dimension, villager.location, 12);
                if (!monster) {
                    unequipSword(villager);
                    try {
                        villager.triggerEvent("minecraft:schedule_bed_villager");
                    } catch {}
                    record.state = WeaponsmithState.SLEEPING;
                    record.grindstone = null;
                    continue;
                }
            }

            this.updateWeaponsmith(record, isNight);
        }
    }

    /**
     * Updates an individual Weaponsmith.
     * @param {object} record 
     * @param {boolean} isNight 
     */
    updateWeaponsmith(record, isNight) {
        const { villager } = record;

        // Threat Check: Check for monsters threatening the village
        if (record.state !== WeaponsmithState.SLEEPING && record.state !== WeaponsmithState.COMBAT && record.state !== WeaponsmithState.CALL_TO_ARMS) {
            const monster = findNearbyMonsters(villager.dimension, villager.location, WEAPONSMITH_CONFIG.MONSTER_SEARCH_RADIUS);
            if (monster) {
                record.targetMonster = monster;
                if (!record.hasCalledHorn) {
                    record.hasCalledHorn = true;
                    record.state = WeaponsmithState.CALL_TO_ARMS;
                    record.timer = 25;
                    equipHorn(villager);
                } else {
                    record.state = WeaponsmithState.COMBAT;
                    record.timer = 15;
                    equipSword(villager);
                }
            }
        }

        switch (record.state) {
            case WeaponsmithState.SLEEPING: {
                if (!isNight) {
                    try {
                        villager.triggerEvent("minecraft:schedule_wander_villager");
                    } catch {}
                    equipSword(villager);
                    record.state = WeaponsmithState.IDLE;
                    record.timer = 40;
                }
                break;
            }

            case WeaponsmithState.CALL_TO_ARMS: {
                record.timer--;
                if (record.timer % 12 === 0) {
                    performCallToArms(villager);
                }

                if (record.timer <= 0) {
                    record.state = WeaponsmithState.COMBAT;
                    record.timer = 20;
                    equipSword(villager);
                }
                break;
            }

            case WeaponsmithState.COMBAT: {
                record.timer--;

                if (!record.targetMonster || !record.targetMonster.isValid()) {
                    const nextMonster = findNearbyMonsters(villager.dimension, villager.location, WEAPONSMITH_CONFIG.MONSTER_SEARCH_RADIUS);
                    if (nextMonster) {
                        record.targetMonster = nextMonster;
                    } else {
                        record.targetMonster = null;
                        equipSword(villager);
                        record.state = WeaponsmithState.COOLDOWN;
                        record.timer = 30;
                        break;
                    }
                }

                const monster = record.targetMonster;
                const mLoc = monster.location;
                const dist = distance(villager.location, mLoc);

                // Determine weapon stance: use Axe against illagers/pillagers/vindictors, Sword against zombies/spiders
                const isArmoredOrIllager = monster.typeId.includes("pillager") || monster.typeId.includes("vindicator") || monster.typeId.includes("iron_golem") || monster.typeId.includes("ravager");
                if (isArmoredOrIllager) {
                    equipAxe(villager);
                } else {
                    equipSword(villager);
                }

                // Face monster and close in
                try {
                    if (record.timer % 10 === 0) {
                        const rot = getLookRotation(villager.location, mLoc);
                        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
                    }
                    if (dist > WEAPONSMITH_CONFIG.ATTACK_DISTANCE) {
                        const dx = mLoc.x - villager.location.x;
                        const dz = mLoc.z - villager.location.z;
                        const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
                        villager.applyImpulse({ x: (dx / len) * 0.20, y: 0, z: (dz / len) * 0.20 });
                    }
                } catch {}

                // Strike!
                if (dist <= WEAPONSMITH_CONFIG.ATTACK_DISTANCE + 0.5 && record.timer <= 0) {
                    performAttackMonster(villager, monster, isArmoredOrIllager);
                    record.timer = 20; // 1 second swing rate
                }
                break;
            }

            case WeaponsmithState.IDLE: {
                record.timer--;
                if (record.timer <= 0) {
                    record.timer = 25;
                    equipSword(villager);

                    // 1. Scan for unbuffed combat allies to sharpen their blades
                    const ally = findNearbyCombatAllies(villager.dimension, villager.location, WEAPONSMITH_CONFIG.BUFF_SEARCH_RADIUS);
                    if (ally) {
                        record.targetAlly = ally;
                        const dist = distance(villager.location, ally.location);
                        if (dist <= 2.5) {
                            record.state = WeaponsmithState.SHARPENING_ALLY;
                            record.timer = 25;
                        } else {
                            record.state = WeaponsmithState.APPROACHING_ALLY;
                            record.timer = 90;
                        }
                        break;
                    }

                    // 2. Secondary: Sharpen sword at Grindstone
                    if (Math.random() < 0.35) {
                        const grindstone = findNearbyGrindstone(villager.dimension, villager.location, WEAPONSMITH_CONFIG.GRINDSTONE_SEARCH_RADIUS);
                        if (grindstone) {
                            record.grindstone = grindstone;
                            const dist = distance(villager.location, grindstone.pos);
                            if (dist <= WEAPONSMITH_CONFIG.GRINDSTONE_USE_DISTANCE) {
                                record.state = WeaponsmithState.SHARPENING;
                                record.timer = WEAPONSMITH_CONFIG.SHARPEN_ANIMATION_TICKS;
                            } else {
                                record.state = WeaponsmithState.APPROACHING_GRINDSTONE;
                                record.timer = 100;
                            }
                            break;
                        }
                    }
                }
                break;
            }

            case WeaponsmithState.APPROACHING_ALLY: {
                record.timer--;
                if (!record.targetAlly || !record.targetAlly.isValid()) {
                    record.state = WeaponsmithState.IDLE;
                    record.targetAlly = null;
                    record.timer = 10;
                    break;
                }

                try {
                    const aLoc = record.targetAlly.location;
                    if (record.timer % 10 === 0) {
                        const rot = getLookRotation(villager.location, aLoc);
                        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
                    }
                    const dx = aLoc.x - villager.location.x;
                    const dz = aLoc.z - villager.location.z;
                    const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
                    villager.applyImpulse({ x: (dx / len) * 0.18, y: 0, z: (dz / len) * 0.18 });
                } catch {}

                const dist = distance(villager.location, record.targetAlly.location);
                if (dist <= 2.5) {
                    record.state = WeaponsmithState.SHARPENING_ALLY;
                    record.timer = 25;
                } else if (record.timer <= 0) {
                    record.state = WeaponsmithState.IDLE;
                    record.targetAlly = null;
                    record.timer = 20;
                }
                break;
            }

            case WeaponsmithState.SHARPENING_ALLY: {
                record.timer--;
                if (record.timer <= 0) {
                    if (record.targetAlly && record.targetAlly.isValid()) {
                        performSharpenAlly(villager, record.targetAlly);
                    }
                    record.targetAlly = null;
                    equipSword(villager);
                    record.state = WeaponsmithState.COOLDOWN;
                    record.timer = 40;
                }
                break;
            }

            case WeaponsmithState.APPROACHING_GRINDSTONE: {
                record.timer--;
                if (!record.grindstone) {
                    record.state = WeaponsmithState.IDLE;
                    break;
                }

                try {
                    const gPos = { x: record.grindstone.pos.x + 0.5, y: record.grindstone.pos.y, z: record.grindstone.pos.z + 0.5 };
                    if (record.timer % 10 === 0) {
                        const rot = getLookRotation(villager.location, gPos);
                        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
                    }
                    const dx = gPos.x - villager.location.x;
                    const dz = gPos.z - villager.location.z;
                    const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
                    villager.applyImpulse({ x: (dx / len) * 0.18, y: 0, z: (dz / len) * 0.18 });
                } catch {}

                const dist = distance(villager.location, record.grindstone.pos);
                if (dist <= WEAPONSMITH_CONFIG.GRINDSTONE_USE_DISTANCE) {
                    record.state = WeaponsmithState.SHARPENING;
                    record.timer = WEAPONSMITH_CONFIG.SHARPEN_ANIMATION_TICKS;
                } else if (record.timer <= 0) {
                    record.state = WeaponsmithState.IDLE;
                    record.grindstone = null;
                    record.timer = 20;
                }
                break;
            }

            case WeaponsmithState.SHARPENING: {
                record.timer--;
                if (record.timer <= 0) {
                    if (record.grindstone) {
                        performSharpen(villager, record.grindstone);
                    }
                    record.grindstone = null;
                    record.state = WeaponsmithState.COOLDOWN;
                    record.timer = WEAPONSMITH_CONFIG.COOLDOWN_TICKS;
                }
                break;
            }

            case WeaponsmithState.COOLDOWN: {
                record.timer--;
                if (record.timer <= 0) {
                    equipSword(villager);
                    record.hasCalledHorn = false;
                    record.state = WeaponsmithState.IDLE;
                    record.timer = 15;
                }
                break;
            }
        }
    }
}

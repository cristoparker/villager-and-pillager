/**
 * Villager Professions Addon - Weaponsmith Manager Module (Namespace: rpc)
 * Coordinates detection of Weaponsmith villagers, equips iron sword in hand,
 * manages grindstone maintenance routines, defends against monsters,
 * and enforces day/night sleeping schedules.
 */

import { world } from "@minecraft/server";
import { WEAPONSMITH_CONFIG } from "./config.js";
import { distance } from "./utils.js";
import {
    equipSword,
    unequipSword,
    findNearbyGrindstone,
    findNearbyMonsters,
    performSharpen
} from "./weaponsmithBehavior.js";

export const WeaponsmithState = {
    IDLE: "IDLE",
    COMBAT: "COMBAT",
    APPROACHING_GRINDSTONE: "APPROACHING_GRINDSTONE",
    SHARPENING: "SHARPENING",
    COOLDOWN: "COOLDOWN",
    SLEEPING: "SLEEPING"
};

export class WeaponsmithManager {
    constructor() {
        /** @type {Map<string, { state: string, villager: Entity, grindstone: any, timer: number }>} */
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

        try {
            if (entity.hasTag("rpc:butcher") || entity.hasTag("rpc:fletcher") || entity.hasTag("rpc:fisherman") || entity.hasTag("rpc:shepherd") || entity.hasTag("rpc:farmer")) {
                return false;
            }
        } catch {}

        try {
            if (entity.matches({ families: ["weaponsmith"] })) return true;
        } catch {}

        try {
            if (entity.hasTag("rpc:weaponsmith") || entity.hasTag("weaponsmith")) return true;
        } catch {}

        try {
            if (entity.nameTag && entity.nameTag.toLowerCase().includes("weapon")) return true;
        } catch {}

        try {
            const variantComp = entity.getComponent("minecraft:variant");
            if (variantComp && variantComp.value === 9) return true;
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

            case WeaponsmithState.IDLE: {
                record.timer--;
                if (record.timer <= 0) {
                    record.timer = 25;
                    equipSword(villager);

                    // 1. Check for hostile monsters (Combat Priority)
                    const monster = findNearbyMonsters(villager.dimension, villager.location, WEAPONSMITH_CONFIG.MONSTER_SEARCH_RADIUS);
                    if (monster) {
                        record.state = WeaponsmithState.COMBAT;
                        record.timer = 30;
                        break;
                    }

                    // 2. Sharpen at Grindstone
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
                                record.timer = 120;
                            }
                            break;
                        }
                    }
                }
                break;
            }

            case WeaponsmithState.COMBAT: {
                record.timer--;
                equipSword(villager);

                if (record.timer <= 0) {
                    record.timer = 20;
                    const monster = findNearbyMonsters(villager.dimension, villager.location, WEAPONSMITH_CONFIG.MONSTER_SEARCH_RADIUS);
                    if (!monster) {
                        record.state = WeaponsmithState.COOLDOWN;
                        record.timer = 30;
                    }
                }
                break;
            }

            case WeaponsmithState.APPROACHING_GRINDSTONE: {
                record.timer--;

                // If monster appears, switch to combat immediately!
                const monster = findNearbyMonsters(villager.dimension, villager.location, 12);
                if (monster) {
                    record.state = WeaponsmithState.COMBAT;
                    record.timer = 30;
                    record.grindstone = null;
                    break;
                }

                if (!record.grindstone) {
                    record.state = WeaponsmithState.IDLE;
                    break;
                }

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
                    record.state = WeaponsmithState.IDLE;
                    record.timer = 15;
                }
                break;
            }
        }
    }
}

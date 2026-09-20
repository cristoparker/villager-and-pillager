/**
 * Villager Professions Addon - Librarian Manager Module (Namespace: rpc)
 * Coordinates detection of Librarian villagers, equips enchanted book in hand,
 * oversees lectern studying routines, executes protective inspiration buffs during raids/attacks,
 * and enforces day/night sleeping schedules.
 */

import { world } from "@minecraft/server";
import { LIBRARIAN_CONFIG } from "./config.js";
import { distance } from "./utils.js";
import {
    equipBook,
    unequipBook,
    findNearbyLectern,
    isMonsterThreatNearby,
    performStudy,
    performInspirationBuff
} from "./librarianBehavior.js";

export const LibrarianState = {
    IDLE: "IDLE",
    INSPIRING: "INSPIRING",
    APPROACHING_LECTERN: "APPROACHING_LECTERN",
    STUDYING: "STUDYING",
    COOLDOWN: "COOLDOWN",
    SLEEPING: "SLEEPING"
};

export class LibrarianManager {
    constructor() {
        /** @type {Map<string, { state: string, villager: Entity, lectern: any, timer: number }>} */
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
     * Checks if an entity is a Librarian villager.
     * @param {Entity} entity 
     * @returns {boolean}
     */
    isLibrarianVillager(entity) {
        if (!entity || !entity.isValid()) return false;

        try {
            if (entity.hasTag("rpc:butcher") || entity.hasTag("rpc:fletcher") || entity.hasTag("rpc:fisherman") || entity.hasTag("rpc:shepherd") || entity.hasTag("rpc:farmer") || entity.hasTag("rpc:weaponsmith") || entity.hasTag("rpc:cleric") || entity.hasTag("rpc:armorer")) {
                return false;
            }
        } catch {}

        try {
            if (entity.matches({ families: ["librarian"] })) return true;
        } catch {}

        try {
            if (entity.hasTag("rpc:librarian") || entity.hasTag("librarian")) return true;
        } catch {}

        try {
            if (entity.nameTag && entity.nameTag.toLowerCase().includes("librar")) return true;
        } catch {}

        try {
            const variantComp = entity.getComponent("minecraft:variant");
            if (variantComp && variantComp.value === 5) return true;
        } catch {}

        return false;
    }

    /**
     * Scans loaded entities for Librarian villagers.
     */
    scanForLibrarians() {
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
                if (this.isLibrarianVillager(villager)) {
                    this.registerLibrarian(villager);
                }
            }
        }
    }

    /**
     * Registers a new Librarian villager.
     * @param {Entity} villager 
     */
    registerLibrarian(villager) {
        if (!villager || !villager.isValid()) return;

        equipBook(villager);

        this.records.set(villager.id, {
            state: LibrarianState.IDLE,
            villager: villager,
            lectern: null,
            timer: 20
        });
    }

    /**
     * Called when an entity spawns or transforms.
     * @param {Entity} entity 
     */
    onEntitySpawn(entity) {
        if (this.isLibrarianVillager(entity)) {
            this.registerLibrarian(entity);
        }
    }

    /**
     * Main update tick loop.
     */
    update() {
        this.scanCooldownTicks++;
        if (this.scanCooldownTicks >= 30) {
            this.scanCooldownTicks = 0;
            this.scanForLibrarians();
        }

        const isNight = this.isNightTime();

        for (const [id, record] of this.records.entries()) {
            const { villager } = record;

            if (!villager || !villager.isValid() || !this.isLibrarianVillager(villager)) {
                if (villager && villager.isValid()) {
                    unequipBook(villager);
                }
                this.records.delete(id);
                continue;
            }

            if (isNight && record.state !== LibrarianState.SLEEPING) {
                unequipBook(villager);
                try {
                    villager.triggerEvent("minecraft:schedule_bed_villager");
                } catch {}

                record.state = LibrarianState.SLEEPING;
                record.lectern = null;
                continue;
            }

            this.updateLibrarian(record, isNight);
        }
    }

    /**
     * Updates an individual Librarian's routine.
     * @param {object} record 
     * @param {boolean} isNight 
     */
    updateLibrarian(record, isNight) {
        const { villager } = record;

        switch (record.state) {
            case LibrarianState.SLEEPING: {
                if (!isNight) {
                    try {
                        villager.triggerEvent("minecraft:schedule_work_librarian");
                    } catch {}
                    equipBook(villager);
                    record.state = LibrarianState.IDLE;
                    record.timer = 40;
                }
                break;
            }

            case LibrarianState.IDLE: {
                record.timer--;
                if (record.timer <= 0) {
                    record.timer = 25;
                    equipBook(villager);

                    // 1. Check for monster threat -> cast protective Inspiration Buff!
                    if (isMonsterThreatNearby(villager.dimension, villager.location, 16)) {
                        record.state = LibrarianState.INSPIRING;
                        record.timer = 20;
                        break;
                    }

                    // 2. Study at Lectern
                    if (Math.random() < 0.35) {
                        const lectern = findNearbyLectern(villager.dimension, villager.location, LIBRARIAN_CONFIG.LECTERN_SEARCH_RADIUS);
                        if (lectern) {
                            record.lectern = lectern;
                            const dist = distance(villager.location, lectern.pos);
                            if (dist <= LIBRARIAN_CONFIG.LECTERN_STUDY_DISTANCE) {
                                record.state = LibrarianState.STUDYING;
                                record.timer = LIBRARIAN_CONFIG.STUDY_ANIMATION_TICKS;
                            } else {
                                record.state = LibrarianState.APPROACHING_LECTERN;
                                record.timer = 100;
                            }
                            break;
                        }
                    }
                }
                break;
            }

            case LibrarianState.INSPIRING: {
                record.timer--;
                if (record.timer <= 0) {
                    performInspirationBuff(villager);
                    record.state = LibrarianState.COOLDOWN;
                    record.timer = LIBRARIAN_CONFIG.COOLDOWN_TICKS;
                }
                break;
            }

            case LibrarianState.APPROACHING_LECTERN: {
                record.timer--;

                if (!record.lectern) {
                    record.state = LibrarianState.IDLE;
                    break;
                }

                const dist = distance(villager.location, record.lectern.pos);
                if (dist <= LIBRARIAN_CONFIG.LECTERN_STUDY_DISTANCE) {
                    record.state = LibrarianState.STUDYING;
                    record.timer = LIBRARIAN_CONFIG.STUDY_ANIMATION_TICKS;
                } else if (record.timer <= 0) {
                    if (dist <= 4.0) {
                        record.state = LibrarianState.STUDYING;
                        record.timer = LIBRARIAN_CONFIG.STUDY_ANIMATION_TICKS;
                    } else {
                        record.state = LibrarianState.IDLE;
                        record.lectern = null;
                        record.timer = 20;
                    }
                }
                break;
            }

            case LibrarianState.STUDYING: {
                record.timer--;
                if (record.timer <= 0) {
                    if (record.lectern) {
                        performStudy(villager, record.lectern);
                    }
                    record.lectern = null;
                    record.state = LibrarianState.COOLDOWN;
                    record.timer = 40;
                }
                break;
            }

            case LibrarianState.COOLDOWN: {
                record.timer--;
                if (record.timer <= 0) {
                    record.state = LibrarianState.IDLE;
                    record.timer = 15;
                }
                break;
            }
        }
    }
}

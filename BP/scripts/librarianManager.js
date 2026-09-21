/**
 * Villager Professions Addon - Librarian Manager Module (Namespace: rpc)
 * Coordinates detection of Librarian villagers, equips enchanted book in hand,
 * oversees lectern studying routines, executes protective inspiration buffs during raids/attacks,
 * and enforces day/night sleeping schedules.
 */

import { world } from "@minecraft/server";
import { LIBRARIAN_CONFIG } from "./config.js";
import { distance, getLookRotation, smoothMoveTowards, setEntityLook, markTargetUnreachable, isTargetUnreachable } from "./utils.js";
import { getVillagerProfession } from "./professionHelper.js";
import {
    equipBook,
    unequipBook,
    equipPaper,
    findNearbyLectern,
    isMonsterThreatNearby,
    performStudy,
    performInspirationBuff,
    performCraftBooks,
    performEnchantingBlessing,
    findNearbyAfflictedAlly,
    performDispelCurse,
    findNearbySugarcanePlantingSpot,
    performPlantSugarcane,
    findGrownSugarcane,
    performHarvestSugarcane
} from "./librarianBehavior.js";

export const LibrarianState = {
    IDLE: "IDLE",
    INSPIRING: "INSPIRING",
    APPROACHING_DISPEL: "APPROACHING_DISPEL",
    DISPELLING_CURSE: "DISPELLING_CURSE",
    APPROACHING_LECTERN: "APPROACHING_LECTERN",
    STUDYING: "STUDYING",
    APPROACHING_LECTERN_CRAFT: "APPROACHING_LECTERN_CRAFT",
    CRAFTING_BOOKS: "CRAFTING_BOOKS",
    ENCHANTING_BLESSING: "ENCHANTING_BLESSING",
    APPROACHING_SUGARCANE_SPOT: "APPROACHING_SUGARCANE_SPOT",
    PLANTING_SUGARCANE: "PLANTING_SUGARCANE",
    APPROACHING_GROWN_SUGARCANE: "APPROACHING_GROWN_SUGARCANE",
    HARVESTING_SUGARCANE: "HARVESTING_SUGARCANE",
    COOLDOWN: "COOLDOWN",
    SLEEPING: "SLEEPING"
};

export class LibrarianManager {
    constructor() {
        /** @type {Map<string, { state: string, villager: Entity, lectern: any, sugarcaneSpot: any, grownSugarcane: any, afflictedAlly: any, timer: number, step: number, stuckTicks: number, lastLoc: any }>} */
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

        const liveProf = getVillagerProfession(entity);
        if (liveProf !== null) {
            return liveProf === "librarian";
        }

        try {
            if (entity.hasTag("rpc:librarian") || entity.hasTag("librarian")) return true;
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
            sugarcaneSpot: null,
            grownSugarcane: null,
            afflictedAlly: null,
            timer: 20,
            step: 0,
            stuckTicks: 0,
            lastLoc: null
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

                    const startStep = record.step || 0;
                    let actionFound = false;

                    for (let s = 0; s < 5; s++) {
                        const currentStep = (startStep + s) % 5;
                        record.step = (currentStep + 1) % 5;

                        // Step 0: Check for monster threat -> cast protective Inspiration Buff!
                        if (currentStep === 0) {
                            if (isMonsterThreatNearby(villager.dimension, villager.location, 16)) {
                                record.state = LibrarianState.INSPIRING;
                                record.timer = 20;
                                actionFound = true;
                                break;
                            }
                        }

                        // Step 1: Check for afflicted allies needing curse dispel!
                        else if (currentStep === 1) {
                            const afflicted = findNearbyAfflictedAlly(villager.dimension, villager.location, LIBRARIAN_CONFIG.DISPEL_SEARCH_RADIUS);
                            if (afflicted && !isTargetUnreachable(afflicted)) {
                                record.afflictedAlly = afflicted;
                                const dist = distance(villager.location, afflicted.location);
                                if (dist <= 3.0) {
                                    record.state = LibrarianState.DISPELLING_CURSE;
                                    record.timer = 25;
                                } else {
                                    record.state = LibrarianState.APPROACHING_DISPEL;
                                    record.timer = 90;
                                    record.stuckTicks = 0;
                                    record.lastLoc = { x: villager.location.x, y: villager.location.y, z: villager.location.z };
                                }
                                actionFound = true;
                                break;
                            }
                        }

                        // Step 2: High priority: Check for grown sugarcane (height >= 2) to harvest for paper!
                        else if (currentStep === 2) {
                            const grown = findGrownSugarcane(villager.dimension, villager.location, LIBRARIAN_CONFIG.SUGARCANE_SEARCH_RADIUS);
                            if (grown && !isTargetUnreachable(grown.pos)) {
                                record.grownSugarcane = grown;
                                const dist = distance(villager.location, grown.pos);
                                if (dist <= LIBRARIAN_CONFIG.HARVEST_DISTANCE) {
                                    record.state = LibrarianState.HARVESTING_SUGARCANE;
                                    record.timer = 20;
                                } else {
                                    record.state = LibrarianState.APPROACHING_GROWN_SUGARCANE;
                                    record.timer = 90;
                                    record.stuckTicks = 0;
                                    record.lastLoc = { x: villager.location.x, y: villager.location.y, z: villager.location.z };
                                }
                                actionFound = true;
                                break;
                            }
                        }

                        // Step 3: Plant sugarcane on water-connected blocks
                        else if (currentStep === 3) {
                            const spot = findNearbySugarcanePlantingSpot(villager.dimension, villager.location, LIBRARIAN_CONFIG.SUGARCANE_SEARCH_RADIUS);
                            if (spot && !isTargetUnreachable(spot.airPos)) {
                                record.sugarcaneSpot = spot;
                                const dist = distance(villager.location, spot.airPos);
                                if (dist <= LIBRARIAN_CONFIG.PLANT_DISTANCE) {
                                    record.state = LibrarianState.PLANTING_SUGARCANE;
                                    record.timer = 22;
                                } else {
                                    record.state = LibrarianState.APPROACHING_SUGARCANE_SPOT;
                                    record.timer = 90;
                                    record.stuckTicks = 0;
                                    record.lastLoc = { x: villager.location.x, y: villager.location.y, z: villager.location.z };
                                }
                                actionFound = true;
                                break;
                            }
                        }

                        // Step 4: Lectern activities: Study, Craft Books, or Enchanting Blessing
                        else if (currentStep === 4) {
                            const lectern = findNearbyLectern(villager.dimension, villager.location, LIBRARIAN_CONFIG.LECTERN_SEARCH_RADIUS);
                            if (lectern && !isTargetUnreachable(lectern.pos)) {
                                record.lectern = lectern;
                                const dist = distance(villager.location, lectern.pos);
                                const roll = Math.random();

                                if (roll < 0.35) {
                                    if (dist <= LIBRARIAN_CONFIG.LECTERN_STUDY_DISTANCE) {
                                        record.state = LibrarianState.STUDYING;
                                        record.timer = LIBRARIAN_CONFIG.STUDY_ANIMATION_TICKS;
                                    } else {
                                        record.state = LibrarianState.APPROACHING_LECTERN;
                                        record.timer = 100;
                                        record.stuckTicks = 0;
                                        record.lastLoc = { x: villager.location.x, y: villager.location.y, z: villager.location.z };
                                    }
                                } else if (roll < 0.70) {
                                    if (dist <= LIBRARIAN_CONFIG.LECTERN_STUDY_DISTANCE) {
                                        record.state = LibrarianState.CRAFTING_BOOKS;
                                        record.timer = 40;
                                        equipPaper(villager);
                                    } else {
                                        record.state = LibrarianState.APPROACHING_LECTERN_CRAFT;
                                        record.timer = 100;
                                        record.stuckTicks = 0;
                                        record.lastLoc = { x: villager.location.x, y: villager.location.y, z: villager.location.z };
                                    }
                                } else {
                                    if (dist <= LIBRARIAN_CONFIG.LECTERN_STUDY_DISTANCE) {
                                        record.state = LibrarianState.ENCHANTING_BLESSING;
                                        record.timer = 35;
                                    } else {
                                        record.state = LibrarianState.APPROACHING_LECTERN;
                                        record.timer = 100;
                                        record.stuckTicks = 0;
                                        record.lastLoc = { x: villager.location.x, y: villager.location.y, z: villager.location.z };
                                    }
                                }
                                actionFound = true;
                                break;
                            }
                        }
                    }

                    if (!actionFound) {
                        record.timer = 20;
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

            case LibrarianState.APPROACHING_DISPEL: {
                record.timer--;
                if (!record.afflictedAlly || !record.afflictedAlly.isValid()) {
                    record.state = LibrarianState.IDLE;
                    record.afflictedAlly = null;
                    record.timer = 10;
                    break;
                }

                const curLoc = villager.location;
                if (record.lastLoc && distance(curLoc, record.lastLoc) < 0.15) {
                    record.stuckTicks = (record.stuckTicks || 0) + 1;
                } else {
                    record.stuckTicks = 0;
                }
                record.lastLoc = { x: curLoc.x, y: curLoc.y, z: curLoc.z };

                if (record.stuckTicks > 35 || record.timer <= 0) {
                    if (record.afflictedAlly) markTargetUnreachable(record.afflictedAlly, 400);
                    record.step = ((record.step || 0) + 1) % 5;
                    record.state = LibrarianState.IDLE;
                    record.afflictedAlly = null;
                    record.timer = 1;
                    break;
                }

                const allyLoc = record.afflictedAlly.location;
                smoothMoveTowards(villager, allyLoc, { speed: 0.16, stopDistance: 2.8, lookTarget: allyLoc });

                const dist = distance(curLoc, allyLoc);
                if (dist <= 3.0) {
                    record.state = LibrarianState.DISPELLING_CURSE;
                    record.timer = 25;
                }
                break;
            }

            case LibrarianState.DISPELLING_CURSE: {
                record.timer--;
                if (record.timer <= 0) {
                    if (record.afflictedAlly && record.afflictedAlly.isValid()) {
                        performDispelCurse(villager, record.afflictedAlly);
                    }
                    equipBook(villager);
                    record.afflictedAlly = null;
                    record.state = LibrarianState.COOLDOWN;
                    record.timer = 50;
                }
                break;
            }

            case LibrarianState.APPROACHING_GROWN_SUGARCANE: {
                record.timer--;
                if (!record.grownSugarcane) {
                    record.state = LibrarianState.IDLE;
                    record.grownSugarcane = null;
                    record.timer = 10;
                    break;
                }

                const curLoc = villager.location;
                if (record.lastLoc && distance(curLoc, record.lastLoc) < 0.15) {
                    record.stuckTicks = (record.stuckTicks || 0) + 1;
                } else {
                    record.stuckTicks = 0;
                }
                record.lastLoc = { x: curLoc.x, y: curLoc.y, z: curLoc.z };

                if (record.stuckTicks > 35 || record.timer <= 0) {
                    if (record.grownSugarcane) markTargetUnreachable(record.grownSugarcane.pos, 400);
                    record.step = ((record.step || 0) + 1) % 5;
                    record.state = LibrarianState.IDLE;
                    record.grownSugarcane = null;
                    record.timer = 1;
                    break;
                }

                const targetPos = record.grownSugarcane.pos;
                const lookPos = { x: targetPos.x + 0.5, y: targetPos.y + 0.5, z: targetPos.z + 0.5 };
                smoothMoveTowards(villager, lookPos, { speed: 0.16, stopDistance: LIBRARIAN_CONFIG.HARVEST_DISTANCE, lookTarget: lookPos });

                const dist = distance(curLoc, targetPos);
                if (dist <= LIBRARIAN_CONFIG.HARVEST_DISTANCE) {
                    record.state = LibrarianState.HARVESTING_SUGARCANE;
                    record.timer = 20;
                }
                break;
            }

            case LibrarianState.HARVESTING_SUGARCANE: {
                record.timer--;
                if (record.timer <= 0) {
                    if (record.grownSugarcane) {
                        performHarvestSugarcane(villager, record.grownSugarcane);
                    }
                    record.grownSugarcane = null;
                    record.state = LibrarianState.COOLDOWN;
                    record.timer = 40;
                }
                break;
            }

            case LibrarianState.APPROACHING_SUGARCANE_SPOT: {
                record.timer--;
                if (!record.sugarcaneSpot) {
                    record.state = LibrarianState.IDLE;
                    record.sugarcaneSpot = null;
                    record.timer = 10;
                    break;
                }

                const curLoc = villager.location;
                if (record.lastLoc && distance(curLoc, record.lastLoc) < 0.15) {
                    record.stuckTicks = (record.stuckTicks || 0) + 1;
                } else {
                    record.stuckTicks = 0;
                }
                record.lastLoc = { x: curLoc.x, y: curLoc.y, z: curLoc.z };

                if (record.stuckTicks > 35 || record.timer <= 0) {
                    if (record.sugarcaneSpot) markTargetUnreachable(record.sugarcaneSpot.airPos, 400);
                    record.step = ((record.step || 0) + 1) % 5;
                    record.state = LibrarianState.IDLE;
                    record.sugarcaneSpot = null;
                    record.timer = 1;
                    break;
                }

                const targetPos = record.sugarcaneSpot.airPos;
                const lookPos = { x: targetPos.x + 0.5, y: targetPos.y + 0.5, z: targetPos.z + 0.5 };
                smoothMoveTowards(villager, lookPos, { speed: 0.16, stopDistance: LIBRARIAN_CONFIG.PLANT_DISTANCE, lookTarget: lookPos });

                const dist = distance(curLoc, targetPos);
                if (dist <= LIBRARIAN_CONFIG.PLANT_DISTANCE) {
                    record.state = LibrarianState.PLANTING_SUGARCANE;
                    record.timer = 22;
                }
                break;
            }

            case LibrarianState.PLANTING_SUGARCANE: {
                record.timer--;
                if (record.timer <= 0) {
                    if (record.sugarcaneSpot) {
                        performPlantSugarcane(villager, record.sugarcaneSpot.airPos);
                    }
                    record.sugarcaneSpot = null;
                    record.state = LibrarianState.COOLDOWN;
                    record.timer = 40;
                }
                break;
            }

            case LibrarianState.APPROACHING_LECTERN: {
                record.timer--;
                if (!record.lectern) {
                    record.state = LibrarianState.IDLE;
                    record.lectern = null;
                    record.timer = 10;
                    break;
                }

                const curLoc = villager.location;
                if (record.lastLoc && distance(curLoc, record.lastLoc) < 0.15) {
                    record.stuckTicks = (record.stuckTicks || 0) + 1;
                } else {
                    record.stuckTicks = 0;
                }
                record.lastLoc = { x: curLoc.x, y: curLoc.y, z: curLoc.z };

                if (record.stuckTicks > 35 || record.timer <= 0) {
                    if (record.lectern) markTargetUnreachable(record.lectern.pos, 400);
                    record.step = ((record.step || 0) + 1) % 5;
                    record.state = LibrarianState.IDLE;
                    record.lectern = null;
                    record.timer = 1;
                    break;
                }

                const targetPos = record.lectern.pos;
                const lookPos = { x: targetPos.x + 0.5, y: targetPos.y + 0.5, z: targetPos.z + 0.5 };
                smoothMoveTowards(villager, lookPos, { speed: 0.16, stopDistance: LIBRARIAN_CONFIG.LECTERN_STUDY_DISTANCE, lookTarget: lookPos });

                const dist = distance(curLoc, targetPos);
                if (dist <= LIBRARIAN_CONFIG.LECTERN_STUDY_DISTANCE) {
                    record.state = LibrarianState.STUDYING;
                    record.timer = LIBRARIAN_CONFIG.STUDY_ANIMATION_TICKS;
                }
                break;
            }

            case LibrarianState.APPROACHING_LECTERN_CRAFT: {
                record.timer--;
                if (!record.lectern) {
                    record.state = LibrarianState.IDLE;
                    record.lectern = null;
                    record.timer = 10;
                    break;
                }

                const curLoc = villager.location;
                if (record.lastLoc && distance(curLoc, record.lastLoc) < 0.15) {
                    record.stuckTicks = (record.stuckTicks || 0) + 1;
                } else {
                    record.stuckTicks = 0;
                }
                record.lastLoc = { x: curLoc.x, y: curLoc.y, z: curLoc.z };

                if (record.stuckTicks > 35 || record.timer <= 0) {
                    if (record.lectern) markTargetUnreachable(record.lectern.pos, 400);
                    record.step = ((record.step || 0) + 1) % 5;
                    record.state = LibrarianState.IDLE;
                    record.lectern = null;
                    record.timer = 1;
                    break;
                }

                const targetPos = record.lectern.pos;
                const lookPos = { x: targetPos.x + 0.5, y: targetPos.y + 0.5, z: targetPos.z + 0.5 };
                smoothMoveTowards(villager, lookPos, { speed: 0.16, stopDistance: LIBRARIAN_CONFIG.LECTERN_STUDY_DISTANCE, lookTarget: lookPos });

                const dist = distance(curLoc, targetPos);
                if (dist <= LIBRARIAN_CONFIG.LECTERN_STUDY_DISTANCE) {
                    record.state = LibrarianState.CRAFTING_BOOKS;
                    record.timer = 40;
                    equipPaper(villager);
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

            case LibrarianState.CRAFTING_BOOKS: {
                record.timer--;
                if (record.timer <= 0) {
                    if (record.lectern) {
                        performCraftBooks(villager, record.lectern.pos);
                    }
                    record.lectern = null;
                    record.state = LibrarianState.COOLDOWN;
                    record.timer = 40;
                }
                break;
            }

            case LibrarianState.ENCHANTING_BLESSING: {
                record.timer--;
                if (record.timer <= 0) {
                    if (record.lectern) {
                        performEnchantingBlessing(villager, record.lectern.pos);
                    }
                    record.lectern = null;
                    record.state = LibrarianState.COOLDOWN;
                    record.timer = 50;
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

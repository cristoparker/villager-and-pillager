/**
 * Fisherman Villager Addon - Shepherd Manager Module (Namespace: rpc)
 * Coordinates detection of shepherd villagers, ensures 2 starter sheep spawn connected with leashes,
 * equips shears in hand, oversees native non-jumping movement towards sheep,
 * executes authentic shearing routines, and enforces day/night sleeping schedules.
 */

import { world } from "@minecraft/server";
import { SHEPHERD_CONFIG } from "./config.js";
import { distance, getLookRotation, smoothMoveTowards, setEntityLook, markTargetUnreachable, isTargetUnreachable } from "./utils.js";
import { getVillagerProfession } from "./professionHelper.js";
import { 
    equipShears, 
    unequipShears, 
    isShearableSheep, 
    findNearbyShearableSheep, 
    spawnStarterSheep, 
    performShear,
    equipDye,
    equipWheat,
    findNearbyWhiteSheep,
    performDyeSheep,
    findNearbyShearedSheep,
    performFeedWheat,
    findNearbyPredators,
    performScarePredator,
    findNearbyLoom,
    performLoomWeaving
} from "./shepherdBehavior.js";

export const ShepherdState = {
    IDLE: "IDLE",
    APPROACHING: "APPROACHING",
    SHEARING: "SHEARING",
    APPROACHING_DYE: "APPROACHING_DYE",
    DYEING: "DYEING",
    APPROACHING_FEED: "APPROACHING_FEED",
    FEEDING: "FEEDING",
    SCARE_PREDATOR: "SCARE_PREDATOR",
    APPROACHING_LOOM: "APPROACHING_LOOM",
    WEAVING_LOOM: "WEAVING_LOOM",
    COOLDOWN: "COOLDOWN",
    SLEEPING: "SLEEPING"
};

export class ShepherdManager {
    constructor() {
        /** @type {Map<string, { state: string, villager: Entity, targetSheep: Entity|null, targetDyeSheep: Entity|null, targetFeedSheep: Entity|null, targetPredator: Entity|null, targetLoom: any, chosenDye: any, timer: number, step: number, stuckTicks: number, lastLoc: any }>} */
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
     * Checks if an entity is a Shepherd villager.
     * @param {Entity} entity 
     * @returns {boolean}
     */
    isShepherdVillager(entity) {
        if (!entity || !entity.isValid()) return false;

        const liveProf = getVillagerProfession(entity);
        if (liveProf !== null) {
            return liveProf === "shepherd";
        }

        try {
            if (entity.hasTag("rpc:shepherd") || entity.hasTag("shepherd")) return true;
        } catch {}

        return false;
    }

    /**
     * Scans loaded chunks for shepherd villagers.
     */
    scanForShepherds() {
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
                if (this.isShepherdVillager(villager)) {
                    this.registerShepherd(villager);
                } else {
                    // Safety check: if an entity is NOT a shepherd but happens to hold shears, unequip it
                    try {
                        const equippable = villager.getComponent("minecraft:equippable");
                        const item = equippable?.getEquipment("Mainhand");
                        if (item && (item.typeId === "minecraft:shears" || item.typeId === "rpc:shears")) {
                            unequipShears(villager);
                        }
                    } catch {}
                }
            }
        }
    }

    /**
     * Registers a new shepherd villager and initializes starter sheep if needed.
     * @param {Entity} villager 
     */
    registerShepherd(villager) {
        if (!villager || this.records.has(villager.id)) return;

        // Spawn 2 leashed sheep if this shepherd has never spawned them yet
        if (!villager.hasTag("rpc:shepherd_sheeps_spawned")) {
            villager.addTag("rpc:shepherd_sheeps_spawned");
            spawnStarterSheep(villager);
        }

        // Equip shears in hand during daytime
        const isNight = this.isNightTime();
        if (!isNight) {
            equipShears(villager);
            try {
                villager.triggerEvent("minecraft:schedule_wander_villager");
            } catch {}
        }

        this.records.set(villager.id, {
            state: isNight ? ShepherdState.SLEEPING : ShepherdState.IDLE,
            villager: villager,
            targetSheep: null,
            targetDyeSheep: null,
            targetFeedSheep: null,
            targetPredator: null,
            targetLoom: null,
            chosenDye: null,
            timer: 20,
            step: 0,
            stuckTicks: 0,
            lastLoc: null
        });
    }

    /**
     * Main update tick executed every game tick.
     */
    update() {
        // Scan for new shepherds every 30 ticks (1.5 seconds)
        this.scanCooldownTicks++;
        if (this.scanCooldownTicks >= 30) {
            this.scanCooldownTicks = 0;
            this.scanForShepherds();
        }

        const isNight = this.isNightTime();

        for (const [id, record] of this.records.entries()) {
            const { villager } = record;

            // Handle despawned, unloaded, or changed entities
            if (!villager || !villager.isValid() || !this.isShepherdVillager(villager)) {
                if (villager && villager.isValid()) {
                    try { villager.triggerEvent("rpc:stop_approach_sheep"); } catch {}
                    unequipShears(villager);
                }
                this.records.delete(id);
                continue;
            }

            // NIGHTTIME CHECK: Put away shears and sleep
            if (isNight && record.state !== ShepherdState.SLEEPING) {
                try { villager.triggerEvent("rpc:stop_approach_sheep"); } catch {}
                unequipShears(villager);
                try {
                    villager.triggerEvent("minecraft:schedule_bed_villager");
                } catch {}

                record.state = ShepherdState.SLEEPING;
                record.targetSheep = null;
                continue;
            }

            this.updateShepherd(record, isNight);
        }
    }

    /**
     * Updates an individual shepherd's cycle.
     * @param {object} record 
     * @param {boolean} isNight 
     */
    updateShepherd(record, isNight) {
        const { villager } = record;

        // Threat Check: Predators (wolves/foxes) threatening the flock
        if (record.state !== ShepherdState.SLEEPING && record.state !== ShepherdState.SCARE_PREDATOR) {
            const predator = findNearbyPredators(villager.dimension, villager.location, SHEPHERD_CONFIG.PREDATOR_SEARCH_RADIUS);
            if (predator) {
                record.targetPredator = predator;
                record.state = ShepherdState.SCARE_PREDATOR;
                record.timer = 15;
                equipShears(villager);
            }
        }

        switch (record.state) {
            case ShepherdState.SLEEPING: {
                if (!isNight) {
                    try {
                        villager.triggerEvent("minecraft:schedule_wander_villager");
                    } catch {}
                    equipShears(villager);
                    record.state = ShepherdState.IDLE;
                    record.timer = 40;
                }
                break;
            }

            case ShepherdState.SCARE_PREDATOR: {
                record.timer--;
                if (!record.targetPredator || !record.targetPredator.isValid()) {
                    record.state = ShepherdState.IDLE;
                    record.targetPredator = null;
                    record.timer = 10;
                    break;
                }

                performScarePredator(villager, record.targetPredator);
                if (record.timer <= 0) {
                    record.targetPredator = null;
                    record.state = ShepherdState.COOLDOWN;
                    record.timer = 30;
                }
                break;
            }

            case ShepherdState.IDLE: {
                record.timer--;
                if (record.timer <= 0) {
                    record.timer = 25;
                    equipShears(villager);

                    const startStep = record.step || 0;
                    let actionFound = false;

                    for (let s = 0; s < 4; s++) {
                        const currentStep = (startStep + s) % 4;
                        record.step = (currentStep + 1) % 4;

                        // Step 0: Scan for closest shearable sheep
                        if (currentStep === 0) {
                            const sheep = findNearbyShearableSheep(villager.dimension, villager.location, SHEPHERD_CONFIG.SHEEP_SEARCH_RADIUS);
                            if (sheep && !isTargetUnreachable(sheep)) {
                                record.targetSheep = sheep;
                                const dist = distance(villager.location, sheep.location);
                                if (dist <= SHEPHERD_CONFIG.SHEAR_DISTANCE) {
                                    record.state = ShepherdState.SHEARING;
                                    record.timer = SHEPHERD_CONFIG.SHEAR_ANIMATION_TICKS;
                                } else {
                                    record.state = ShepherdState.APPROACHING;
                                    record.timer = 120;
                                    record.stuckTicks = 0;
                                    record.lastLoc = { x: villager.location.x, y: villager.location.y, z: villager.location.z };
                                    try {
                                        villager.triggerEvent("rpc:start_approach_sheep");
                                    } catch {}
                                }
                                actionFound = true;
                                break;
                            }
                        }

                        // Step 1: Scan for sheared sheep that need wheat to regrow wool
                        else if (currentStep === 1) {
                            const shearedSheep = findNearbyShearedSheep(villager.dimension, villager.location, SHEPHERD_CONFIG.SHEEP_SEARCH_RADIUS);
                            if (shearedSheep && !isTargetUnreachable(shearedSheep)) {
                                record.targetFeedSheep = shearedSheep;
                                equipWheat(villager);
                                const dist = distance(villager.location, shearedSheep.location);
                                if (dist <= SHEPHERD_CONFIG.SHEAR_DISTANCE) {
                                    record.state = ShepherdState.FEEDING;
                                    record.timer = 25;
                                } else {
                                    record.state = ShepherdState.APPROACHING_FEED;
                                    record.timer = 100;
                                    record.stuckTicks = 0;
                                    record.lastLoc = { x: villager.location.x, y: villager.location.y, z: villager.location.z };
                                }
                                actionFound = true;
                                break;
                            }
                        }

                        // Step 2: Scan for white sheep to dye into vibrant colors
                        else if (currentStep === 2) {
                            const whiteSheep = findNearbyWhiteSheep(villager.dimension, villager.location, SHEPHERD_CONFIG.SHEEP_SEARCH_RADIUS);
                            if (whiteSheep && !isTargetUnreachable(whiteSheep) && SHEPHERD_CONFIG.DYES && SHEPHERD_CONFIG.DYES.length > 0) {
                                const dyeDef = SHEPHERD_CONFIG.DYES[Math.floor(Math.random() * SHEPHERD_CONFIG.DYES.length)];
                                record.targetDyeSheep = whiteSheep;
                                record.chosenDye = dyeDef;
                                equipDye(villager, dyeDef.itemId);
                                const dist = distance(villager.location, whiteSheep.location);
                                if (dist <= SHEPHERD_CONFIG.SHEAR_DISTANCE) {
                                    record.state = ShepherdState.DYEING;
                                    record.timer = 25;
                                } else {
                                    record.state = ShepherdState.APPROACHING_DYE;
                                    record.timer = 100;
                                    record.stuckTicks = 0;
                                    record.lastLoc = { x: villager.location.x, y: villager.location.y, z: villager.location.z };
                                }
                                actionFound = true;
                                break;
                            }
                        }

                        // Step 3: Loom workstation interaction
                        else if (currentStep === 3) {
                            const loom = findNearbyLoom(villager.dimension, villager.location, SHEPHERD_CONFIG.LOOM_SEARCH_RADIUS);
                            if (loom && !isTargetUnreachable(loom.pos)) {
                                record.targetLoom = loom;
                                const dist = distance(villager.location, loom.pos);
                                if (dist <= SHEPHERD_CONFIG.LOOM_USE_DISTANCE) {
                                    record.state = ShepherdState.WEAVING_LOOM;
                                    record.timer = 30;
                                } else {
                                    record.state = ShepherdState.APPROACHING_LOOM;
                                    record.timer = 90;
                                    record.stuckTicks = 0;
                                    record.lastLoc = { x: villager.location.x, y: villager.location.y, z: villager.location.z };
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

            case ShepherdState.APPROACHING: {
                record.timer--;
                if (!record.targetSheep || !record.targetSheep.isValid() || !isShearableSheep(record.targetSheep)) {
                    try { villager.triggerEvent("rpc:stop_approach_sheep"); } catch {}
                    record.state = ShepherdState.IDLE;
                    record.targetSheep = null;
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
                    try { villager.triggerEvent("rpc:stop_approach_sheep"); } catch {}
                    if (record.targetSheep) markTargetUnreachable(record.targetSheep, 400);
                    record.step = ((record.step || 0) + 1) % 4;
                    record.state = ShepherdState.IDLE;
                    record.targetSheep = null;
                    record.timer = 1;
                    break;
                }

                const sLoc = record.targetSheep.location;
                smoothMoveTowards(villager, sLoc, { speed: 0.16, stopDistance: SHEPHERD_CONFIG.SHEAR_DISTANCE, lookTarget: sLoc });

                const dist = distance(curLoc, sLoc);
                if (dist <= SHEPHERD_CONFIG.SHEAR_DISTANCE) {
                    try { villager.triggerEvent("rpc:stop_approach_sheep"); } catch {}
                    record.state = ShepherdState.SHEARING;
                    record.timer = SHEPHERD_CONFIG.SHEAR_ANIMATION_TICKS;
                }
                break;
            }

            case ShepherdState.SHEARING: {
                record.timer--;
                if (record.timer <= 0) {
                    if (record.targetSheep && record.targetSheep.isValid() && isShearableSheep(record.targetSheep)) {
                        performShear(villager, record.targetSheep);
                    }
                    record.targetSheep = null;
                    record.state = ShepherdState.COOLDOWN;
                    record.timer = SHEPHERD_CONFIG.SHEAR_COOLDOWN_TICKS;
                }
                break;
            }

            case ShepherdState.APPROACHING_FEED: {
                record.timer--;
                if (!record.targetFeedSheep || !record.targetFeedSheep.isValid()) {
                    record.state = ShepherdState.IDLE;
                    record.targetFeedSheep = null;
                    equipShears(villager);
                    record.timer = 10;
                    break;
                }

                if (record.timer % 20 === 0) equipWheat(villager);

                const curLoc = villager.location;
                if (record.lastLoc && distance(curLoc, record.lastLoc) < 0.15) {
                    record.stuckTicks = (record.stuckTicks || 0) + 1;
                } else {
                    record.stuckTicks = 0;
                }
                record.lastLoc = { x: curLoc.x, y: curLoc.y, z: curLoc.z };

                if (record.stuckTicks > 35 || record.timer <= 0) {
                    if (record.targetFeedSheep) markTargetUnreachable(record.targetFeedSheep, 400);
                    record.step = ((record.step || 0) + 1) % 4;
                    record.state = ShepherdState.IDLE;
                    record.targetFeedSheep = null;
                    equipShears(villager);
                    record.timer = 1;
                    break;
                }

                const sLoc = record.targetFeedSheep.location;
                smoothMoveTowards(villager, sLoc, { speed: 0.16, stopDistance: SHEPHERD_CONFIG.SHEAR_DISTANCE, lookTarget: sLoc });

                const dist = distance(curLoc, sLoc);
                if (dist <= SHEPHERD_CONFIG.SHEAR_DISTANCE) {
                    record.state = ShepherdState.FEEDING;
                    record.timer = 25;
                }
                break;
            }

            case ShepherdState.FEEDING: {
                record.timer--;
                if (record.timer <= 0) {
                    if (record.targetFeedSheep && record.targetFeedSheep.isValid()) {
                        performFeedWheat(villager, record.targetFeedSheep);
                    }
                    record.targetFeedSheep = null;
                    equipShears(villager);
                    record.state = ShepherdState.COOLDOWN;
                    record.timer = 40;
                }
                break;
            }

            case ShepherdState.APPROACHING_DYE: {
                record.timer--;
                if (!record.targetDyeSheep || !record.targetDyeSheep.isValid() || !record.chosenDye) {
                    record.state = ShepherdState.IDLE;
                    record.targetDyeSheep = null;
                    equipShears(villager);
                    record.timer = 10;
                    break;
                }

                if (record.timer % 20 === 0) equipDye(villager, record.chosenDye.itemId);

                const curLoc = villager.location;
                if (record.lastLoc && distance(curLoc, record.lastLoc) < 0.15) {
                    record.stuckTicks = (record.stuckTicks || 0) + 1;
                } else {
                    record.stuckTicks = 0;
                }
                record.lastLoc = { x: curLoc.x, y: curLoc.y, z: curLoc.z };

                if (record.stuckTicks > 35 || record.timer <= 0) {
                    if (record.targetDyeSheep) markTargetUnreachable(record.targetDyeSheep, 400);
                    record.step = ((record.step || 0) + 1) % 4;
                    record.state = ShepherdState.IDLE;
                    record.targetDyeSheep = null;
                    equipShears(villager);
                    record.timer = 1;
                    break;
                }

                const sLoc = record.targetDyeSheep.location;
                smoothMoveTowards(villager, sLoc, { speed: 0.16, stopDistance: SHEPHERD_CONFIG.SHEAR_DISTANCE, lookTarget: sLoc });

                const dist = distance(curLoc, sLoc);
                if (dist <= SHEPHERD_CONFIG.SHEAR_DISTANCE) {
                    record.state = ShepherdState.DYEING;
                    record.timer = 25;
                }
                break;
            }

            case ShepherdState.DYEING: {
                record.timer--;
                if (record.timer <= 0) {
                    if (record.targetDyeSheep && record.targetDyeSheep.isValid() && record.chosenDye) {
                        performDyeSheep(villager, record.targetDyeSheep, record.chosenDye);
                    }
                    record.targetDyeSheep = null;
                    record.chosenDye = null;
                    equipShears(villager);
                    record.state = ShepherdState.COOLDOWN;
                    record.timer = 40;
                }
                break;
            }

            case ShepherdState.APPROACHING_LOOM: {
                record.timer--;
                if (!record.targetLoom) {
                    record.state = ShepherdState.IDLE;
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
                    if (record.targetLoom) markTargetUnreachable(record.targetLoom.pos, 400);
                    record.step = ((record.step || 0) + 1) % 4;
                    record.state = ShepherdState.IDLE;
                    record.targetLoom = null;
                    record.timer = 1;
                    break;
                }

                const lPos = { x: record.targetLoom.pos.x + 0.5, y: record.targetLoom.pos.y, z: record.targetLoom.pos.z + 0.5 };
                smoothMoveTowards(villager, lPos, { speed: 0.16, stopDistance: SHEPHERD_CONFIG.LOOM_USE_DISTANCE, lookTarget: lPos });

                const dist = distance(curLoc, record.targetLoom.pos);
                if (dist <= SHEPHERD_CONFIG.LOOM_USE_DISTANCE) {
                    record.state = ShepherdState.WEAVING_LOOM;
                    record.timer = 30;
                }
                break;
            }

            case ShepherdState.WEAVING_LOOM: {
                record.timer--;
                if (record.timer <= 0) {
                    if (record.targetLoom) {
                        performLoomWeaving(villager, record.targetLoom.pos);
                    }
                    record.targetLoom = null;
                    equipShears(villager);
                    record.state = ShepherdState.COOLDOWN;
                    record.timer = 50;
                }
                break;
            }

            case ShepherdState.COOLDOWN: {
                record.timer--;
                if (record.timer <= 0) {
                    equipShears(villager);
                    record.state = ShepherdState.IDLE;
                    record.timer = 15;
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
        if (this.isShepherdVillager(entity)) {
            this.registerShepherd(entity);
        }
    }
}

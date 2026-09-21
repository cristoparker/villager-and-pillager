/**
 * Fisherman Villager Addon - Butcher Manager Module (Namespace: rpc)
 * Coordinates detection of butcher villagers, equips them with an iron axe/cleaver,
 * oversees hunting of nearby adult pigs & cows with native non-jumping walking,
 * collects dropped fresh meats, navigates to village Smokers, and places coal & meat inside!
 */

import { world } from "@minecraft/server";
import { BUTCHER_CONFIG } from "./config.js";
import { distance, getLookRotation, playSoundSafe, spawnParticleSafe, smoothMoveTowards, setEntityLook, markTargetUnreachable, isTargetUnreachable } from "./utils.js";
import { 
    equipAxe, 
    unequipAxe, 
    isValidPrey, 
    findNearbyPrey, 
    performSlaughter, 
    findNearestSmoker, 
    loadSmoker 
} from "./butcherBehavior.js";
import { findNearbyMonsters } from "./fletcherBehavior.js";
import { getVillagerProfession } from "./professionHelper.js";

export const ButcherState = {
    IDLE: "IDLE",
    COMBAT: "COMBAT",
    HUNTING: "HUNTING",
    SLAUGHTERING: "SLAUGHTERING",
    APPROACHING_SMOKER: "APPROACHING_SMOKER",
    COOKING: "COOKING",
    COOLDOWN: "COOLDOWN",
    SLEEPING: "SLEEPING"
};

export class ButcherManager {
    constructor() {
        /** @type {Map<string, { state: string, villager: Entity, targetAnimal: Entity|null, smoker: any, meat: { id: string, count: number }|null, timer: number }>} */
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
     * Checks if an entity is a Butcher villager.
     * @param {Entity} entity 
     * @returns {boolean}
     */
    isButcherVillager(entity) {
        if (!entity || !entity.isValid()) return false;

        const liveProf = getVillagerProfession(entity);
        if (liveProf !== null) {
            return liveProf === "butcher";
        }

        try {
            if (entity.hasTag("rpc:butcher") || entity.hasTag("butcher")) return true;
        } catch {}

        return false;
    }

    /**
     * Scans loaded chunks for butcher villagers.
     */
    scanForButchers() {
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
                if (this.isButcherVillager(villager)) {
                    this.registerButcher(villager);
                } else {
                    // Safety check: if an entity is NOT a butcher but happens to hold an axe, unequip it
                    try {
                        const equippable = villager.getComponent("minecraft:equippable");
                        const item = equippable?.getEquipment("Mainhand");
                        if (item && (item.typeId === BUTCHER_CONFIG.VANILLA_AXE_ITEM_ID || item.typeId === BUTCHER_CONFIG.CLEAVER_ITEM_ID)) {
                            unequipAxe(villager);
                        }
                    } catch {}
                }
            }
        }
    }

    /**
     * Registers a new butcher villager and equips their weapon.
     * @param {Entity} villager 
     */
    registerButcher(villager) {
        if (!villager || this.records.has(villager.id)) return;

        const isNight = this.isNightTime();
        if (!isNight) {
            equipAxe(villager);
            try {
                villager.triggerEvent("minecraft:schedule_wander_villager");
            } catch {}
        }

        this.records.set(villager.id, {
            state: isNight ? ButcherState.SLEEPING : ButcherState.IDLE,
            villager: villager,
            targetAnimal: null,
            smoker: null,
            meat: null,
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
        // Scan for new butchers every 30 ticks (1.5 seconds)
        this.scanCooldownTicks++;
        if (this.scanCooldownTicks >= 30) {
            this.scanCooldownTicks = 0;
            this.scanForButchers();
        }

        const isNight = this.isNightTime();

        for (const [id, record] of this.records.entries()) {
            const { villager } = record;

            // Handle despawned, unloaded, or changed entities
            if (!villager || !villager.isValid() || !this.isButcherVillager(villager)) {
                if (villager && villager.isValid()) {
                    try { villager.triggerEvent("rpc:stop_butcher_hunt"); } catch {}
                    try { villager.triggerEvent("rpc:stop_approach_smoker"); } catch {}
                    unequipAxe(villager);
                }
                this.records.delete(id);
                continue;
            }

            // NIGHTTIME CHECK: Put away weapon and sleep in bed
            if (isNight && record.state !== ButcherState.SLEEPING) {
                try {
                    villager.triggerEvent("rpc:stop_butcher_hunt");
                } catch {}
                try {
                    villager.triggerEvent("rpc:stop_approach_smoker");
                } catch {}
                unequipAxe(villager);
                try {
                    villager.triggerEvent("minecraft:schedule_bed_villager");
                } catch {}

                record.state = ButcherState.SLEEPING;
                record.targetAnimal = null;
                record.smoker = null;
                continue;
            }

            this.updateButcher(record, isNight);
        }
    }

    /**
     * Updates an individual butcher's routine.
     * @param {object} record 
     * @param {boolean} isNight 
     */
    updateButcher(record, isNight) {
        const { villager } = record;

        switch (record.state) {
            case ButcherState.SLEEPING: {
                // Wait for sunrise
                if (!isNight) {
                    try {
                        villager.triggerEvent("minecraft:schedule_wander_villager");
                    } catch {}
                    equipAxe(villager);
                    record.state = ButcherState.IDLE;
                    record.timer = 40; // Wake up delay
                }
                break;
            }

            case ButcherState.IDLE: {
                record.timer--;
                if (record.timer <= 0) {
                    record.timer = 20;

                    // Ensure weapon is equipped
                    equipAxe(villager);

                    // 1. PRIORITY 1: Check for nearby hostile monsters
                    const monster = findNearbyMonsters(villager.dimension, villager.location, 16);
                    if (monster) {
                        record.state = ButcherState.COMBAT;
                        record.timer = 20;
                        break;
                    }

                    const currentStep = record.step || 0;
                    let actionTaken = false;

                    // Step 0: If already holding meat, search for a Smoker to cook it
                    if (currentStep === 0) {
                        if (record.meat) {
                            const smoker = findNearestSmoker(villager.dimension, villager.location, BUTCHER_CONFIG.SMOKER_SEARCH_RADIUS);
                            if (smoker) {
                                record.smoker = smoker;
                                record.stuckTicks = 0;
                                record.lastLoc = { ...villager.location };
                                record.state = ButcherState.APPROACHING_SMOKER;
                                record.timer = 200; // 10 seconds to reach smoker
                                try {
                                    villager.triggerEvent("rpc:start_approach_smoker");
                                } catch {}
                                actionTaken = true;
                            }
                        }
                    }

                    // Step 1: Scan for nearby pigs and cows
                    if (!actionTaken && (currentStep === 1 || !record.meat)) {
                        const animal = findNearbyPrey(villager.dimension, villager.location, BUTCHER_CONFIG.ANIMAL_SEARCH_RADIUS);
                        if (animal) {
                            record.targetAnimal = animal;
                            record.stuckTicks = 0;
                            record.lastLoc = { ...villager.location };
                            const dist = distance(villager.location, animal.location);
                            if (dist <= BUTCHER_CONFIG.ATTACK_DISTANCE) {
                                record.state = ButcherState.SLAUGHTERING;
                                record.timer = BUTCHER_CONFIG.SLAUGHTER_ANIMATION_TICKS;
                            } else {
                                record.state = ButcherState.HUNTING;
                                record.timer = 120; // 6 seconds to reach animal
                                try {
                                    villager.triggerEvent("rpc:start_butcher_hunt");
                                } catch {}
                            }
                            actionTaken = true;
                        }
                    }

                    // If neither action was taken or target unavailable, advance step to prevent loop
                    record.step = (currentStep + 1) % 2;
                }
                break;
            }

            case ButcherState.COMBAT: {
                // Ensure axe is equipped for combat
                equipAxe(villager);

                record.timer--;
                if (record.timer <= 0) {
                    record.timer = 20;
                    // Check if monsters are still nearby
                    const monster = findNearbyMonsters(villager.dimension, villager.location, 16);
                    if (!monster) {
                        // Village is safe! Return to cooldown / idle
                        record.state = ButcherState.COOLDOWN;
                        record.timer = 30;
                        try {
                            villager.triggerEvent("minecraft:schedule_wander_villager");
                        } catch {}
                    }
                }
                break;
            }

            case ButcherState.HUNTING: {
                // Immediate monster interruption check
                const hostile = findNearbyMonsters(villager.dimension, villager.location, 14);
                if (hostile) {
                    try {
                        villager.triggerEvent("rpc:stop_butcher_hunt");
                    } catch {}
                    record.state = ButcherState.COMBAT;
                    record.targetAnimal = null;
                    record.timer = 20;
                    break;
                }

                record.timer--;

                // Target became invalid or died
                if (!record.targetAnimal || !record.targetAnimal.isValid() || !isValidPrey(record.targetAnimal)) {
                    try {
                        villager.triggerEvent("rpc:stop_butcher_hunt");
                    } catch {}
                    record.state = ButcherState.IDLE;
                    record.targetAnimal = null;
                    record.step = ((record.step || 0) + 1) % 2;
                    record.timer = 10;
                    break;
                }

                // Smooth movement towards the animal
                smoothMoveTowards(villager, record.targetAnimal.location, {
                    stopDistance: BUTCHER_CONFIG.ATTACK_DISTANCE,
                    speed: 0.16
                });

                // Stuck detection
                if (record.lastLoc && distance(villager.location, record.lastLoc) < 0.15) {
                    record.stuckTicks = (record.stuckTicks || 0) + 1;
                } else {
                    record.stuckTicks = 0;
                    record.lastLoc = { ...villager.location };
                }

                const dist = distance(villager.location, record.targetAnimal.location);
                if (dist <= BUTCHER_CONFIG.ATTACK_DISTANCE) {
                    try {
                        villager.triggerEvent("rpc:stop_butcher_hunt");
                    } catch {}
                    record.state = ButcherState.SLAUGHTERING;
                    record.timer = BUTCHER_CONFIG.SLAUGHTER_ANIMATION_TICKS;
                } else if (record.stuckTicks > 35 || record.timer <= 0) {
                    // Stuck or timeout pursuing this animal: blacklist target and advance step
                    if (record.targetAnimal) markTargetUnreachable(record.targetAnimal);
                    try {
                        villager.triggerEvent("rpc:stop_butcher_hunt");
                    } catch {}
                    record.targetAnimal = null;
                    record.step = ((record.step || 0) + 1) % 2;
                    record.state = ButcherState.IDLE;
                    record.timer = 5;
                    try {
                        villager.triggerEvent("minecraft:schedule_wander_villager");
                    } catch {}
                }
                break;
            }

            case ButcherState.SLAUGHTERING: {
                record.timer--;

                if (record.timer <= 0) {
                    if (record.targetAnimal && record.targetAnimal.isValid() && isValidPrey(record.targetAnimal)) {
                        const loot = performSlaughter(villager, record.targetAnimal, (updatedLoot) => {
                            if (updatedLoot) record.meat = updatedLoot;
                        });
                        if (loot) {
                            record.meat = loot;
                        }
                    }

                    record.targetAnimal = null;

                    // Immediately look for a Smoker to cook the meat!
                    const smoker = findNearestSmoker(villager.dimension, villager.location, BUTCHER_CONFIG.SMOKER_SEARCH_RADIUS);
                    if (smoker && record.meat) {
                        record.smoker = smoker;
                        record.stuckTicks = 0;
                        record.lastLoc = { ...villager.location };
                        record.state = ButcherState.APPROACHING_SMOKER;
                        record.timer = 200;
                        try {
                            villager.triggerEvent("rpc:start_approach_smoker");
                        } catch {}
                    } else {
                        record.state = ButcherState.COOLDOWN;
                        record.timer = BUTCHER_CONFIG.HUNT_COOLDOWN_TICKS;
                    }
                }
                break;
            }

            case ButcherState.APPROACHING_SMOKER: {
                // Immediate monster interruption check
                const hostile = findNearbyMonsters(villager.dimension, villager.location, 14);
                if (hostile) {
                    try {
                        villager.triggerEvent("rpc:stop_approach_smoker");
                    } catch {}
                    record.state = ButcherState.COMBAT;
                    record.timer = 20;
                    break;
                }

                record.timer--;

                if (!record.smoker || !record.meat) {
                    try {
                        villager.triggerEvent("rpc:stop_approach_smoker");
                    } catch {}
                    record.state = ButcherState.IDLE;
                    record.smoker = null;
                    record.step = ((record.step || 0) + 1) % 2;
                    record.timer = 10;
                    break;
                }

                // Smooth movement towards smoker
                smoothMoveTowards(villager, record.smoker, {
                    stopDistance: BUTCHER_CONFIG.SMOKER_LOAD_DISTANCE,
                    speed: 0.15
                });

                // Stuck detection
                if (record.lastLoc && distance(villager.location, record.lastLoc) < 0.15) {
                    record.stuckTicks = (record.stuckTicks || 0) + 1;
                } else {
                    record.stuckTicks = 0;
                    record.lastLoc = { ...villager.location };
                }

                // Check distance to smoker block
                const dist = distance(villager.location, record.smoker);
                if (dist <= BUTCHER_CONFIG.SMOKER_LOAD_DISTANCE) {
                    try {
                        villager.triggerEvent("rpc:stop_approach_smoker");
                    } catch {}
                    record.state = ButcherState.COOKING;
                    record.timer = 25; // 1.25s cooking interaction
                } else if (record.stuckTicks > 35 || record.timer <= 0) {
                    try {
                        villager.triggerEvent("rpc:stop_approach_smoker");
                    } catch {}
                    // If close enough (within 4.5 blocks), load smoker anyway
                    if (dist <= 4.5) {
                        record.state = ButcherState.COOKING;
                        record.timer = 15;
                    } else {
                        if (record.smoker) markTargetUnreachable(record.smoker);
                        record.smoker = null;
                        record.step = ((record.step || 0) + 1) % 2;
                        record.state = ButcherState.IDLE;
                        record.timer = 10;
                    }
                }
                break;
            }

            case ButcherState.COOKING: {
                record.timer--;

                // Face the smoker on start of cooking
                if (record.timer === 24 && record.smoker) {
                    try {
                        setEntityLook(villager, record.smoker);
                    } catch {}
                }

                if (record.timer === 20 || record.timer === 10) {
                    try {
                        villager.playAnimation("animation.villager.raise_arms");
                    } catch {}
                }

                if (record.timer <= 0) {
                    if (record.smoker && record.smoker.block && record.meat) {
                        const targetMeat = record.meat.meatId || record.meat.id || "minecraft:beef";
                        const targetCount = record.meat.count || 1;
                        loadSmoker(villager.dimension, record.smoker.block, targetMeat, targetCount);
                    }

                    // Butcher happiness feedback
                    playSoundSafe(villager.dimension, "mob.villager.yes", villager.location, { volume: 0.9, pitch: 1.05 });
                    spawnParticleSafe(villager.dimension, "minecraft:villager_happy", {
                        x: villager.location.x,
                        y: villager.location.y + 1.8,
                        z: villager.location.z
                    });

                    // Resume wander schedule so the butcher leaves the smoker
                    try {
                        villager.triggerEvent("minecraft:schedule_wander_villager");
                    } catch {}

                    record.meat = null;
                    record.smoker = null;
                    record.state = ButcherState.COOLDOWN;
                    record.timer = BUTCHER_CONFIG.HUNT_COOLDOWN_TICKS;
                }
                break;
            }

            case ButcherState.COOLDOWN: {
                const hostile = findNearbyMonsters(villager.dimension, villager.location, 16);
                if (hostile) {
                    record.state = ButcherState.COMBAT;
                    record.timer = 20;
                    break;
                }

                record.timer--;
                if (record.timer <= 0) {
                    record.state = ButcherState.IDLE;
                    record.timer = 15;
                    try {
                        villager.triggerEvent("minecraft:schedule_wander_villager");
                    } catch {}
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
        if (this.isButcherVillager(entity)) {
            this.registerButcher(entity);
        }
    }
}

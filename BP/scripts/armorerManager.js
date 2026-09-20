/**
 * Villager Professions Addon - Armorer Manager Module (Namespace: rpc)
 * Coordinates detection of Armorer villagers, equips iron ingot in hand,
 * scans for damaged Iron Golems to repair, interacts with blast furnaces,
 * and enforces day/night sleeping schedules.
 */

import { world } from "@minecraft/server";
import { ARMORER_CONFIG } from "./config.js";
import { distance, getLookRotation } from "./utils.js";
import { getVillagerProfession } from "./professionHelper.js";
import {
    equipIngot,
    unequipIngot,
    equipShield,
    equipChestplate,
    findNearbyDamagedGolem,
    findNearbyBlastFurnace,
    performRepairGolem,
    performForgeArmor,
    findNearbyUnbuffedAlly,
    performFortifyAlly,
    findNearbyAnvil,
    performHammerAnvil,
    findNearbyHostiles,
    performShieldBlock,
    hasIronGolemNearby,
    performConstructGolem
} from "./armorerBehavior.js";

export const ArmorerState = {
    IDLE: "IDLE",
    SHIELD_BLOCK: "SHIELD_BLOCK",
    APPROACHING_GOLEM: "APPROACHING_GOLEM",
    REPAIRING: "REPAIRING",
    APPROACHING_ALLY: "APPROACHING_ALLY",
    FORTIFYING_ALLY: "FORTIFYING_ALLY",
    APPROACHING_ANVIL: "APPROACHING_ANVIL",
    HAMMERING_ANVIL: "HAMMERING_ANVIL",
    APPROACHING_FURNACE: "APPROACHING_FURNACE",
    FORGING: "FORGING",
    APPROACHING_GOLEM_FORGE: "APPROACHING_GOLEM_FORGE",
    CONSTRUCTING_GOLEM: "CONSTRUCTING_GOLEM",
    COOLDOWN: "COOLDOWN",
    SLEEPING: "SLEEPING"
};

export class ArmorerManager {
    constructor() {
        /** @type {Map<string, { state: string, villager: Entity, targetGolem: Entity|null, targetAlly: Entity|null, targetAnvil: any, blastFurnace: any, targetMonster: Entity|null, timer: number }>} */
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
     * Checks if an entity is an Armorer villager.
     * @param {Entity} entity 
     * @returns {boolean}
     */
    isArmorerVillager(entity) {
        if (!entity || !entity.isValid()) return false;

        const liveProf = getVillagerProfession(entity);
        if (liveProf !== null) {
            return liveProf === "armorer";
        }

        try {
            if (entity.hasTag("rpc:armorer") || entity.hasTag("armorer")) return true;
        } catch {}

        return false;
    }

    /**
     * Scans loaded entities for Armorer villagers.
     */
    scanForArmorers() {
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
                if (this.isArmorerVillager(villager)) {
                    this.registerArmorer(villager);
                }
            }
        }
    }

    /**
     * Registers a new Armorer villager.
     * @param {Entity} villager 
     */
    registerArmorer(villager) {
        if (!villager || !villager.isValid()) return;

        equipIngot(villager);

        this.records.set(villager.id, {
            state: ArmorerState.IDLE,
            villager: villager,
            targetGolem: null,
            blastFurnace: null,
            timer: 20
        });
    }

    /**
     * Called when an entity spawns or transforms.
     * @param {Entity} entity 
     */
    onEntitySpawn(entity) {
        if (this.isArmorerVillager(entity)) {
            this.registerArmorer(entity);
        }
    }

    /**
     * Main update tick loop.
     */
    update() {
        this.scanCooldownTicks++;
        if (this.scanCooldownTicks >= 30) {
            this.scanCooldownTicks = 0;
            this.scanForArmorers();
        }

        const isNight = this.isNightTime();

        for (const [id, record] of this.records.entries()) {
            const { villager } = record;

            if (!villager || !villager.isValid() || !this.isArmorerVillager(villager)) {
                if (villager && villager.isValid()) {
                    unequipIngot(villager);
                }
                this.records.delete(id);
                continue;
            }

            if (isNight && record.state !== ArmorerState.SLEEPING) {
                unequipIngot(villager);
                try {
                    villager.triggerEvent("minecraft:schedule_bed_villager");
                } catch {}

                record.state = ArmorerState.SLEEPING;
                record.targetGolem = null;
                record.blastFurnace = null;
                continue;
            }

            this.updateArmorer(record, isNight);
        }
    }

    /**
     * Updates an individual Armorer's routine.
     * @param {object} record 
     * @param {boolean} isNight 
     */
    updateArmorer(record, isNight) {
        const { villager } = record;

        // Threat Check: Hostile monsters nearby -> Shield defense!
        if (record.state !== ArmorerState.SLEEPING && record.state !== ArmorerState.SHIELD_BLOCK) {
            const monster = findNearbyHostiles(villager.dimension, villager.location, 6);
            if (monster) {
                record.targetMonster = monster;
                record.state = ArmorerState.SHIELD_BLOCK;
                record.timer = 20;
                equipShield(villager);
            }
        }

        switch (record.state) {
            case ArmorerState.SLEEPING: {
                if (!isNight) {
                    try {
                        villager.triggerEvent("minecraft:schedule_wander_villager");
                    } catch {}
                    equipIngot(villager);
                    record.state = ArmorerState.IDLE;
                    record.timer = 40;
                }
                break;
            }

            case ArmorerState.SHIELD_BLOCK: {
                record.timer--;
                if (!record.targetMonster || !record.targetMonster.isValid()) {
                    record.state = ArmorerState.IDLE;
                    record.targetMonster = null;
                    equipIngot(villager);
                    record.timer = 10;
                    break;
                }

                performShieldBlock(villager, record.targetMonster);
                if (record.timer <= 0) {
                    record.targetMonster = null;
                    equipIngot(villager);
                    record.state = ArmorerState.COOLDOWN;
                    record.timer = 30;
                }
                break;
            }

            case ArmorerState.IDLE: {
                record.timer--;
                if (record.timer <= 0) {
                    record.timer = 25;
                    equipIngot(villager);

                    // 1. Primary: Scan for damaged Iron Golems to repair
                    const golem = findNearbyDamagedGolem(villager.dimension, villager.location, ARMORER_CONFIG.GOLEM_SEARCH_RADIUS);
                    if (golem) {
                        record.targetGolem = golem;
                        const dist = distance(villager.location, golem.location);
                        if (dist <= ARMORER_CONFIG.REPAIR_DISTANCE) {
                            record.state = ArmorerState.REPAIRING;
                            record.timer = ARMORER_CONFIG.REPAIR_ANIMATION_TICKS;
                        } else {
                            record.state = ArmorerState.APPROACHING_GOLEM;
                            record.timer = 100;
                        }
                        break;
                    }

                    // 2. Scan for unbuffed allies (villagers/player) to fortify with Resistance & Absorption
                    const ally = findNearbyUnbuffedAlly(villager.dimension, villager.location, ARMORER_CONFIG.BUFF_SEARCH_RADIUS);
                    if (ally) {
                        record.targetAlly = ally;
                        equipChestplate(villager);
                        const dist = distance(villager.location, ally.location);
                        if (dist <= 2.5) {
                            record.state = ArmorerState.FORTIFYING_ALLY;
                            record.timer = 25;
                        } else {
                            record.state = ArmorerState.APPROACHING_ALLY;
                            record.timer = 90;
                        }
                        break;
                    }

                    // 3. Golem Construction: If no Iron Golem in 32 blocks, construct one at blast furnace!
                    if (!hasIronGolemNearby(villager.dimension, villager.location, ARMORER_CONFIG.GOLEM_SUMMON_RADIUS)) {
                        const furnace = findNearbyBlastFurnace(villager.dimension, villager.location, ARMORER_CONFIG.BLAST_FURNACE_SEARCH_RADIUS);
                        if (furnace) {
                            record.blastFurnace = furnace;
                            record.state = ArmorerState.APPROACHING_GOLEM_FORGE;
                            record.timer = 100;
                            break;
                        }
                    }

                    // 4. Secondary: Anvil hammering & maintenance
                    if (Math.random() < 0.35) {
                        const anvil = findNearbyAnvil(villager.dimension, villager.location, ARMORER_CONFIG.ANVIL_SEARCH_RADIUS);
                        if (anvil) {
                            record.targetAnvil = anvil;
                            const dist = distance(villager.location, anvil.pos);
                            if (dist <= 2.5) {
                                record.state = ArmorerState.HAMMERING_ANVIL;
                                record.timer = 30;
                            } else {
                                record.state = ArmorerState.APPROACHING_ANVIL;
                                record.timer = 90;
                            }
                            break;
                        }
                    }

                    // 5. Blast Furnace forging routine
                    if (Math.random() < 0.4) {
                        const furnace = findNearbyBlastFurnace(villager.dimension, villager.location, ARMORER_CONFIG.BLAST_FURNACE_SEARCH_RADIUS);
                        if (furnace) {
                            record.blastFurnace = furnace;
                            record.state = ArmorerState.APPROACHING_FURNACE;
                            record.timer = 100;
                            break;
                        }
                    }
                }
                break;
            }

            case ArmorerState.APPROACHING_GOLEM: {
                record.timer--;
                if (!record.targetGolem || !record.targetGolem.isValid()) {
                    record.state = ArmorerState.IDLE;
                    record.targetGolem = null;
                    record.timer = 10;
                    break;
                }

                try {
                    const gLoc = record.targetGolem.location;
                    if (record.timer % 10 === 0) {
                        const rot = getLookRotation(villager.location, gLoc);
                        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
                    }
                    const dx = gLoc.x - villager.location.x;
                    const dz = gLoc.z - villager.location.z;
                    const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
                    villager.applyImpulse({ x: (dx / len) * 0.18, y: 0, z: (dz / len) * 0.18 });
                } catch {}

                const dist = distance(villager.location, record.targetGolem.location);
                if (dist <= ARMORER_CONFIG.REPAIR_DISTANCE) {
                    record.state = ArmorerState.REPAIRING;
                    record.timer = ARMORER_CONFIG.REPAIR_ANIMATION_TICKS;
                } else if (record.timer <= 0) {
                    record.state = ArmorerState.IDLE;
                    record.targetGolem = null;
                    record.timer = 20;
                }
                break;
            }

            case ArmorerState.REPAIRING: {
                record.timer--;
                if (record.timer <= 0) {
                    if (record.targetGolem && record.targetGolem.isValid()) {
                        performRepairGolem(villager, record.targetGolem);
                    }
                    record.targetGolem = null;
                    record.state = ArmorerState.COOLDOWN;
                    record.timer = ARMORER_CONFIG.REPAIR_COOLDOWN_TICKS;
                }
                break;
            }

            case ArmorerState.APPROACHING_ALLY: {
                record.timer--;
                if (!record.targetAlly || !record.targetAlly.isValid()) {
                    record.state = ArmorerState.IDLE;
                    record.targetAlly = null;
                    equipIngot(villager);
                    record.timer = 10;
                    break;
                }

                if (record.timer % 20 === 0) equipChestplate(villager);

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
                    record.state = ArmorerState.FORTIFYING_ALLY;
                    record.timer = 25;
                } else if (record.timer <= 0) {
                    record.state = ArmorerState.IDLE;
                    record.targetAlly = null;
                    equipIngot(villager);
                    record.timer = 20;
                }
                break;
            }

            case ArmorerState.FORTIFYING_ALLY: {
                record.timer--;
                if (record.timer <= 0) {
                    if (record.targetAlly && record.targetAlly.isValid()) {
                        performFortifyAlly(villager, record.targetAlly);
                    }
                    record.targetAlly = null;
                    equipIngot(villager);
                    record.state = ArmorerState.COOLDOWN;
                    record.timer = 40;
                }
                break;
            }

            case ArmorerState.APPROACHING_ANVIL: {
                record.timer--;
                if (!record.targetAnvil) {
                    record.state = ArmorerState.IDLE;
                    record.timer = 10;
                    break;
                }

                try {
                    const aPos = { x: record.targetAnvil.pos.x + 0.5, y: record.targetAnvil.pos.y, z: record.targetAnvil.pos.z + 0.5 };
                    if (record.timer % 10 === 0) {
                        const rot = getLookRotation(villager.location, aPos);
                        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
                    }
                    const dx = aPos.x - villager.location.x;
                    const dz = aPos.z - villager.location.z;
                    const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
                    villager.applyImpulse({ x: (dx / len) * 0.18, y: 0, z: (dz / len) * 0.18 });
                } catch {}

                const dist = distance(villager.location, record.targetAnvil.pos);
                if (dist <= 2.5) {
                    record.state = ArmorerState.HAMMERING_ANVIL;
                    record.timer = 30;
                } else if (record.timer <= 0) {
                    record.state = ArmorerState.IDLE;
                    record.targetAnvil = null;
                    record.timer = 20;
                }
                break;
            }

            case ArmorerState.HAMMERING_ANVIL: {
                record.timer--;
                if (record.timer <= 0) {
                    if (record.targetAnvil) {
                        performHammerAnvil(villager, record.targetAnvil.pos);
                    }
                    record.targetAnvil = null;
                    record.state = ArmorerState.COOLDOWN;
                    record.timer = 40;
                }
                break;
            }

            case ArmorerState.APPROACHING_GOLEM_FORGE: {
                record.timer--;
                if (!record.blastFurnace) {
                    record.state = ArmorerState.IDLE;
                    break;
                }

                try {
                    const fPos = { x: record.blastFurnace.pos.x + 0.5, y: record.blastFurnace.pos.y, z: record.blastFurnace.pos.z + 0.5 };
                    if (record.timer % 10 === 0) {
                        const rot = getLookRotation(villager.location, fPos);
                        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
                    }
                    const dx = fPos.x - villager.location.x;
                    const dz = fPos.z - villager.location.z;
                    const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
                    villager.applyImpulse({ x: (dx / len) * 0.18, y: 0, z: (dz / len) * 0.18 });
                } catch {}

                const dist = distance(villager.location, record.blastFurnace.pos);
                if (dist <= 2.8) {
                    record.state = ArmorerState.CONSTRUCTING_GOLEM;
                    record.timer = 35;
                } else if (record.timer <= 0) {
                    record.state = ArmorerState.IDLE;
                    record.blastFurnace = null;
                    record.timer = 20;
                }
                break;
            }

            case ArmorerState.CONSTRUCTING_GOLEM: {
                record.timer--;
                if (record.timer <= 0) {
                    if (record.blastFurnace) {
                        performConstructGolem(villager, record.blastFurnace.pos);
                    }
                    record.blastFurnace = null;
                    record.state = ArmorerState.COOLDOWN;
                    record.timer = 80;
                }
                break;
            }

            case ArmorerState.APPROACHING_FURNACE: {
                record.timer--;
                if (!record.blastFurnace) {
                    record.state = ArmorerState.IDLE;
                    break;
                }

                try {
                    const fPos = { x: record.blastFurnace.pos.x + 0.5, y: record.blastFurnace.pos.y, z: record.blastFurnace.pos.z + 0.5 };
                    if (record.timer % 10 === 0) {
                        const rot = getLookRotation(villager.location, fPos);
                        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
                    }
                    const dx = fPos.x - villager.location.x;
                    const dz = fPos.z - villager.location.z;
                    const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
                    villager.applyImpulse({ x: (dx / len) * 0.18, y: 0, z: (dz / len) * 0.18 });
                } catch {}

                const dist = distance(villager.location, record.blastFurnace.pos);
                if (dist <= 2.8) {
                    record.state = ArmorerState.FORGING;
                    record.timer = 24;
                } else if (record.timer <= 0) {
                    record.state = ArmorerState.IDLE;
                    record.blastFurnace = null;
                    record.timer = 20;
                }
                break;
            }

            case ArmorerState.FORGING: {
                record.timer--;
                if (record.timer <= 0) {
                    if (record.blastFurnace) {
                        performForgeArmor(villager, record.blastFurnace);
                    }
                    record.blastFurnace = null;
                    record.state = ArmorerState.COOLDOWN;
                    record.timer = 40;
                }
                break;
            }

            case ArmorerState.COOLDOWN: {
                record.timer--;
                if (record.timer <= 0) {
                    equipIngot(villager);
                    record.state = ArmorerState.IDLE;
                    record.timer = 15;
                }
                break;
            }
        }
    }
}

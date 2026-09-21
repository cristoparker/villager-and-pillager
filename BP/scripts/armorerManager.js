/**
 * Villager Professions Addon - Armorer Manager Module (Namespace: rpc)
 * Coordinates detection of Armorer villagers, equips iron ingot in hand,
 * scans for damaged Iron Golems to repair, interacts with blast furnaces,
 * and enforces day/night sleeping schedules.
 */

import { world } from "@minecraft/server";
import { ARMORER_CONFIG } from "./config.js";
import { distance, getLookRotation, smoothMoveTowards, markTargetUnreachable, isTargetUnreachable } from "./utils.js";
import { getVillagerProfession } from "./professionHelper.js";
import {
    equipIngot,
    unequipIngot,
    equipChestplate,
    findNearbyDamagedGolem,
    findNearbyBlastFurnace,
    performRepairGolem,
    performForgeArmor,
    findNearbyUnbuffedAlly,
    performFortifyAlly,
    findNearbyAnvil,
    performHammerAnvil,
    hasIronGolemNearby,
    performConstructGolem,
    equipIronBlock,
    equipPumpkin,
    findNearbyRaidThreat,
    findNearbyGolemConstructionSpot,
    performAssembleRaidGolem
} from "./armorerBehavior.js";

export const ArmorerState = {
    IDLE: "IDLE",
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
    APPROACHING_RAID_GOLEM_SPOT: "APPROACHING_RAID_GOLEM_SPOT",
    BUILDING_RAID_GOLEM: "BUILDING_RAID_GOLEM",
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
            golemSpot: null,
            raidGolemCooldown: 0,
            step: 0,
            stuckTicks: 0,
            lastDist: 999,
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

        if (record.raidGolemCooldown > 0) record.raidGolemCooldown--;



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

            case ArmorerState.IDLE: {
                record.timer--;
                if (record.timer <= 0) {
                    record.timer = 20;
                    equipIngot(villager);

                    const startStep = (record.step || 0) % 6;
                    let foundAction = false;

                    for (let s = 0; s < 6; s++) {
                        const currentStep = (startStep + s) % 6;

                        // 0. RAID DEFENSE PRIORITY
                        if (currentStep === 0 && record.raidGolemCooldown <= 0) {
                            const raidThreat = findNearbyRaidThreat(villager.dimension, villager.location, ARMORER_CONFIG.RAID_SEARCH_RADIUS || 24);
                            if (raidThreat && !hasIronGolemNearby(villager.dimension, villager.location, ARMORER_CONFIG.RAID_GOLEM_BUILD_RADIUS || 24)) {
                                const golemSpot = findNearbyGolemConstructionSpot(villager.dimension, villager.location, 10);
                                if (golemSpot && !isTargetUnreachable(golemSpot.center)) {
                                    record.golemSpot = golemSpot;
                                    equipIronBlock(villager);
                                    const dist = distance(villager.location, golemSpot.center);
                                    if (dist <= 3.0) {
                                        record.state = ArmorerState.BUILDING_RAID_GOLEM;
                                        record.timer = 40;
                                        record.raidGolemCooldown = ARMORER_CONFIG.GOLEM_BUILD_COOLDOWN_TICKS || 400;
                                        performAssembleRaidGolem(villager, golemSpot);
                                    } else {
                                        record.state = ArmorerState.APPROACHING_RAID_GOLEM_SPOT;
                                        record.timer = 90;
                                        record.stuckTicks = 0;
                                        record.lastDist = dist;
                                    }
                                    record.step = 0;
                                    foundAction = true;
                                    break;
                                }
                            }
                        }

                        // 1. Primary: Scan for damaged Iron Golems to repair
                        else if (currentStep === 1) {
                            const golem = findNearbyDamagedGolem(villager.dimension, villager.location, ARMORER_CONFIG.GOLEM_SEARCH_RADIUS);
                            if (golem && !isTargetUnreachable(golem.id)) {
                                record.targetGolem = golem;
                                const dist = distance(villager.location, golem.location);
                                if (dist <= ARMORER_CONFIG.REPAIR_DISTANCE) {
                                    record.state = ArmorerState.REPAIRING;
                                    record.timer = ARMORER_CONFIG.REPAIR_ANIMATION_TICKS;
                                } else {
                                    record.state = ArmorerState.APPROACHING_GOLEM;
                                    record.timer = 90;
                                    record.stuckTicks = 0;
                                    record.lastDist = dist;
                                }
                                record.step = 1;
                                foundAction = true;
                                break;
                            }
                        }

                        // 2. Scan for unbuffed allies to fortify
                        else if (currentStep === 2) {
                            const ally = findNearbyUnbuffedAlly(villager.dimension, villager.location, ARMORER_CONFIG.BUFF_SEARCH_RADIUS);
                            if (ally && !isTargetUnreachable(ally.id)) {
                                record.targetAlly = ally;
                                equipChestplate(villager);
                                const dist = distance(villager.location, ally.location);
                                if (dist <= 2.5) {
                                    record.state = ArmorerState.FORTIFYING_ALLY;
                                    record.timer = 25;
                                } else {
                                    record.state = ArmorerState.APPROACHING_ALLY;
                                    record.timer = 80;
                                    record.stuckTicks = 0;
                                    record.lastDist = dist;
                                }
                                record.step = 2;
                                foundAction = true;
                                break;
                            }
                        }

                        // 3. Golem Construction at blast furnace
                        else if (currentStep === 3) {
                            if (!hasIronGolemNearby(villager.dimension, villager.location, ARMORER_CONFIG.GOLEM_SUMMON_RADIUS)) {
                                const furnace = findNearbyBlastFurnace(villager.dimension, villager.location, ARMORER_CONFIG.BLAST_FURNACE_SEARCH_RADIUS);
                                if (furnace && !isTargetUnreachable(furnace.pos)) {
                                    record.blastFurnace = furnace;
                                    record.state = ArmorerState.APPROACHING_GOLEM_FORGE;
                                    record.timer = 90;
                                    record.stuckTicks = 0;
                                    record.lastDist = distance(villager.location, furnace.pos);
                                    record.step = 3;
                                    foundAction = true;
                                    break;
                                }
                            }
                        }

                        // 4. Secondary: Anvil hammering & maintenance
                        else if (currentStep === 4 && Math.random() < 0.4) {
                            const anvil = findNearbyAnvil(villager.dimension, villager.location, ARMORER_CONFIG.ANVIL_SEARCH_RADIUS);
                            if (anvil && !isTargetUnreachable(anvil.pos)) {
                                record.targetAnvil = anvil;
                                const dist = distance(villager.location, anvil.pos);
                                if (dist <= 2.5) {
                                    record.state = ArmorerState.HAMMERING_ANVIL;
                                    record.timer = 30;
                                } else {
                                    record.state = ArmorerState.APPROACHING_ANVIL;
                                    record.timer = 80;
                                    record.stuckTicks = 0;
                                    record.lastDist = dist;
                                }
                                record.step = 4;
                                foundAction = true;
                                break;
                            }
                        }

                        // 5. Blast Furnace forging routine
                        else if (currentStep === 5 && Math.random() < 0.4) {
                            const furnace = findNearbyBlastFurnace(villager.dimension, villager.location, ARMORER_CONFIG.BLAST_FURNACE_SEARCH_RADIUS);
                            if (furnace && !isTargetUnreachable(furnace.pos)) {
                                record.blastFurnace = furnace;
                                record.state = ArmorerState.APPROACHING_FURNACE;
                                record.timer = 90;
                                record.stuckTicks = 0;
                                record.lastDist = distance(villager.location, furnace.pos);
                                record.step = 5;
                                foundAction = true;
                                break;
                            }
                        }
                    }

                    if (!foundAction) {
                        record.step = 0;
                        record.timer = 25;
                    }
                }
                break;
            }

            case ArmorerState.APPROACHING_GOLEM: {
                record.timer--;
                if (!record.targetGolem || !record.targetGolem.isValid()) {
                    record.state = ArmorerState.IDLE;
                    record.targetGolem = null;
                    record.timer = 5;
                    break;
                }

                const targetPos = record.targetGolem.location;
                const dist = smoothMoveTowards(villager, targetPos, { speed: 0.13, stopDistance: ARMORER_CONFIG.REPAIR_DISTANCE });

                if (Math.abs(dist - (record.lastDist || dist)) < 0.15) {
                    record.stuckTicks = (record.stuckTicks || 0) + 1;
                } else {
                    record.stuckTicks = 0;
                    record.lastDist = dist;
                }

                if (dist <= ARMORER_CONFIG.REPAIR_DISTANCE) {
                    record.state = ArmorerState.REPAIRING;
                    record.timer = ARMORER_CONFIG.REPAIR_ANIMATION_TICKS;
                    record.stuckTicks = 0;
                } else if (record.stuckTicks > 35 || record.timer <= 0) {
                    markTargetUnreachable(record.targetGolem.id, 400);
                    record.targetGolem = null;
                    record.step = 2;
                    record.state = ArmorerState.IDLE;
                    record.timer = 1;
                    record.stuckTicks = 0;
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
                    record.timer = 5;
                    break;
                }

                if (record.timer % 20 === 0) equipChestplate(villager);

                const targetPos = record.targetAlly.location;
                const dist = smoothMoveTowards(villager, targetPos, { speed: 0.13, stopDistance: 2.4 });

                if (Math.abs(dist - (record.lastDist || dist)) < 0.15) {
                    record.stuckTicks = (record.stuckTicks || 0) + 1;
                } else {
                    record.stuckTicks = 0;
                    record.lastDist = dist;
                }

                if (dist <= 2.4) {
                    record.state = ArmorerState.FORTIFYING_ALLY;
                    record.timer = 25;
                    record.stuckTicks = 0;
                } else if (record.stuckTicks > 35 || record.timer <= 0) {
                    markTargetUnreachable(record.targetAlly.id, 400);
                    record.targetAlly = null;
                    equipIngot(villager);
                    record.step = 3;
                    record.state = ArmorerState.IDLE;
                    record.timer = 1;
                    record.stuckTicks = 0;
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
                    record.timer = 5;
                    break;
                }

                const targetPos = { x: record.targetAnvil.pos.x + 0.5, y: record.targetAnvil.pos.y, z: record.targetAnvil.pos.z + 0.5 };
                const dist = smoothMoveTowards(villager, targetPos, { speed: 0.13, stopDistance: 2.4 });

                if (Math.abs(dist - (record.lastDist || dist)) < 0.15) {
                    record.stuckTicks = (record.stuckTicks || 0) + 1;
                } else {
                    record.stuckTicks = 0;
                    record.lastDist = dist;
                }

                if (dist <= 2.4) {
                    record.state = ArmorerState.HAMMERING_ANVIL;
                    record.timer = 30;
                    record.stuckTicks = 0;
                } else if (record.stuckTicks > 35 || record.timer <= 0) {
                    markTargetUnreachable(record.targetAnvil.pos, 400);
                    record.targetAnvil = null;
                    record.step = 5;
                    record.state = ArmorerState.IDLE;
                    record.timer = 1;
                    record.stuckTicks = 0;
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
                    record.timer = 5;
                    break;
                }

                const targetPos = { x: record.blastFurnace.pos.x + 0.5, y: record.blastFurnace.pos.y, z: record.blastFurnace.pos.z + 0.5 };
                const dist = smoothMoveTowards(villager, targetPos, { speed: 0.13, stopDistance: 2.6 });

                if (Math.abs(dist - (record.lastDist || dist)) < 0.15) {
                    record.stuckTicks = (record.stuckTicks || 0) + 1;
                } else {
                    record.stuckTicks = 0;
                    record.lastDist = dist;
                }

                if (dist <= 2.6) {
                    record.state = ArmorerState.CONSTRUCTING_GOLEM;
                    record.timer = 35;
                    record.stuckTicks = 0;
                } else if (record.stuckTicks > 35 || record.timer <= 0) {
                    markTargetUnreachable(record.blastFurnace.pos, 400);
                    record.blastFurnace = null;
                    record.step = 4;
                    record.state = ArmorerState.IDLE;
                    record.timer = 1;
                    record.stuckTicks = 0;
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
                    record.timer = 5;
                    break;
                }

                const targetPos = { x: record.blastFurnace.pos.x + 0.5, y: record.blastFurnace.pos.y, z: record.blastFurnace.pos.z + 0.5 };
                const dist = smoothMoveTowards(villager, targetPos, { speed: 0.13, stopDistance: 2.6 });

                if (Math.abs(dist - (record.lastDist || dist)) < 0.15) {
                    record.stuckTicks = (record.stuckTicks || 0) + 1;
                } else {
                    record.stuckTicks = 0;
                    record.lastDist = dist;
                }

                if (dist <= 2.6) {
                    record.state = ArmorerState.FORGING;
                    record.timer = 24;
                    record.stuckTicks = 0;
                } else if (record.stuckTicks > 35 || record.timer <= 0) {
                    markTargetUnreachable(record.blastFurnace.pos, 400);
                    record.blastFurnace = null;
                    record.step = 0;
                    record.state = ArmorerState.IDLE;
                    record.timer = 1;
                    record.stuckTicks = 0;
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

            case ArmorerState.APPROACHING_RAID_GOLEM_SPOT: {
                record.timer--;
                if (!record.golemSpot) {
                    record.state = ArmorerState.IDLE;
                    equipIngot(villager);
                    record.timer = 5;
                    break;
                }

                const targetPos = { x: record.golemSpot.center.x + 0.5, y: record.golemSpot.center.y, z: record.golemSpot.center.z + 0.5 };
                const dist = smoothMoveTowards(villager, targetPos, { speed: 0.13, stopDistance: 2.5 });

                if (Math.abs(dist - (record.lastDist || dist)) < 0.15) {
                    record.stuckTicks = (record.stuckTicks || 0) + 1;
                } else {
                    record.stuckTicks = 0;
                    record.lastDist = dist;
                }

                if (dist <= 2.5) {
                    record.state = ArmorerState.BUILDING_RAID_GOLEM;
                    record.timer = 40;
                    record.raidGolemCooldown = ARMORER_CONFIG.GOLEM_BUILD_COOLDOWN_TICKS || 400;
                    performAssembleRaidGolem(villager, record.golemSpot);
                    record.stuckTicks = 0;
                } else if (record.stuckTicks > 35 || record.timer <= 0) {
                    markTargetUnreachable(record.golemSpot.center, 400);
                    record.golemSpot = null;
                    record.state = ArmorerState.IDLE;
                    equipIngot(villager);
                    record.timer = 1;
                    record.stuckTicks = 0;
                }
                break;
            }

            case ArmorerState.BUILDING_RAID_GOLEM: {
                record.timer--;
                if (record.timer <= 0) {
                    record.golemSpot = null;
                    record.raidGolemCooldown = ARMORER_CONFIG.GOLEM_BUILD_COOLDOWN_TICKS || 400;
                    equipIngot(villager);
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

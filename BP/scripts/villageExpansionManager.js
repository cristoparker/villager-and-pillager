/**
 * Villager Professions Addon - Village Expansion & Economy Manager (Namespace: rpc)
 * Coordinates:
 * 1. Universal dropped item collection for all villagers (meat, wool, sugarcane, crops, fish, arrows, ingots).
 * 2. Copper Golem-style Chest Organization: depositing collected items into village chests/barrels,
 *    or placing a new community chest if none exists.
 * 3. Village Bed Expansion: placing beds with 2-block headroom in open spaces to enable natural villager breeding.
 * 4. Village Workbench Expansion: placing workstations for new villagers to adopt professions.
 */

import { world, system, ItemStack, EquipmentSlot } from "@minecraft/server";
import { EXPANSION_CONFIG } from "./config.js";
import { distance, getLookRotation, playSoundSafe, spawnParticleSafe, setBlockSafe, placeBedBlock, isSolidGround, isPassableBlock, isFreeBedSpace, isReplaceableSpace } from "./utils.js";
import { getVillagerProfession } from "./professionHelper.js";

export const PROFESSION_WORKBENCH_MAP = {
    farmer: "minecraft:composter",
    fisherman: "minecraft:barrel",
    shepherd: "minecraft:loom",
    fletcher: "minecraft:fletching_table",
    librarian: "minecraft:lectern",
    cartographer: "minecraft:cartography_table",
    cleric: "minecraft:brewing_stand",
    armorer: "minecraft:blast_furnace",
    weaponsmith: "minecraft:grindstone",
    toolsmith: "minecraft:smithing_table",
    butcher: "minecraft:smoker",
    leatherworker: "minecraft:cauldron",
    mason: "minecraft:stonecutter"
};

// Global area placement cooldown registries to prevent simultaneous spam
const recentBedAreaPlacements = new Map();
const recentChestAreaPlacements = new Map();
const recentWorkbenchAreaPlacements = new Map();

function isAreaBedCooldown(dimension, location) {
    if (!dimension || !location) return false;
    const key = `${dimension.id}:${Math.floor(location.x / 16)},${Math.floor(location.z / 16)}`;
    const expires = recentBedAreaPlacements.get(key) || 0;
    return Date.now() < expires;
}

function setAreaBedCooldown(dimension, location, durationMs = 300000) {
    if (!dimension || !location) return;
    const key = `${dimension.id}:${Math.floor(location.x / 16)},${Math.floor(location.z / 16)}`;
    recentBedAreaPlacements.set(key, Date.now() + durationMs);
}

function isAreaChestCooldown(dimension, location) {
    if (!dimension || !location) return false;
    const key = `${dimension.id}:${Math.floor(location.x / 20)},${Math.floor(location.z / 20)}`;
    const expires = recentChestAreaPlacements.get(key) || 0;
    return Date.now() < expires;
}

function setAreaChestCooldown(dimension, location, durationMs = 300000) {
    if (!dimension || !location) return;
    const key = `${dimension.id}:${Math.floor(location.x / 20)},${Math.floor(location.z / 20)}`;
    recentChestAreaPlacements.set(key, Date.now() + durationMs);
}

function isAreaWorkbenchCooldown(dimension, location) {
    if (!dimension || !location) return false;
    const key = `${dimension.id}:${Math.floor(location.x / 8)},${Math.floor(location.z / 8)}`;
    const expires = recentWorkbenchAreaPlacements.get(key) || 0;
    return Date.now() < expires;
}

function setAreaWorkbenchCooldown(dimension, location, durationMs = 60000) {
    if (!dimension || !location) return;
    const key = `${dimension.id}:${Math.floor(location.x / 8)},${Math.floor(location.z / 8)}`;
    recentWorkbenchAreaPlacements.set(key, Date.now() + durationMs);
}

export const ExpansionState = {
    IDLE: "IDLE",
    COLLECTING_ITEM: "COLLECTING_ITEM",
    APPROACHING_CHEST: "APPROACHING_CHEST",
    DEPOSITING_CHEST: "DEPOSITING_CHEST",
    APPROACHING_CHEST_SPOT: "APPROACHING_CHEST_SPOT",
    PLACING_CHEST: "PLACING_CHEST",
    APPROACHING_BED_SPOT: "APPROACHING_BED_SPOT",
    PLACING_BED: "PLACING_BED",
    APPROACHING_WORKBENCH_SPOT: "APPROACHING_WORKBENCH_SPOT",
    PLACING_WORKBENCH: "PLACING_WORKBENCH",
    COOLDOWN: "COOLDOWN"
};

export let globalExpansionManager = null;

export function setGlobalExpansionManager(mgr) {
    globalExpansionManager = mgr;
}

export function notifyDroppedItem(villager, itemEntity) {
    if (globalExpansionManager && villager && itemEntity) {
        try {
            globalExpansionManager.directTargetDroppedItem(villager, itemEntity);
        } catch {}
    }
}

export class VillageExpansionManager {
    constructor() {
        /** @type {Map<string, { state: string, villager: Entity, carriedItems: Array<{ typeId: string, amount: number }>, targetItemEntity: Entity|null, targetChest: any, placementSpot: Vector3|null, targetWorkbenchType: string|null, bedCooldown: number, workbenchCooldown: number, depositCooldown: number, chestCooldown: number, breedCooldown: number, timer: number }>} */
        this.records = new Map();
        this.scanCooldownTicks = 0;
    }

    /**
     * Checks if it is currently nighttime.
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
     * Registers a villager into the expansion manager.
     * @param {Entity} villager 
     */
    registerVillager(villager) {
        if (!villager || !villager.isValid() || this.records.has(villager.id)) return;

        this.records.set(villager.id, {
            state: ExpansionState.IDLE,
            villager: villager,
            carriedItems: [],
            targetItemEntity: null,
            targetChest: null,
            placementSpot: null,
            targetWorkbenchType: null,
            bedCooldown: Math.floor(Math.random() * 1200) + 600, // 30-90s initial cooldown, beds not frequent!
            workbenchCooldown: 20, // 1 second! Check immediately if workbench is needed!
            depositCooldown: 0,
            chestCooldown: 40, // 2 seconds initial check
            breedCooldown: 200,
            timer: 20
        });
    }

    /**
     * Unregisters a villager.
     * @param {string} id 
     */
    unregisterVillager(id) {
        this.records.delete(id);
    }

    /**
     * Scans loaded entities for all villagers.
     */
    scanForVillagers() {
        const dimensions = ["overworld"];
        for (const dimId of dimensions) {
            let dim;
            try { dim = world.getDimension(dimId); } catch {}
            if (!dim) continue;

            let villagers = [];
            try { villagers = dim.getEntities({ type: "minecraft:villager_v2" }); } catch {}
            try {
                const legacy = dim.getEntities({ type: "minecraft:villager" });
                if (legacy && legacy.length > 0) villagers = villagers.concat(legacy);
            } catch {}

            for (const villager of villagers) {
                if (villager && villager.isValid() && !this.records.has(villager.id)) {
                    this.registerVillager(villager);
                }
            }
        }
    }

    /**
     * Entity spawn callback.
     * @param {Entity} entity 
     */
    onEntitySpawn(entity) {
        if (entity && (entity.typeId === "minecraft:villager_v2" || entity.typeId === "minecraft:villager")) {
            this.registerVillager(entity);
        }
    }

    /**
     * Allows profession managers to immediately instruct a villager to collect a dropped item
     * (e.g. Shepherd after shearing wool, Butcher after meat drop, Librarian after sugarcane harvest).
     * @param {Entity} villager 
     * @param {Entity} itemEntity 
     */
    directTargetDroppedItem(villager, itemEntity) {
        if (!villager || !villager.isValid() || !itemEntity || !itemEntity.isValid()) return;
        let record = this.records.get(villager.id);
        if (!record) {
            this.registerVillager(villager);
            record = this.records.get(villager.id);
        }
        if (!record) return;

        record.targetItemEntity = itemEntity;
        record.state = ExpansionState.COLLECTING_ITEM;
        record.timer = 100;
    }

    /**
     * Main update tick loop.
     */
    update() {
        this.scanCooldownTicks++;
        if (this.scanCooldownTicks >= 40) {
            this.scanCooldownTicks = 0;
            this.scanForVillagers();
        }

        const isNight = this.isNightTime();

        for (const [id, record] of this.records.entries()) {
            const { villager } = record;

            if (!villager || !villager.isValid()) {
                this.records.delete(id);
                continue;
            }

            // At night, pause expansion tasks so villagers sleep peacefully
            if (isNight) {
                if (record.state !== ExpansionState.IDLE) {
                    record.state = ExpansionState.IDLE;
                    record.targetItemEntity = null;
                    record.targetChest = null;
                    record.placementSpot = null;
                }
                continue;
            }

            if (record.bedCooldown > 0) record.bedCooldown--;
            if (record.workbenchCooldown > 0) record.workbenchCooldown--;
            if (record.depositCooldown > 0) record.depositCooldown--;
            if (record.chestCooldown > 0) record.chestCooldown--;
            if (record.breedCooldown > 0) record.breedCooldown--;

            this.updateVillager(record);
        }
    }

    /**
     * Updates an individual villager's expansion and item handling routine.
     * @param {object} record 
     */
    updateVillager(record) {
        const { villager } = record;
        const dim = villager.dimension;
        const vLoc = villager.location;

        switch (record.state) {
            case ExpansionState.IDLE: {
                record.timer--;
                if (record.timer <= 0) {
                    record.timer = 20;

                    // 1. PRIORITY 1: Scan for nearby dropped items to collect!
                    const droppedItem = this.findNearbyDroppedItem(dim, vLoc, EXPANSION_CONFIG.ITEM_SEARCH_RADIUS);
                    if (droppedItem) {
                        record.targetItemEntity = droppedItem;
                        record.state = ExpansionState.COLLECTING_ITEM;
                        record.timer = 100;
                        break;
                    }

                    // 2. PRIORITY 2: Village Workbench Autonomous Placement!
                    // If a villager does not find their own workbench nearby, they immediately place it adjacent to themselves!
                    if (record.workbenchCooldown <= 0) {
                        const prof = getVillagerProfession(villager);
                        const neededWorkbench = (prof && PROFESSION_WORKBENCH_MAP[prof]) ? PROFESSION_WORKBENCH_MAP[prof] : null;

                        // For specific profession, check 10 blocks. For unemployed/nitwit, check only 6 blocks.
                        const searchRadius = neededWorkbench ? 10 : 6;
                        const hasWorkbench = this.hasNearbyWorkbench(dim, vLoc, neededWorkbench, searchRadius);
                        if (!hasWorkbench && !isAreaWorkbenchCooldown(dim, vLoc)) {
                            const wbSpot = this.findNearbyWorkbenchPlacementSpot(dim, vLoc, 3);
                            if (wbSpot) {
                                record.placementSpot = wbSpot;
                                if (neededWorkbench) {
                                    record.targetWorkbenchType = neededWorkbench;
                                } else {
                                    const wbList = EXPANSION_CONFIG.WORKBENCH_BLOCK_IDS;
                                    record.targetWorkbenchType = wbList[Math.floor(Math.random() * wbList.length)];
                                }

                                const d = distance(vLoc, wbSpot);
                                if (d <= 2.8) {
                                    record.state = ExpansionState.PLACING_WORKBENCH;
                                    record.timer = 15;
                                } else {
                                    record.state = ExpansionState.APPROACHING_WORKBENCH_SPOT;
                                    record.timer = 80;
                                }
                                break;
                            }
                        }
                    }

                    // 3. PRIORITY 3: Village Community Chest Management (Strict 20-block radius rule)
                    // If villagers find any chest within 20 blocks, they NEVER place another chest;
                    // instead ALL villagers use the chest to deposit goods and organize!
                    // If NO chest exists within 20 blocks, they place 1 community chest for everyone.
                    const nearbyChest = this.findNearbyChest(dim, vLoc, EXPANSION_CONFIG.CHEST_SEARCH_RADIUS);
                    if (nearbyChest) {
                        // Chest found within 20 blocks: NEVER place a new chest!
                        // If holding carried items, walk over and deposit into the community chest.
                        if (record.carriedItems.length > 0 && record.depositCooldown <= 0) {
                            record.targetChest = nearbyChest;
                            const d = distance(vLoc, nearbyChest.pos);
                            if (d <= EXPANSION_CONFIG.CHEST_DEPOSIT_DISTANCE) {
                                record.state = ExpansionState.DEPOSITING_CHEST;
                                record.timer = 25;
                            } else {
                                record.state = ExpansionState.APPROACHING_CHEST;
                                record.timer = 100;
                            }
                            break;
                        }
                    } else {
                        // NO chest found in 20 blocks radius!
                        // Place 1 community chest for the entire area so all villagers can use it.
                        if (record.chestCooldown <= 0 && !isAreaChestCooldown(dim, vLoc)) {
                            const chestSpot = this.findNearbyChestPlacementSpot(dim, vLoc, 4);
                            if (chestSpot) {
                                record.placementSpot = chestSpot;
                                const d = distance(vLoc, chestSpot);
                                if (d <= 2.8) {
                                    record.state = ExpansionState.PLACING_CHEST;
                                    record.timer = 20;
                                } else {
                                    record.state = ExpansionState.APPROACHING_CHEST_SPOT;
                                    record.timer = 80;
                                }
                                break;
                            }
                        }
                    }

                    // 4. PRIORITY 4: Village Bed Expansion (Enables Breeding, strictly low frequency)
                    // Responsively places beds in open areas when a bed deficit exists, never replacing existing blocks
                    if (record.bedCooldown <= 0 && !isAreaBedCooldown(dim, vLoc)) {
                        const localBeds = this.countNearbyBeds(dim, vLoc, EXPANSION_CONFIG.BED_SEARCH_RADIUS);
                        const localVillagers = this.countNearbyVillagers(dim, vLoc, EXPANSION_CONFIG.BED_SEARCH_RADIUS);

                        if (localBeds < localVillagers && Math.random() < 0.20) {
                            const bedSpot = this.findNearbyBedPlacementSpot(dim, vLoc, 8);
                            if (bedSpot) {
                                record.placementSpot = bedSpot;
                                const targetPos = bedSpot.footPos || bedSpot;
                                const d = distance(vLoc, targetPos);
                                if (d <= 2.8) {
                                    record.state = ExpansionState.PLACING_BED;
                                    record.timer = 20;
                                } else {
                                    record.state = ExpansionState.APPROACHING_BED_SPOT;
                                    record.timer = 90;
                                }
                                break;
                            }
                        }
                    }

                    // 5. PRIORITY 5: Villager Breeding System Check
                    if (record.breedCooldown <= 0) {
                        if (this.tryPerformQuickBreeding(villager, record, dim, vLoc)) {
                            record.timer = 35;
                            break;
                        }
                    }
                }
                break;
            }

            case ExpansionState.COLLECTING_ITEM: {
                record.timer--;
                if (!record.targetItemEntity || !record.targetItemEntity.isValid() || record.timer <= 0) {
                    record.state = ExpansionState.IDLE;
                    record.targetItemEntity = null;
                    record.timer = 15;
                    break;
                }

                const itemLoc = record.targetItemEntity.location;
                const d = distance(vLoc, itemLoc);

                if (d <= EXPANSION_CONFIG.ITEM_PICKUP_DISTANCE) {
                    this.collectItem(villager, record.targetItemEntity, record);
                    record.targetItemEntity = null;
                    record.state = ExpansionState.IDLE;
                    record.timer = 15;
                    break;
                }

                try {
                    if (record.timer % 10 === 0) {
                        const rot = getLookRotation(vLoc, itemLoc);
                        villager.teleport(vLoc, { rotation: { x: 0, y: rot.y } });
                    }
                    const dx = itemLoc.x - vLoc.x;
                    const dz = itemLoc.z - vLoc.z;
                    const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
                    villager.applyImpulse({ x: (dx / len) * 0.18, y: 0, z: (dz / len) * 0.18 });
                } catch {}
                break;
            }

            case ExpansionState.APPROACHING_CHEST: {
                record.timer--;
                if (!record.targetChest || record.timer <= 0) {
                    record.state = ExpansionState.IDLE;
                    record.targetChest = null;
                    record.timer = 20;
                    break;
                }

                const chestPos = record.targetChest.pos;
                const d = distance(vLoc, chestPos);
                if (d <= EXPANSION_CONFIG.CHEST_DEPOSIT_DISTANCE) {
                    record.state = ExpansionState.DEPOSITING_CHEST;
                    record.timer = 25;
                    break;
                }

                try {
                    if (record.timer % 10 === 0) {
                        const rot = getLookRotation(vLoc, chestPos);
                        villager.teleport(vLoc, { rotation: { x: 0, y: rot.y } });
                    }
                    const dx = chestPos.x + 0.5 - vLoc.x;
                    const dz = chestPos.z + 0.5 - vLoc.z;
                    const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
                    villager.applyImpulse({ x: (dx / len) * 0.18, y: 0, z: (dz / len) * 0.18 });
                } catch {}
                break;
            }

            case ExpansionState.DEPOSITING_CHEST: {
                record.timer--;
                if (record.timer <= 0) {
                    if (record.targetChest) {
                        this.performDepositItems(villager, record.targetChest.block, record);
                    }
                    record.targetChest = null;
                    record.depositCooldown = 200; // 10s cooldown before seeking chest again
                    record.state = ExpansionState.COOLDOWN;
                    record.timer = 30;
                }
                break;
            }

            case ExpansionState.APPROACHING_CHEST_SPOT: {
                record.timer--;
                if (!record.placementSpot || record.timer <= 0) {
                    record.state = ExpansionState.IDLE;
                    record.placementSpot = null;
                    record.timer = 20;
                    break;
                }

                const spot = record.placementSpot;
                const d = distance(vLoc, spot);
                if (d <= 2.8) {
                    record.state = ExpansionState.PLACING_CHEST;
                    record.timer = 20;
                    break;
                }

                try {
                    if (record.timer % 10 === 0) {
                        const rot = getLookRotation(vLoc, spot);
                        villager.teleport(vLoc, { rotation: { x: 0, y: rot.y } });
                        const equippable = villager.getComponent("minecraft:equippable");
                        equippable?.setEquipment(EquipmentSlot.Mainhand, new ItemStack("minecraft:chest", 1));
                    }
                    const dx = spot.x + 0.5 - vLoc.x;
                    const dz = spot.z + 0.5 - vLoc.z;
                    const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
                    villager.applyImpulse({ x: (dx / len) * 0.18, y: 0, z: (dz / len) * 0.18 });
                } catch {}
                break;
            }

            case ExpansionState.PLACING_CHEST: {
                record.timer--;
                if (record.timer <= 0) {
                    if (record.placementSpot) {
                        this.performPlaceAndDepositChest(villager, record.placementSpot, record);
                    }
                    record.placementSpot = null;
                    record.depositCooldown = 300;
                    record.chestCooldown = EXPANSION_CONFIG.CHEST_COOLDOWN_TICKS;
                    record.state = ExpansionState.COOLDOWN;
                    record.timer = 40;
                }
                break;
            }

            case ExpansionState.APPROACHING_BED_SPOT: {
                record.timer--;
                if (!record.placementSpot || record.timer <= 0) {
                    record.state = ExpansionState.IDLE;
                    record.placementSpot = null;
                    record.timer = 20;
                    break;
                }

                const spot = record.placementSpot;
                const targetPos = spot.footPos || spot;
                const d = distance(vLoc, targetPos);
                if (d <= 2.8) {
                    record.state = ExpansionState.PLACING_BED;
                    record.timer = 20;
                    break;
                }

                try {
                    if (record.timer % 10 === 0) {
                        const rot = getLookRotation(vLoc, targetPos);
                        villager.teleport(vLoc, { rotation: { x: 0, y: rot.y } });
                        const equippable = villager.getComponent("minecraft:equippable");
                        equippable?.setEquipment(EquipmentSlot.Mainhand, new ItemStack("minecraft:bed", 1));
                    }
                    const dx = targetPos.x + 0.5 - vLoc.x;
                    const dz = targetPos.z + 0.5 - vLoc.z;
                    const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
                    villager.applyImpulse({ x: (dx / len) * 0.18, y: 0, z: (dz / len) * 0.18 });
                } catch {}
                break;
            }

            case ExpansionState.PLACING_BED: {
                record.timer--;
                if (record.timer <= 0) {
                    if (record.placementSpot) {
                        this.performPlaceBed(villager, record.placementSpot);
                    }
                    record.placementSpot = null;
                    record.bedCooldown = EXPANSION_CONFIG.BED_COOLDOWN_TICKS;
                    record.state = ExpansionState.COOLDOWN;
                    record.timer = 40;
                }
                break;
            }

            case ExpansionState.APPROACHING_WORKBENCH_SPOT: {
                record.timer--;
                if (!record.placementSpot || record.timer <= 0) {
                    record.state = ExpansionState.IDLE;
                    record.placementSpot = null;
                    record.timer = 20;
                    break;
                }

                const spot = record.placementSpot;
                const d = distance(vLoc, spot);
                if (d <= 2.8) {
                    record.state = ExpansionState.PLACING_WORKBENCH;
                    record.timer = 15;
                    break;
                }

                try {
                    if (record.timer % 10 === 0) {
                        const rot = getLookRotation(vLoc, spot);
                        villager.teleport(vLoc, { rotation: { x: 0, y: rot.y } });
                        if (record.targetWorkbenchType) {
                            const equippable = villager.getComponent("minecraft:equippable");
                            equippable?.setEquipment(EquipmentSlot.Mainhand, new ItemStack(record.targetWorkbenchType, 1));
                        }
                    }
                    const dx = spot.x + 0.5 - vLoc.x;
                    const dz = spot.z + 0.5 - vLoc.z;
                    const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
                    villager.applyImpulse({ x: (dx / len) * 0.18, y: 0, z: (dz / len) * 0.18 });
                } catch {}
                break;
            }

            case ExpansionState.PLACING_WORKBENCH: {
                record.timer--;
                if (record.timer <= 0) {
                    if (record.placementSpot && record.targetWorkbenchType) {
                        this.performPlaceWorkbench(villager, record.placementSpot, record.targetWorkbenchType);
                    }
                    record.placementSpot = null;
                    record.targetWorkbenchType = null;
                    record.workbenchCooldown = EXPANSION_CONFIG.WORKBENCH_COOLDOWN_TICKS;
                    record.state = ExpansionState.COOLDOWN;
                    record.timer = 30;
                }
                break;
            }

            case ExpansionState.COOLDOWN: {
                record.timer--;
                if (record.timer <= 0) {
                    record.state = ExpansionState.IDLE;
                    record.timer = 20;
                }
                break;
            }
        }
    }

    /**
     * Finds the closest valid dropped item entity.
     * @param {Dimension} dimension 
     * @param {Vector3} location 
     * @param {number} radius 
     */
    findNearbyDroppedItem(dimension, location, radius = EXPANSION_CONFIG.ITEM_SEARCH_RADIUS) {
        if (!dimension || !location) return null;

        try {
            const items = dimension.getEntities({
                type: "minecraft:item",
                location: location,
                maxDistance: radius
            });

            let closest = null;
            let closestDist = Infinity;

            for (const item of items) {
                if (!item || !item.isValid()) continue;
                const d = distance(location, item.location);
                if (d < closestDist) {
                    closestDist = d;
                    closest = item;
                }
            }
            return closest;
        } catch {
            return null;
        }
    }

    /**
     * Collects a dropped item entity into villager storage.
     * @param {Entity} villager 
     * @param {Entity} itemEntity 
     * @param {object} record 
     */
    collectItem(villager, itemEntity, record) {
        if (!villager || !villager.isValid() || !itemEntity || !itemEntity.isValid()) return false;
        const dim = villager.dimension;
        const itemLoc = itemEntity.location;

        let typeId = "minecraft:apple";
        let amount = 1;

        try {
            const itemComp = itemEntity.getComponent("minecraft:item");
            const stack = itemComp?.itemStack;
            if (stack) {
                typeId = stack.typeId;
                amount = stack.amount || 1;
            }
        } catch {}

        // Store into villager record inventory
        const existing = record.carriedItems.find(i => i.typeId === typeId);
        if (existing) {
            existing.amount += amount;
        } else {
            record.carriedItems.push({ typeId, amount });
        }

        // Try to add to native inventory component if present
        try {
            const invComp = villager.getComponent("minecraft:inventory");
            if (invComp?.container) {
                invComp.container.addItem(new ItemStack(typeId, amount));
            }
        } catch {}

        // Audio & visual feedback
        playSoundSafe(dim, "random.pop", itemLoc, { volume: 0.8, pitch: 1.2 });
        spawnParticleSafe(dim, "minecraft:villager_happy", { x: itemLoc.x, y: itemLoc.y + 0.5, z: itemLoc.z });

        try {
            villager.playAnimation("animation.villager.raise_arms");
        } catch {}

        // Remove dropped item entity
        try {
            itemEntity.kill();
        } catch {}

        return true;
    }

    /**
     * Finds a nearby Chest or Barrel container block within radius.
     * Scans every coordinate (no skipping) to guarantee existing chests are always found.
     * @param {Dimension} dimension 
     * @param {Vector3} location 
     * @param {number} radius 
     */
    findNearbyChest(dimension, location, radius = EXPANSION_CONFIG.CHEST_SEARCH_RADIUS) {
        if (!dimension || !location) return null;
        const ox = Math.floor(location.x);
        const oy = Math.floor(location.y);
        const oz = Math.floor(location.z);
        const r = Math.min(radius, 20);

        let closest = null;
        let closestDist = Infinity;

        for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
                for (let dy = -2; dy <= 3; dy++) {
                    const pos = { x: ox + dx, y: oy + dy, z: oz + dz };
                    try {
                        const block = dimension.getBlock(pos);
                        if (block && EXPANSION_CONFIG.CHEST_BLOCK_IDS.includes(block.typeId)) {
                            const d = distance(location, pos);
                            if (d < closestDist) {
                                closestDist = d;
                                closest = { block, pos };
                            }
                        }
                    } catch {}
                }
            }
        }
        return closest;
    }

    /**
     * Deposits carried items into a village chest (Copper Golem style).
     * @param {Entity} villager 
     * @param {Block} chestBlock 
     * @param {object} record 
     */
    performDepositItems(villager, chestBlock, record) {
        if (!villager || !villager.isValid() || !chestBlock || record.carriedItems.length === 0) return false;
        const dim = villager.dimension;
        const pos = chestBlock.location;

        try {
            const rot = getLookRotation(villager.location, { x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 });
            villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
            villager.playAnimation("animation.villager.raise_arms");
        } catch {}

        playSoundSafe(dim, "random.chestopen", pos, { volume: 0.8, pitch: 1.0 });

        // Transfer items into chest container
        try {
            const inv = chestBlock.getComponent("minecraft:inventory");
            const container = inv?.container;

            for (const item of record.carriedItems) {
                let added = false;
                if (container) {
                    try {
                        container.addItem(new ItemStack(item.typeId, item.amount));
                        added = true;
                    } catch {}
                }
                if (!added) {
                    // Fallback: spawn item inside chest location
                    try {
                        dim.spawnItem(new ItemStack(item.typeId, item.amount), {
                            x: pos.x + 0.5,
                            y: pos.y + 0.8,
                            z: pos.z + 0.5
                        });
                    } catch {}
                }
            }
        } catch {}

        playSoundSafe(dim, "random.chestclosed", pos, { volume: 0.8, pitch: 1.0 });
        playSoundSafe(dim, "mob.villager.yes", villager.location, { volume: 0.9, pitch: 1.0 });
        spawnParticleSafe(dim, "minecraft:villager_happy", { x: pos.x + 0.5, y: pos.y + 1.2, z: pos.z + 0.5 });

        // Clear carried items
        record.carriedItems = [];
        return true;
    }

    /**
     * Finds an open solid ground location near the villager suitable for placing a community chest.
     * Orders checks from 1 to 4 blocks away, ensuring close and reachable placement on solid ground.
     * @param {Dimension} dimension 
     * @param {Vector3} location 
     * @param {number} radius 
     */
    findNearbyChestPlacementSpot(dimension, location, radius = 4) {
        if (!dimension || !location) return null;
        const ox = Math.floor(location.x);
        const oy = Math.floor(location.y);
        const oz = Math.floor(location.z);

        const offsets = [];
        for (let r = 1; r <= radius; r++) {
            for (let dx = -r; dx <= r; dx++) {
                for (let dz = -r; dz <= r; dz++) {
                    if (Math.max(Math.abs(dx), Math.abs(dz)) === r) {
                        offsets.push({ dx, dz });
                    }
                }
            }
        }

        for (const off of offsets) {
            for (let dy = -1; dy <= 1; dy++) {
                const groundPos = { x: ox + off.dx, y: oy + dy - 1, z: oz + off.dz };
                const spotPos = { x: ox + off.dx, y: oy + dy, z: oz + off.dz };
                const abovePos = { x: ox + off.dx, y: oy + dy + 1, z: oz + off.dz };

                try {
                    const ground = dimension.getBlock(groundPos);
                    const spot = dimension.getBlock(spotPos);
                    const above = dimension.getBlock(abovePos);

                    if (isSolidGround(ground) && 
                        isReplaceableSpace(spot) && 
                        !spot.typeId.includes("bed") && 
                        !spot.typeId.includes("chest") && 
                        !spot.typeId.includes("door") &&
                        (isReplaceableSpace(above) || above?.isAir)) {
                        return spotPos;
                    }
                } catch {}
            }
        }
        return null;
    }

    /**
     * Places a new community chest and deposits all carried items into it.
     * Sets a 5-minute area cooldown across the 20-block radius so no duplicate chests are placed.
     * @param {Entity} villager 
     * @param {Vector3} spot 
     * @param {object} record 
     */
    performPlaceAndDepositChest(villager, spot, record) {
        if (!villager || !villager.isValid() || !spot) return false;
        const dim = villager.dimension;

        try {
            const rot = getLookRotation(villager.location, spot);
            villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
            const equippable = villager.getComponent("minecraft:equippable");
            equippable?.setEquipment(EquipmentSlot.Mainhand, new ItemStack("minecraft:chest", 1));
            villager.playAnimation("animation.villager.raise_arms");
        } catch {}

        const block = dim.getBlock(spot);
        if (!block || !isReplaceableSpace(block)) return false;

        const placed = setBlockSafe(block, "minecraft:chest") || setBlockSafe(block, "minecraft:barrel");
        if (placed) {
            setAreaChestCooldown(dim, spot, 300000); // 5-minute area cooldown for 20-block grid
            playSoundSafe(dim, "dig.wood", spot, { volume: 0.9, pitch: 1.0 });
            playSoundSafe(dim, "mob.villager.yes", villager.location, { volume: 0.9, pitch: 1.0 });
            spawnParticleSafe(dim, "minecraft:villager_happy", { x: spot.x + 0.5, y: spot.y + 1.0, z: spot.z + 0.5 });
            this.performDepositItems(villager, block, record);
            return true;
        }
        return false;
    }

    /**
     * Autonomous rapid breeding system:
     * When there are more beds than villagers in the village, adult villagers
     * close to each other will quickly breed, ensuring village numbers never deplete!
     * @param {Entity} villager 
     * @param {object} record 
     * @param {Dimension} dim 
     * @param {Vector3} vLoc 
     * @returns {boolean}
     */
    tryPerformQuickBreeding(villager, record, dim, vLoc) {
        if (!villager || !villager.isValid() || record.breedCooldown > 0) return false;

        const localBeds = this.countNearbyBeds(dim, vLoc, EXPANSION_CONFIG.BED_SEARCH_RADIUS);
        const localVillagers = this.countNearbyVillagers(dim, vLoc, EXPANSION_CONFIG.BED_SEARCH_RADIUS);

        // Only breed if surplus beds exist in the village!
        if (localBeds <= localVillagers) return false;

        // Find a nearby adult villager partner within 5.5 blocks
        try {
            let candidates = [];
            try {
                candidates = dim.getEntities({
                    type: "minecraft:villager_v2",
                    location: vLoc,
                    maxDistance: 5.5
                });
            } catch {}

            for (const partner of candidates) {
                if (!partner || !partner.isValid() || partner.id === villager.id) continue;
                if (partner.hasTag("rpc:baby_villager") || partner.hasTag("rpc:recently_bred")) continue;

                // Turn to face each other
                const pLoc = partner.location;
                const rotA = getLookRotation(vLoc, pLoc);
                const rotB = getLookRotation(pLoc, vLoc);
                try {
                    villager.teleport(vLoc, { rotation: { x: 0, y: rotA.y } });
                    partner.teleport(pLoc, { rotation: { x: 0, y: rotB.y } });
                    villager.playAnimation("animation.villager.raise_arms");
                    partner.playAnimation("animation.villager.raise_arms");
                } catch {}

                // Emit heart particles between both parents
                const midX = (vLoc.x + pLoc.x) / 2;
                const midY = (vLoc.y + pLoc.y) / 2 + 0.8;
                const midZ = (vLoc.z + pLoc.z) / 2;

                spawnParticleSafe(dim, "minecraft:heart_particle", { x: midX, y: midY + 0.4, z: midZ });
                spawnParticleSafe(dim, "minecraft:heart_particle", { x: vLoc.x, y: vLoc.y + 1.2, z: vLoc.z });
                spawnParticleSafe(dim, "minecraft:heart_particle", { x: pLoc.x, y: pLoc.y + 1.2, z: pLoc.z });

                playSoundSafe(dim, "mob.villager.yes", vLoc, { volume: 0.9, pitch: 1.1 });
                playSoundSafe(dim, "random.pop", { x: midX, y: midY, z: midZ }, { volume: 0.8, pitch: 1.2 });

                // Spawn baby villager
                try {
                    const baby = dim.spawnEntity("minecraft:villager_v2", { x: midX, y: vLoc.y, z: midZ });
                    if (baby && baby.isValid()) {
                        baby.triggerEvent("minecraft:entity_born");
                        baby.triggerEvent("minecraft:spawn_baby");
                        baby.addTag("rpc:baby_villager");
                        spawnParticleSafe(dim, "minecraft:villager_happy", { x: midX, y: midY + 0.5, z: midZ });
                        spawnParticleSafe(dim, "minecraft:totem_particle", { x: midX, y: midY + 0.6, z: midZ });
                    }
                } catch {
                    try {
                        const legacyBaby = dim.spawnEntity("minecraft:villager", { x: midX, y: vLoc.y, z: midZ });
                        legacyBaby?.triggerEvent("minecraft:spawn_baby");
                        legacyBaby?.addTag("rpc:baby_villager");
                    } catch {}
                }

                // Tag parents and apply breeding cooldown (60s)
                villager.addTag("rpc:recently_bred");
                partner.addTag("rpc:recently_bred");
                record.breedCooldown = EXPANSION_CONFIG.BREED_COOLDOWN_TICKS || 1200;

                const partnerRecord = this.records.get(partner.id);
                if (partnerRecord) {
                    partnerRecord.breedCooldown = EXPANSION_CONFIG.BREED_COOLDOWN_TICKS || 1200;
                }

                // Schedule tag cleanup
                const vId = villager.id;
                const pId = partner.id;
                system.runTimeout(() => {
                    try {
                        const v = dim.getEntities({ location: vLoc, maxDistance: 16 }).find(e => e.id === vId);
                        v?.removeTag("rpc:recently_bred");
                    } catch {}
                    try {
                        const p = dim.getEntities({ location: pLoc, maxDistance: 16 }).find(e => e.id === pId);
                        p?.removeTag("rpc:recently_bred");
                    } catch {}
                }, 1200);

                return true;
            }
        } catch {}

        return false;
    }

    /**
     * Counts nearby beds within radius without skipping any coordinates.
     * @param {Dimension} dimension 
     * @param {Vector3} location 
     * @param {number} radius 
     */
    countNearbyBeds(dimension, location, radius = EXPANSION_CONFIG.BED_SEARCH_RADIUS) {
        if (!dimension || !location) return 0;
        let count = 0;
        const ox = Math.floor(location.x);
        const oy = Math.floor(location.y);
        const oz = Math.floor(location.z);
        const r = Math.min(radius, 12);

        for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
                for (let dy = -2; dy <= 2; dy++) {
                    const pos = { x: ox + dx, y: oy + dy, z: oz + dz };
                    try {
                        const block = dimension.getBlock(pos);
                        if (block && block.typeId === EXPANSION_CONFIG.BED_BLOCK_ID) {
                            count++;
                        }
                    } catch {}
                }
            }
        }
        return Math.ceil(count / 2);
    }

    /**
     * Counts nearby villagers within radius.
     * @param {Dimension} dimension 
     * @param {Vector3} location 
     * @param {number} radius 
     */
    countNearbyVillagers(dimension, location, radius = EXPANSION_CONFIG.BED_SEARCH_RADIUS) {
        if (!dimension || !location) return 1;
        let total = 0;
        try {
            const villagers = dimension.getEntities({
                type: "minecraft:villager_v2",
                location: location,
                maxDistance: radius
            });
            total += villagers.length;
        } catch {}
        try {
            const legacy = dimension.getEntities({
                type: "minecraft:villager",
                location: location,
                maxDistance: radius
            });
            total += legacy.length;
        } catch {}
        return Math.max(1, total);
    }

    /**
     * Finds a spot with 2 adjacent horizontal solid ground blocks and 2 blocks of air headroom above.
     * (Bedrock villagers require 2 blocks headroom above beds to jump and breed!)
     * @param {Dimension} dimension 
     * @param {Vector3} location 
     * @param {number} radius 
     */
    findNearbyBedPlacementSpot(dimension, location, radius = 8) {
        if (!dimension || !location) return null;
        const ox = Math.floor(location.x);
        const oy = Math.floor(location.y);
        const oz = Math.floor(location.z);

        const DIRECTIONS = [
            { dir: 0, dx: 0, dz: 1 },  // South (+Z)
            { dir: 3, dx: 1, dz: 0 },  // East (+X)
            { dir: 2, dx: 0, dz: -1 }, // North (-Z)
            { dir: 1, dx: -1, dz: 0 }  // West (-X)
        ];

        const candidates = [];

        for (let dx = -radius; dx <= radius; dx += 2) {
            for (let dz = -radius; dz <= radius; dz += 2) {
                for (let dy = -1; dy <= 2; dy++) {
                    const footPos = { x: ox + dx, y: oy + dy, z: oz + dz };
                    const gFoot = { x: footPos.x, y: footPos.y - 1, z: footPos.z };

                    try {
                        const bGroundFoot = dimension.getBlock(gFoot);
                        const bFoot = dimension.getBlock(footPos);
                        if (!isSolidGround(bGroundFoot) || !isFreeBedSpace(bFoot)) continue;

                        for (const d of DIRECTIONS) {
                            const headPos = { x: footPos.x + d.dx, y: footPos.y, z: footPos.z + d.dz };
                            const gHead = { x: headPos.x, y: headPos.y - 1, z: headPos.z };

                            const bGroundHead = dimension.getBlock(gHead);
                            const bHead = dimension.getBlock(headPos);
                            if (!isSolidGround(bGroundHead) || !isFreeBedSpace(bHead)) continue;

                            const fH1 = dimension.getBlock({ x: footPos.x, y: footPos.y + 1, z: footPos.z });
                            const fH2 = dimension.getBlock({ x: footPos.x, y: footPos.y + 2, z: footPos.z });
                            const hH1 = dimension.getBlock({ x: headPos.x, y: headPos.y + 1, z: headPos.z });
                            const hH2 = dimension.getBlock({ x: headPos.x, y: headPos.y + 2, z: headPos.z });

                            if (fH1?.isAir && fH2?.isAir && hH1?.isAir && hH2?.isAir) {
                                candidates.push({ footPos, headPos, direction: d.dir });
                                break;
                            }
                        }
                    } catch {}
                }
            }
        }

        if (candidates.length === 0) return null;
        return candidates[Math.floor(Math.random() * candidates.length)];
    }

    /**
     * Places a bed block to expand village breeding capacity.
     * @param {Entity} villager 
     * @param {object} spot 
     */
    performPlaceBed(villager, spot) {
        if (!villager || !villager.isValid() || !spot) return false;
        const dim = villager.dimension;
        const footPos = spot.footPos || spot;

        try {
            const rot = getLookRotation(villager.location, footPos);
            villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
            const equippable = villager.getComponent("minecraft:equippable");
            equippable?.setEquipment(EquipmentSlot.Mainhand, new ItemStack("minecraft:bed", 1));
            villager.playAnimation("animation.villager.raise_arms");
        } catch {}

        let placed = false;
        if (spot.footPos && spot.headPos) {
            placed = placeBedBlock(dim, spot);
        } else {
            const block = dim.getBlock(footPos);
            if (block && isPassableBlock(block)) {
                placed = setBlockSafe(block, EXPANSION_CONFIG.BED_BLOCK_ID);
            }
        }

        if (placed) {
            setAreaBedCooldown(dim, footPos);
            playSoundSafe(dim, "dig.wood", footPos, { volume: 0.9, pitch: 1.0 });
            playSoundSafe(dim, "mob.villager.yes", villager.location, { volume: 0.9, pitch: 1.1 });
            spawnParticleSafe(dim, "minecraft:heart_particle", { x: footPos.x + 0.5, y: footPos.y + 1.2, z: footPos.z + 0.5 });
            spawnParticleSafe(dim, "minecraft:villager_happy", { x: footPos.x + 0.5, y: footPos.y + 1.0, z: footPos.z + 0.5 });
            return true;
        }
        return false;
    }

    /**
     * Checks if a specific workbench (or any village workstation) exists within radius.
     * Scans every coordinate (no skipping) so existing workbenches are accurately identified.
     * @param {Dimension} dimension 
     * @param {Vector3} location 
     * @param {string|null} workbenchTypeId 
     * @param {number} radius 
     * @returns {boolean}
     */
    hasNearbyWorkbench(dimension, location, workbenchTypeId = null, radius = 10) {
        if (!dimension || !location) return false;
        const ox = Math.floor(location.x);
        const oy = Math.floor(location.y);
        const oz = Math.floor(location.z);

        const checkTypes = workbenchTypeId ? [workbenchTypeId] : EXPANSION_CONFIG.WORKBENCH_BLOCK_IDS;

        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                for (let dy = -2; dy <= 2; dy++) {
                    const pos = { x: ox + dx, y: oy + dy, z: oz + dz };
                    try {
                        const block = dimension.getBlock(pos);
                        if (block && checkTypes.includes(block.typeId)) {
                            return true;
                        }
                    } catch {}
                }
            }
        }
        return false;
    }

    /**
     * Finds a spot for placing a village workbench right adjacent to the villager (1 to 3 blocks away).
     * Reliably replaces short grass / snow layer on solid ground without destroying structures.
     * @param {Dimension} dimension 
     * @param {Vector3} location 
     * @param {number} radius 
     */
    findNearbyWorkbenchPlacementSpot(dimension, location, radius = 3) {
        if (!dimension || !location) return null;
        const ox = Math.floor(location.x);
        const oy = Math.floor(location.y);
        const oz = Math.floor(location.z);

        // Offsets sorted by closeness to the villager (checks nearest rings first)
        const offsets = [];
        for (let r = 1; r <= radius; r++) {
            for (let dx = -r; dx <= r; dx++) {
                for (let dz = -r; dz <= r; dz++) {
                    if (Math.max(Math.abs(dx), Math.abs(dz)) === r) {
                        offsets.push({ dx, dz });
                    }
                }
            }
        }

        for (const off of offsets) {
            for (let dy = -1; dy <= 1; dy++) {
                const groundPos = { x: ox + off.dx, y: oy + dy - 1, z: oz + off.dz };
                const spotPos = { x: ox + off.dx, y: oy + dy, z: oz + off.dz };
                const abovePos = { x: ox + off.dx, y: oy + dy + 1, z: oz + off.dz };

                try {
                    const ground = dimension.getBlock(groundPos);
                    const spot = dimension.getBlock(spotPos);
                    const above = dimension.getBlock(abovePos);

                    if (isSolidGround(ground) && 
                        isReplaceableSpace(spot) && 
                        !spot.typeId.includes("bed") && 
                        !spot.typeId.includes("chest") && 
                        !spot.typeId.includes("door") &&
                        (isReplaceableSpace(above) || above?.isAir)) {
                        return spotPos;
                    }
                } catch {}
            }
        }
        return null;
    }

    /**
     * Places a workbench for unemployed or growing villagers.
     * Replaces grass cleanly, equips the workstation in hand, and applies area cooldown.
     * @param {Entity} villager 
     * @param {Vector3} spot 
     * @param {string} workbenchTypeId 
     */
    performPlaceWorkbench(villager, spot, workbenchTypeId) {
        if (!villager || !villager.isValid() || !spot || !workbenchTypeId) return false;
        const dim = villager.dimension;

        try {
            const rot = getLookRotation(villager.location, spot);
            villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
            const equippable = villager.getComponent("minecraft:equippable");
            equippable?.setEquipment(EquipmentSlot.Mainhand, new ItemStack(workbenchTypeId, 1));
            villager.playAnimation("animation.villager.raise_arms");
        } catch {}

        const block = dim.getBlock(spot);
        if (!block || !isReplaceableSpace(block)) return false;

        const placed = setBlockSafe(block, workbenchTypeId);
        if (placed) {
            setAreaWorkbenchCooldown(dim, spot, 60000);
            playSoundSafe(dim, "dig.wood", spot, { volume: 0.9, pitch: 1.0 });
            playSoundSafe(dim, "mob.villager.yes", villager.location, { volume: 0.9, pitch: 1.05 });
            spawnParticleSafe(dim, "minecraft:villager_happy", { x: spot.x + 0.5, y: spot.y + 1.2, z: spot.z + 0.5 });
            return true;
        }
        return false;
    }
}

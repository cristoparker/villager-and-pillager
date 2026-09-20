/**
 * Villager Professions Addon - Village Expansion & Economy Manager (Namespace: rpc)
 * Coordinates:
 * 1. Universal dropped item collection for all villagers (meat, wool, sugarcane, crops, fish, arrows, ingots).
 * 2. Copper Golem-style Chest Organization: depositing collected items into village chests/barrels,
 *    or placing a new community chest if none exists.
 * 3. Village Bed Expansion: placing beds with 2-block headroom in open spaces to enable natural villager breeding.
 * 4. Village Workbench Expansion: placing workstations for new villagers to adopt professions.
 */

import { world, ItemStack, EquipmentSlot } from "@minecraft/server";
import { EXPANSION_CONFIG } from "./config.js";
import { distance, getLookRotation, playSoundSafe, spawnParticleSafe, setBlockSafe } from "./utils.js";

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
        /** @type {Map<string, { state: string, villager: Entity, carriedItems: Array<{ typeId: string, amount: number }>, targetItemEntity: Entity|null, targetChest: any, placementSpot: Vector3|null, targetWorkbenchType: string|null, bedCooldown: number, workbenchCooldown: number, depositCooldown: number, timer: number }>} */
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
            bedCooldown: Math.floor(Math.random() * 600) + 400, // Stagger initial cooldowns
            workbenchCooldown: Math.floor(Math.random() * 800) + 600,
            depositCooldown: 0,
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

                    // 2. PRIORITY 2: If carrying collected goods, search for village chest to deposit (Copper Golem style!)
                    if (record.carriedItems.length > 0 && record.depositCooldown <= 0) {
                        const chest = this.findNearbyChest(dim, vLoc, EXPANSION_CONFIG.CHEST_SEARCH_RADIUS);
                        if (chest) {
                            record.targetChest = chest;
                            const d = distance(vLoc, chest.pos);
                            if (d <= EXPANSION_CONFIG.CHEST_DEPOSIT_DISTANCE) {
                                record.state = ExpansionState.DEPOSITING_CHEST;
                                record.timer = 25;
                            } else {
                                record.state = ExpansionState.APPROACHING_CHEST;
                                record.timer = 120;
                            }
                            break;
                        } else {
                            // No chest found in village: find a spot to build a new community chest!
                            const chestSpot = this.findNearbyChestPlacementSpot(dim, vLoc, 6);
                            if (chestSpot) {
                                record.placementSpot = chestSpot;
                                record.state = ExpansionState.APPROACHING_CHEST_SPOT;
                                record.timer = 100;
                                break;
                            }
                        }
                    }

                    // 3. PRIORITY 3: Village Bed Expansion (Enables Breeding!)
                    // Checks if beds count in vicinity is less than or equal to local villagers count
                    if (record.bedCooldown <= 0 && Math.random() < 0.25) {
                        const localBeds = this.countNearbyBeds(dim, vLoc, EXPANSION_CONFIG.BED_SEARCH_RADIUS);
                        const localVillagers = this.countNearbyVillagers(dim, vLoc, EXPANSION_CONFIG.BED_SEARCH_RADIUS);

                        if (localBeds < localVillagers + EXPANSION_CONFIG.MAX_LOCAL_BEDS_SURPLUS) {
                            const bedSpot = this.findNearbyBedPlacementSpot(dim, vLoc, 8);
                            if (bedSpot) {
                                record.placementSpot = bedSpot;
                                record.state = ExpansionState.APPROACHING_BED_SPOT;
                                record.timer = 100;
                                break;
                            }
                        }
                    }

                    // 4. PRIORITY 4: Village Workbench Expansion (New Jobs for Villagers!)
                    if (record.workbenchCooldown <= 0 && Math.random() < 0.20) {
                        const wbSpot = this.findNearbyWorkbenchPlacementSpot(dim, vLoc, 8);
                        if (wbSpot) {
                            record.placementSpot = wbSpot;
                            // Pick a random workstation
                            const wbList = EXPANSION_CONFIG.WORKBENCH_BLOCK_IDS;
                            record.targetWorkbenchType = wbList[Math.floor(Math.random() * wbList.length)];
                            record.state = ExpansionState.APPROACHING_WORKBENCH_SPOT;
                            record.timer = 100;
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
                if (d <= 2.2) {
                    record.state = ExpansionState.PLACING_CHEST;
                    record.timer = 25;
                    break;
                }

                try {
                    if (record.timer % 10 === 0) {
                        const rot = getLookRotation(vLoc, spot);
                        villager.teleport(vLoc, { rotation: { x: 0, y: rot.y } });
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
                const d = distance(vLoc, spot);
                if (d <= 2.2) {
                    record.state = ExpansionState.PLACING_BED;
                    record.timer = 25;
                    break;
                }

                try {
                    if (record.timer % 10 === 0) {
                        const rot = getLookRotation(vLoc, spot);
                        villager.teleport(vLoc, { rotation: { x: 0, y: rot.y } });
                    }
                    const dx = spot.x + 0.5 - vLoc.x;
                    const dz = spot.z + 0.5 - vLoc.z;
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
                if (d <= 2.2) {
                    record.state = ExpansionState.PLACING_WORKBENCH;
                    record.timer = 25;
                    break;
                }

                try {
                    if (record.timer % 10 === 0) {
                        const rot = getLookRotation(vLoc, spot);
                        villager.teleport(vLoc, { rotation: { x: 0, y: rot.y } });
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
                    record.timer = 40;
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
     * Finds a nearby Chest or Barrel container block.
     * @param {Dimension} dimension 
     * @param {Vector3} location 
     * @param {number} radius 
     */
    findNearbyChest(dimension, location, radius = EXPANSION_CONFIG.CHEST_SEARCH_RADIUS) {
        if (!dimension || !location) return null;
        const ox = Math.floor(location.x);
        const oy = Math.floor(location.y);
        const oz = Math.floor(location.z);

        for (let dx = -radius; dx <= radius; dx += 2) {
            for (let dz = -radius; dz <= radius; dz += 2) {
                for (let dy = -2; dy <= 3; dy++) {
                    const pos = { x: ox + dx, y: oy + dy, z: oz + dz };
                    try {
                        const block = dimension.getBlock(pos);
                        if (block && EXPANSION_CONFIG.CHEST_BLOCK_IDS.includes(block.typeId)) {
                            return { block, pos };
                        }
                    } catch {}
                }
            }
        }
        return null;
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
     * Finds an open solid ground location suitable for placing a community chest.
     * @param {Dimension} dimension 
     * @param {Vector3} location 
     * @param {number} radius 
     */
    findNearbyChestPlacementSpot(dimension, location, radius = 6) {
        if (!dimension || !location) return null;
        const ox = Math.floor(location.x);
        const oy = Math.floor(location.y);
        const oz = Math.floor(location.z);

        for (let dx = -radius; dx <= radius; dx += 2) {
            for (let dz = -radius; dz <= radius; dz += 2) {
                for (let dy = -1; dy <= 2; dy++) {
                    const groundPos = { x: ox + dx, y: oy + dy, z: oz + dz };
                    const airPos = { x: groundPos.x, y: groundPos.y + 1, z: groundPos.z };

                    try {
                        const ground = dimension.getBlock(groundPos);
                        const air = dimension.getBlock(airPos);

                        if (ground && ground.isSolid && !ground.isAir && air && air.isAir) {
                            return airPos;
                        }
                    } catch {}
                }
            }
        }
        return null;
    }

    /**
     * Places a new chest and immediately deposits all carried items into it.
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
            villager.playAnimation("animation.villager.raise_arms");
        } catch {}

        const block = dim.getBlock(spot);
        if (!block || !block.isAir) return false;

        const placed = setBlockSafe(block, "minecraft:chest") || setBlockSafe(block, "minecraft:barrel");
        if (placed) {
            playSoundSafe(dim, "dig.wood", spot, { volume: 0.9, pitch: 1.0 });
            spawnParticleSafe(dim, "minecraft:villager_happy", { x: spot.x + 0.5, y: spot.y + 1.0, z: spot.z + 0.5 });
            this.performDepositItems(villager, block, record);
            return true;
        }
        return false;
    }

    /**
     * Counts nearby beds within radius.
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

        for (let dx = -radius; dx <= radius; dx += 3) {
            for (let dz = -radius; dz <= radius; dz += 3) {
                for (let dy = -2; dy <= 3; dy++) {
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
        return count;
    }

    /**
     * Counts nearby villagers within radius.
     * @param {Dimension} dimension 
     * @param {Vector3} location 
     * @param {number} radius 
     */
    countNearbyVillagers(dimension, location, radius = EXPANSION_CONFIG.BED_SEARCH_RADIUS) {
        if (!dimension || !location) return 1;
        try {
            const villagers = dimension.getEntities({
                type: "minecraft:villager_v2",
                location: location,
                maxDistance: radius
            });
            return villagers.length || 1;
        } catch {
            return 1;
        }
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

        for (let dx = -radius; dx <= radius; dx += 2) {
            for (let dz = -radius; dz <= radius; dz += 2) {
                for (let dy = -1; dy <= 2; dy++) {
                    const g1 = { x: ox + dx, y: oy + dy, z: oz + dz };
                    const g2 = { x: ox + dx + 1, y: oy + dy, z: oz + dz };

                    try {
                        const bGround1 = dimension.getBlock(g1);
                        const bGround2 = dimension.getBlock(g2);
                        if (!bGround1?.isSolid || !bGround2?.isSolid) continue;

                        const a1 = dimension.getBlock({ x: g1.x, y: g1.y + 1, z: g1.z });
                        const a2 = dimension.getBlock({ x: g2.x, y: g2.y + 1, z: g2.z });
                        const h1 = dimension.getBlock({ x: g1.x, y: g1.y + 2, z: g1.z });
                        const h2 = dimension.getBlock({ x: g2.x, y: g2.y + 2, z: g2.z });

                        if (a1?.isAir && a2?.isAir && h1?.isAir && h2?.isAir) {
                            return { x: g1.x, y: g1.y + 1, z: g1.z };
                        }
                    } catch {}
                }
            }
        }
        return null;
    }

    /**
     * Places a bed block to expand village breeding capacity.
     * @param {Entity} villager 
     * @param {Vector3} spot 
     */
    performPlaceBed(villager, spot) {
        if (!villager || !villager.isValid() || !spot) return false;
        const dim = villager.dimension;

        try {
            const rot = getLookRotation(villager.location, spot);
            villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
            villager.playAnimation("animation.villager.raise_arms");
        } catch {}

        const block = dim.getBlock(spot);
        if (!block || !block.isAir) return false;

        const placed = setBlockSafe(block, EXPANSION_CONFIG.BED_BLOCK_ID);
        if (placed) {
            playSoundSafe(dim, "dig.wood", spot, { volume: 0.9, pitch: 1.0 });
            playSoundSafe(dim, "mob.villager.yes", villager.location, { volume: 0.9, pitch: 1.1 });
            spawnParticleSafe(dim, "minecraft:heart_particle", { x: spot.x + 0.5, y: spot.y + 1.2, z: spot.z + 0.5 });
            spawnParticleSafe(dim, "minecraft:villager_happy", { x: spot.x + 0.5, y: spot.y + 1.0, z: spot.z + 0.5 });
            return true;
        }
        return false;
    }

    /**
     * Finds a spot for placing a village workbench.
     * @param {Dimension} dimension 
     * @param {Vector3} location 
     * @param {number} radius 
     */
    findNearbyWorkbenchPlacementSpot(dimension, location, radius = 8) {
        if (!dimension || !location) return null;
        const ox = Math.floor(location.x);
        const oy = Math.floor(location.y);
        const oz = Math.floor(location.z);

        for (let dx = -radius; dx <= radius; dx += 2) {
            for (let dz = -radius; dz <= radius; dz += 2) {
                for (let dy = -1; dy <= 2; dy++) {
                    const g = { x: ox + dx, y: oy + dy, z: oz + dz };
                    const a = { x: g.x, y: g.y + 1, z: g.z };

                    try {
                        const ground = dimension.getBlock(g);
                        const air = dimension.getBlock(a);
                        if (ground?.isSolid && !ground.isAir && air?.isAir) {
                            return a;
                        }
                    } catch {}
                }
            }
        }
        return null;
    }

    /**
     * Places a workbench for unemployed or growing villagers.
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
            villager.playAnimation("animation.villager.raise_arms");
        } catch {}

        const block = dim.getBlock(spot);
        if (!block || !block.isAir) return false;

        const placed = setBlockSafe(block, workbenchTypeId);
        if (placed) {
            playSoundSafe(dim, "dig.wood", spot, { volume: 0.9, pitch: 1.0 });
            playSoundSafe(dim, "mob.villager.yes", villager.location, { volume: 0.9, pitch: 1.05 });
            spawnParticleSafe(dim, "minecraft:villager_happy", { x: spot.x + 0.5, y: spot.y + 1.2, z: spot.z + 0.5 });
            return true;
        }
        return false;
    }
}

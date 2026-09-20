/**
 * Villager Professions Addon - Farmer Behavior Module (Namespace: rpc)
 * Handles iron hoe equipment, ripe crop scanning, authentic harvesting & replanting,
 * composter fertilization routines, and crop drop mechanics.
 */

import { ItemStack, EquipmentSlot, system } from "@minecraft/server";
import { FARMER_CONFIG, FLETCHER_CONFIG } from "./config.js";
import { distance, distance2D, getLookRotation, playSoundSafe, spawnParticleSafe, setBlockSafe, placeBedBlock, isSolidGround, isPassableBlock, isFreeBedSpace } from "./utils.js";
import { notifyDroppedItem } from "./villageExpansionManager.js";

/**
 * Equips iron hoe in the farmer villager's main hand.
 * @param {Entity} villager 
 */
export function equipHoe(villager) {
    if (!villager || !villager.isValid()) return;

    try {
        const equippable = villager.getComponent("minecraft:equippable");
        if (equippable) {
            const current = equippable.getEquipment(EquipmentSlot.Mainhand);
            if (current && current.typeId === FARMER_CONFIG.HOE_ITEM_ID) {
                return;
            }
            try {
                equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack(FARMER_CONFIG.HOE_ITEM_ID, 1));
                return;
            } catch {}
        }
    } catch {}

    try {
        villager.runCommandAsync(`replaceitem entity @s slot.weapon.mainhand 0 ${FARMER_CONFIG.HOE_ITEM_ID}`).catch(() => {});
    } catch {}
}

/**
 * Unequips item from the villager's main hand.
 * @param {Entity} villager 
 */
export function unequipHoe(villager) {
    if (!villager || !villager.isValid()) return;

    try {
        const equippable = villager.getComponent("minecraft:equippable");
        equippable?.setEquipment(EquipmentSlot.Mainhand, undefined);
    } catch {}
}

/**
 * Scans nearby farmland for ripe crops ready for harvesting.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 * @returns {{ block: Block, pos: Vector3, cropDef: any } | null}
 */
export function findNearbyRipeCrop(dimension, location, radius = FARMER_CONFIG.CROP_SEARCH_RADIUS) {
    if (!dimension || !location) return null;

    const startX = Math.floor(location.x);
    const startY = Math.floor(location.y);
    const startZ = Math.floor(location.z);
    const rad = Math.min(radius, 16);

    let closest = null;
    let closestDist = Infinity;

    for (let dx = -rad; dx <= rad; dx += 2) {
        for (let dz = -rad; dz <= rad; dz += 2) {
            for (let dy = -2; dy <= 2; dy++) {
                const pos = { x: startX + dx, y: startY + dy, z: startZ + dz };
                try {
                    const block = dimension.getBlock(pos);
                    if (!block) continue;

                    const typeId = block.typeId;
                    const cropDef = FARMER_CONFIG.CROPS.find(c => c.typeId === typeId);
                    if (!cropDef) continue;

                    const perm = block.permutation;
                    const growth = perm.getState("growth");
                    if (growth === cropDef.maxGrowth || growth === 7) {
                        const d = distance(location, pos);
                        if (d < closestDist) {
                            closestDist = d;
                            closest = { block, pos, cropDef };
                        }
                    }
                } catch {}
            }
        }
    }

    return closest;
}

/**
 * Scans nearby farmland (hoed dirt) that is empty and ready for seeds/crops.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 * @returns {{ farmlandBlock: Block, airBlock: Block, pos: Vector3 } | null}
 */
export function findNearbyEmptyFarmland(dimension, location, radius = FARMER_CONFIG.CROP_SEARCH_RADIUS) {
    if (!dimension || !location) return null;

    const startX = Math.floor(location.x);
    const startY = Math.floor(location.y);
    const startZ = Math.floor(location.z);
    const rad = Math.min(radius, 16);

    let closest = null;
    let closestDist = Infinity;

    for (let dx = -rad; dx <= rad; dx += 2) {
        for (let dz = -rad; dz <= rad; dz += 2) {
            for (let dy = -2; dy <= 2; dy++) {
                const pos = { x: startX + dx, y: startY + dy, z: startZ + dz };
                try {
                    const block = dimension.getBlock(pos);
                    if (!block || block.typeId !== "minecraft:farmland") continue;

                    const airPos = { x: pos.x, y: pos.y + 1, z: pos.z };
                    const airBlock = dimension.getBlock(airPos);
                    if (airBlock && airBlock.isAir) {
                        const d = distance(location, airPos);
                        if (d < closestDist) {
                            closestDist = d;
                            closest = { farmlandBlock: block, airBlock, pos: airPos };
                        }
                    }
                } catch {}
            }
        }
    }

    return closest;
}

/**
 * Plants a crop on hoed dirt (farmland).
 * @param {Entity} villager 
 * @param {{ farmlandBlock: Block, airBlock: Block, pos: Vector3 }} farmlandInfo 
 */
export function performPlantCropOnFarmland(villager, farmlandInfo) {
    if (!villager || !villager.isValid() || !farmlandInfo || !farmlandInfo.pos) return false;

    const dim = villager.dimension;
    const pos = farmlandInfo.pos;

    // Face the farmland
    try {
        const rot = getLookRotation(villager.location, { x: pos.x + 0.5, y: pos.y, z: pos.z + 0.5 });
        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    const crops = FARMER_CONFIG.CROPS;
    const chosenCrop = crops[Math.floor(Math.random() * crops.length)];

    try {
        const block = dim.getBlock(pos);
        if (block && block.isAir) {
            if (setBlockSafe(block, chosenCrop.typeId)) {
                try {
                    const newPerm = block.permutation.withState("growth", 0);
                    block.setPermutation(newPerm);
                } catch {}
                playSoundSafe(dim, "dig.grass", pos, { volume: 0.9, pitch: 1.0 });
                spawnParticleSafe(dim, "minecraft:villager_happy", { x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 });
                return true;
            }
        }
    } catch {}

    return false;
}

/**
 * Scans nearby crops that are not fully grown yet (growth < 7) for bone meal fertilizing.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 * @returns {{ block: Block, pos: Vector3, cropDef: any, currentGrowth: number } | null}
 */
export function findNearbyUngrownCrop(dimension, location, radius = 14) {
    if (!dimension || !location) return null;

    const startX = Math.floor(location.x);
    const startY = Math.floor(location.y);
    const startZ = Math.floor(location.z);
    const rad = Math.min(radius, 16);

    let closest = null;
    let closestDist = Infinity;

    for (let dx = -rad; dx <= rad; dx += 2) {
        for (let dz = -rad; dz <= rad; dz += 2) {
            for (let dy = -2; dy <= 2; dy++) {
                const pos = { x: startX + dx, y: startY + dy, z: startZ + dz };
                try {
                    const block = dimension.getBlock(pos);
                    if (!block) continue;

                    const typeId = block.typeId;
                    const cropDef = FARMER_CONFIG.CROPS.find(c => c.typeId === typeId);
                    if (!cropDef) continue;

                    const perm = block.permutation;
                    const growth = perm.getState("growth");
                    if (typeof growth === "number" && growth < cropDef.maxGrowth && growth < 7) {
                        const d = distance(location, pos);
                        if (d < closestDist) {
                            closestDist = d;
                            closest = { block, pos, cropDef, currentGrowth: growth };
                        }
                    }
                } catch {}
            }
        }
    }

    return closest;
}

/**
 * Applies bone meal to an un-grown crop, advancing its growth stage with sound and particles.
 * @param {Entity} villager 
 * @param {{ block: Block, pos: Vector3, cropDef: any, currentGrowth: number }} cropInfo 
 */
export function performBoneMealCrop(villager, cropInfo) {
    if (!villager || !villager.isValid() || !cropInfo || !cropInfo.block) return false;

    const dim = villager.dimension;
    const pos = cropInfo.pos;

    try {
        const rot = getLookRotation(villager.location, { x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 });
        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    playSoundSafe(dim, "item.bonemeal", pos, { volume: 1.0, pitch: 1.1 });
    spawnParticleSafe(dim, "minecraft:crop_growth_area_emitter", { x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 });
    spawnParticleSafe(dim, "minecraft:villager_happy", { x: pos.x + 0.5, y: pos.y + 0.8, z: pos.z + 0.5 });

    try {
        const cur = typeof cropInfo.currentGrowth === "number" ? cropInfo.currentGrowth : 0;
        const advance = 1 + Math.floor(Math.random() * 2); // advance by 1 or 2 stages
        const newGrowth = Math.min(cropInfo.cropDef.maxGrowth, cur + advance);
        const newPerm = cropInfo.block.permutation.withState("growth", newGrowth);
        cropInfo.block.setPermutation(newPerm);
        return true;
    } catch {}

    return false;
}

/**
 * Finds a nearby composter block.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 * @returns {{ block: Block, pos: Vector3 } | null}
 */
export function findNearbyComposter(dimension, location, radius = 16) {
    if (!dimension || !location) return null;

    const startX = Math.floor(location.x);
    const startY = Math.floor(location.y);
    const startZ = Math.floor(location.z);

    for (let dx = -radius; dx <= radius; dx += 3) {
        for (let dz = -radius; dz <= radius; dz += 3) {
            for (let dy = -2; dy <= 2; dy++) {
                const pos = { x: startX + dx, y: startY + dy, z: startZ + dz };
                try {
                    const block = dimension.getBlock(pos);
                    if (block && block.typeId === FARMER_CONFIG.COMPOSTER_ID) {
                        return { block, pos };
                    }
                } catch {}
            }
        }
    }

    return null;
}

/**
 * Executes authentic harvesting and replanting of a ripe crop.
 * @param {Entity} villager 
 * @param {{ block: Block, pos: Vector3, cropDef: any }} cropInfo 
 */
export function performHarvest(villager, cropInfo) {
    if (!villager || !villager.isValid() || !cropInfo || !cropInfo.block) return false;

    const dim = villager.dimension;
    const block = cropInfo.block;
    const pos = cropInfo.pos;
    const cropDef = cropInfo.cropDef;

    // 1. Turn farmer to face the crop
    try {
        const rot = getLookRotation(villager.location, { x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 });
        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
    } catch {}

    // 2. Play arm raising / hoe swinging animation
    try {
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    // 3. Play crop break sound & particles
    playSoundSafe(dim, "dig.grass", pos, { volume: 0.9, pitch: 1.0 });
    spawnParticleSafe(dim, "minecraft:villager_happy", { x: pos.x + 0.5, y: pos.y + 0.8, z: pos.z + 0.5 });

    // 4. Drop harvested crop produce
    try {
        const dropAmount = 1 + Math.floor(Math.random() * 2);
        const cropDrop = dim.spawnItem(new ItemStack(cropDef.loot, dropAmount), { x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 });
        if (cropDrop) notifyDroppedItem(villager, cropDrop);

        if (cropDef.seed && cropDef.seed !== cropDef.loot) {
            const seedAmount = 1 + Math.floor(Math.random() * 2);
            const seedDrop = dim.spawnItem(new ItemStack(cropDef.seed, seedAmount), { x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 });
            if (seedDrop) notifyDroppedItem(villager, seedDrop);
        }
    } catch {}

    // 5. Replant the crop back at growth 0
    try {
        const newPerm = block.permutation.withState("growth", 0);
        block.setPermutation(newPerm);
        playSoundSafe(dim, "item.bonemeal", pos, { volume: 0.8, pitch: 1.2 });
    } catch {}

    return true;
}

/**
 * Interacts with composter: adds compost materials, emits particles.
 * @param {Entity} villager 
 * @param {{ block: Block, pos: Vector3 }} composterInfo 
 */
export function performCompost(villager, composterInfo) {
    if (!villager || !villager.isValid() || !composterInfo) return false;

    const dim = villager.dimension;
    const pos = composterInfo.pos;

    try {
        const rot = getLookRotation(villager.location, { x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 });
        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    playSoundSafe(dim, "block.composter.fill", pos, { volume: 0.9, pitch: 1.0 });
    spawnParticleSafe(dim, "minecraft:villager_happy", { x: pos.x + 0.5, y: pos.y + 1.0, z: pos.z + 0.5 });

    return true;
}

/**
 * Finds a nearby suitable spot to plant a decorative flower.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 * @returns {{ pos: Vector3 }|null}
 */
export function findNearbyFlowerPlantingSpot(dimension, location, radius = FARMER_CONFIG.FLOWER_SEARCH_RADIUS) {
    if (!dimension || !location) return null;

    const ox = Math.floor(location.x);
    const oy = Math.floor(location.y);
    const oz = Math.floor(location.z);
    const candidates = [];

    for (let dx = -radius; dx <= radius; dx += 2) {
        for (let dz = -radius; dz <= radius; dz += 2) {
            for (let dy = -2; dy <= 2; dy++) {
                const checkPos = { x: ox + dx, y: oy + dy, z: oz + dz };
                try {
                    const ground = dimension.getBlock(checkPos);
                    if (!ground) continue;
                    const gType = ground.typeId;
                    if (gType === "minecraft:grass_block" || gType === "minecraft:dirt" || gType === "minecraft:farmland" || gType === "minecraft:podzol") {
                        const airPos = { x: checkPos.x, y: checkPos.y + 1, z: checkPos.z };
                        const airBlock = dimension.getBlock(airPos);
                        if (airBlock && airBlock.isAir) {
                            candidates.push(airPos);
                        }
                    }
                } catch {}
            }
        }
    }

    if (candidates.length === 0) return null;
    return { pos: candidates[Math.floor(Math.random() * candidates.length)] };
}

/**
 * Plants a random flower at the specified spot.
 * @param {Entity} villager 
 * @param {Vector3} spotPos 
 */
export function performPlantFlower(villager, spotPos) {
    if (!villager || !villager.isValid() || !spotPos) return false;

    const dim = villager.dimension;

    try {
        const rot = getLookRotation(villager.location, spotPos);
        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    const flowers = FARMER_CONFIG.FLOWERS;
    const chosenFlower = flowers[Math.floor(Math.random() * flowers.length)];

    try {
        const block = dim.getBlock(spotPos);
        if (block && block.isAir) {
            if (setBlockSafe(block, chosenFlower)) {
                playSoundSafe(dim, "dig.grass", spotPos, { volume: 0.9, pitch: 1.1 });
                spawnParticleSafe(dim, "minecraft:villager_happy", { x: spotPos.x + 0.5, y: spotPos.y + 0.6, z: spotPos.z + 0.5 });
                return true;
            }
        }
    } catch {}

    return false;
}

/**
 * Finds a nearby suitable spot to plant a tree sapling.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 * @returns {{ pos: Vector3 }|null}
 */
export function findNearbySaplingPlantingSpot(dimension, location, radius = FARMER_CONFIG.SAPLING_SEARCH_RADIUS) {
    if (!dimension || !location) return null;

    const ox = Math.floor(location.x);
    const oy = Math.floor(location.y);
    const oz = Math.floor(location.z);
    const candidates = [];

    for (let dx = -radius; dx <= radius; dx += 3) {
        for (let dz = -radius; dz <= radius; dz += 3) {
            for (let dy = -2; dy <= 2; dy++) {
                const checkPos = { x: ox + dx, y: oy + dy, z: oz + dz };
                try {
                    const ground = dimension.getBlock(checkPos);
                    if (!ground) continue;
                    const gType = ground.typeId;
                    if (gType === "minecraft:grass_block" || gType === "minecraft:dirt" || gType === "minecraft:podzol") {
                        // Check vertical clearance for tree growth (4 blocks above)
                        let clear = true;
                        for (let h = 1; h <= 4; h++) {
                            const b = dimension.getBlock({ x: checkPos.x, y: checkPos.y + h, z: checkPos.z });
                            if (!b || !b.isAir) {
                                clear = false;
                                break;
                            }
                        }
                        if (clear) {
                            candidates.push({ x: checkPos.x, y: checkPos.y + 1, z: checkPos.z });
                        }
                    }
                } catch {}
            }
        }
    }

    if (candidates.length === 0) return null;
    return { pos: candidates[Math.floor(Math.random() * candidates.length)] };
}

/**
 * Plants a random sapling at the specified spot.
 * @param {Entity} villager 
 * @param {Vector3} spotPos 
 */
export function performPlantSapling(villager, spotPos) {
    if (!villager || !villager.isValid() || !spotPos) return false;

    const dim = villager.dimension;

    try {
        const rot = getLookRotation(villager.location, spotPos);
        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    const saplings = FARMER_CONFIG.SAPLINGS;
    const chosenSapling = saplings[Math.floor(Math.random() * saplings.length)];

    try {
        const block = dim.getBlock(spotPos);
        if (block && block.isAir) {
            if (setBlockSafe(block, chosenSapling)) {
                playSoundSafe(dim, "dig.grass", spotPos, { volume: 0.9, pitch: 1.0 });
                spawnParticleSafe(dim, "minecraft:villager_happy", { x: spotPos.x + 0.5, y: spotPos.y + 0.6, z: spotPos.z + 0.5 });
                return true;
            }
        }
    } catch {}

    return false;
}

/**
 * Finds a nearby sapling block.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 * @returns {{ block: Block, pos: Vector3, typeId: string }|null}
 */
export function findNearbySapling(dimension, location, radius = FARMER_CONFIG.BONEMEAL_SEARCH_RADIUS) {
    if (!dimension || !location) return null;

    const ox = Math.floor(location.x);
    const oy = Math.floor(location.y);
    const oz = Math.floor(location.z);

    let closest = null;
    let closestDist = Infinity;

    for (let dx = -radius; dx <= radius; dx += 2) {
        for (let dz = -radius; dz <= radius; dz += 2) {
            for (let dy = -2; dy <= 3; dy++) {
                const pos = { x: ox + dx, y: oy + dy, z: oz + dz };
                try {
                    const block = dimension.getBlock(pos);
                    if (block && block.typeId.includes("sapling")) {
                        const d = distance(location, pos);
                        if (d < closestDist) {
                            closestDist = d;
                            closest = { block, pos, typeId: block.typeId };
                        }
                    }
                } catch {}
            }
        }
    }

    return closest;
}

/**
 * Helper to grow a sapling into a full tree with natural trunk and leaves canopy.
 * @param {Dimension} dimension 
 * @param {Vector3} pos 
 * @param {string} saplingTypeId 
 */
export function growTree(dimension, pos, saplingTypeId) {
    let logType = "minecraft:oak_log";
    let leavesType = "minecraft:oak_leaves";

    if (saplingTypeId.includes("birch")) {
        logType = "minecraft:birch_log";
        leavesType = "minecraft:birch_leaves";
    } else if (saplingTypeId.includes("spruce")) {
        logType = "minecraft:spruce_log";
        leavesType = "minecraft:spruce_leaves";
    } else if (saplingTypeId.includes("cherry")) {
        logType = "minecraft:cherry_log";
        leavesType = "minecraft:cherry_leaves";
    } else if (saplingTypeId.includes("acacia")) {
        logType = "minecraft:acacia_log";
        leavesType = "minecraft:acacia_leaves";
    }

    const treeHeight = 4 + Math.floor(Math.random() * 2);
    const topY = pos.y + treeHeight;

    // Build leaves canopy around top of trunk
    for (let dy = -2; dy <= 1; dy++) {
        const layerY = topY + dy;
        const rad = dy === 1 ? 1 : 2;
        for (let dx = -rad; dx <= rad; dx++) {
            for (let dz = -rad; dz <= rad; dz++) {
                if (Math.abs(dx) === rad && Math.abs(dz) === rad && Math.random() < 0.4) continue;
                const bPos = { x: pos.x + dx, y: layerY, z: pos.z + dz };
                try {
                    const block = dimension.getBlock(bPos);
                    if (block && (block.isAir || block.typeId.includes("sapling"))) {
                        setBlockSafe(block, leavesType);
                    }
                } catch {}
            }
        }
    }

    // Build central log trunk
    for (let h = 0; h <= treeHeight; h++) {
        const logPos = { x: pos.x, y: pos.y + h, z: pos.z };
        try {
            const block = dimension.getBlock(logPos);
            if (block) {
                setBlockSafe(block, logType);
            }
        } catch {}
    }

    playSoundSafe(dimension, "dig.wood", pos, { volume: 1.0, pitch: 1.0 });
    spawnParticleSafe(dimension, "minecraft:villager_happy", { x: pos.x + 0.5, y: pos.y + 2.0, z: pos.z + 0.5 });
}

/**
 * Uses bone meal on a target sapling, promoting growth or generating a tree.
 * @param {Entity} villager 
 * @param {{ block: Block, pos: Vector3, typeId: string }} saplingInfo 
 */
export function performBoneMealSapling(villager, saplingInfo) {
    if (!villager || !villager.isValid() || !saplingInfo || !saplingInfo.block) return false;

    const dim = villager.dimension;
    const pos = saplingInfo.pos;

    try {
        const rot = getLookRotation(villager.location, { x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 });
        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    playSoundSafe(dim, "item.bonemeal", pos, { volume: 1.0, pitch: 1.1 });
    spawnParticleSafe(dim, "minecraft:crop_growth_area_emitter", { x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 });
    spawnParticleSafe(dim, "minecraft:villager_happy", { x: pos.x + 0.5, y: pos.y + 0.8, z: pos.z + 0.5 });

    // Advance sapling stage or grow tree
    try {
        const perm = saplingInfo.block.permutation;
        const currentAge = perm.getState("age_bit");
        if (currentAge === 0) {
            const nextPerm = perm.withState("age_bit", 1);
            saplingInfo.block.setPermutation(nextPerm);
        } else {
            // Already stage 1 or 40% chance -> grow tree!
            growTree(dim, pos, saplingInfo.typeId);
        }
    } catch {
        // Fallback: grow directly
        growTree(dim, pos, saplingInfo.typeId);
    }

    return true;
}

/**
 * Scans nearby entities for hostile monsters threatening the farmer.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 * @returns {Entity|null}
 */
export function findNearbyMonsters(dimension, location, radius = FARMER_CONFIG.MONSTER_SEARCH_RADIUS) {
    if (!dimension || !location) return null;

    let closest = null;
    let closestDist = Infinity;

    for (const hostTypeId of FLETCHER_CONFIG.HOSTILE_TYPES) {
        try {
            const entities = dimension.getEntities({
                type: hostTypeId,
                location: location,
                maxDistance: radius
            });
            for (const entity of entities) {
                if (entity && entity.isValid()) {
                    const health = entity.getComponent("minecraft:health");
                    if (health && health.currentValue <= 0) continue;

                    const d = distance(location, entity.location);
                    if (d < closestDist) {
                        closestDist = d;
                        closest = entity;
                    }
                }
            }
        } catch {}
    }

    return closest;
}

/**
 * Executes authentic melee attack with iron hoe against a threatening monster.
 * @param {Entity} villager 
 * @param {Entity} monster 
 */
export function performAttackMonster(villager, monster) {
    if (!villager || !villager.isValid() || !monster || !monster.isValid()) return false;

    const dim = villager.dimension;
    const mLoc = monster.location;
    const vLoc = villager.location;

    // Face the monster
    try {
        const rot = getLookRotation(vLoc, mLoc);
        villager.teleport(vLoc, { rotation: { x: 0, y: rot.y } });
    } catch {}

    // Swing hoe animation
    try {
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    // Strike sounds & particles
    playSoundSafe(dim, "mob.irongolem.attack", mLoc, { volume: 0.9, pitch: 1.1 });
    playSoundSafe(dim, "damage.hit", mLoc, { volume: 0.9, pitch: 1.0 });
    spawnParticleSafe(dim, "minecraft:crit", { x: mLoc.x, y: mLoc.y + 1.0, z: mLoc.z });

    // Apply damage
    try {
        monster.applyDamage(FARMER_CONFIG.ATTACK_DAMAGE, { damagingEntity: villager });
    } catch {
        try {
            villager.runCommandAsync(`damage @e[type=!villager,type=!villager_v2,type=!player,c=1,r=3] ${FARMER_CONFIG.ATTACK_DAMAGE} entity_attack entity @s`).catch(() => {});
        } catch {}
    }

    // Knockback impulse away from farmer
    try {
        const dx = mLoc.x - vLoc.x;
        const dz = mLoc.z - vLoc.z;
        const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
        monster.applyImpulse({ x: (dx / len) * 0.4, y: 0.25, z: (dz / len) * 0.4 });
    } catch {}

    return true;
}

/**
 * Equips a specific food item (wheat, seeds, carrot) in the farmer's mainhand.
 * @param {Entity} villager 
 * @param {string} foodItemId 
 */
export function equipFoodItem(villager, foodItemId) {
    if (!villager || !villager.isValid() || !foodItemId) return;

    try {
        const equippable = villager.getComponent("minecraft:equippable");
        if (equippable) {
            const current = equippable.getEquipment(EquipmentSlot.Mainhand);
            if (current && current.typeId === foodItemId) {
                return;
            }
            try {
                equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack(foodItemId, 1));
                return;
            } catch {}
        }
    } catch {}

    try {
        villager.runCommandAsync(`replaceitem entity @s slot.weapon.mainhand 0 ${foodItemId}`).catch(() => {});
    } catch {}
}

/**
 * Scans nearby loaded entities for baby cows, sheep, chickens, and pigs to feed and grow.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 * @returns {{ entity: Entity, speciesDef: any, pos: Vector3 } | null}
 */
export function findNearbyBabyAnimals(dimension, location, radius = FARMER_CONFIG.ANIMAL_SEARCH_RADIUS) {
    if (!dimension || !location) return null;

    let closest = null;
    let closestDist = Infinity;

    for (const species of FARMER_CONFIG.BREEDABLE_ANIMALS) {
        try {
            const entities = dimension.getEntities({
                type: species.typeId,
                location: location,
                maxDistance: radius
            });

            for (const entity of entities) {
                if (!entity || !entity.isValid()) continue;

                // Check if the entity is a baby
                let isBaby = false;
                try {
                    if (entity.getComponent("minecraft:is_baby") !== undefined) {
                        isBaby = true;
                    }
                } catch {}

                if (isBaby) {
                    const d = distance(location, entity.location);
                    if (d < closestDist) {
                        closestDist = d;
                        closest = { entity, speciesDef: species, pos: entity.location };
                    }
                }
            }
        } catch {}
    }

    return closest;
}

/**
 * Feeds a baby animal with its favorite food, playing eating sounds, growth particles,
 * and triggering its ageable_grow_up event to accelerate its growth into an adult!
 * @param {Entity} villager 
 * @param {{ entity: Entity, speciesDef: any, pos: Vector3 }} babyInfo 
 */
export function performFeedBabyAnimal(villager, babyInfo) {
    if (!villager || !villager.isValid() || !babyInfo || !babyInfo.entity || !babyInfo.entity.isValid()) return false;

    const dim = villager.dimension;
    const baby = babyInfo.entity;
    const bLoc = baby.location;
    const vLoc = villager.location;

    // Face the baby animal
    try {
        const rot = getLookRotation(vLoc, bLoc);
        villager.teleport(vLoc, { rotation: { x: 0, y: rot.y } });
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    // Play eating sound and growth particle effects
    playSoundSafe(dim, "random.eat", bLoc, { volume: 1.0, pitch: 1.2 });
    spawnParticleSafe(dim, "minecraft:crop_growth_area_emitter", { x: bLoc.x, y: bLoc.y + 0.4, z: bLoc.z });
    spawnParticleSafe(dim, "minecraft:villager_happy", { x: bLoc.x, y: bLoc.y + 0.7, z: bLoc.z });

    // Instantly grow up baby animal into an adult!
    try {
        baby.triggerEvent("minecraft:ageable_grow_up");
    } catch {}

    // Celebratory feedback
    playSoundSafe(dim, "mob.villager.yes", vLoc, { volume: 0.9, pitch: 1.1 });
    spawnParticleSafe(dim, "minecraft:villager_happy", { x: vLoc.x, y: vLoc.y + 1.8, z: vLoc.z });

    return true;
}

/**
 * Scans nearby entities for 2 adult animals of the same species that can breed together.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 * @returns {{ animalA: Entity, animalB: Entity, speciesDef: any, centerPos: Vector3 } | null}
 */
export function findNearbyBreedableAnimalPair(dimension, location, radius = FARMER_CONFIG.ANIMAL_SEARCH_RADIUS) {
    if (!dimension || !location) return null;

    for (const species of FARMER_CONFIG.BREEDABLE_ANIMALS) {
        try {
            const entities = dimension.getEntities({
                type: species.typeId,
                location: location,
                maxDistance: radius
            });

            // Filter for adult entities not on cooldown
            const adults = [];
            for (const entity of entities) {
                if (!entity || !entity.isValid()) continue;

                // Baby check
                let isBaby = false;
                try {
                    if (entity.getComponent("minecraft:is_baby") !== undefined) isBaby = true;
                } catch {}
                if (isBaby) continue;

                // Cooldown check
                try {
                    if (entity.hasTag("rpc:recently_bred")) continue;
                } catch {}

                adults.push(entity);
            }

            // Need at least 2 adults of the same species
            if (adults.length >= 2) {
                // Find two adults that are close to each other (<= 8 blocks apart)
                for (let i = 0; i < adults.length; i++) {
                    for (let j = i + 1; j < adults.length; j++) {
                        const a = adults[i];
                        const b = adults[j];
                        const dBetween = distance(a.location, b.location);
                        if (dBetween <= 8.0) {
                            const midX = (a.location.x + b.location.x) / 2.0;
                            const midY = (a.location.y + b.location.y) / 2.0;
                            const midZ = (a.location.z + b.location.z) / 2.0;
                            return {
                                animalA: a,
                                animalB: b,
                                speciesDef: species,
                                centerPos: { x: midX, y: midY, z: midZ }
                            };
                        }
                    }
                }
            }
        } catch {}
    }

    return null;
}

/**
 * Breeds a pair of adult animals with their favorite food, emitting heart particles,
 * eating sounds, and spawning a baby offspring.
 * @param {Entity} villager 
 * @param {{ animalA: Entity, animalB: Entity, speciesDef: any, centerPos: Vector3 }} breedPairInfo 
 */
export function performBreedAnimals(villager, breedPairInfo) {
    if (!villager || !villager.isValid() || !breedPairInfo) return false;
    const { animalA, animalB, speciesDef, centerPos } = breedPairInfo;
    if (!animalA || !animalA.isValid() || !animalB || !animalB.isValid()) return false;

    const dim = villager.dimension;
    const vLoc = villager.location;

    // Face the breeding pair
    try {
        const rot = getLookRotation(vLoc, centerPos);
        villager.teleport(vLoc, { rotation: { x: 0, y: rot.y } });
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    // Feed sounds on both parents
    playSoundSafe(dim, "random.eat", animalA.location, { volume: 1.0, pitch: 1.0 });
    playSoundSafe(dim, "random.eat", animalB.location, { volume: 1.0, pitch: 1.0 });

    // Love hearts on both parents!
    spawnParticleSafe(dim, "minecraft:heart_particle", { x: animalA.location.x, y: animalA.location.y + 1.2, z: animalA.location.z });
    spawnParticleSafe(dim, "minecraft:heart_particle", { x: animalB.location.x, y: animalB.location.y + 1.2, z: animalB.location.z });

    // Add breeding cooldown tags (60s cooldown)
    try { animalA.addTag("rpc:recently_bred"); } catch {}
    try { animalB.addTag("rpc:recently_bred"); } catch {}
    system.runTimeout(() => {
        try { if (animalA.isValid()) animalA.removeTag("rpc:recently_bred"); } catch {}
        try { if (animalB.isValid()) animalB.removeTag("rpc:recently_bred"); } catch {}
    }, 1200);

    // Spawn the baby animal between the parents!
    try {
        const babyPos = {
            x: (animalA.location.x + animalB.location.x) / 2.0,
            y: (animalA.location.y + animalB.location.y) / 2.0,
            z: (animalA.location.z + animalB.location.z) / 2.0
        };
        const baby = dim.spawnEntity(speciesDef.typeId, babyPos);
        if (baby && baby.isValid()) {
            try {
                baby.triggerEvent("minecraft:entity_born");
            } catch {}
            spawnParticleSafe(dim, "minecraft:heart_particle", { x: babyPos.x, y: babyPos.y + 0.6, z: babyPos.z });
            spawnParticleSafe(dim, "minecraft:villager_happy", { x: babyPos.x, y: babyPos.y + 0.6, z: babyPos.z });
            playSoundSafe(dim, "random.pop", babyPos, { volume: 0.9, pitch: 1.4 });
        }
    } catch (e) {
        console.warn(`[Farmer] Error spawning baby ${speciesDef.typeId}: ${e}`);
    }

    // Farmer satisfaction feedback
    playSoundSafe(dim, "mob.villager.yes", vLoc, { volume: 0.9, pitch: 1.05 });
    spawnParticleSafe(dim, "minecraft:villager_happy", { x: vLoc.x, y: vLoc.y + 1.8, z: vLoc.z });

    return true;
}

/**
 * Equips an item in the villager's main hand.
 * @param {Entity} villager 
 * @param {string} itemTypeId 
 */
export function equipItem(villager, itemTypeId) {
    if (!villager || !villager.isValid() || !itemTypeId) return;

    try {
        const equippable = villager.getComponent("minecraft:equippable");
        if (equippable) {
            const current = equippable.getEquipment(EquipmentSlot.Mainhand);
            if (current && current.typeId === itemTypeId) {
                return;
            }
            try {
                equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack(itemTypeId, 1));
                return;
            } catch {}
        }
    } catch {}

    try {
        villager.runCommandAsync(`replaceitem entity @s slot.weapon.mainhand 0 ${itemTypeId}`).catch(() => {});
    } catch {}
}

/**
 * Scans nearby loaded blocks for a chest or barrel container.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 * @returns {{ block: Block, pos: Vector3 } | null}
 */
export function findNearbyChest(dimension, location, radius = FARMER_CONFIG.CHEST_SEARCH_RADIUS) {
    if (!dimension || !location) return null;
    const ox = Math.floor(location.x);
    const oy = Math.floor(location.y);
    const oz = Math.floor(location.z);
    const r = Math.min(radius, 20);
    const chestIds = FARMER_CONFIG.CHEST_BLOCK_IDS;

    let closest = null;
    let closestDist = Infinity;

    for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
            for (let dy = -2; dy <= 3; dy++) {
                const pos = { x: ox + dx, y: oy + dy, z: oz + dz };
                try {
                    const block = dimension.getBlock(pos);
                    if (block && chestIds.includes(block.typeId)) {
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
 * Finds a suitable flat ground spot near the farmer to erect a community farm chest.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 * @returns {{ pos: Vector3 } | null}
 */
export function findNearbyChestPlacementSpot(dimension, location, radius = 4) {
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
                    return { pos: spotPos };
                }
            } catch {}
        }
    }
    return null;
}

/**
 * Equips and places a village/farm community chest, depositing harvested produce into it.
 * @param {Entity} villager 
 * @param {Vector3} spotPos 
 */
export function performPlaceChest(villager, spotPos) {
    if (!villager || !villager.isValid() || !spotPos) return false;
    const dim = villager.dimension;

    try {
        const rot = getLookRotation(villager.location, spotPos);
        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
        equipItem(villager, "minecraft:chest");
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    const block = dim.getBlock(spotPos);
    if (!block || !isPassableBlock(block)) return false;

    const placed = setBlockSafe(block, "minecraft:chest") || setBlockSafe(block, "minecraft:barrel");
    if (placed) {
        playSoundSafe(dim, "dig.wood", spotPos, { volume: 0.9, pitch: 1.0 });
        playSoundSafe(dim, "mob.villager.yes", villager.location, { volume: 0.9, pitch: 1.0 });
        spawnParticleSafe(dim, "minecraft:villager_happy", { x: spotPos.x + 0.5, y: spotPos.y + 1.0, z: spotPos.z + 0.5 });

        // Deposit starter harvested farm goods into the newly placed community chest
        try {
            const inv = block.getComponent("minecraft:inventory");
            const container = inv?.container;
            if (container) {
                const crops = ["minecraft:wheat", "minecraft:carrot", "minecraft:potato", "minecraft:bread", "minecraft:wheat_seeds"];
                const loot = crops[Math.floor(Math.random() * crops.length)];
                container.addItem(new ItemStack(loot, Math.floor(Math.random() * 3) + 2));
            }
        } catch {}

        return true;
    }
    return false;
}

/**
 * Deposits harvested farm crops into an existing village chest or barrel.
 * @param {Entity} villager 
 * @param {Block} chestBlock 
 */
export function performDepositCropIntoChest(villager, chestBlock) {
    if (!villager || !villager.isValid() || !chestBlock) return false;
    const dim = villager.dimension;
    const pos = chestBlock.location;

    try {
        const rot = getLookRotation(villager.location, { x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 });
        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
        const crops = ["minecraft:wheat", "minecraft:carrot", "minecraft:potato", "minecraft:beetroot"];
        equipItem(villager, crops[Math.floor(Math.random() * crops.length)]);
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    playSoundSafe(dim, "random.chestopen", pos, { volume: 0.8, pitch: 1.0 });

    try {
        const inv = chestBlock.getComponent("minecraft:inventory");
        const container = inv?.container;
        if (container) {
            const cropList = ["minecraft:wheat", "minecraft:carrot", "minecraft:potato", "minecraft:beetroot", "minecraft:wheat_seeds"];
            const chosen = cropList[Math.floor(Math.random() * cropList.length)];
            container.addItem(new ItemStack(chosen, Math.floor(Math.random() * 2) + 1));
        }
    } catch {}

    playSoundSafe(dim, "random.chestclosed", pos, { volume: 0.8, pitch: 1.0 });
    playSoundSafe(dim, "mob.villager.yes", villager.location, { volume: 0.9, pitch: 1.05 });
    spawnParticleSafe(dim, "minecraft:villager_happy", { x: pos.x + 0.5, y: pos.y + 1.2, z: pos.z + 0.5 });

    return true;
}

/**
 * Finds an open spot adjacent or within 1-3 blocks of an existing chest.
 * @param {Dimension} dimension 
 * @param {Vector3} chestPos 
 * @param {number} radius 
 * @returns {{ block: Block, pos: Vector3 } | null}
 */
export function findNearbyChestPlacementSpotNearExisting(dimension, chestPos, radius = 3) {
    if (!dimension || !chestPos) return null;
    const ox = Math.floor(chestPos.x);
    const oy = Math.floor(chestPos.y);
    const oz = Math.floor(chestPos.z);
    const candidates = [];

    for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
            if (dx === 0 && dz === 0) continue;
            for (let dy = -1; dy <= 1; dy++) {
                const pos = { x: ox + dx, y: oy + dy, z: oz + dz };
                const gPos = { x: pos.x, y: pos.y - 1, z: pos.z };
                const aPos = { x: pos.x, y: pos.y + 1, z: pos.z };

                try {
                    const block = dimension.getBlock(pos);
                    const ground = dimension.getBlock(gPos);
                    const above = dimension.getBlock(aPos);

                    if (isSolidGround(ground) && isPassableBlock(block) && isPassableBlock(above)) {
                        candidates.push({ block, pos });
                    }
                } catch {}
            }
        }
    }

    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
}

/**
 * Counts existing beds in vicinity accurately without skipping coordinates.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 */
export function countNearbyBeds(dimension, location, radius = FARMER_CONFIG.BED_SEARCH_RADIUS) {
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
                    if (block && block.typeId === "minecraft:bed") {
                        count++;
                    }
                } catch {}
            }
        }
    }
    return Math.ceil(count / 2);
}

/**
 * Counts villagers within radius.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 */
export function countNearbyVillagers(dimension, location, radius = FARMER_CONFIG.BED_SEARCH_RADIUS) {
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
 * Scans for a flat 2-block ground spot with 2-block clear headroom for placing a bed.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 * @returns {{ footPos: Vector3, headPos: Vector3, direction: number } | null}
 */
export function findNearbyBedPlacementSpot(dimension, location, radius = 8) {
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
                    if (!isSolidGround(bGroundFoot) || bGroundFoot.typeId.includes("bed") || !isFreeBedSpace(bFoot)) continue;

                    for (const d of DIRECTIONS) {
                        const headPos = { x: footPos.x + d.dx, y: footPos.y, z: footPos.z + d.dz };
                        const gHead = { x: headPos.x, y: headPos.y - 1, z: headPos.z };

                        const bGroundHead = dimension.getBlock(gHead);
                        const bHead = dimension.getBlock(headPos);
                        if (!isSolidGround(bGroundHead) || bGroundHead.typeId.includes("bed") || !isFreeBedSpace(bHead)) continue;

                        // Check 2 blocks clear headroom above foot and head
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
 * Places a complete 2-block Bedrock bed with authentic orientation, sound, and particles.
 * Guaranteed to never replace existing furniture or blocks.
 * @param {Entity} villager 
 * @param {{ footPos: Vector3, headPos: Vector3, direction: number }} bedSpot 
 */
export function performPlaceBed(villager, bedSpot) {
    if (!villager || !villager.isValid() || !bedSpot) return false;
    const dim = villager.dimension;
    const { footPos } = bedSpot;

    try {
        const rot = getLookRotation(villager.location, footPos);
        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
        equipItem(villager, "minecraft:bed");
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    const placed = placeBedBlock(dim, bedSpot);
    if (placed) {
        playSoundSafe(dim, "dig.wood", footPos, { volume: 0.9, pitch: 1.0 });
        playSoundSafe(dim, "mob.villager.yes", villager.location, { volume: 0.9, pitch: 1.1 });
        spawnParticleSafe(dim, "minecraft:heart_particle", { x: footPos.x + 0.5, y: footPos.y + 1.2, z: footPos.z + 0.5 });
        spawnParticleSafe(dim, "minecraft:villager_happy", { x: footPos.x + 0.5, y: footPos.y + 1.0, z: footPos.z + 0.5 });
        return true;
    }
    return false;
}

/**
 * Finds a nearby villager to share food with (bread or carrots) to boost breeding and village population.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 * @returns {Entity|null}
 */
/**
 * Scans nearby villagers to find one needing food.
 * Rotates through all villagers so the farmer gives free bread to everyone!
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 * @returns {Entity|null}
 */
export function findNearbyVillagersToFeed(dimension, location, radius = FARMER_CONFIG.FOOD_SHARE_RADIUS || 16) {
    if (!dimension || !location) return null;
    try {
        let villagers = [];
        try {
            villagers = dimension.getEntities({
                type: "minecraft:villager_v2",
                location: location,
                maxDistance: radius
            });
        } catch {}
        try {
            const leg = dimension.getEntities({
                type: "minecraft:villager",
                location: location,
                maxDistance: radius
            });
            if (leg && leg.length > 0) villagers = villagers.concat(leg);
        } catch {}

        let fallbackCandidate = null;
        for (const v of villagers) {
            if (!v || !v.isValid()) continue;
            const d = distance(location, v.location);
            if (d > 0.8) { // Not self
                if (!v.hasTag("rpc:recently_fed_bread")) {
                    return v; // Found an unfed villager!
                }
                if (!fallbackCandidate) fallbackCandidate = v;
            }
        }
        return fallbackCandidate;
    } catch {}
    return null;
}

/**
 * Drops free bread to a nearby villager, playing toss animations, sounds, and heart particles.
 * Ensures the recipient has enough bread (>= 3) to trigger Minecraft's own native breeding system!
 * @param {Entity} farmer 
 * @param {Entity} recipient 
 */
export function performShareFoodWithVillager(farmer, recipient) {
    if (!farmer || !farmer.isValid() || !recipient || !recipient.isValid()) return false;
    const dim = farmer.dimension;
    const fLoc = farmer.location;
    const rLoc = recipient.location;

    // Face each other
    try {
        const rotF = getLookRotation(fLoc, rLoc);
        const rotR = getLookRotation(rLoc, fLoc);
        farmer.teleport(fLoc, { rotation: { x: 0, y: rotF.y } });
        recipient.teleport(rLoc, { rotation: { x: 0, y: rotR.y } });
        equipItem(farmer, "minecraft:bread");
        farmer.playAnimation("animation.villager.raise_arms");
    } catch {}

    // Drop bread visually between them
    try {
        const dropPos = {
            x: fLoc.x + (rLoc.x - fLoc.x) * 0.5,
            y: fLoc.y + 0.6,
            z: fLoc.z + (rLoc.z - fLoc.z) * 0.5
        };
        dim.spawnItem(new ItemStack("minecraft:bread", 2), dropPos);
    } catch {}

    // Deposit 4 breads into recipient's inventory container (vanilla Minecraft requires 3 bread to breed!)
    try {
        const inv = recipient.getComponent("minecraft:inventory");
        inv?.container?.addItem(new ItemStack("minecraft:bread", 4));
    } catch {}

    // Also ensure farmer has bread for breeding
    try {
        const fInv = farmer.getComponent("minecraft:inventory");
        fInv?.container?.addItem(new ItemStack("minecraft:bread", 4));
    } catch {}

    // Tag recipient so farmer feeds others next
    try {
        recipient.addTag("rpc:recently_fed_bread");
        system.runTimeout(() => {
            try {
                if (recipient.isValid()) recipient.removeTag("rpc:recently_fed_bread");
            } catch {}
        }, 300); // 15 seconds
    } catch {}

    playSoundSafe(dim, "random.pop", rLoc, { volume: 0.9, pitch: 1.1 });
    playSoundSafe(dim, "mob.villager.yes", fLoc, { volume: 0.9, pitch: 1.0 });

    // Display breeding love hearts!
    spawnParticleSafe(dim, "minecraft:heart_particle", { x: rLoc.x, y: rLoc.y + 1.2, z: rLoc.z });
    spawnParticleSafe(dim, "minecraft:heart_particle", { x: fLoc.x, y: fLoc.y + 1.2, z: fLoc.z });
    spawnParticleSafe(dim, "minecraft:villager_happy", { x: rLoc.x, y: rLoc.y + 1.0, z: rLoc.z });

    return true;
}

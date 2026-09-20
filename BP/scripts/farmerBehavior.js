/**
 * Villager Professions Addon - Farmer Behavior Module (Namespace: rpc)
 * Handles iron hoe equipment, ripe crop scanning, authentic harvesting & replanting,
 * composter fertilization routines, and crop drop mechanics.
 */

import { ItemStack, EquipmentSlot } from "@minecraft/server";
import { FARMER_CONFIG, FLETCHER_CONFIG } from "./config.js";
import { distance, distance2D, getLookRotation, playSoundSafe, spawnParticleSafe, setBlockSafe } from "./utils.js";

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
        dim.spawnItem(new ItemStack(cropDef.loot, dropAmount), { x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 });
        if (cropDef.seed && cropDef.seed !== cropDef.loot) {
            const seedAmount = 1 + Math.floor(Math.random() * 2);
            dim.spawnItem(new ItemStack(cropDef.seed, seedAmount), { x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 });
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

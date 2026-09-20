/**
 * Villager Professions Addon - Farmer Behavior Module (Namespace: rpc)
 * Handles iron hoe equipment, ripe crop scanning, authentic harvesting & replanting,
 * composter fertilization routines, and crop drop mechanics.
 */

import { ItemStack, EquipmentSlot } from "@minecraft/server";
import { FARMER_CONFIG } from "./config.js";
import { distance, distance2D, getLookRotation, playSoundSafe, spawnParticleSafe } from "./utils.js";

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

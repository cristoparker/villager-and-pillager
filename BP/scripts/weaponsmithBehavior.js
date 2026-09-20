/**
 * Villager Professions Addon - Weaponsmith Behavior Module (Namespace: rpc)
 * Coordinates iron sword equipment, grindstone sharpening routines,
 * defensive rallying, and combat maintenance.
 */

import { ItemStack, EquipmentSlot } from "@minecraft/server";
import { WEAPONSMITH_CONFIG, FLETCHER_CONFIG } from "./config.js";
import { distance, getLookRotation, playSoundSafe, spawnParticleSafe } from "./utils.js";

/**
 * Equips iron sword in the weaponsmith's main hand.
 * @param {Entity} villager 
 */
export function equipSword(villager) {
    if (!villager || !villager.isValid()) return;

    try {
        const equippable = villager.getComponent("minecraft:equippable");
        if (equippable) {
            const current = equippable.getEquipment(EquipmentSlot.Mainhand);
            if (current && current.typeId === WEAPONSMITH_CONFIG.SWORD_ITEM_ID) {
                return;
            }
            try {
                equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack(WEAPONSMITH_CONFIG.SWORD_ITEM_ID, 1));
                return;
            } catch {}
        }
    } catch {}

    try {
        villager.runCommandAsync(`replaceitem entity @s slot.weapon.mainhand 0 ${WEAPONSMITH_CONFIG.SWORD_ITEM_ID}`).catch(() => {});
    } catch {}
}

/**
 * Unequips item from the villager's main hand.
 * @param {Entity} villager 
 */
export function unequipSword(villager) {
    if (!villager || !villager.isValid()) return;

    try {
        const equippable = villager.getComponent("minecraft:equippable");
        equippable?.setEquipment(EquipmentSlot.Mainhand, undefined);
    } catch {}
}

/**
 * Finds a nearby Grindstone block.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 * @returns {{ block: Block, pos: Vector3 } | null}
 */
export function findNearbyGrindstone(dimension, location, radius = WEAPONSMITH_CONFIG.GRINDSTONE_SEARCH_RADIUS) {
    if (!dimension || !location) return null;

    const startX = Math.floor(location.x);
    const startY = Math.floor(location.y);
    const startZ = Math.floor(location.z);

    for (let dx = -radius; dx <= radius; dx += 2) {
        for (let dz = -radius; dz <= radius; dz += 2) {
            for (let dy = -2; dy <= 2; dy++) {
                const pos = { x: startX + dx, y: startY + dy, z: startZ + dz };
                try {
                    const block = dimension.getBlock(pos);
                    if (block && block.typeId === WEAPONSMITH_CONFIG.GRINDSTONE_ID) {
                        return { block, pos };
                    }
                } catch {}
            }
        }
    }

    return null;
}

/**
 * Scans for hostile monsters threatening the village.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 * @returns {Entity|null}
 */
export function findNearbyMonsters(dimension, location, radius = WEAPONSMITH_CONFIG.MONSTER_SEARCH_RADIUS) {
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
 * Performs grindstone sharpening: sparks, grindstone sound, arm swing, and strength buff.
 * @param {Entity} villager 
 * @param {{ block: Block, pos: Vector3 }} grindstoneInfo 
 */
export function performSharpen(villager, grindstoneInfo) {
    if (!villager || !villager.isValid() || !grindstoneInfo) return false;

    const dim = villager.dimension;
    const pos = grindstoneInfo.pos;

    try {
        const rot = getLookRotation(villager.location, { x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 });
        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    playSoundSafe(dim, "block.grindstone.use", pos, { volume: 1.0, pitch: 1.0 });
    spawnParticleSafe(dim, "minecraft:crit", { x: pos.x + 0.5, y: pos.y + 0.8, z: pos.z + 0.5 });

    // Buff the weaponsmith with slight strength/regeneration
    try {
        villager.addEffect("strength", 200, { amplifier: 1, showParticles: false });
    } catch {}

    return true;
}

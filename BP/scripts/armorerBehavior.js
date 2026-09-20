/**
 * Villager Professions Addon - Armorer Behavior Module (Namespace: rpc)
 * Coordinates iron ingot equipment, damaged Iron Golem detection & repairs,
 * blast furnace forging routines, and protective maintenance.
 */

import { ItemStack, EquipmentSlot } from "@minecraft/server";
import { ARMORER_CONFIG } from "./config.js";
import { distance, getLookRotation, playSoundSafe, spawnParticleSafe } from "./utils.js";

/**
 * Equips iron ingot in armorer's main hand.
 * @param {Entity} villager 
 */
export function equipIngot(villager) {
    if (!villager || !villager.isValid()) return;

    try {
        const equippable = villager.getComponent("minecraft:equippable");
        if (equippable) {
            const current = equippable.getEquipment(EquipmentSlot.Mainhand);
            if (current && current.typeId === ARMORER_CONFIG.INGOT_ITEM_ID) {
                return;
            }
            try {
                equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack(ARMORER_CONFIG.INGOT_ITEM_ID, 1));
                return;
            } catch {}
        }
    } catch {}

    try {
        villager.runCommandAsync(`replaceitem entity @s slot.weapon.mainhand 0 ${ARMORER_CONFIG.INGOT_ITEM_ID}`).catch(() => {});
    } catch {}
}

/**
 * Unequips item from main hand.
 * @param {Entity} villager 
 */
export function unequipIngot(villager) {
    if (!villager || !villager.isValid()) return;

    try {
        const equippable = villager.getComponent("minecraft:equippable");
        equippable?.setEquipment(EquipmentSlot.Mainhand, undefined);
    } catch {}
}

/**
 * Finds damaged Iron Golems nearby.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 * @returns {Entity|null}
 */
export function findNearbyDamagedGolem(dimension, location, radius = ARMORER_CONFIG.GOLEM_SEARCH_RADIUS) {
    if (!dimension || !location) return null;

    try {
        const golems = dimension.getEntities({
            type: "minecraft:iron_golem",
            location: location,
            maxDistance: radius
        });

        for (const golem of golems) {
            if (!golem || !golem.isValid()) continue;
            const health = golem.getComponent("minecraft:health");
            if (health && health.currentValue < health.effectiveMax * 0.9) {
                return golem;
            }
        }
    } catch {}

    return null;
}

/**
 * Finds a nearby Blast Furnace block.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 * @returns {{ block: Block, pos: Vector3 } | null}
 */
export function findNearbyBlastFurnace(dimension, location, radius = 16) {
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
                    if (block && block.typeId === ARMORER_CONFIG.BLAST_FURNACE_ID) {
                        return { block, pos };
                    }
                } catch {}
            }
        }
    }

    return null;
}

/**
 * Repairs a damaged Iron Golem with authentic anvil clink and particles.
 * @param {Entity} villager 
 * @param {Entity} golem 
 */
export function performRepairGolem(villager, golem) {
    if (!villager || !villager.isValid() || !golem || !golem.isValid()) return false;

    const dim = villager.dimension;
    const golemLoc = golem.location;

    try {
        const rot = getLookRotation(villager.location, golemLoc);
        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    playSoundSafe(dim, "random.anvil_use", golemLoc, { volume: 1.0, pitch: 1.0 });
    spawnParticleSafe(dim, "minecraft:villager_happy", { x: golemLoc.x, y: golemLoc.y + 1.5, z: golemLoc.z });

    // Restore 25 health to the golem
    try {
        const health = golem.getComponent("minecraft:health");
        if (health) {
            health.setCurrentValue(Math.min(health.effectiveMax, health.currentValue + 25));
        }
    } catch {
        try {
            golem.addEffect("instant_health", 20, { amplifier: 1, showParticles: false });
        } catch {}
    }

    return true;
}

/**
 * Forges armor at blast furnace.
 * @param {Entity} villager 
 * @param {{ block: Block, pos: Vector3 }} blastFurnaceInfo 
 */
export function performForgeArmor(villager, blastFurnaceInfo) {
    if (!villager || !villager.isValid() || !blastFurnaceInfo) return false;

    const dim = villager.dimension;
    const pos = blastFurnaceInfo.pos;

    try {
        const rot = getLookRotation(villager.location, { x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 });
        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    playSoundSafe(dim, "fire.fire", pos, { volume: 0.9, pitch: 1.0 });
    playSoundSafe(dim, "random.anvil_land", pos, { volume: 0.6, pitch: 1.5 });
    spawnParticleSafe(dim, "minecraft:villager_happy", { x: pos.x + 0.5, y: pos.y + 1.0, z: pos.z + 0.5 });

    return true;
}

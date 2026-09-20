/**
 * Villager Professions Addon - Cleric Behavior Module (Namespace: rpc)
 * Coordinates splash potion equipment, injured ally detection (villagers, iron golems, players),
 * healing rituals, and brewing stand interactions.
 */

import { ItemStack, EquipmentSlot } from "@minecraft/server";
import { CLERIC_CONFIG } from "./config.js";
import { distance, getLookRotation, playSoundSafe, spawnParticleSafe } from "./utils.js";

/**
 * Equips potion or splash potion in the cleric's main hand.
 * @param {Entity} villager 
 */
export function equipPotion(villager) {
    if (!villager || !villager.isValid()) return;

    try {
        const equippable = villager.getComponent("minecraft:equippable");
        if (equippable) {
            const current = equippable.getEquipment(EquipmentSlot.Mainhand);
            if (current && (current.typeId === CLERIC_CONFIG.SPLASH_POTION_ITEM_ID || current.typeId === CLERIC_CONFIG.POTION_ITEM_ID)) {
                return;
            }
            try {
                equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack(CLERIC_CONFIG.SPLASH_POTION_ITEM_ID, 1));
                return;
            } catch {
                try {
                    equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack(CLERIC_CONFIG.POTION_ITEM_ID, 1));
                    return;
                } catch {}
            }
        }
    } catch {}

    try {
        villager.runCommandAsync(`replaceitem entity @s slot.weapon.mainhand 0 ${CLERIC_CONFIG.SPLASH_POTION_ITEM_ID}`).catch(() => {
            villager.runCommandAsync(`replaceitem entity @s slot.weapon.mainhand 0 ${CLERIC_CONFIG.POTION_ITEM_ID}`).catch(() => {});
        });
    } catch {}
}

/**
 * Unequips potion from main hand.
 * @param {Entity} villager 
 */
export function unequipPotion(villager) {
    if (!villager || !villager.isValid()) return;

    try {
        const equippable = villager.getComponent("minecraft:equippable");
        equippable?.setEquipment(EquipmentSlot.Mainhand, undefined);
    } catch {}
}

/**
 * Scans nearby entities for injured allies (other villagers, iron golems, or players).
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 * @returns {Entity|null}
 */
export function findNearbyInjuredAlly(dimension, location, radius = CLERIC_CONFIG.ALLIED_SEARCH_RADIUS) {
    if (!dimension || !location) return null;

    const allyTypes = [
        "minecraft:villager_v2",
        "minecraft:villager",
        "minecraft:iron_golem",
        "minecraft:player"
    ];

    let mostInjured = null;
    let lowestHealthRatio = 0.95; // Must have lost at least 5% health

    for (const typeId of allyTypes) {
        try {
            const entities = dimension.getEntities({
                type: typeId,
                location: location,
                maxDistance: radius
            });

            for (const entity of entities) {
                if (!entity || !entity.isValid()) continue;

                const healthComp = entity.getComponent("minecraft:health");
                if (healthComp && healthComp.currentValue < healthComp.effectiveMax) {
                    const ratio = healthComp.currentValue / healthComp.effectiveMax;
                    if (ratio < lowestHealthRatio) {
                        lowestHealthRatio = ratio;
                        mostInjured = entity;
                    }
                }
            }
        } catch {}
    }

    return mostInjured;
}

/**
 * Finds a nearby Brewing Stand block.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 * @returns {{ block: Block, pos: Vector3 } | null}
 */
export function findNearbyBrewingStand(dimension, location, radius = 16) {
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
                    if (block && block.typeId === CLERIC_CONFIG.BREWING_STAND_ID) {
                        return { block, pos };
                    }
                } catch {}
            }
        }
    }

    return null;
}

/**
 * Performs authentic healing splash potion ritual on an ally.
 * @param {Entity} villager 
 * @param {Entity} ally 
 */
export function performHeal(villager, ally) {
    if (!villager || !villager.isValid() || !ally || !ally.isValid()) return false;

    const dim = villager.dimension;
    const allyLoc = ally.location;

    // 1. Turn to face target
    try {
        const rot = getLookRotation(villager.location, allyLoc);
        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    // 2. Play glass shatter & splash sound
    playSoundSafe(dim, "random.glass", allyLoc, { volume: 0.9, pitch: 1.2 });
    playSoundSafe(dim, "potion.splash", allyLoc, { volume: 1.0, pitch: 1.0 });

    // 3. Emits particles: hearts & villager happy
    spawnParticleSafe(dim, "minecraft:heart_particle", { x: allyLoc.x, y: allyLoc.y + 1.2, z: allyLoc.z });
    spawnParticleSafe(dim, "minecraft:villager_happy", { x: allyLoc.x, y: allyLoc.y + 1.0, z: allyLoc.z });

    // 4. Apply instant health & regeneration effects
    try {
        ally.addEffect("instant_health", 20, { amplifier: 1, showParticles: true });
        ally.addEffect("regeneration", 120, { amplifier: 1, showParticles: false });
    } catch {}

    return true;
}

/**
 * Interacts with brewing stand: brewing sounds & magic particles.
 * @param {Entity} villager 
 * @param {{ block: Block, pos: Vector3 }} brewingStandInfo 
 */
export function performBrew(villager, brewingStandInfo) {
    if (!villager || !villager.isValid() || !brewingStandInfo) return false;

    const dim = villager.dimension;
    const pos = brewingStandInfo.pos;

    try {
        const rot = getLookRotation(villager.location, { x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 });
        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    playSoundSafe(dim, "block.brewing_stand.brew", pos, { volume: 0.9, pitch: 1.0 });
    spawnParticleSafe(dim, "minecraft:villager_happy", { x: pos.x + 0.5, y: pos.y + 1.0, z: pos.z + 0.5 });

    return true;
}

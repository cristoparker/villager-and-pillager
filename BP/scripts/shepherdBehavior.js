/**
 * Fisherman Villager Addon - Shepherd Behavior Module (Namespace: rpc)
 * Handles shears equipment, finding shearable sheep, authentic shearing execution,
 * wool drop mechanics, and leashing 2 starter sheep to the Shepherd.
 */

import { ItemStack, EquipmentSlot } from "@minecraft/server";
import { SHEPHERD_CONFIG } from "./config.js";
import { distance, distance2D, getLookRotation, playSoundSafe, spawnParticleSafe } from "./utils.js";

/**
 * Equips shears in the villager's main hand.
 * @param {Entity} villager 
 */
export function equipShears(villager) {
    if (!villager || !villager.isValid()) return;

    try {
        const equippable = villager.getComponent("minecraft:equippable");
        if (equippable) {
            try {
                equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack(SHEPHERD_CONFIG.SHEARS_ITEM_ID, 1));
            } catch {
                equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack(SHEPHERD_CONFIG.VANILLA_SHEARS_ITEM_ID, 1));
            }
        }
    } catch {}

    try {
        villager.runCommandAsync(`replaceitem entity @s slot.weapon.mainhand 0 ${SHEPHERD_CONFIG.SHEARS_ITEM_ID}`).catch(() => {
            villager.runCommandAsync(`replaceitem entity @s slot.weapon.mainhand 0 ${SHEPHERD_CONFIG.VANILLA_SHEARS_ITEM_ID}`).catch(() => {});
        });
    } catch {}
}

/**
 * Unequips items from the villager's main hand (e.g. for sleeping).
 * @param {Entity} villager 
 */
export function unequipShears(villager) {
    if (!villager || !villager.isValid()) return;

    try {
        const equippable = villager.getComponent("minecraft:equippable");
        equippable?.setEquipment(EquipmentSlot.Mainhand, undefined);
    } catch {}
}

/**
 * Checks if a sheep entity has wool and can be sheared.
 * @param {Entity} sheep 
 * @returns {boolean}
 */
export function isShearableSheep(sheep) {
    if (!sheep || !sheep.isValid()) return false;

    // Baby sheep cannot be sheared
    try {
        if (sheep.getComponent("minecraft:is_baby")) return false;
    } catch {}

    // Sheared sheep cannot be sheared again until wool regrows
    try {
        if (sheep.getComponent("minecraft:is_sheared")) return false;
    } catch {}

    return true;
}

/**
 * Finds the closest shearable sheep near the shepherd.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 * @returns {Entity|null}
 */
export function findNearbyShearableSheep(dimension, location, radius = SHEPHERD_CONFIG.SHEEP_SEARCH_RADIUS) {
    if (!dimension || !location) return null;

    let candidates = [];
    try {
        candidates = dimension.getEntities({
            type: "minecraft:sheep",
            location: location,
            maxDistance: radius
        });
    } catch {
        return null;
    }

    let closest = null;
    let closestDist = Infinity;

    for (const sheep of candidates) {
        if (isShearableSheep(sheep)) {
            const d = distance(location, sheep.location);
            if (d < closestDist) {
                closestDist = d;
                closest = sheep;
            }
        }
    }

    return closest;
}

/**
 * Connects a sheep entity to the shepherd using Minecraft's native leash/lead system.
 * @param {Entity} sheep 
 * @param {Entity} villager 
 */
export function leashSheepToVillager(sheep, villager) {
    if (!sheep || !sheep.isValid() || !villager || !villager.isValid()) return;

    try {
        const leashComp = sheep.getComponent("minecraft:leashable");
        if (leashComp && typeof leashComp.leashTo === "function") {
            leashComp.leashTo(villager);
        }
    } catch (e) {
        // Native fallback or older API version
    }
}

/**
 * Spawns 2 sheep connected with leashes to the Shepherd villager (like Wandering Trader with llamas).
 * @param {Entity} villager 
 */
export function spawnStarterSheep(villager) {
    if (!villager || !villager.isValid()) return;

    const dim = villager.dimension;
    const vLoc = villager.location;

    // Spawn 2 sheep on opposite sides
    const offsets = [
        { x: 1.4, y: 0, z: 0.8 },
        { x: -1.4, y: 0, z: -0.8 }
    ];

    for (let i = 0; i < offsets.length; i++) {
        const pos = {
            x: vLoc.x + offsets[i].x,
            y: vLoc.y + offsets[i].y,
            z: vLoc.z + offsets[i].z
        };

        try {
            const sheep = dim.spawnEntity("minecraft:sheep", pos);
            if (sheep && sheep.isValid()) {
                sheep.addTag("rpc:shepherd_sheep");
                // Native leash connection
                leashSheepToVillager(sheep, villager);
            }
        } catch (e) {
            console.warn(`[Shepherd] Failed to spawn sheep ${i}: ${e}`);
        }
    }

    playSoundSafe(dim, "mob.sheep.say", vLoc, { volume: 0.9, pitch: 1.0 });
}

/**
 * Executes shearing action on a target sheep.
 * @param {Entity} villager 
 * @param {Entity} sheep 
 */
export function performShear(villager, sheep) {
    if (!villager || !villager.isValid() || !sheep || !sheep.isValid()) return false;

    const dim = villager.dimension;
    const sheepLoc = sheep.location;

    // 1. Turn shepherd to face sheep
    try {
        const rot = getLookRotation(villager.location, sheepLoc);
        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
    } catch {}

    // 2. Play arm raising / snip animation
    try {
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    // 3. Play shear sound
    playSoundSafe(dim, "mob.sheep.shear", sheepLoc, { volume: 1.0, pitch: 1.0 });

    // 4. Trigger vanilla on_sheared event on sheep
    try {
        sheep.triggerEvent("minecraft:on_sheared");
    } catch {}

    // 5. Determine wool color from sheep
    let colorIndex = 0;
    try {
        const colorComp = sheep.getComponent("minecraft:color");
        if (colorComp && typeof colorComp.value === "number") {
            colorIndex = Math.max(0, Math.min(15, colorComp.value));
        }
    } catch {}

    const woolItemId = SHEPHERD_CONFIG.WOOL_MAP[colorIndex] || "minecraft:white_wool";
    const woolCount = Math.floor(Math.random() * 2) + 1; // 1 to 2 wool blocks

    // 6. Spawn dropped wool item at sheep
    try {
        dim.spawnItem(new ItemStack(woolItemId, woolCount), {
            x: sheepLoc.x,
            y: sheepLoc.y + 0.5,
            z: sheepLoc.z
        });
    } catch {}

    // 7. Spurt wool particles
    spawnParticleSafe(dim, "minecraft:balloon_pop_particle", {
        x: sheepLoc.x,
        y: sheepLoc.y + 0.6,
        z: sheepLoc.z
    });

    // 8. Shepherd happiness feedback
    spawnParticleSafe(dim, "minecraft:villager_happy", {
        x: villager.location.x,
        y: villager.location.y + 1.8,
        z: villager.location.z
    });
    playSoundSafe(dim, "mob.villager.yes", villager.location, { volume: 0.9, pitch: 1.05 });

    return true;
}

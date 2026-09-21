/**
 * Fisherman Villager Addon - Shepherd Behavior Module (Namespace: rpc)
 * Handles shears equipment, finding shearable sheep, authentic shearing execution,
 * wool drop mechanics, and leashing 2 starter sheep to the Shepherd.
 */

import { ItemStack, EquipmentSlot, system } from "@minecraft/server";
import { SHEPHERD_CONFIG } from "./config.js";
import { distance, distance2D, getLookRotation, playSoundSafe, spawnParticleSafe, setEntityLook, isTargetUnreachable } from "./utils.js";
import { notifyDroppedItem } from "./villageExpansionManager.js";

/**
 * Equips shears in the villager's main hand.
 * @param {Entity} villager 
 */
export function equipShears(villager) {
    if (!villager || !villager.isValid()) return;

    try {
        const equippable = villager.getComponent("minecraft:equippable");
        if (equippable) {
            const current = equippable.getEquipment(EquipmentSlot.Mainhand);
            if (current && (current.typeId === SHEPHERD_CONFIG.SHEARS_ITEM_ID || current.typeId === SHEPHERD_CONFIG.VANILLA_SHEARS_ITEM_ID)) {
                return; // Already equipped!
            }

            try {
                equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack(SHEPHERD_CONFIG.SHEARS_ITEM_ID, 1));
                return;
            } catch {
                try {
                    equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack(SHEPHERD_CONFIG.VANILLA_SHEARS_ITEM_ID, 1));
                    return;
                } catch {}
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
        if (isShearableSheep(sheep) && !isTargetUnreachable(sheep)) {
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
    setEntityLook(villager, sheepLoc);

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
        const droppedWool = dim.spawnItem(new ItemStack(woolItemId, woolCount), {
            x: sheepLoc.x,
            y: sheepLoc.y + 0.5,
            z: sheepLoc.z
        });
        if (droppedWool) {
            notifyDroppedItem(villager, droppedWool);
        }
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

/**
 * Equips dye in the villager's main hand.
 * @param {Entity} villager 
 * @param {string} dyeItemId 
 */
export function equipDye(villager, dyeItemId) {
    if (!villager || !villager.isValid() || !dyeItemId) return;
    try {
        const equippable = villager.getComponent("minecraft:equippable");
        if (equippable) {
            const current = equippable.getEquipment(EquipmentSlot.Mainhand);
            if (current && current.typeId === dyeItemId) return;
            try {
                equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack(dyeItemId, 1));
                return;
            } catch {}
        }
    } catch {}
    try {
        villager.runCommandAsync(`replaceitem entity @s slot.weapon.mainhand 0 ${dyeItemId}`).catch(() => {});
    } catch {}
}

/**
 * Equips wheat in the villager's main hand.
 * @param {Entity} villager 
 */
export function equipWheat(villager) {
    if (!villager || !villager.isValid()) return;
    try {
        const equippable = villager.getComponent("minecraft:equippable");
        if (equippable) {
            const current = equippable.getEquipment(EquipmentSlot.Mainhand);
            if (current && current.typeId === SHEPHERD_CONFIG.WHEAT_ITEM_ID) return;
            try {
                equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack(SHEPHERD_CONFIG.WHEAT_ITEM_ID, 1));
                return;
            } catch {}
        }
    } catch {}
    try {
        villager.runCommandAsync(`replaceitem entity @s slot.weapon.mainhand 0 ${SHEPHERD_CONFIG.WHEAT_ITEM_ID}`).catch(() => {});
    } catch {}
}

/**
 * Finds a nearby white (undyed) adult sheep.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 */
export function findNearbyWhiteSheep(dimension, location, radius = SHEPHERD_CONFIG.SHEEP_SEARCH_RADIUS) {
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
        if (!sheep || !sheep.isValid()) continue;
        try {
            if (sheep.getComponent("minecraft:is_baby")) continue;
            if (sheep.getComponent("minecraft:is_sheared")) continue;
            if (sheep.hasTag("rpc:recently_dyed")) continue;
            if (isTargetUnreachable(sheep)) continue;
            const colorComp = sheep.getComponent("minecraft:color");
            if (colorComp && colorComp.value === 0) {
                const d = distance(location, sheep.location);
                if (d < closestDist) {
                    closestDist = d;
                    closest = sheep;
                }
            }
        } catch {}
    }
    return closest;
}

/**
 * Dyes a white sheep a random color from config.
 * @param {Entity} villager 
 * @param {Entity} sheep 
 * @param {object} dyeDef 
 */
export function performDyeSheep(villager, sheep, dyeDef) {
    if (!villager || !villager.isValid() || !sheep || !sheep.isValid() || !dyeDef) return false;
    const dim = villager.dimension;
    const sLoc = sheep.location;

    setEntityLook(villager, sLoc);
    try {
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    playSoundSafe(dim, "item.dye.use", sLoc, { volume: 1.0, pitch: 1.1 });
    playSoundSafe(dim, "random.pop", sLoc, { volume: 0.9, pitch: 1.2 });
    spawnParticleSafe(dim, "minecraft:villager_happy", { x: sLoc.x, y: sLoc.y + 0.8, z: sLoc.z });

    try {
        sheep.triggerEvent(dyeDef.event);
        sheep.addTag("rpc:recently_dyed");
        system.runTimeout(() => {
            try {
                if (sheep.isValid()) sheep.removeTag("rpc:recently_dyed");
            } catch {}
        }, 1200);
    } catch {}

    playSoundSafe(dim, "mob.villager.yes", villager.location, { volume: 0.9, pitch: 1.05 });
    return true;
}

/**
 * Finds a nearby sheared sheep that needs wheat to regrow wool.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 */
export function findNearbyShearedSheep(dimension, location, radius = SHEPHERD_CONFIG.SHEEP_SEARCH_RADIUS) {
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
        if (!sheep || !sheep.isValid()) continue;
        try {
            if (sheep.getComponent("minecraft:is_baby")) continue;
            if (sheep.hasTag("rpc:recently_fed")) continue;
            if (isTargetUnreachable(sheep)) continue;
            if (sheep.getComponent("minecraft:is_sheared")) {
                const d = distance(location, sheep.location);
                if (d < closestDist) {
                    closestDist = d;
                    closest = sheep;
                }
            }
        } catch {}
    }
    return closest;
}

/**
 * Feeds wheat to a sheared sheep to accelerate wool regrowth.
 * @param {Entity} villager 
 * @param {Entity} sheep 
 */
export function performFeedWheat(villager, sheep) {
    if (!villager || !villager.isValid() || !sheep || !sheep.isValid()) return false;
    const dim = villager.dimension;
    const sLoc = sheep.location;

    setEntityLook(villager, sLoc);
    try {
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    playSoundSafe(dim, "random.eat", sLoc, { volume: 1.0, pitch: 1.2 });
    spawnParticleSafe(dim, "minecraft:crop_growth_area_emitter", { x: sLoc.x, y: sLoc.y + 0.5, z: sLoc.z });
    spawnParticleSafe(dim, "minecraft:heart_particle", { x: sLoc.x, y: sLoc.y + 0.8, z: sLoc.z });

    try {
        sheep.triggerEvent("minecraft:on_eat_grass");
        sheep.addTag("rpc:recently_fed");
        system.runTimeout(() => {
            try {
                if (sheep.isValid()) sheep.removeTag("rpc:recently_fed");
            } catch {}
        }, 600);
    } catch {}

    playSoundSafe(dim, "mob.villager.yes", villager.location, { volume: 0.9, pitch: 1.05 });
    return true;
}

/**
 * Scans for wild wolves or foxes threatening the flock.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 */
export function findNearbyPredators(dimension, location, radius = SHEPHERD_CONFIG.PREDATOR_SEARCH_RADIUS) {
    if (!dimension || !location) return null;
    const predatorTypes = ["minecraft:wolf", "minecraft:fox"];
    let closest = null;
    let closestDist = Infinity;

    for (const pType of predatorTypes) {
        try {
            const entities = dimension.getEntities({
                type: pType,
                location: location,
                maxDistance: radius
            });
            for (const entity of entities) {
                if (!entity || !entity.isValid()) continue;
                try {
                    if (entity.getComponent("minecraft:is_tamed")) continue;
                } catch {}
                if (isTargetUnreachable(entity)) continue;
                const d = distance(location, entity.location);
                if (d < closestDist) {
                    closestDist = d;
                    closest = entity;
                }
            }
        } catch {}
    }
    return closest;
}

/**
 * Scares away a predator by snapping shears aggressively with knockback.
 * @param {Entity} villager 
 * @param {Entity} predator 
 */
export function performScarePredator(villager, predator) {
    if (!villager || !villager.isValid() || !predator || !predator.isValid()) return false;
    const dim = villager.dimension;
    const pLoc = predator.location;
    const vLoc = villager.location;

    setEntityLook(villager, pLoc);
    try {
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    playSoundSafe(dim, "mob.sheep.shear", vLoc, { volume: 1.2, pitch: 1.3 });
    playSoundSafe(dim, "mob.villager.no", vLoc, { volume: 1.0, pitch: 1.0 });
    spawnParticleSafe(dim, "minecraft:crit", { x: pLoc.x, y: pLoc.y + 0.6, z: pLoc.z });

    try {
        const dx = pLoc.x - vLoc.x;
        const dz = pLoc.z - vLoc.z;
        const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
        predator.applyImpulse({ x: (dx / len) * 0.45, y: 0.25, z: (dz / len) * 0.45 });
    } catch {}

    return true;
}

/**
 * Scans for a nearby Loom workstation.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 */
export function findNearbyLoom(dimension, location, radius = SHEPHERD_CONFIG.LOOM_SEARCH_RADIUS) {
    if (!dimension || !location) return null;
    const ox = Math.floor(location.x);
    const oy = Math.floor(location.y);
    const oz = Math.floor(location.z);

    for (let dx = -radius; dx <= radius; dx += 2) {
        for (let dz = -radius; dz <= radius; dz += 2) {
            for (let dy = -2; dy <= 2; dy++) {
                const pos = { x: ox + dx, y: oy + dy, z: oz + dz };
                if (isTargetUnreachable(pos)) continue;
                try {
                    const block = dimension.getBlock(pos);
                    if (block && block.typeId === SHEPHERD_CONFIG.LOOM_ID) {
                        return { block, pos };
                    }
                } catch {}
            }
        }
    }
    return null;
}

/**
 * Operates loom to weave carpets.
 * @param {Entity} villager 
 * @param {Vector3} loomPos 
 */
export function performLoomWeaving(villager, loomPos) {
    if (!villager || !villager.isValid() || !loomPos) return false;
    const dim = villager.dimension;

    setEntityLook(villager, { x: loomPos.x + 0.5, y: loomPos.y + 0.5, z: loomPos.z + 0.5 });
    try {
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    playSoundSafe(dim, "block.loom.use", loomPos, { volume: 1.0, pitch: 1.0 });
    spawnParticleSafe(dim, "minecraft:balloon_pop_particle", { x: loomPos.x + 0.5, y: loomPos.y + 0.8, z: loomPos.z + 0.5 });
    spawnParticleSafe(dim, "minecraft:villager_happy", { x: loomPos.x + 0.5, y: loomPos.y + 1.2, z: loomPos.z + 0.5 });

    try {
        const droppedCarpet = dim.spawnItem(new ItemStack("minecraft:white_carpet", 1), {
            x: loomPos.x + 0.5,
            y: loomPos.y + 0.6,
            z: loomPos.z + 0.5
        });
        if (droppedCarpet) {
            notifyDroppedItem(villager, droppedCarpet);
        }
    } catch {}

    return true;
}

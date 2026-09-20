/**
 * Villager Professions Addon - Armorer Behavior Module (Namespace: rpc)
 * Coordinates iron ingot equipment, damaged Iron Golem detection & repairs,
 * blast furnace forging routines, and protective maintenance.
 */

import { ItemStack, EquipmentSlot, system } from "@minecraft/server";
import { ARMORER_CONFIG, FLETCHER_CONFIG } from "./config.js";
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

/**
 * Equips shield in armorer's main hand.
 * @param {Entity} villager 
 */
export function equipShield(villager) {
    if (!villager || !villager.isValid()) return;
    try {
        const equippable = villager.getComponent("minecraft:equippable");
        if (equippable) {
            const current = equippable.getEquipment(EquipmentSlot.Mainhand);
            if (current && current.typeId === ARMORER_CONFIG.SHIELD_ITEM_ID) return;
            try {
                equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack(ARMORER_CONFIG.SHIELD_ITEM_ID, 1));
                return;
            } catch {}
        }
    } catch {}
    try {
        villager.runCommandAsync(`replaceitem entity @s slot.weapon.mainhand 0 ${ARMORER_CONFIG.SHIELD_ITEM_ID}`).catch(() => {});
    } catch {}
}

/**
 * Equips iron chestplate in armorer's main hand.
 * @param {Entity} villager 
 */
export function equipChestplate(villager) {
    if (!villager || !villager.isValid()) return;
    try {
        const equippable = villager.getComponent("minecraft:equippable");
        if (equippable) {
            const current = equippable.getEquipment(EquipmentSlot.Mainhand);
            if (current && current.typeId === ARMORER_CONFIG.CHESTPLATE_ITEM_ID) return;
            try {
                equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack(ARMORER_CONFIG.CHESTPLATE_ITEM_ID, 1));
                return;
            } catch {}
        }
    } catch {}
    try {
        villager.runCommandAsync(`replaceitem entity @s slot.weapon.mainhand 0 ${ARMORER_CONFIG.CHESTPLATE_ITEM_ID}`).catch(() => {});
    } catch {}
}

/**
 * Finds a nearby villager or player who doesn't have the fortified buff.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 */
export function findNearbyUnbuffedAlly(dimension, location, radius = ARMORER_CONFIG.BUFF_SEARCH_RADIUS) {
    if (!dimension || !location) return null;
    const targetTypes = ["minecraft:villager_v2", "minecraft:villager", "minecraft:player"];
    let closest = null;
    let closestDist = Infinity;

    for (const tType of targetTypes) {
        try {
            const entities = dimension.getEntities({
                type: tType,
                location: location,
                maxDistance: radius
            });
            for (const entity of entities) {
                if (!entity || !entity.isValid()) continue;
                if (entity.hasTag("rpc:armorer")) continue; // Don't buff self
                if (entity.hasTag("rpc:fortified")) continue; // Already fortified

                const d = distance(location, entity.location);
                if (d < closestDist && d > 0.5) {
                    closestDist = d;
                    closest = entity;
                }
            }
        } catch {}
    }
    return closest;
}

/**
 * Fortifies an ally with armor protection buffs (Resistance & Absorption).
 * @param {Entity} villager 
 * @param {Entity} ally 
 */
export function performFortifyAlly(villager, ally) {
    if (!villager || !villager.isValid() || !ally || !ally.isValid()) return false;
    const dim = villager.dimension;
    const aLoc = ally.location;

    try {
        const rot = getLookRotation(villager.location, aLoc);
        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    playSoundSafe(dim, "random.anvil_use", aLoc, { volume: 0.9, pitch: 1.2 });
    playSoundSafe(dim, "mob.villager.yes", villager.location, { volume: 0.9, pitch: 1.05 });
    spawnParticleSafe(dim, "minecraft:villager_happy", { x: aLoc.x, y: aLoc.y + 1.2, z: aLoc.z });
    spawnParticleSafe(dim, "minecraft:totem_particle", { x: aLoc.x, y: aLoc.y + 1.0, z: aLoc.z });

    // Grant 60 seconds of Resistance II and Absorption
    try {
        ally.addEffect("resistance", 1200, { amplifier: 1, showParticles: true });
        ally.addEffect("absorption", 1200, { amplifier: 0, showParticles: true });
    } catch {
        try {
            ally.runCommandAsync("effect @s resistance 60 1 true").catch(() => {});
            ally.runCommandAsync("effect @s absorption 60 0 true").catch(() => {});
        } catch {}
    }

    try {
        ally.addTag("rpc:fortified");
        system.runTimeout(() => {
            try {
                if (ally.isValid()) ally.removeTag("rpc:fortified");
            } catch {}
        }, 1200);
    } catch {}

    return true;
}

/**
 * Scans for nearby Anvils.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 */
export function findNearbyAnvil(dimension, location, radius = ARMORER_CONFIG.ANVIL_SEARCH_RADIUS) {
    if (!dimension || !location) return null;
    const ox = Math.floor(location.x);
    const oy = Math.floor(location.y);
    const oz = Math.floor(location.z);

    for (let dx = -radius; dx <= radius; dx += 2) {
        for (let dz = -radius; dz <= radius; dz += 2) {
            for (let dy = -2; dy <= 2; dy++) {
                const pos = { x: ox + dx, y: oy + dy, z: oz + dz };
                try {
                    const block = dimension.getBlock(pos);
                    if (block && ARMORER_CONFIG.ANVIL_BLOCK_IDS.includes(block.typeId)) {
                        return { block, pos };
                    }
                } catch {}
            }
        }
    }
    return null;
}

/**
 * Operates anvil with heavy hammer sparks.
 * @param {Entity} villager 
 * @param {Vector3} anvilPos 
 */
export function performHammerAnvil(villager, anvilPos) {
    if (!villager || !villager.isValid() || !anvilPos) return false;
    const dim = villager.dimension;

    try {
        const rot = getLookRotation(villager.location, { x: anvilPos.x + 0.5, y: anvilPos.y + 0.5, z: anvilPos.z + 0.5 });
        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    playSoundSafe(dim, "random.anvil_use", anvilPos, { volume: 1.0, pitch: 0.95 });
    spawnParticleSafe(dim, "minecraft:lava_particle", { x: anvilPos.x + 0.5, y: anvilPos.y + 0.9, z: anvilPos.z + 0.5 });
    spawnParticleSafe(dim, "minecraft:villager_happy", { x: anvilPos.x + 0.5, y: anvilPos.y + 1.2, z: anvilPos.z + 0.5 });

    return true;
}

/**
 * Scans for nearby hostile monsters threatening the armorer.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 */
export function findNearbyHostiles(dimension, location, radius = 10) {
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
                if (!entity || !entity.isValid()) continue;
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
 * Blocks incoming hostile attack with shield, deflecting damage and knocking back.
 * @param {Entity} villager 
 * @param {Entity} monster 
 */
export function performShieldBlock(villager, monster) {
    if (!villager || !villager.isValid() || !monster || !monster.isValid()) return false;
    const dim = villager.dimension;
    const mLoc = monster.location;
    const vLoc = villager.location;

    try {
        const rot = getLookRotation(vLoc, mLoc);
        villager.teleport(vLoc, { rotation: { x: 0, y: rot.y } });
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    playSoundSafe(dim, "item.shield.block", vLoc, { volume: 1.2, pitch: 1.0 });
    spawnParticleSafe(dim, "minecraft:crit", { x: mLoc.x, y: mLoc.y + 1.0, z: mLoc.z });

    // Knockback monster
    try {
        const dx = mLoc.x - vLoc.x;
        const dz = mLoc.z - vLoc.z;
        const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
        monster.applyImpulse({ x: (dx / len) * 0.4, y: 0.2, z: (dz / len) * 0.4 });
    } catch {}

    return true;
}

/**
 * Checks if any Iron Golem exists within radius.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 */
export function hasIronGolemNearby(dimension, location, radius = ARMORER_CONFIG.GOLEM_SUMMON_RADIUS) {
    if (!dimension || !location) return false;
    try {
        const golems = dimension.getEntities({
            type: "minecraft:iron_golem",
            location: location,
            maxDistance: radius
        });
        return golems.length > 0;
    } catch {
        return false;
    }
}

/**
 * Constructs a new Iron Golem at the blast furnace forge.
 * @param {Entity} villager 
 * @param {Vector3} blastFurnacePos 
 */
export function performConstructGolem(villager, blastFurnacePos) {
    if (!villager || !villager.isValid() || !blastFurnacePos) return false;
    const dim = villager.dimension;

    try {
        const rot = getLookRotation(villager.location, { x: blastFurnacePos.x + 0.5, y: blastFurnacePos.y + 0.5, z: blastFurnacePos.z + 0.5 });
        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    playSoundSafe(dim, "random.anvil_land", blastFurnacePos, { volume: 1.0, pitch: 0.9 });
    playSoundSafe(dim, "fire.fire", blastFurnacePos, { volume: 1.0, pitch: 1.0 });

    // Spawn Iron Golem 2 blocks away
    try {
        const spawnPos = { x: blastFurnacePos.x + 1.5, y: blastFurnacePos.y, z: blastFurnacePos.z + 1.5 };
        const golem = dim.spawnEntity("minecraft:iron_golem", spawnPos);
        if (golem && golem.isValid()) {
            spawnParticleSafe(dim, "minecraft:smoke_particle", { x: spawnPos.x, y: spawnPos.y + 1.0, z: spawnPos.z });
            spawnParticleSafe(dim, "minecraft:villager_happy", { x: spawnPos.x, y: spawnPos.y + 1.8, z: spawnPos.z });
            playSoundSafe(dim, "mob.irongolem.death", spawnPos, { volume: 0.8, pitch: 1.4 });
        }
    } catch (e) {
        console.warn(`[Armorer] Failed to spawn Iron Golem: ${e}`);
    }

    playSoundSafe(dim, "mob.villager.yes", villager.location, { volume: 1.0, pitch: 1.0 });
    return true;
}

/**
 * Villager Professions Addon - Weaponsmith Behavior Module (Namespace: rpc)
 * Coordinates iron sword equipment, grindstone sharpening routines,
 * defensive rallying, and combat maintenance.
 */

import { ItemStack, EquipmentSlot, system } from "@minecraft/server";
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

/**
 * Equips iron axe in weaponsmith's main hand.
 * @param {Entity} villager 
 */
export function equipAxe(villager) {
    if (!villager || !villager.isValid()) return;
    try {
        const equippable = villager.getComponent("minecraft:equippable");
        if (equippable) {
            const current = equippable.getEquipment(EquipmentSlot.Mainhand);
            if (current && current.typeId === WEAPONSMITH_CONFIG.AXE_ITEM_ID) return;
            try {
                equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack(WEAPONSMITH_CONFIG.AXE_ITEM_ID, 1));
                return;
            } catch {}
        }
    } catch {}
    try {
        villager.runCommandAsync(`replaceitem entity @s slot.weapon.mainhand 0 ${WEAPONSMITH_CONFIG.AXE_ITEM_ID}`).catch(() => {});
    } catch {}
}

/**
 * Equips goat horn in weaponsmith's main hand.
 * @param {Entity} villager 
 */
export function equipHorn(villager) {
    if (!villager || !villager.isValid()) return;
    try {
        const equippable = villager.getComponent("minecraft:equippable");
        if (equippable) {
            const current = equippable.getEquipment(EquipmentSlot.Mainhand);
            if (current && current.typeId === WEAPONSMITH_CONFIG.HORN_ITEM_ID) return;
            try {
                equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack(WEAPONSMITH_CONFIG.HORN_ITEM_ID, 1));
                return;
            } catch {}
        }
    } catch {}
    try {
        villager.runCommandAsync(`replaceitem entity @s slot.weapon.mainhand 0 ${WEAPONSMITH_CONFIG.HORN_ITEM_ID}`).catch(() => {});
    } catch {}
}

/**
 * Finds nearby combat allies (iron golems, butchers, fletchers, armorers, players) to sharpen weapons.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 */
export function findNearbyCombatAllies(dimension, location, radius = WEAPONSMITH_CONFIG.BUFF_SEARCH_RADIUS) {
    if (!dimension || !location) return null;
    const allyTypes = ["minecraft:iron_golem", "minecraft:player", "minecraft:villager_v2", "minecraft:villager"];
    let closest = null;
    let closestDist = Infinity;

    for (const aType of allyTypes) {
        try {
            const entities = dimension.getEntities({
                type: aType,
                location: location,
                maxDistance: radius
            });
            for (const entity of entities) {
                if (!entity || !entity.isValid()) continue;
                if (entity.hasTag("rpc:weaponsmith")) continue; // Don't buff self
                if (entity.hasTag("rpc:sharpened")) continue; // Already buffed

                const d = distance(location, entity.location);
                if (d < closestDist && d > 0.8) {
                    closestDist = d;
                    closest = entity;
                }
            }
        } catch {}
    }
    return closest;
}

/**
 * Sharpens ally's weapon, granting Strength & Speed buffs with weapon clashing sound.
 * @param {Entity} villager 
 * @param {Entity} ally 
 */
export function performSharpenAlly(villager, ally) {
    if (!villager || !villager.isValid() || !ally || !ally.isValid()) return false;
    const dim = villager.dimension;
    const aLoc = ally.location;

    try {
        const rot = getLookRotation(villager.location, aLoc);
        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    playSoundSafe(dim, "item.trident.hit_ground", aLoc, { volume: 1.0, pitch: 1.2 });
    playSoundSafe(dim, "block.grindstone.use", aLoc, { volume: 0.9, pitch: 1.1 });
    spawnParticleSafe(dim, "minecraft:crit", { x: aLoc.x, y: aLoc.y + 1.2, z: aLoc.z });
    spawnParticleSafe(dim, "minecraft:villager_happy", { x: aLoc.x, y: aLoc.y + 1.5, z: aLoc.z });

    // Grant 45 seconds Strength I & Speed I
    try {
        ally.addEffect("strength", 900, { amplifier: 0, showParticles: true });
        ally.addEffect("speed", 900, { amplifier: 0, showParticles: true });
    } catch {
        try {
            ally.runCommandAsync("effect @s strength 45 0 true").catch(() => {});
            ally.runCommandAsync("effect @s speed 45 0 true").catch(() => {});
        } catch {}
    }

    try {
        ally.addTag("rpc:sharpened");
        system.runTimeout(() => {
            try {
                if (ally.isValid()) ally.removeTag("rpc:sharpened");
            } catch {}
        }, 900);
    } catch {}

    playSoundSafe(dim, "mob.villager.yes", villager.location, { volume: 0.9, pitch: 1.05 });
    return true;
}

/**
 * Sounds war horn rallying defenders to defensive positions.
 * @param {Entity} villager 
 */
export function performCallToArms(villager) {
    if (!villager || !villager.isValid()) return false;
    const dim = villager.dimension;
    const vLoc = villager.location;

    try {
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    playSoundSafe(dim, "item.goat_horn.sound.0", vLoc, { volume: 1.5, pitch: 1.0 });
    playSoundSafe(dim, "block.bell.hit", vLoc, { volume: 1.0, pitch: 1.0 });
    spawnParticleSafe(dim, "minecraft:note_particle", { x: vLoc.x, y: vLoc.y + 2.0, z: vLoc.z });

    return true;
}

/**
 * Performs authentic melee attack against a monster with sword or axe.
 * @param {Entity} villager 
 * @param {Entity} monster 
 * @param {boolean} useAxe 
 */
export function performAttackMonster(villager, monster, useAxe = false) {
    if (!villager || !villager.isValid() || !monster || !monster.isValid()) return false;
    const dim = villager.dimension;
    const mLoc = monster.location;
    const vLoc = villager.location;

    try {
        const rot = getLookRotation(vLoc, mLoc);
        villager.teleport(vLoc, { rotation: { x: 0, y: rot.y } });
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    if (useAxe) {
        playSoundSafe(dim, "damage.hit", mLoc, { volume: 1.0, pitch: 0.9 });
        playSoundSafe(dim, "item.shield.block", mLoc, { volume: 0.8, pitch: 0.8 }); // shield break sound
    } else {
        playSoundSafe(dim, "damage.hit", mLoc, { volume: 1.0, pitch: 1.1 });
        playSoundSafe(dim, "mob.player.attack.strong", mLoc, { volume: 1.0, pitch: 1.0 });
    }
    spawnParticleSafe(dim, "minecraft:crit", { x: mLoc.x, y: mLoc.y + 1.0, z: mLoc.z });

    const dmg = useAxe ? 9 : WEAPONSMITH_CONFIG.ATTACK_DAMAGE;
    try {
        monster.applyDamage(dmg, { damagingEntity: villager });
    } catch {
        try {
            villager.runCommandAsync(`damage @e[type=!villager,type=!villager_v2,type=!player,c=1,r=3] ${dmg} entity_attack entity @s`).catch(() => {});
        } catch {}
    }

    // Knockback
    try {
        const dx = mLoc.x - vLoc.x;
        const dz = mLoc.z - vLoc.z;
        const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
        const impulseForce = useAxe ? 0.45 : 0.35;
        monster.applyImpulse({ x: (dx / len) * impulseForce, y: 0.22, z: (dz / len) * impulseForce });
    } catch {}

    return true;
}

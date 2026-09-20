/**
 * Villager Professions Addon - Cleric Behavior Module (Namespace: rpc)
 * Coordinates splash potion equipment, injured ally detection (villagers, iron golems, players),
 * healing rituals, and brewing stand interactions.
 */

import { ItemStack, EquipmentSlot } from "@minecraft/server";
import { CLERIC_CONFIG, FLETCHER_CONFIG } from "./config.js";
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
 * Performs authentic healing splash potion ritual exclusively on injured villagers or players.
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
        ally.addEffect("regeneration", 160, { amplifier: 1, showParticles: true });
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

/**
 * Witcher-style self regeneration potion drinking routine during raids and combat.
 * Cleric drinks a powerful concoction giving regeneration and resistance!
 * @param {Entity} villager 
 */
export function performWitcherRegen(villager) {
    if (!villager || !villager.isValid()) return false;

    const dim = villager.dimension;
    const vLoc = villager.location;

    try {
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    playSoundSafe(dim, "random.drink", vLoc, { volume: 1.0, pitch: 1.0 });
    playSoundSafe(dim, "random.burp", vLoc, { volume: 0.8, pitch: 1.2 });
    spawnParticleSafe(dim, "minecraft:potion_splash_particle", { x: vLoc.x, y: vLoc.y + 1.2, z: vLoc.z });
    spawnParticleSafe(dim, "minecraft:villager_happy", { x: vLoc.x, y: vLoc.y + 1.5, z: vLoc.z });

    try {
        villager.addEffect("regeneration", 240, { amplifier: 1, showParticles: true });
        villager.addEffect("resistance", 240, { amplifier: 1, showParticles: false });
    } catch {}

    return true;
}

/**
 * Checks if a raid or monster threat is active in the vicinity.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 * @returns {boolean}
 */
export function isRaidOrMonsterThreatNearby(dimension, location, radius = CLERIC_CONFIG.RAID_SEARCH_RADIUS) {
    if (!dimension || !location) return false;

    for (const hostTypeId of FLETCHER_CONFIG.HOSTILE_TYPES) {
        try {
            const mobs = dimension.getEntities({
                type: hostTypeId,
                location: location,
                maxDistance: radius
            });
            if (mobs.length > 0) return true;
        } catch {}
    }

    return false;
}

/**
 * Scans for threatening pillagers, illagers, or monsters within range.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 * @returns {Entity|null}
 */
export function findNearbyPillagersAndMonsters(dimension, location, radius = CLERIC_CONFIG.OFFENSIVE_SEARCH_RADIUS) {
    if (!dimension || !location) return null;

    let closest = null;
    let closestDist = Infinity;

    for (const mobType of FLETCHER_CONFIG.HOSTILE_TYPES) {
        try {
            const mobs = dimension.getEntities({
                type: mobType,
                location: location,
                maxDistance: radius
            });

            for (const mob of mobs) {
                if (!mob || !mob.isValid()) continue;

                const health = mob.getComponent("minecraft:health");
                if (health && health.currentValue <= 0) continue;

                const d = distance(location, mob.location);
                if (d < closestDist) {
                    closestDist = d;
                    closest = mob;
                }
            }
        } catch {}
    }

    return closest;
}

/**
 * Hurls a splash potion of Slowness & Poison at pillagers or monsters.
 * For undead monsters (zombies/skeletons), uses Weakness & Instant Damage since they are immune to poison!
 * @param {Entity} villager 
 * @param {Entity} target 
 */
export function performOffensiveSplashPotion(villager, target) {
    if (!villager || !villager.isValid() || !target || !target.isValid()) return false;

    const dim = villager.dimension;
    const tLoc = target.location;
    const vLoc = villager.location;

    try {
        const rot = getLookRotation(vLoc, tLoc);
        villager.teleport(vLoc, { rotation: { x: 0, y: rot.y } });
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    // Audio effects: throw whoosh + impact glass break & splash
    playSoundSafe(dim, "random.bow", vLoc, { volume: 0.8, pitch: 1.2 });
    playSoundSafe(dim, "potion.splash", tLoc, { volume: 1.0, pitch: 0.95 });
    playSoundSafe(dim, "random.glass", tLoc, { volume: 0.9, pitch: 1.2 });

    // Visual splash particles
    spawnParticleSafe(dim, "minecraft:potion_splash_particle", { x: tLoc.x, y: tLoc.y + 0.8, z: tLoc.z });
    spawnParticleSafe(dim, "minecraft:mobspell_emitter", { x: tLoc.x, y: tLoc.y + 0.5, z: tLoc.z });

    // 1. Apply Slowness (8 seconds)
    try {
        target.addEffect("slowness", 160, { amplifier: 1, showParticles: true });
    } catch {}

    // 2. Apply Poison for living mobs (pillagers, illagers, spiders, creepers) or Harming for undead
    const typeId = target.typeId.toLowerCase();
    const isUndead = typeId.includes("zombie") || typeId.includes("skeleton") || typeId.includes("husk") || typeId.includes("stray") || typeId.includes("drowned") || typeId.includes("wither");

    try {
        if (isUndead) {
            target.addEffect("weakness", 160, { amplifier: 1, showParticles: true });
            target.addEffect("instant_damage", 20, { amplifier: 0, showParticles: true });
        } else {
            target.addEffect("poison", 140, { amplifier: 1, showParticles: true });
        }
    } catch {}

    // 3. Splash impact damage
    try {
        target.applyDamage(4, { damagingEntity: villager });
    } catch {
        try {
            villager.runCommandAsync(`damage @e[type=!villager,type=!villager_v2,type=!player,c=1,r=4] 4 magic entity @s`).catch(() => {});
        } catch {}
    }

    // 4. Knockback impulse
    try {
        const dx = tLoc.x - vLoc.x;
        const dz = tLoc.z - vLoc.z;
        const len = Math.sqrt(dx * dx + dz * dz) || 1.0;
        target.applyImpulse({ x: (dx / len) * 0.35, y: 0.2, z: (dz / len) * 0.35 });
    } catch {}

    return true;
}

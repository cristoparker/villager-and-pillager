/**
 * Fisherman Villager Addon - Fletcher Behavior Module (Namespace: rpc)
 * Handles equipping Bow and Crossbow, scanning for hostile monsters,
 * locating Target blocks for practice, calculating ballistic arrow trajectory,
 * and shooting authentic arrows with sound and particles.
 */

import { ItemStack, EquipmentSlot } from "@minecraft/server";
import { FLETCHER_CONFIG } from "./config.js";
import { distance, getLookRotation, playSoundSafe, spawnParticleSafe } from "./utils.js";
import { notifyDroppedItem } from "./villageExpansionManager.js";

/**
 * Equips a Bow or Crossbow in the Fletcher's main hand.
 * @param {Entity} villager 
 * @param {string} preferredType "minecraft:bow" | "minecraft:crossbow"
 */
export function equipRangedWeapon(villager, preferredType = FLETCHER_CONFIG.BOW_ITEM_ID) {
    if (!villager || !villager.isValid()) return;

    const targetType = (preferredType === FLETCHER_CONFIG.CROSSBOW_ITEM_ID) 
        ? FLETCHER_CONFIG.CROSSBOW_ITEM_ID 
        : FLETCHER_CONFIG.BOW_ITEM_ID;

    try {
        const equippable = villager.getComponent("minecraft:equippable");
        if (equippable) {
            const current = equippable.getEquipment(EquipmentSlot.Mainhand);
            if (current && (current.typeId === FLETCHER_CONFIG.BOW_ITEM_ID || current.typeId === FLETCHER_CONFIG.CROSSBOW_ITEM_ID)) {
                // If already holding the requested weapon, do nothing
                if (current.typeId === targetType) return;
            }

            try {
                equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack(targetType, 1));
                return;
            } catch {}
        }
    } catch {}

    try {
        villager.runCommandAsync(`replaceitem entity @s slot.weapon.mainhand 0 ${targetType}`).catch(() => {});
    } catch {}
}

/**
 * Unequips ranged weapon from the Fletcher's main hand (e.g. when going to bed).
 * @param {Entity} villager 
 */
export function unequipRangedWeapon(villager) {
    if (!villager || !villager.isValid()) return;

    try {
        const equippable = villager.getComponent("minecraft:equippable");
        equippable?.setEquipment(EquipmentSlot.Mainhand, undefined);
    } catch {}
}

/**
 * Equips an arrow in the Fletcher's main hand during fletching table crafting.
 * @param {Entity} villager 
 */
export function equipArrow(villager) {
    if (!villager || !villager.isValid()) return;
    try {
        const equippable = villager.getComponent("minecraft:equippable");
        if (equippable) {
            const current = equippable.getEquipment(EquipmentSlot.Mainhand);
            if (current && current.typeId === FLETCHER_CONFIG.ARROW_ITEM_ID) return;
            try {
                equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack(FLETCHER_CONFIG.ARROW_ITEM_ID, 1));
                return;
            } catch {}
        }
    } catch {}
    try {
        villager.runCommandAsync(`replaceitem entity @s slot.weapon.mainhand 0 ${FLETCHER_CONFIG.ARROW_ITEM_ID}`).catch(() => {});
    } catch {}
}

/**
 * Checks if an entity is currently holding a Crossbow.
 * @param {Entity} villager 
 * @returns {boolean}
 */
export function isHoldingCrossbow(villager) {
    if (!villager || !villager.isValid()) return false;
    try {
        const equippable = villager.getComponent("minecraft:equippable");
        const item = equippable?.getEquipment(EquipmentSlot.Mainhand);
        return item?.typeId === FLETCHER_CONFIG.CROSSBOW_ITEM_ID;
    } catch {
        return false;
    }
}

/**
 * Finds the closest hostile monster threatening the village.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 * @returns {Entity|null}
 */
export function findNearbyMonsters(dimension, location, radius = FLETCHER_CONFIG.MONSTER_SEARCH_RADIUS) {
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

                // Check health (don't shoot already dead mobs)
                try {
                    const health = mob.getComponent("minecraft:health");
                    if (health && health.currentValue <= 0) continue;
                } catch {}

                const d = distance(location, mob.location);
                if (d < closestDist) {
                    closestDist = d;
                    closest = mob;
                }
            }
        } catch {}
    }

    // Secondary fallback: search by hostile families
    if (!closest) {
        for (const family of FLETCHER_CONFIG.HOSTILE_FAMILIES) {
            try {
                const mobs = dimension.getEntities({
                    families: [family],
                    location: location,
                    maxDistance: radius
                });

                for (const mob of mobs) {
                    if (!mob || !mob.isValid()) continue;
                    // Do not target friendly entities or villagers
                    const typeId = mob.typeId;
                    if (typeId.includes("villager") || typeId.includes("player") || typeId.includes("iron_golem")) continue;

                    const d = distance(location, mob.location);
                    if (d < closestDist) {
                        closestDist = d;
                        closest = mob;
                    }
                }
            } catch {}
        }
    }

    return closest;
}

/**
 * Searches for the nearest Target block (minecraft:target) within radius.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 * @returns {{ x: number, y: number, z: number }|null}
 */
export function findNearbyTargetBlock(dimension, location, radius = FLETCHER_CONFIG.TARGET_BLOCK_SEARCH_RADIUS) {
    if (!dimension || !location) return null;

    const ox = Math.floor(location.x);
    const oy = Math.floor(location.y);
    const oz = Math.floor(location.z);
    const r = Math.min(32, Math.max(2, Math.floor(radius)));

    let closest = null;
    let closestDist = Infinity;

    for (let dx = -r; dx <= r; dx += 2) {
        for (let dz = -r; dz <= r; dz += 2) {
            for (let dy = -2; dy <= 4; dy++) {
                try {
                    const block = dimension.getBlock({ x: ox + dx, y: oy + dy, z: oz + dz });
                    if (block && (block.typeId === "minecraft:target" || block.typeId === "target")) {
                        const d = distance(location, { x: ox + dx + 0.5, y: oy + dy + 0.5, z: oz + dz + 0.5 });
                        if (d < closestDist) {
                            closestDist = d;
                            closest = { x: ox + dx + 0.5, y: oy + dy + 0.5, z: oz + dz + 0.5 };
                        }
                    }
                } catch {}
            }
        }
    }

    return closest;
}

/**
 * Finds a suitable standing location for target practice with clear line of sight.
 * @param {Dimension} dimension 
 * @param {Vector3} villagerLoc 
 * @param {Vector3} targetLoc 
 * @param {number} minD 
 * @param {number} maxD 
 * @returns {Vector3|null}
 */
export function findShootingSpot(dimension, villagerLoc, targetLoc, minD = 5.0, maxD = 9.0) {
    if (!dimension || !villagerLoc || !targetLoc) return null;

    const currentDist = distance(villagerLoc, targetLoc);
    if (currentDist >= minD && currentDist <= maxD) {
        return villagerLoc; // Already in a great shooting spot!
    }

    // Calculate direction vector from target to villager
    const dx = villagerLoc.x - targetLoc.x;
    const dz = villagerLoc.z - targetLoc.z;
    const len = Math.sqrt(dx * dx + dz * dz) || 1.0;

    const idealDist = (minD + maxD) / 2.0;
    const candidateX = targetLoc.x + (dx / len) * idealDist;
    const candidateZ = targetLoc.z + (dz / len) * idealDist;

    // Check walkable ground
    for (let dy = -1; dy <= 2; dy++) {
        const checkY = Math.floor(targetLoc.y) + dy;
        try {
            const standBlock = dimension.getBlock({ x: Math.floor(candidateX), y: checkY - 1, z: Math.floor(candidateZ) });
            const airBlock1 = dimension.getBlock({ x: Math.floor(candidateX), y: checkY, z: Math.floor(candidateZ) });
            const airBlock2 = dimension.getBlock({ x: Math.floor(candidateX), y: checkY + 1, z: Math.floor(candidateZ) });

            if (standBlock && standBlock.isSolid && airBlock1 && airBlock1.isAir && airBlock2 && airBlock2.isAir) {
                return { x: candidateX, y: checkY, z: candidateZ };
            }
        } catch {}
    }

    return { x: candidateX, y: targetLoc.y, z: candidateZ };
}

/**
 * Shoots an authentic arrow at a nearby Target block for archery practice.
 * @param {Entity} villager 
 * @param {Vector3} targetBlockPos 
 * @param {boolean} isCrossbow 
 * @returns {boolean}
 */
export function shootArrowAtBlock(villager, targetBlockPos, isCrossbow = false) {
    if (!villager || !villager.isValid() || !targetBlockPos) return false;

    const dim = villager.dimension;
    const vLoc = villager.location;

    // 1. Face target block
    try {
        const rot = getLookRotation(vLoc, targetBlockPos);
        villager.teleport(vLoc, { rotation: { x: 0, y: rot.y } });
    } catch {}

    // 2. Play arm raised aiming animation
    try {
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    // 3. Calculate projectile spawn position
    const rad = (villager.getRotation().y * Math.PI) / 180.0;
    const forwardX = -Math.sin(rad) * 0.6;
    const forwardZ = Math.cos(rad) * 0.6;
    const spawnPos = {
        x: vLoc.x + forwardX,
        y: vLoc.y + 1.4,
        z: vLoc.z + forwardZ
    };

    // 4. Center of target block bullseye (slight random spread for authenticity)
    const bullseye = {
        x: targetBlockPos.x + (Math.random() - 0.5) * 0.3,
        y: targetBlockPos.y + (Math.random() - 0.5) * 0.3,
        z: targetBlockPos.z + (Math.random() - 0.5) * 0.3
    };

    const dirX = bullseye.x - spawnPos.x;
    const dirY = bullseye.y - spawnPos.y;
    const dirZ = bullseye.z - spawnPos.z;
    const dist = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ) || 1.0;

    const speed = FLETCHER_CONFIG.ARROW_SPEED;
    const arcCompensation = (dist * 0.045);
    const velX = (dirX / dist) * speed;
    const velY = ((dirY + arcCompensation) / dist) * speed;
    const velZ = (dirZ / dist) * speed;

    // 5. Spawn and fire arrow projectile towards target block
    try {
        const arrow = dim.spawnEntity(FLETCHER_CONFIG.ARROW_ITEM_ID, spawnPos);
        if (arrow && arrow.isValid()) {
            try {
                const proj = arrow.getComponent("minecraft:projectile");
                if (proj && typeof proj.shoot === "function") {
                    proj.shoot({ x: velX, y: velY, z: velZ }, { uncertainty: 0.5 });
                } else {
                    arrow.applyImpulse({ x: velX, y: velY, z: velZ });
                }
            } catch {
                arrow.applyImpulse({ x: velX, y: velY, z: velZ });
            }
        }
    } catch (e) {
        console.warn(`[Fletcher] Error spawning practice arrow: ${e}`);
    }

    // 6. Audio and visual feedback
    if (isCrossbow) {
        playSoundSafe(dim, "crossbow.shoot", spawnPos, { volume: 1.0, pitch: 1.0 });
    } else {
        playSoundSafe(dim, "random.bow", spawnPos, { volume: 1.0, pitch: 1.05 });
    }

    spawnParticleSafe(dim, "minecraft:crit", spawnPos);

    // Fletcher pride/happiness feedback
    playSoundSafe(dim, "mob.villager.yes", vLoc, { volume: 0.8, pitch: 1.1 });
    spawnParticleSafe(dim, "minecraft:villager_happy", {
        x: vLoc.x,
        y: vLoc.y + 1.8,
        z: vLoc.z
    });

    return true;
}

/**
 * Shoots an arrow at a threatening monster in combat, dealing authentic ranged damage.
 * @param {Entity} villager 
 * @param {Entity} monster 
 * @param {boolean} isCrossbow 
 * @returns {boolean}
 */
export function shootArrowAtMonster(villager, monster, isCrossbow = false) {
    if (!villager || !villager.isValid() || !monster || !monster.isValid()) return false;

    const dim = villager.dimension;
    const vLoc = villager.location;
    const mLoc = monster.location;

    // 1. Face the monster
    try {
        const rot = getLookRotation(vLoc, mLoc);
        villager.teleport(vLoc, { rotation: { x: rot.x * 0.4, y: rot.y } });
    } catch {}

    // 2. Aim animation
    try {
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    // 3. Projectile spawn position
    const rad = (villager.getRotation().y * Math.PI) / 180.0;
    const forwardX = -Math.sin(rad) * 0.6;
    const forwardZ = Math.cos(rad) * 0.6;
    const spawnPos = {
        x: vLoc.x + forwardX,
        y: vLoc.y + 1.4,
        z: vLoc.z + forwardZ
    };

    // Target monster's chest
    const targetChest = {
        x: mLoc.x + (Math.random() - 0.5) * 0.2,
        y: mLoc.y + 0.9,
        z: mLoc.z + (Math.random() - 0.5) * 0.2
    };

    const dirX = targetChest.x - spawnPos.x;
    const dirY = targetChest.y - spawnPos.y;
    const dirZ = targetChest.z - spawnPos.z;
    const dist = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ) || 1.0;

    const speed = FLETCHER_CONFIG.ARROW_SPEED || 2.2;
    const arcComp = dist * 0.035;
    const velX = (dirX / dist) * speed;
    const velY = ((dirY + arcComp) / dist) * speed;
    const velZ = (dirZ / dist) * speed;

    // 4. Spawn projectile
    try {
        const arrow = dim.spawnEntity(FLETCHER_CONFIG.ARROW_ITEM_ID, spawnPos);
        if (arrow && arrow.isValid()) {
            try {
                const proj = arrow.getComponent("minecraft:projectile");
                if (proj && typeof proj.shoot === "function") {
                    proj.shoot({ x: velX, y: velY, z: velZ }, { uncertainty: 0.3 });
                } else {
                    arrow.applyImpulse({ x: velX, y: velY, z: velZ });
                }
            } catch {
                arrow.applyImpulse({ x: velX, y: velY, z: velZ });
            }
        }
    } catch (e) {
        console.warn(`[Fletcher] Error spawning combat arrow: ${e}`);
    }

    // 5. Sound and Fire effects
    const hasFireNear = isNearFireSource(dim, vLoc, FLETCHER_CONFIG.FIRE_SEARCH_RADIUS);
    if (hasFireNear) {
        spawnParticleSafe(dim, "minecraft:flame", spawnPos);
        try { monster.setOnFire(4); } catch {}
    }

    if (isCrossbow) {
        playSoundSafe(dim, "crossbow.shoot", spawnPos, { volume: 1.0, pitch: 1.0 });
    } else {
        playSoundSafe(dim, "random.bow", spawnPos, { volume: 1.0, pitch: 1.0 });
    }

    // 6. Direct damage and tactical debuffs
    const damage = isCrossbow ? 9 : 6;
    try {
        monster.applyDamage(damage, { damagingEntity: villager });
        playSoundSafe(dim, "damage.hit", mLoc, { volume: 0.8, pitch: 1.1 });
        spawnParticleSafe(dim, "minecraft:crit", { x: mLoc.x, y: mLoc.y + 1.0, z: mLoc.z });

        // Tactical arrow effects based on monster type
        if (monster.typeId.includes("spider") || monster.typeId.includes("creeper")) {
            monster.addEffect("slowness", 100, { amplifier: 1, showParticles: true });
        } else if (monster.typeId.includes("pillager") || monster.typeId.includes("vindicator") || monster.typeId.includes("ravager")) {
            monster.addEffect("poison", 80, { amplifier: 0, showParticles: true });
        }
    } catch {
        try {
            villager.runCommandAsync(`damage @e[type=!villager,type=!villager_v2,type=!player,c=1,r=20] ${damage} projectile entity @s`).catch(() => {});
        } catch {}
    }

    return true;
}

/**
 * Checks if a fire or torch block is nearby.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 */
export function isNearFireSource(dimension, location, radius = 4) {
    if (!dimension || !location) return false;
    const ox = Math.floor(location.x);
    const oy = Math.floor(location.y);
    const oz = Math.floor(location.z);

    for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
            for (let dy = -1; dy <= 2; dy++) {
                const pos = { x: ox + dx, y: oy + dy, z: oz + dz };
                try {
                    const block = dimension.getBlock(pos);
                    if (block && (block.typeId.includes("fire") || block.typeId.includes("torch") || block.typeId.includes("campfire"))) {
                        return true;
                    }
                } catch {}
            }
        }
    }
    return false;
}

/**
 * Scans for a nearby Fletching Table workstation.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 */
export function findNearbyFletchingTable(dimension, location, radius = FLETCHER_CONFIG.FLETCHING_TABLE_RADIUS) {
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
                    if (block && block.typeId === FLETCHER_CONFIG.FLETCHING_TABLE_ID) {
                        return { block, pos };
                    }
                } catch {}
            }
        }
    }
    return null;
}

/**
 * Crafts special arrows at the fletching table.
 * @param {Entity} villager 
 * @param {Vector3} tablePos 
 */
export function performCraftTippedArrows(villager, tablePos) {
    if (!villager || !villager.isValid() || !tablePos) return false;
    const dim = villager.dimension;

    try {
        const rot = getLookRotation(villager.location, { x: tablePos.x + 0.5, y: tablePos.y + 0.5, z: tablePos.z + 0.5 });
        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    playSoundSafe(dim, "item.axe.strip", tablePos, { volume: 0.9, pitch: 1.1 });
    playSoundSafe(dim, "random.pop", tablePos, { volume: 0.9, pitch: 1.3 });
    spawnParticleSafe(dim, "minecraft:crit", { x: tablePos.x + 0.5, y: tablePos.y + 0.8, z: tablePos.z + 0.5 });
    spawnParticleSafe(dim, "minecraft:villager_happy", { x: tablePos.x + 0.5, y: tablePos.y + 1.2, z: tablePos.z + 0.5 });

    // Drop arrow reward
    try {
        const dropEntity = dim.spawnItem(new ItemStack(FLETCHER_CONFIG.ARROW_ITEM_ID, 2), {
            x: tablePos.x + 0.5,
            y: tablePos.y + 0.7,
            z: tablePos.z + 0.5
        });
        if (dropEntity) {
            notifyDroppedItem(villager, dropEntity);
        }
    } catch {}

    playSoundSafe(dim, "mob.villager.yes", villager.location, { volume: 0.9, pitch: 1.05 });
    return true;
}

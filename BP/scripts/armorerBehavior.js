/**
 * Villager Professions Addon - Armorer Behavior Module (Namespace: rpc)
 * Coordinates iron ingot equipment, damaged Iron Golem detection & repairs,
 * blast furnace forging routines, and protective maintenance.
 */

import { ItemStack, EquipmentSlot, system } from "@minecraft/server";
import { ARMORER_CONFIG, FLETCHER_CONFIG } from "./config.js";
import { distance, getLookRotation, playSoundSafe, spawnParticleSafe, setBlockSafe, isSolidGround } from "./utils.js";

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

/**
 * Equips iron block in armorer's main hand.
 * @param {Entity} villager 
 */
export function equipIronBlock(villager) {
    if (!villager || !villager.isValid()) return;
    try {
        const equippable = villager.getComponent("minecraft:equippable");
        equippable?.setEquipment(EquipmentSlot.Mainhand, new ItemStack(ARMORER_CONFIG.IRON_BLOCK_ID || "minecraft:iron_block", 1));
    } catch {}
}

/**
 * Equips carved pumpkin in armorer's main hand.
 * @param {Entity} villager 
 */
export function equipPumpkin(villager) {
    if (!villager || !villager.isValid()) return;
    try {
        const equippable = villager.getComponent("minecraft:equippable");
        equippable?.setEquipment(EquipmentSlot.Mainhand, new ItemStack(ARMORER_CONFIG.CARVED_PUMPKIN_ID || "minecraft:carved_pumpkin", 1));
    } catch {}
}

/**
 * Detects if a raid or major hostile assault is currently active near the armorer.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 * @returns {Entity|null}
 */
export function findNearbyRaidThreat(dimension, location, radius = ARMORER_CONFIG.RAID_SEARCH_RADIUS || 24) {
    if (!dimension || !location) return null;

    const raidMobTypes = [
        "minecraft:pillager",
        "minecraft:vindicator",
        "minecraft:evoker",
        "minecraft:ravager",
        "minecraft:witch",
        "minecraft:illusioner",
        "minecraft:vex",
        "minecraft:zombie",
        "minecraft:husk",
        "minecraft:zombie_villager"
    ];

    for (const mobType of raidMobTypes) {
        try {
            const mobs = dimension.getEntities({
                type: mobType,
                location: location,
                maxDistance: radius
            });
            for (const mob of mobs) {
                if (mob && mob.isValid()) {
                    return mob;
                }
            }
        } catch {}
    }

    return null;
}

/**
 * Finds a suitable 3-block high clear spot on solid ground to construct an Iron Golem.
 * Checks that the center and arms are completely free air, avoiding existing blocks.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 * @returns {{ center: Vector3, axis: 'x'|'z' } | null}
 */
export function findNearbyGolemConstructionSpot(dimension, location, radius = 10) {
    if (!dimension || !location) return null;
    const ox = Math.floor(location.x);
    const oy = Math.floor(location.y);
    const oz = Math.floor(location.z);

    for (let dx = -radius; dx <= radius; dx += 2) {
        for (let dz = -radius; dz <= radius; dz += 2) {
            for (let dy = -1; dy <= 2; dy++) {
                const cx = ox + dx;
                const cy = oy + dy;
                const cz = oz + dz;

                try {
                    const ground = dimension.getBlock({ x: cx, y: cy - 1, z: cz });
                    if (!isSolidGround(ground)) continue;

                    const bStem = dimension.getBlock({ x: cx, y: cy, z: cz });
                    const bChest = dimension.getBlock({ x: cx, y: cy + 1, z: cz });
                    const bHead = dimension.getBlock({ x: cx, y: cy + 2, z: cz });

                    if (!bStem?.isAir || !bChest?.isAir || !bHead?.isAir) continue;

                    // Check X-axis arms: (cx-1, cy+1, cz) and (cx+1, cy+1, cz)
                    const bArmX1 = dimension.getBlock({ x: cx - 1, y: cy + 1, z: cz });
                    const bArmX2 = dimension.getBlock({ x: cx + 1, y: cy + 1, z: cz });
                    if (bArmX1?.isAir && bArmX2?.isAir) {
                        return { center: { x: cx, y: cy, z: cz }, axis: 'x' };
                    }

                    // Check Z-axis arms: (cx, cy+1, cz-1) and (cx, cy+1, cz+1)
                    const bArmZ1 = dimension.getBlock({ x: cx, y: cy + 1, z: cz - 1 });
                    const bArmZ2 = dimension.getBlock({ x: cx, y: cy + 1, z: cz + 1 });
                    if (bArmZ1?.isAir && bArmZ2?.isAir) {
                        return { center: { x: cx, y: cy, z: cz }, axis: 'z' };
                    }
                } catch {}
            }
        }
    }

    return null;
}

/**
 * Assembles an Iron Golem during a raid:
 * Staged placement of 4 iron blocks in a T-shape and a carved pumpkin on top,
 * followed by animation/sound effects and spawning the live Iron Golem.
 * @param {Entity} villager 
 * @param {{ center: Vector3, axis: 'x'|'z' }} spotInfo 
 */
export function performAssembleRaidGolem(villager, spotInfo) {
    if (!villager || !villager.isValid() || !spotInfo || !spotInfo.center) return false;
    const dim = villager.dimension;
    const { center, axis } = spotInfo;

    const stemPos = { x: center.x, y: center.y, z: center.z };
    const chestPos = { x: center.x, y: center.y + 1, z: center.z };
    const headPos = { x: center.x, y: center.y + 2, z: center.z };
    const arm1Pos = axis === 'x' ? { x: center.x - 1, y: center.y + 1, z: center.z } : { x: center.x, y: center.y + 1, z: center.z - 1 };
    const arm2Pos = axis === 'x' ? { x: center.x + 1, y: center.y + 1, z: center.z } : { x: center.x, y: center.y + 1, z: center.z + 1 };

    // Turn villager towards construction spot
    try {
        const rot = getLookRotation(villager.location, { x: center.x + 0.5, y: center.y + 1, z: center.z + 0.5 });
        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
    } catch {}

    // Stage 1 (0 ticks): Place bottom iron block (legs/stem)
    equipIronBlock(villager);
    try { villager.playAnimation("animation.villager.raise_arms"); } catch {}
    const bStem = dim.getBlock(stemPos);
    if (bStem && bStem.isAir) {
        setBlockSafe(bStem, ARMORER_CONFIG.IRON_BLOCK_ID || "minecraft:iron_block");
        playSoundSafe(dim, "dig.stone", stemPos, { volume: 0.9, pitch: 0.8 });
        spawnParticleSafe(dim, "minecraft:villager_happy", { x: stemPos.x + 0.5, y: stemPos.y + 1.0, z: stemPos.z + 0.5 });
    }

    // Stage 2 (8 ticks): Place central chest iron block
    system.runTimeout(() => {
        try {
            if (!villager || !villager.isValid()) return;
            const bChest = dim.getBlock(chestPos);
            if (bChest && bChest.isAir) {
                setBlockSafe(bChest, ARMORER_CONFIG.IRON_BLOCK_ID || "minecraft:iron_block");
                playSoundSafe(dim, "dig.stone", chestPos, { volume: 0.9, pitch: 0.9 });
                villager.playAnimation("animation.villager.raise_arms");
            }
        } catch {}
    }, 8);

    // Stage 3 (16 ticks): Place left and right iron block arms
    system.runTimeout(() => {
        try {
            if (!villager || !villager.isValid()) return;
            const bArm1 = dim.getBlock(arm1Pos);
            const bArm2 = dim.getBlock(arm2Pos);
            if (bArm1 && bArm1.isAir) setBlockSafe(bArm1, ARMORER_CONFIG.IRON_BLOCK_ID || "minecraft:iron_block");
            if (bArm2 && bArm2.isAir) setBlockSafe(bArm2, ARMORER_CONFIG.IRON_BLOCK_ID || "minecraft:iron_block");
            playSoundSafe(dim, "random.anvil_land", chestPos, { volume: 0.8, pitch: 1.2 });
            equipPumpkin(villager);
            villager.playAnimation("animation.villager.raise_arms");
        } catch {}
    }, 16);

    // Stage 4 (24 ticks): Place carved pumpkin head!
    system.runTimeout(() => {
        try {
            if (!villager || !villager.isValid()) return;
            const bHead = dim.getBlock(headPos);
            if (bHead && bHead.isAir) {
                setBlockSafe(bHead, ARMORER_CONFIG.CARVED_PUMPKIN_ID || "minecraft:carved_pumpkin");
                playSoundSafe(dim, "block.pumpkin.carve", headPos, { volume: 1.0, pitch: 1.0 });
                playSoundSafe(dim, "random.anvil_use", headPos, { volume: 1.0, pitch: 1.0 });
                villager.playAnimation("animation.villager.raise_arms");
            }
        } catch {}
    }, 24);

    // Stage 5 (32 ticks): The Golem Awakes! Convert blocks to active Iron Golem entity!
    system.runTimeout(() => {
        try {
            const spawnPos = { x: center.x + 0.5, y: center.y, z: center.z + 0.5 };

            // Check if vanilla Minecraft already spawned the Iron Golem from the block pattern!
            let existingGolems = [];
            try {
                existingGolems = dim.getEntities({
                    type: "minecraft:iron_golem",
                    location: spawnPos,
                    maxDistance: 3.5
                });
            } catch {}

            // Remove any lingering construction blocks if vanilla didn't already consume them
            const bs = dim.getBlock(stemPos);
            const bc = dim.getBlock(chestPos);
            const ba1 = dim.getBlock(arm1Pos);
            const ba2 = dim.getBlock(arm2Pos);
            const bh = dim.getBlock(headPos);

            if (bs && bs.typeId.includes("iron_block")) setBlockSafe(bs, "minecraft:air");
            if (bc && bc.typeId.includes("iron_block")) setBlockSafe(bc, "minecraft:air");
            if (ba1 && ba1.typeId.includes("iron_block")) setBlockSafe(ba1, "minecraft:air");
            if (ba2 && ba2.typeId.includes("iron_block")) setBlockSafe(ba2, "minecraft:air");
            if (bh && (bh.typeId.includes("pumpkin") || bh.typeId.includes("carved_pumpkin"))) setBlockSafe(bh, "minecraft:air");

            // Only spawn if vanilla hasn't already spawned the Iron Golem! Prevents duplicate 2-golem spawn!
            if (existingGolems.length === 0) {
                dim.spawnEntity("minecraft:iron_golem", spawnPos);
            }

            spawnParticleSafe(dim, "minecraft:totem_particle", { x: spawnPos.x, y: spawnPos.y + 1.5, z: spawnPos.z });
            spawnParticleSafe(dim, "minecraft:smoke_particle", { x: spawnPos.x, y: spawnPos.y + 1.0, z: spawnPos.z });
            spawnParticleSafe(dim, "minecraft:villager_happy", { x: spawnPos.x, y: spawnPos.y + 2.0, z: spawnPos.z });
            playSoundSafe(dim, "mob.irongolem.death", spawnPos, { volume: 1.0, pitch: 1.2 });
            playSoundSafe(dim, "random.anvil_land", spawnPos, { volume: 1.0, pitch: 0.8 });

            if (villager && villager.isValid()) {
                playSoundSafe(dim, "mob.villager.yes", villager.location, { volume: 1.0, pitch: 1.05 });
                equipIngot(villager);
            }
        } catch (e) {
            console.warn(`[Armorer] Error completing golem assembly: ${e}`);
        }
    }, 32);

    return true;
}

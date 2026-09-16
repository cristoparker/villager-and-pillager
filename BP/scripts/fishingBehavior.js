/**
 * Fisherman Villager Addon - Fishing Behavior Module (Namespace: rpc)
 * Handles equipping rpc:fishing_rod, casting rpc:fishing_bobber far into the river,
 * keeping the hook floating smoothly on the water surface, and drawing a continuous rope/string particle line.
 */

import { world, ItemStack, EquipmentSlot } from "@minecraft/server";
import { FISHING_CONFIG, LOOT_TABLE } from "./config.js";
import { 
    getLookRotation, 
    playSoundSafe, 
    spawnParticleSafe, 
    drawParticleLine, 
    pickRandomLoot 
} from "./utils.js";
import { findCastTarget, findWaterSurfaceY } from "./waterScanner.js";

/**
 * Calculates the exact tip position of the held fishing rod in world space.
 */
export function getRodTipPosition(villager) {
    const loc = villager.location;
    const rot = villager.getRotation ? villager.getRotation() : { x: 0, y: 0 };
    const yawRad = rot.y * (Math.PI / 180);

    // Forward direction unit vector
    const dirX = -Math.sin(yawRad);
    const dirZ = Math.cos(yawRad);
    // Right arm offset
    const rightX = Math.cos(yawRad) * 0.35;
    const rightZ = Math.sin(yawRad) * 0.35;

    // Rod extends forward from the villager's hands
    return {
        x: loc.x + rightX + dirX * 1.35,
        y: loc.y + 1.55,
        z: loc.z + rightZ + dirZ * 1.35
    };
}

/**
 * Starts the fishing sequence: equips rpc:fishing_rod item, throws hook far into river.
 */
export function startFishing(villager, spot) {
    if (!villager || !villager.isValid()) return null;

    let castTarget = spot?.castTarget;
    if (!castTarget) {
        castTarget = findCastTarget(villager.dimension, villager.location);
    }
    if (!castTarget) {
        // Fallback: 6 blocks in front of villager
        const rot = villager.getRotation ? villager.getRotation() : { x: 0, y: 0 };
        const yawRad = rot.y * (Math.PI / 180);
        castTarget = {
            x: villager.location.x - Math.sin(yawRad) * 6,
            y: villager.location.y - 0.2,
            z: villager.location.z + Math.cos(yawRad) * 6
        };
    }

    world.sendMessage(`§e[DEBUG] Start fishing! Cast target: (${Math.floor(castTarget.x)}, ${Math.floor(castTarget.y)}, ${Math.floor(castTarget.z)})`);

    // 1. Trigger custom event: sets movement speed to 0.0 so villager stands firmly on land!
    try {
        villager.triggerEvent("rpc:start_fishing");
    } catch {}

    // 2. Equip custom rpc:fishing_rod item in mainhand
    try {
        const equippable = villager.getComponent("minecraft:equippable");
        if (equippable) {
            equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack(FISHING_CONFIG.FISHING_ROD_ITEM_ID, 1));
        }
    } catch {}

    try {
        villager.runCommandAsync("replaceitem entity @s slot.weapon.mainhand 0 rpc:fishing_rod").catch(() => {});
    } catch {}

    // 3. Face water cast spot ONCE (do NOT repeatedly teleport every tick!)
    const rot = getLookRotation(villager.location, castTarget);
    try {
        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    // 4. Play cast sound
    playSoundSafe(villager.dimension, "random.bow", villager.location, { volume: 1.0, pitch: 0.85 });

    // 5. Spawn and throw hook far into the river
    const rodTip = getRodTipPosition(villager);
    let bobber = null;

    try {
        bobber = villager.dimension.spawnEntity(FISHING_CONFIG.BOBBER_ENTITY_ID, {
            x: rodTip.x,
            y: rodTip.y + 0.2,
            z: rodTip.z
        });

        const dx = castTarget.x - rodTip.x;
        const dz = castTarget.z - rodTip.z;
        const horizDist = Math.hypot(dx, dz) || 1;
        const speed = Math.min(1.4, Math.max(0.65, horizDist * 0.088));

        bobber.applyImpulse({
            x: (dx / horizDist) * speed,
            y: 0.48,
            z: (dz / horizDist) * speed
        });
        world.sendMessage("§a[DEBUG] Hook cast smoothly into water!");
    } catch {
        try {
            bobber = villager.dimension.spawnEntity(FISHING_CONFIG.BOBBER_ENTITY_ID, castTarget);
        } catch {}
    }

    playSoundSafe(villager.dimension, "random.splash", castTarget, { volume: 0.9, pitch: 1.1 });

    const biteDelayTicks = Math.floor(
        Math.random() * (FISHING_CONFIG.MAX_BITE_TICKS - FISHING_CONFIG.MIN_BITE_TICKS)
    ) + FISHING_CONFIG.MIN_BITE_TICKS;

    return {
        villager: villager,
        spot: spot,
        castTarget: castTarget,
        bobber: bobber,
        stage: "WAITING",
        ticksLeft: biteDelayTicks,
        elapsedTicks: 0,
        waterSurfaceY: null
    };
}

/**
 * Updates ongoing fishing session each tick.
 */
export function tickFishing(session) {
    const { villager, castTarget, bobber } = session;

    if (!villager || !villager.isValid()) {
        cleanupSession(session);
        return false;
    }

    session.elapsedTicks++;
    session.ticksLeft--;

    // Keep bobber floating over water like normal player fishing rod
    if (bobber && bobber.isValid()) {
        const bobberPos = bobber.location;
        if (session.waterSurfaceY === null || session.elapsedTicks % 20 === 0) {
            const foundY = findWaterSurfaceY(villager.dimension, bobberPos.x, bobberPos.y + 2, bobberPos.z);
            if (foundY !== null) {
                session.waterSurfaceY = foundY;
            }
        }

        if (session.waterSurfaceY !== null) {
            // Gentle floating wave bobbing
            const isBiting = session.stage === "BITING";
            const wave = isBiting ? -0.25 : Math.sin(session.elapsedTicks * 0.18) * 0.04;

            bobber.teleport({
                x: bobberPos.x,
                y: session.waterSurfaceY + 0.88 + wave,
                z: bobberPos.z
            });
            bobber.clearVelocity();
        }
    }

    const bobberLoc = (bobber && bobber.isValid()) ? bobber.location : castTarget;

    // DRAW VISIBLE STRING: connects rod tip to hook eyelet with realistic physics
    const rodTip = getRodTipPosition(villager);
    const hookAttachPoint = {
        x: bobberLoc.x,
        y: bobberLoc.y + 0.18, // Connects directly to top eyelet of fishing hook
        z: bobberLoc.z
    };

    drawParticleLine(villager.dimension, rodTip, hookAttachPoint, {
        isTight: (session.stage === "BITING"),
        waterSurfaceY: session.waterSurfaceY,
        tick: session.elapsedTicks
    });

    // Water ripple ring around bobber
    if (session.elapsedTicks % 16 === 0) {
        spawnParticleSafe(villager.dimension, "minecraft:water_wake_particle", bobberLoc);
    }

    // Fish bite phase
    if (session.stage === "WAITING" && session.ticksLeft <= FISHING_CONFIG.BITE_WINDOW_TICKS) {
        session.stage = "BITING";
        world.sendMessage("§6[DEBUG] Hook tugged down! Fish biting!");
        playSoundSafe(villager.dimension, "random.splash", bobberLoc, { volume: 1.2, pitch: 0.9 });
        spawnParticleSafe(villager.dimension, "minecraft:water_splash_particle", bobberLoc);
        spawnParticleSafe(villager.dimension, "minecraft:bubble_column_bubble", bobberLoc);
        spawnParticleSafe(villager.dimension, "minecraft:fish_hook_particle", bobberLoc);
    }

    // Bite complete: Reel in
    if (session.ticksLeft <= 0) {
        reelInAndCatch(session);
        return false;
    }

    return true;
}

/**
 * Reels in the hook, despawns bobber, launches fish across river, and celebrates.
 */
export function reelInAndCatch(session) {
    const { villager, castTarget, bobber } = session;
    if (!villager || !villager.isValid()) {
        cleanupSession(session);
        return;
    }

    const bobberLoc = (bobber && bobber.isValid()) ? bobber.location : castTarget;

    // 1. Play retrieve sounds
    playSoundSafe(villager.dimension, "random.bow", villager.location, { volume: 1.0, pitch: 1.2 });
    playSoundSafe(villager.dimension, "random.splash", bobberLoc, { volume: 1.0, pitch: 1.0 });

    // 2. Remove bobber
    cleanupSession(session);

    // 3. Trigger stop fishing event (restores movement)
    try {
        villager.triggerEvent("rpc:stop_fishing");
    } catch {}

    // 4. Launch caught fish item from river to villager
    const loot = pickRandomLoot(LOOT_TABLE);
    world.sendMessage(`§a[DEBUG] Caught fish: ${loot.typeId}! Reeling to shore.`);

    try {
        const fishItem = new ItemStack(loot.typeId, 1);
        const spawnedItem = villager.dimension.spawnItem(fishItem, {
            x: bobberLoc.x,
            y: bobberLoc.y + 0.4,
            z: bobberLoc.z
        });

        if (spawnedItem && spawnedItem.isValid()) {
            const dx = villager.location.x - bobberLoc.x;
            const dz = villager.location.z - bobberLoc.z;
            const horizDist = Math.hypot(dx, dz) || 1;
            const speed = Math.min(1.3, Math.max(0.55, horizDist * 0.085));
            spawnedItem.applyImpulse({
                x: (dx / horizDist) * speed,
                y: 0.52,
                z: (dz / horizDist) * speed
            });
        }
    } catch {
        try {
            villager.dimension.spawnItem(new ItemStack(loot.typeId, 1), villager.location);
        } catch {}
    }

    // 5. Celebration
    spawnParticleSafe(villager.dimension, "minecraft:villager_happy", {
        x: villager.location.x,
        y: villager.location.y + 1.8,
        z: villager.location.z
    });
    playSoundSafe(villager.dimension, "mob.villager.yes", villager.location, { volume: 1.0, pitch: 1.0 });
}

/**
 * Cleans up session entities.
 */
export function cleanupSession(session) {
    if (session && session.bobber && session.bobber.isValid()) {
        try {
            session.bobber.remove();
        } catch {}
        session.bobber = null;
    }
}

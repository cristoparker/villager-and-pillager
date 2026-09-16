/**
 * Fisherman Villager Addon - Fishing Behavior Module (Namespace: rpc)
 * Handles equipping rpc:fishing_rod, placing rpc:fishing_bobber on the river surface,
 * keeping the hook floating smoothly on the water, and drawing a continuous rope/string particle line.
 */

import { ItemStack, EquipmentSlot } from "@minecraft/server";
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
 * Matched to the tip of the item model held in the villager's right hand.
 */
export function getRodTipPosition(villager) {
    const loc = villager.location;
    const rot = villager.getRotation ? villager.getRotation() : { x: 0, y: 0 };
    const yawRad = rot.y * (Math.PI / 180);

    // Forward direction unit vector
    const dirX = -Math.sin(yawRad);
    const dirZ = Math.cos(yawRad);
    // Right hand offset
    const rightX = Math.cos(yawRad) * 0.32;
    const rightZ = Math.sin(yawRad) * 0.32;

    // Rod tip: reaches forward ~0.65 blocks from body and sits at chest height (~1.18 blocks up)
    return {
        x: loc.x + rightX + dirX * 0.65,
        y: loc.y + 1.18,
        z: loc.z + rightZ + dirZ * 0.65
    };
}

/**
 * Starts the fishing sequence: equips rpc:fishing_rod item, places hook in river water.
 */
export function startFishing(villager, spot) {
    if (!villager || !villager.isValid()) return null;

    let castTarget = spot?.castTarget;
    if (!castTarget) {
        castTarget = findCastTarget(villager.dimension, villager);
    }
    if (!castTarget) {
        // Fallback: search 2 to 4 blocks in front of villager for water surface
        const rot = villager.getRotation ? villager.getRotation() : { x: 0, y: 0 };
        const yawRad = rot.y * (Math.PI / 180);
        const fX = -Math.sin(yawRad);
        const fZ = Math.cos(yawRad);
        const waterY = findWaterSurfaceY(villager.dimension, villager.location.x + fX * 3, villager.location.y, villager.location.z + fZ * 3);
        const targetY = (waterY !== null) ? waterY + 0.88 : (villager.location.y - 0.12);
        castTarget = {
            x: villager.location.x + fX * 3 + 0.5,
            y: targetY,
            z: villager.location.z + fZ * 3 + 0.5,
            waterSurfaceY: waterY
        };
    }

    // 1. Trigger custom event: sets movement speed to 0.0 so villager stands firmly on land
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

    // 3. Face water cast spot
    const rot = getLookRotation(villager.location, castTarget);
    try {
        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    // 4. Play cast sound at villager
    playSoundSafe(villager.dimension, "random.bow", villager.location, { volume: 1.0, pitch: 0.85 });

    // 5. Spawn bobber directly resting on top of the river water surface
    let bobber = null;
    try {
        bobber = villager.dimension.spawnEntity(FISHING_CONFIG.BOBBER_ENTITY_ID, castTarget);
    } catch {
        try {
            bobber = villager.dimension.spawnEntity(FISHING_CONFIG.BOBBER_ENTITY_ID, {
                x: castTarget.x,
                y: castTarget.y,
                z: castTarget.z
            });
        } catch {}
    }

    // Splash sound and water wake particles at the bobber in the water
    playSoundSafe(villager.dimension, "random.splash", castTarget, { volume: 0.9, pitch: 1.1 });
    spawnParticleSafe(villager.dimension, "minecraft:water_splash_particle", castTarget);

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
        waterSurfaceY: castTarget.waterSurfaceY ?? (castTarget.y - 0.88)
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

    // Keep bobber floating smoothly on the water surface with gentle wave oscillation
    if (bobber && bobber.isValid()) {
        const isBiting = session.stage === "BITING";
        const wave = isBiting ? -0.22 : Math.sin(session.elapsedTicks * 0.16) * 0.04;

        bobber.teleport({
            x: castTarget.x,
            y: castTarget.y + wave,
            z: castTarget.z
        });
        bobber.clearVelocity();
    }

    const bobberLoc = (bobber && bobber.isValid()) ? bobber.location : castTarget;

    // DRAW VISIBLE STRING: connects directly from the fishing rod tip to the hook eyelet
    const rodTip = getRodTipPosition(villager);
    const hookAttachPoint = {
        x: bobberLoc.x,
        y: bobberLoc.y + 0.18, // Connects to top eyelet of hook model
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

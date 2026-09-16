/**
 * Fisherman Villager Addon - Fishing Behavior Module (Namespace: rpc)
 * Handles equipping rpc:fishing_rod, casting rpc:fishing_bobber far into the river,
 * drawing continuous rope/string particles, and fish retrieval.
 */

import { ItemStack } from "@minecraft/server";
import { FISHING_CONFIG, LOOT_TABLE } from "./config.js";
import { 
    getLookRotation, 
    playSoundSafe, 
    spawnParticleSafe, 
    drawParticleLine, 
    pickRandomLoot 
} from "./utils.js";

import { findCastTarget } from "./waterScanner.js";

/**
 * Calculates rod tip in world coordinates from villager hand position.
 */
function getHandPosition(villager) {
    const loc = villager.location;
    const rot = villager.getRotation ? villager.getRotation() : { x: 0, y: 0 };
    const yawRad = rot.y * (Math.PI / 180);

    const forwardX = -Math.sin(yawRad) * 0.7;
    const forwardZ = Math.cos(yawRad) * 0.7;
    const rightX = Math.cos(yawRad) * 0.35;
    const rightZ = Math.sin(yawRad) * 0.35;

    return {
        x: loc.x + forwardX + rightX,
        y: loc.y + 1.25,
        z: loc.z + forwardZ + rightZ
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
        // Default: 6 blocks in front of villager
        const rot = villager.getRotation ? villager.getRotation() : { x: 0, y: 0 };
        const yawRad = rot.y * (Math.PI / 180);
        castTarget = {
            x: villager.location.x - Math.sin(yawRad) * 6,
            y: villager.location.y - 0.2,
            z: villager.location.z + Math.cos(yawRad) * 6
        };
    }

    // 1. Equip custom rpc:fishing_rod item in mainhand
    try {
        const equippable = villager.getComponent("minecraft:equippable");
        if (equippable) {
            equippable.setEquipment("Mainhand", new ItemStack(FISHING_CONFIG.FISHING_ROD_ITEM_ID, 1));
        }
    } catch {}

    try {
        villager.runCommandAsync("replaceitem entity @s slot.weapon.mainhand 0 rpc:fishing_rod").catch(() => {});
    } catch {}

    // 2. Face water cast spot
    const rot = getLookRotation(villager.location, castTarget);
    try {
        villager.teleport(villager.location, { rotation: rot });
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    // 3. Play cast sound
    playSoundSafe(villager.dimension, "random.bow", villager.location, { volume: 1.0, pitch: 0.85 });

    // 4. Calculate hand origin
    const handPos = getHandPosition(villager);

    // 5. Spawn and throw hook far into the river
    let bobber = null;
    try {
        bobber = villager.dimension.spawnEntity(FISHING_CONFIG.BOBBER_ENTITY_ID, {
            x: handPos.x,
            y: handPos.y + 0.3,
            z: handPos.z
        });

        const dx = spot.castTarget.x - handPos.x;
        const dz = spot.castTarget.z - handPos.z;
        const horizDist = Math.hypot(dx, dz) || 1;
        const speed = Math.min(1.45, Math.max(0.7, horizDist * 0.09));

        bobber.applyImpulse({
            x: (dx / horizDist) * speed,
            y: 0.52,
            z: (dz / horizDist) * speed
        });
    } catch {
        try {
            bobber = villager.dimension.spawnEntity(FISHING_CONFIG.BOBBER_ENTITY_ID, spot.castTarget);
        } catch {}
    }

    playSoundSafe(villager.dimension, "random.splash", spot.castTarget, { volume: 0.9, pitch: 1.1 });

    const biteDelayTicks = Math.floor(
        Math.random() * (FISHING_CONFIG.MAX_BITE_TICKS - FISHING_CONFIG.MIN_BITE_TICKS)
    ) + FISHING_CONFIG.MIN_BITE_TICKS;

    return {
        villager: villager,
        spot: spot,
        bobber: bobber,
        stage: "WAITING",
        ticksLeft: biteDelayTicks,
        elapsedTicks: 0
    };
}

/**
 * Updates ongoing fishing session each tick.
 */
export function tickFishing(session) {
    const { villager, spot, bobber } = session;

    if (!villager || !villager.isValid()) {
        cleanupSession(session);
        return false;
    }

    session.elapsedTicks++;
    session.ticksLeft--;

    const bobberLoc = (bobber && bobber.isValid()) ? bobber.location : spot.castTarget;

    // Face bobber with raised arms
    if (session.elapsedTicks % 3 === 0) {
        const rot = getLookRotation(villager.location, bobberLoc);
        try {
            villager.teleport(villager.location, { rotation: { x: rot.x, y: rot.y } });
            villager.playAnimation("animation.villager.raise_arms");
        } catch {}
    }

    // DRAW CONTINUOUS ROPE/STRING: from villager's hand to the hook
    const handPos = getHandPosition(villager);
    drawParticleLine(villager.dimension, handPos, bobberLoc, FISHING_CONFIG.STRING_PARTICLE_POINTS);

    // Water ripples
    if (session.elapsedTicks % 12 === 0) {
        spawnParticleSafe(villager.dimension, "minecraft:water_wake_particle", bobberLoc);
    }

    // Fish bite phase
    if (session.stage === "WAITING" && session.ticksLeft <= FISHING_CONFIG.BITE_WINDOW_TICKS) {
        session.stage = "BITING";
        playSoundSafe(villager.dimension, "random.splash", bobberLoc, { volume: 1.2, pitch: 0.9 });
        spawnParticleSafe(villager.dimension, "minecraft:water_splash_particle", bobberLoc);
        spawnParticleSafe(villager.dimension, "minecraft:bubble_column_bubble", bobberLoc);
        spawnParticleSafe(villager.dimension, "minecraft:fish_hook_particle", bobberLoc);

        if (bobber && bobber.isValid()) {
            try {
                bobber.applyImpulse({ x: 0, y: -0.16, z: 0 });
            } catch {}
        }
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
    const { villager, spot, bobber } = session;
    if (!villager || !villager.isValid()) {
        cleanupSession(session);
        return;
    }

    const bobberLoc = (bobber && bobber.isValid()) ? bobber.location : spot.castTarget;

    // 1. Play retrieve sound
    playSoundSafe(villager.dimension, "random.bow", villager.location, { volume: 1.0, pitch: 1.2 });
    playSoundSafe(villager.dimension, "random.splash", bobberLoc, { volume: 1.0, pitch: 1.0 });

    // 2. Remove bobber
    cleanupSession(session);

    // 3. Clear mainhand item or keep
    try {
        const equippable = villager.getComponent("minecraft:equippable");
        if (equippable) {
            equippable.setEquipment("Mainhand", undefined);
        }
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

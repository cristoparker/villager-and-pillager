/**
 * Fisherman Villager Addon - Fishing Behavior Module (Namespace: rpc)
 * Handles equipping rpc:fishing_rod, casting rpc:fishing_bobber with realistic trajectory physics,
 * natural water floating, reel-in flight physics, and continuous catenary particle rope rendering.
 */

import { ItemStack, EquipmentSlot } from "@minecraft/server";
import { FISHING_CONFIG, LOOT_TABLE, FISHERMAN_CONFIG } from "./config.js";
import { 
    getLookRotation, 
    playSoundSafe, 
    spawnParticleSafe, 
    drawParticleLine, 
    pickRandomLoot,
    distance,
    setEntityLook,
    isTargetUnreachable
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
 * Equips fishing rod in the fisherman's main hand.
 * @param {Entity} villager 
 */
export function equipFishingRod(villager) {
    if (!villager || !villager.isValid()) return;

    try {
        const equippable = villager.getComponent("minecraft:equippable");
        if (equippable) {
            const current = equippable.getEquipment(EquipmentSlot.Mainhand);
            if (current && (current.typeId === FISHING_CONFIG.FISHING_ROD_ITEM_ID || current.typeId === "minecraft:fishing_rod")) {
                return;
            }
            try {
                equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack(FISHING_CONFIG.FISHING_ROD_ITEM_ID, 1));
                return;
            } catch {
                try {
                    equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack("minecraft:fishing_rod", 1));
                    return;
                } catch {}
            }
        }
    } catch {}

    try {
        villager.runCommandAsync(`replaceitem entity @s slot.weapon.mainhand 0 ${FISHING_CONFIG.FISHING_ROD_ITEM_ID}`).catch(() => {
            villager.runCommandAsync(`replaceitem entity @s slot.weapon.mainhand 0 minecraft:fishing_rod`).catch(() => {});
        });
    } catch {}
}

/**
 * Unequips fishing rod from main hand.
 * @param {Entity} villager 
 */
export function unequipFishingRod(villager) {
    if (!villager || !villager.isValid()) return;
    try {
        const equippable = villager.getComponent("minecraft:equippable");
        equippable?.setEquipment(EquipmentSlot.Mainhand, undefined);
    } catch {}
}

/**
 * Starts the fishing sequence: equips rpc:fishing_rod item and throws hook with projectile velocity.
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

    // 4. Calculate rod tip and trajectory flight parameters
    const rodTip = getRodTipPosition(villager);
    const horizDist = Math.hypot(castTarget.x - rodTip.x, castTarget.z - rodTip.z);
    const flightTicks = Math.round(Math.max(12, Math.min(22, horizDist * 1.4)));
    const arcHeight = Math.max(1.2, Math.min(3.2, horizDist * 0.22));

    // 5. Spawn bobber at rod tip to begin physical throw
    let bobber = null;
    try {
        bobber = villager.dimension.spawnEntity(FISHING_CONFIG.BOBBER_ENTITY_ID, {
            x: rodTip.x,
            y: rodTip.y,
            z: rodTip.z
        });
    } catch {
        try {
            bobber = villager.dimension.spawnEntity(FISHING_CONFIG.BOBBER_ENTITY_ID, castTarget);
        } catch {}
    }

    // Cast whoosh sound at villager
    playSoundSafe(villager.dimension, "random.bow", villager.location, { volume: 1.0, pitch: 0.85 });

    const biteDelayTicks = Math.floor(
        Math.random() * (FISHING_CONFIG.MAX_BITE_TICKS - FISHING_CONFIG.MIN_BITE_TICKS)
    ) + FISHING_CONFIG.MIN_BITE_TICKS;

    return {
        villager: villager,
        spot: spot,
        castTarget: castTarget,
        bobber: bobber,
        stage: "CASTING", // Starts in dynamic projectile throwing phase
        castTicks: flightTicks,
        castElapsed: 0,
        castStart: { x: rodTip.x, y: rodTip.y, z: rodTip.z },
        castEnd: { x: castTarget.x, y: castTarget.y, z: castTarget.z },
        castArcHeight: arcHeight,
        ticksLeft: biteDelayTicks,
        elapsedTicks: 0,
        waterSurfaceY: castTarget.waterSurfaceY ?? (castTarget.y - 0.88),
        reelTicks: 0,
        reelElapsed: 0,
        reelStart: null,
        reelEnd: null,
        reelArcHeight: 0,
        caughtItem: null
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
    const rodTip = getRodTipPosition(villager);

    // ==========================================
    // STAGE 1: CASTING (Projectile flight to water)
    // ==========================================
    if (session.stage === "CASTING") {
        session.castElapsed++;
        const p = Math.min(1.0, session.castElapsed / session.castTicks);

        // Ballistic parabolic trajectory: y = linear + 4 * p * (1 - p) * H
        const pArc = 4 * p * (1 - p) * session.castArcHeight;
        const curX = session.castStart.x + (session.castEnd.x - session.castStart.x) * p;
        const curZ = session.castStart.z + (session.castEnd.z - session.castStart.z) * p;
        const curY = session.castStart.y + (session.castEnd.y - session.castStart.y) * p + pArc;

        if (bobber && bobber.isValid()) {
            bobber.teleport({ x: curX, y: curY, z: curZ });
            bobber.clearVelocity();
        }

        // Draw taut fishing line following the flying hook
        const hookAttachPoint = { x: curX, y: curY + 0.18, z: curZ };
        drawParticleLine(villager.dimension, rodTip, hookAttachPoint, {
            isTight: true,
            tick: session.elapsedTicks
        });

        if (p >= 1.0) {
            // Hook touches down on water surface
            session.stage = "WAITING";
            playSoundSafe(villager.dimension, "random.splash", session.castEnd, { volume: 0.9, pitch: 1.1 });
            spawnParticleSafe(villager.dimension, "minecraft:water_splash_particle", session.castEnd);
            spawnParticleSafe(villager.dimension, "minecraft:water_wake_particle", session.castEnd);
        }

        return true;
    }

    // ==========================================
    // STAGE 2: WAITING & BITING (Floating on water)
    // ==========================================
    if (session.stage === "WAITING" || session.stage === "BITING") {
        session.ticksLeft--;

        const isBiting = (session.stage === "BITING");
        const wave = isBiting ? -0.22 : Math.sin(session.elapsedTicks * 0.16) * 0.04;

        if (bobber && bobber.isValid()) {
            bobber.teleport({
                x: castTarget.x,
                y: castTarget.y + wave,
                z: castTarget.z
            });
            bobber.clearVelocity();
        }

        const bobberLoc = (bobber && bobber.isValid()) ? bobber.location : castTarget;
        const hookAttachPoint = {
            x: bobberLoc.x,
            y: bobberLoc.y + 0.18,
            z: bobberLoc.z
        };

        drawParticleLine(villager.dimension, rodTip, hookAttachPoint, {
            isTight: isBiting,
            waterSurfaceY: session.waterSurfaceY,
            tick: session.elapsedTicks
        });

        // Water ripple ring around bobber
        if (session.elapsedTicks % 16 === 0) {
            spawnParticleSafe(villager.dimension, "minecraft:water_wake_particle", bobberLoc);
        }

        // Bite trigger
        if (session.stage === "WAITING" && session.ticksLeft <= FISHING_CONFIG.BITE_WINDOW_TICKS) {
            session.stage = "BITING";
            playSoundSafe(villager.dimension, "random.splash", bobberLoc, { volume: 1.2, pitch: 0.9 });
            spawnParticleSafe(villager.dimension, "minecraft:water_splash_particle", bobberLoc);
            spawnParticleSafe(villager.dimension, "minecraft:bubble_column_bubble", bobberLoc);
            spawnParticleSafe(villager.dimension, "minecraft:fish_hook_particle", bobberLoc);
        }

        // Bite complete -> Start Reeling phase with physics
        if (session.ticksLeft <= 0) {
            startReeling(session);
        }

        return true;
    }

    // ==========================================
    // STAGE 3: REELING (Projectile arc back to villager)
    // ==========================================
    if (session.stage === "REELING") {
        session.reelElapsed++;
        const p = Math.min(1.0, session.reelElapsed / session.reelTicks);

        // Ballistic parabolic trajectory returning to villager
        const pArc = 4 * p * (1 - p) * session.reelArcHeight;
        const curX = session.reelStart.x + (session.reelEnd.x - session.reelStart.x) * p;
        const curZ = session.reelStart.z + (session.reelEnd.z - session.reelStart.z) * p;
        const curY = session.reelStart.y + (session.reelEnd.y - session.reelStart.y) * p + pArc;

        if (bobber && bobber.isValid()) {
            bobber.teleport({ x: curX, y: curY, z: curZ });
            bobber.clearVelocity();
        }

        if (session.caughtItem && session.caughtItem.isValid()) {
            session.caughtItem.teleport({ x: curX, y: curY - 0.15, z: curZ });
            session.caughtItem.clearVelocity();
        }

        const hookAttachPoint = { x: curX, y: curY + 0.18, z: curZ };
        drawParticleLine(villager.dimension, rodTip, hookAttachPoint, {
            isTight: true,
            tick: session.elapsedTicks
        });

        if (p >= 1.0) {
            // Reeling complete: cleanup and celebrate
            cleanupSession(session);
            try {
                villager.triggerEvent("rpc:stop_fishing");
            } catch {}

            spawnParticleSafe(villager.dimension, "minecraft:villager_happy", {
                x: villager.location.x,
                y: villager.location.y + 1.8,
                z: villager.location.z
            });
            playSoundSafe(villager.dimension, "mob.villager.yes", villager.location, { volume: 1.0, pitch: 1.0 });

            return false;
        }

        return true;
    }

    return true;
}

/**
 * Initiates reel-in phase with ballistic trajectory returning to villager.
 */
function startReeling(session) {
    const { villager, castTarget } = session;
    session.stage = "REELING";

    const rodTip = getRodTipPosition(villager);
    const horizDist = Math.hypot(castTarget.x - rodTip.x, castTarget.z - rodTip.z);

    session.reelTicks = Math.round(Math.max(12, Math.min(22, horizDist * 1.3)));
    session.reelElapsed = 0;
    session.reelStart = { x: castTarget.x, y: castTarget.y, z: castTarget.z };
    session.reelEnd = { x: rodTip.x, y: villager.location.y + 0.75, z: rodTip.z };
    session.reelArcHeight = Math.max(1.4, Math.min(3.0, horizDist * 0.2));

    // Spawn caught fish item that flies along the arc alongside the hook
    const loot = pickRandomLoot(LOOT_TABLE);
    try {
        const fishItem = new ItemStack(loot.typeId, 1);
        session.caughtItem = villager.dimension.spawnItem(fishItem, {
            x: castTarget.x,
            y: castTarget.y + 0.3,
            z: castTarget.z
        });
    } catch {}

    playSoundSafe(villager.dimension, "random.bow", villager.location, { volume: 1.0, pitch: 1.2 });
    playSoundSafe(villager.dimension, "random.splash", castTarget, { volume: 1.0, pitch: 1.0 });
}

/**
 * Cleans up session entities.
 */
export function cleanupSession(session) {
    if (session) {
        if (session.bobber && session.bobber.isValid()) {
            try {
                session.bobber.remove();
            } catch {}
            session.bobber = null;
        }
    }
}

/**
 * Equips fish in fisherman's main hand.
 * @param {Entity} villager 
 * @param {string} fishItemId 
 */
export function equipFish(villager, fishItemId = "minecraft:cod") {
    if (!villager || !villager.isValid()) return;
    try {
        const equippable = villager.getComponent("minecraft:equippable");
        if (equippable) {
            const current = equippable.getEquipment(EquipmentSlot.Mainhand);
            if (current && current.typeId === fishItemId) return;
            try {
                equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack(fishItemId, 1));
                return;
            } catch {}
        }
    } catch {}
    try {
        villager.runCommandAsync(`replaceitem entity @s slot.weapon.mainhand 0 ${fishItemId}`).catch(() => {});
    } catch {}
}

/**
 * Equips water/fish bucket in fisherman's main hand.
 * @param {Entity} villager 
 * @param {string} bucketItemId 
 */
export function equipBucket(villager, bucketItemId = FISHERMAN_CONFIG.TROPICAL_FISH_BUCKET) {
    if (!villager || !villager.isValid()) return;
    try {
        const equippable = villager.getComponent("minecraft:equippable");
        if (equippable) {
            const current = equippable.getEquipment(EquipmentSlot.Mainhand);
            if (current && current.typeId === bucketItemId) return;
            try {
                equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack(bucketItemId, 1));
                return;
            } catch {}
        }
    } catch {}
    try {
        villager.runCommandAsync(`replaceitem entity @s slot.weapon.mainhand 0 ${bucketItemId}`).catch(() => {});
    } catch {}
}

/**
 * Finds a nearby stray cat to feed and befriend.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 */
export function findNearbyStrayCat(dimension, location, radius = FISHERMAN_CONFIG.CAT_SEARCH_RADIUS) {
    if (!dimension || !location) return null;
    let closest = null;
    let closestDist = Infinity;

    try {
        const cats = dimension.getEntities({
            type: "minecraft:cat",
            location: location,
            maxDistance: radius
        });
        for (const cat of cats) {
            if (!cat || !cat.isValid() || isTargetUnreachable(cat)) continue;
            if (cat.hasTag("rpc:befriended")) continue;

            const d = distance(location, cat.location);
            if (d < closestDist) {
                closestDist = d;
                closest = cat;
            }
        }
    } catch {}
    return closest;
}

/**
 * Feeds fish to a stray cat, emitting hearts, purring sounds, and befriending it.
 * @param {Entity} villager 
 * @param {Entity} cat 
 */
export function performFeedAndTameCat(villager, cat) {
    if (!villager || !villager.isValid() || !cat || !cat.isValid()) return false;
    const dim = villager.dimension;
    const cLoc = cat.location;

    try {
        setEntityLook(villager, cLoc);
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    playSoundSafe(dim, "random.eat", cLoc, { volume: 1.0, pitch: 1.3 });
    playSoundSafe(dim, "mob.cat.purr", cLoc, { volume: 1.0, pitch: 1.0 });
    playSoundSafe(dim, "mob.cat.meow", cLoc, { volume: 0.9, pitch: 1.1 });
    spawnParticleSafe(dim, "minecraft:heart_particle", { x: cLoc.x, y: cLoc.y + 0.5, z: cLoc.z });
    spawnParticleSafe(dim, "minecraft:villager_happy", { x: cLoc.x, y: cLoc.y + 0.8, z: cLoc.z });

    try {
        cat.addTag("rpc:befriended");
        cat.triggerEvent("minecraft:pet_tamed");
    } catch {}

    playSoundSafe(dim, "mob.villager.yes", villager.location, { volume: 0.9, pitch: 1.05 });
    return true;
}

/**
 * Finds a nearby Campfire workstation.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 */
export function findNearbyCampfire(dimension, location, radius = FISHERMAN_CONFIG.CAMPFIRE_SEARCH_RADIUS) {
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
                    if (block && (block.typeId === FISHERMAN_CONFIG.CAMPFIRE_ID || block.typeId === FISHERMAN_CONFIG.SOUL_CAMPFIRE_ID) && !isTargetUnreachable(pos)) {
                        return { block, pos };
                    }
                } catch {}
            }
        }
    }
    return null;
}

/**
 * Cooks caught fish on the campfire and spawns cooked fish drops.
 * @param {Entity} villager 
 * @param {Vector3} campfirePos 
 */
export function performCookFish(villager, campfirePos) {
    if (!villager || !villager.isValid() || !campfirePos) return false;
    const dim = villager.dimension;

    try {
        setEntityLook(villager, { x: campfirePos.x + 0.5, y: campfirePos.y + 0.5, z: campfirePos.z + 0.5 });
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    playSoundSafe(dim, "random.fizz", campfirePos, { volume: 1.0, pitch: 1.1 });
    playSoundSafe(dim, "fire.fire", campfirePos, { volume: 1.0, pitch: 1.0 });
    spawnParticleSafe(dim, "minecraft:smoke_particle", { x: campfirePos.x + 0.5, y: campfirePos.y + 0.7, z: campfirePos.z + 0.5 });

    // Drop cooked fish
    const cookedItems = FISHERMAN_CONFIG.COOKED_FISH_ITEMS;
    const chosen = cookedItems[Math.floor(Math.random() * cookedItems.length)];
    try {
        dim.spawnItem(new ItemStack(chosen, 1), {
            x: campfirePos.x + 0.5,
            y: campfirePos.y + 0.6,
            z: campfirePos.z + 0.5
        });
    } catch {}

    playSoundSafe(dim, "mob.villager.yes", villager.location, { volume: 0.9, pitch: 1.05 });
    return true;
}

/**
 * Scans for a nearby water pond block.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 */
export function findNearbyPondWater(dimension, location, radius = 14) {
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
                    if (block && block.typeId === "minecraft:water" && !isTargetUnreachable(pos)) {
                        // Check if air above
                        const above = dimension.getBlock({ x: pos.x, y: pos.y + 1, z: pos.z });
                        if (above && above.isAir) {
                            return { block, pos };
                        }
                    }
                } catch {}
            }
        }
    }
    return null;
}

/**
 * Releases tropical fish into a pond.
 * @param {Entity} villager 
 * @param {Vector3} waterPos 
 */
export function performRestockFish(villager, waterPos) {
    if (!villager || !villager.isValid() || !waterPos) return false;
    const dim = villager.dimension;

    try {
        setEntityLook(villager, { x: waterPos.x + 0.5, y: waterPos.y + 0.5, z: waterPos.z + 0.5 });
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    playSoundSafe(dim, "bucket.empty_fish", waterPos, { volume: 1.0, pitch: 1.0 });
    playSoundSafe(dim, "random.splash", waterPos, { volume: 1.0, pitch: 1.2 });
    spawnParticleSafe(dim, "minecraft:water_splash_particle_manual", { x: waterPos.x + 0.5, y: waterPos.y + 0.8, z: waterPos.z + 0.5 });
    spawnParticleSafe(dim, "minecraft:villager_happy", { x: waterPos.x + 0.5, y: waterPos.y + 1.2, z: waterPos.z + 0.5 });

    try {
        dim.spawnEntity("minecraft:tropical_fish", { x: waterPos.x + 0.5, y: waterPos.y + 0.2, z: waterPos.z + 0.5 });
    } catch {}

    return true;
}

/**
 * Fisherman Villager Addon - Pathfinder & Navigation Helper
 * Works in synergy with Minecraft's native pathfinding (minecraft:behavior.move_to_water).
 * Monitors arrival at river shores and provides gentle obstacle unsticking without jittery teleports.
 */

import { NAVIGATION_CONFIG } from "./config.js";
import { distance2D } from "./utils.js";
import { isWaterNear } from "./waterScanner.js";

/**
 * Checks navigation progress towards the target water/river.
 * Relies primarily on Minecraft's native pathfinding AI (behavior.move_to_water),
 * providing stuck assistance when needed.
 * 
 * @param {Entity} villager 
 * @param {{ shore: { x: number, y: number, z: number } }} spot 
 * @param {object} navState 
 * @returns {{ reached: boolean, stuck: boolean }}
 */
export function checkNavigationProgress(villager, spot, navState) {
    if (!villager || !villager.isValid()) {
        return { reached: false, stuck: true };
    }

    const currentLoc = villager.location;

    // 1. Check if villager has reached water shore (stops on land before entering water!)
    if (isWaterNear(villager.dimension, currentLoc, 2.8)) {
        return { reached: true, stuck: false };
    }

    if (spot && spot.shore) {
        const distToShore = distance2D(currentLoc, spot.shore);
        if (distToShore <= NAVIGATION_CONFIG.ARRIVAL_DISTANCE) {
            return { reached: true, stuck: false };
        }
    }

    // 2. Track stuck status
    navState.totalTicks = (navState.totalTicks || 0) + 1;
    if (navState.totalTicks > NAVIGATION_CONFIG.TIMEOUT_TICKS) {
        return { reached: false, stuck: true };
    }

    if (navState.lastPos) {
        const moved = distance2D(currentLoc, navState.lastPos);
        if (moved < 0.04) {
            navState.stuckTicks = (navState.stuckTicks || 0) + 1;
        } else {
            navState.stuckTicks = 0;
        }
    }
    navState.lastPos = { x: currentLoc.x, y: currentLoc.y, z: currentLoc.z };

    // 3. Gentle nudge if stuck on a 1-block ledge or fence
    if (navState.stuckTicks > NAVIGATION_CONFIG.STUCK_TICKS_THRESHOLD) {
        if (navState.stuckTicks > NAVIGATION_CONFIG.STUCK_TICKS_THRESHOLD * 4) {
            return { reached: false, stuck: true };
        }

        if (spot && spot.shore) {
            const dx = spot.shore.x - currentLoc.x;
            const dz = spot.shore.z - currentLoc.z;
            const dist = Math.hypot(dx, dz) || 1;
            try {
                villager.applyImpulse({
                    x: (dx / dist) * 0.18 + (Math.random() - 0.5) * 0.1,
                    y: 0.38,
                    z: (dz / dist) * 0.18 + (Math.random() - 0.5) * 0.1
                });
            } catch {}
        }
    }

    return { reached: false, stuck: false };
}

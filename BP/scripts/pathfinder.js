/**
 * Fisherman Villager Addon - Pathfinder & Navigation Helper
 * Relies entirely on Minecraft's native pathfinding AI (minecraft:behavior.move_to_water)
 * for 100% natural, smooth, non-jumping walking on land.
 */

import { distance2D } from "./utils.js";
import { isWaterNear } from "./waterScanner.js";

/**
 * Checks navigation progress towards the target water/river.
 * Does NOT apply any jumping impulses, allowing Minecraft's native pathfinding
 * to move the villager with 100% smooth, natural footstep animations.
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

    // Check if villager has reached water shore (stops on land before entering water!)
    if (isWaterNear(villager.dimension, currentLoc, 2.8)) {
        return { reached: true, stuck: false };
    }

    // Timeout check (30 seconds)
    navState.totalTicks = (navState.totalTicks || 0) + 1;
    if (navState.totalTicks > 600) {
        return { reached: false, stuck: true };
    }

    // Monitor position without applying ANY impulses (prevents jumping!)
    if (navState.lastPos) {
        const moved = distance2D(currentLoc, navState.lastPos);
        if (moved < 0.04) {
            navState.stuckTicks = (navState.stuckTicks || 0) + 1;
        } else {
            navState.stuckTicks = 0;
        }
    }
    navState.lastPos = { x: currentLoc.x, y: currentLoc.y, z: currentLoc.z };

    // If completely stuck for over 6 seconds, reset search
    if (navState.stuckTicks > 120) {
        return { reached: false, stuck: true };
    }

    return { reached: false, stuck: false };
}

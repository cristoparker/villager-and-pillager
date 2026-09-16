/**
 * Fisherman Villager Addon - Water & River Scanner Module (Namespace: rpc)
 * Accurately detects rivers and water bodies within 48 blocks,
 * determines shoreline spots, and locates open water targets for casting.
 */

import { SCAN_CONFIG, FISHING_CONFIG } from "./config.js";
import { distance2D, isWaterBlock, isPassableBlock, isSolidGround } from "./utils.js";

/**
 * Checks if a given coordinate is in a river biome.
 */
export function isRiverBiome(dimension, x, y, z) {
    try {
        const biome = dimension.getBiome({ x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) });
        if (!biome) return false;
        const id = (biome.id ?? String(biome)).toLowerCase();
        for (const riverId of SCAN_CONFIG.RIVER_BIOME_IDS) {
            if (id.includes(riverId.toLowerCase()) || id.includes("river")) {
                return true;
            }
        }
    } catch {}
    return false;
}

/**
 * Finds the water surface Y coordinate at an X, Z column.
 */
export function findWaterSurfaceY(dimension, x, startY, z) {
    const minY = Math.max(-64, Math.floor(startY) - 16);
    const maxY = Math.min(320, Math.floor(startY) + 6);

    for (let y = maxY; y >= minY; y--) {
        try {
            const block = dimension.getBlock({ x: Math.floor(x), y: y, z: Math.floor(z) });
            if (isWaterBlock(block)) {
                const above = dimension.getBlock({ x: Math.floor(x), y: y + 1, z: Math.floor(z) });
                if (!above || above.isAir || isPassableBlock(above)) {
                    return y;
                }
            }
        } catch {}
    }
    return null;
}

/**
 * Checks if there is any water block near the given location.
 * Used to immediately tell if the villager has reached the shore/water!
 */
export function isWaterNear(dimension, location, radius = 3.5) {
    if (!dimension || !location) return false;

    const locX = Math.floor(location.x);
    const locY = Math.floor(location.y);
    const locZ = Math.floor(location.z);
    const r = Math.ceil(radius);

    for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
            if (Math.hypot(dx, dz) > radius) continue;
            for (let dy = 1; dy >= -3; dy--) {
                try {
                    const block = dimension.getBlock({ x: locX + dx, y: locY + dy, z: locZ + dz });
                    if (isWaterBlock(block)) {
                        return true;
                    }
                } catch {}
            }
        }
    }
    return false;
}

/**
 * Finds open water in front of the villager or nearby for casting.
 * Prioritizes forward facing cone and ensures hook sits precisely on the water surface.
 */
export function findCastTarget(dimension, villagerOrLoc) {
    if (!dimension || !villagerOrLoc) return null;

    const isEntity = !!villagerOrLoc.location;
    const villagerLoc = isEntity ? villagerOrLoc.location : villagerOrLoc;
    const locX = Math.floor(villagerLoc.x);
    const locY = Math.floor(villagerLoc.y);
    const locZ = Math.floor(villagerLoc.z);

    // Forward direction unit vector from villager rotation if available
    let forwardYaw = 0;
    if (isEntity && villagerOrLoc.getRotation) {
        forwardYaw = villagerOrLoc.getRotation().y;
    }
    const forwardRad = forwardYaw * (Math.PI / 180);
    const fX = -Math.sin(forwardRad);
    const fZ = Math.cos(forwardRad);

    // Angular offsets prioritizing forward cone (0 deg, +/- 22.5 deg, +/- 45 deg, +/- 67.5 deg, etc.)
    const angleOffsets = [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.6, -1.6, 2.0, -2.0, 2.5, -2.5, Math.PI];

    // Check far distances (6 to 14 blocks) in forward cone
    for (let dist = FISHING_CONFIG.FAR_CAST_MAX; dist >= FISHING_CONFIG.FAR_CAST_MIN; dist -= 2) {
        for (const offset of angleOffsets) {
            const angle = Math.atan2(fZ, fX) + offset;
            const targetX = Math.floor(locX + Math.cos(angle) * dist);
            const targetZ = Math.floor(locZ + Math.sin(angle) * dist);

            const waterY = findWaterSurfaceY(dimension, targetX, locY, targetZ);
            if (waterY !== null) {
                return {
                    x: targetX + 0.5,
                    y: waterY + 0.88,
                    z: targetZ + 0.5,
                    waterSurfaceY: waterY,
                    isRiver: isRiverBiome(dimension, targetX, waterY, targetZ)
                };
            }
        }
    }

    // Medium/close fallback (2.5 to 6 blocks)
    for (let dist = 6; dist >= 2.5; dist -= 1) {
        for (const offset of angleOffsets) {
            const angle = Math.atan2(fZ, fX) + offset;
            const targetX = Math.floor(locX + Math.cos(angle) * dist);
            const targetZ = Math.floor(locZ + Math.sin(angle) * dist);

            const waterY = findWaterSurfaceY(dimension, targetX, locY, targetZ);
            if (waterY !== null) {
                return {
                    x: targetX + 0.5,
                    y: waterY + 0.88,
                    z: targetZ + 0.5,
                    waterSurfaceY: waterY,
                    isRiver: isRiverBiome(dimension, targetX, waterY, targetZ)
                };
            }
        }
    }

    return null;
}

/**
 * Finds the best fishing spot/water body within 48 blocks.
 * Prioritizes river biomes and returns { shore, castTarget, isRiver, distance } or null.
 */
export function findBestFishingSpot(dimension, villagerLoc) {
    if (!dimension || !villagerLoc) return null;

    const originX = Math.floor(villagerLoc.x);
    const originY = Math.floor(villagerLoc.y);
    const originZ = Math.floor(villagerLoc.z);

    let bestRiver = null;
    let bestRiverDist = Infinity;

    let bestGeneric = null;
    let bestGenericDist = Infinity;

    // Search in concentric rings from 6 to 48 blocks
    for (let r = 6; r <= SCAN_CONFIG.RADIUS; r += SCAN_CONFIG.RADIAL_STEP) {
        const angleStep = Math.max(0.24, SCAN_CONFIG.RADIAL_STEP / r);
        const totalSamples = Math.floor((2 * Math.PI) / angleStep);

        for (let i = 0; i < totalSamples; i++) {
            const angle = i * angleStep;
            const checkX = Math.floor(originX + Math.cos(angle) * r);
            const checkZ = Math.floor(originZ + Math.sin(angle) * r);

            const isRiver = isRiverBiome(dimension, checkX, originY, checkZ) ||
                            isRiverBiome(dimension, checkX, SCAN_CONFIG.SEA_LEVEL, checkZ);

            const waterY = findWaterSurfaceY(dimension, checkX, originY, checkZ);
            if (waterY === null) continue;

            const dist = Math.hypot(checkX - originX, checkZ - originZ);

            const spot = {
                shore: { x: checkX + 0.5, y: waterY + 1.0, z: checkZ + 0.5 },
                castTarget: { x: checkX + 0.5, y: waterY + 0.9, z: checkZ + 0.5 },
                isRiver: isRiver,
                distance: dist
            };

            if (isRiver && dist < bestRiverDist) {
                bestRiverDist = dist;
                bestRiver = spot;
            } else if (!bestRiver && dist < bestGenericDist) {
                bestGenericDist = dist;
                bestGeneric = spot;
            }
        }

        // Return immediately if we found a river nearby!
        if (bestRiver && r >= 16) {
            return bestRiver;
        }
    }

    return bestRiver || bestGeneric;
}

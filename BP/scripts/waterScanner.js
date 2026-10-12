/**
 * Fisherman Villager Addon - Water & River Scanner Module (Namespace: rpc)
 * Accurately detects rivers and water bodies within 48 blocks,
 * determines shoreline spots, and locates open water targets for casting.
 */

import { SCAN_CONFIG, FISHING_CONFIG } from "./config.js";
import { distance2D, isWaterBlock, isPassableBlock, isSolidGround } from "./utils.js";

/**
 * Checks if a water block is adjacent to farmland (i.e. an irrigation channel on a farm).
 * Fishermen should fish in rivers, oceans, and natural ponds, NOT in 1x1 farm trenches!
 * @param {Dimension} dimension 
 * @param {number} x 
 * @param {number} y 
 * @param {number} z 
 * @returns {boolean}
 */
export function isFarmWater(dimension, x, y, z) {
    if (!dimension) return false;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);

    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            if (dx === 0 && dz === 0) continue;
            for (let dy = -1; dy <= 1; dy++) {
                try {
                    const block = dimension.getBlock({ x: ix + dx, y: iy + dy, z: iz + dz });
                    if (block && (block.typeId === "minecraft:farmland" || block.typeId.includes("farmland"))) {
                        return true;
                    }
                } catch {}
            }
        }
    }
    return false;
}

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
 * Checks if there is any natural water block near the given location.
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
                    if (isWaterBlock(block) && !isFarmWater(dimension, locX + dx, locY + dy, locZ + dz)) {
                        return true;
                    }
                } catch {}
            }
        }
    }
    return false;
}

/**
 * Finds open water strictly in front of the villager for casting.
 * Prioritizes forward facing cone (narrow angles only), close-to-medium distance,
 * and strictly rejects farm irrigation water so bobbers are never placed behind or in farm crops.
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

    // Angular offsets: STRICT forward cone only (0 deg, +/- 11 deg, +/- 23 deg, +/- 34 deg, +/- 45 deg)
    // NEVER search behind (+/- 90 deg or Math.PI)!
    const angleOffsets = [0, 0.2, -0.2, 0.4, -0.4, 0.6, -0.6, 0.8, -0.8];

    // 1. First priority: Close-to-medium distance in front (2.5 to 7.0 blocks)
    for (let dist = 3.0; dist <= 7.0; dist += 1.0) {
        for (const offset of angleOffsets) {
            const angle = Math.atan2(fZ, fX) + offset;
            const targetX = Math.floor(locX + Math.cos(angle) * dist);
            const targetZ = Math.floor(locZ + Math.sin(angle) * dist);

            const waterY = findWaterSurfaceY(dimension, targetX, locY, targetZ);
            if (waterY !== null) {
                // Ensure it's not farm water
                if (isFarmWater(dimension, targetX, waterY, targetZ)) continue;

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

    // 2. Secondary priority: Further cast distances (7.0 to 12.0 blocks) in forward cone
    for (let dist = 8.0; dist <= 12.0; dist += 2.0) {
        for (const offset of angleOffsets) {
            const angle = Math.atan2(fZ, fX) + offset;
            const targetX = Math.floor(locX + Math.cos(angle) * dist);
            const targetZ = Math.floor(locZ + Math.sin(angle) * dist);

            const waterY = findWaterSurfaceY(dimension, targetX, locY, targetZ);
            if (waterY !== null) {
                if (isFarmWater(dimension, targetX, waterY, targetZ)) continue;

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
 * Prioritizes river biomes, rejects farm water, and locates solid ground adjacent to water to stand on.
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

            const waterY = findWaterSurfaceY(dimension, checkX, originY, checkZ);
            if (waterY === null) continue;

            // Reject farm irrigation water
            if (isFarmWater(dimension, checkX, waterY, checkZ)) continue;

            const isRiver = isRiverBiome(dimension, checkX, originY, checkZ) ||
                            isRiverBiome(dimension, checkX, SCAN_CONFIG.SEA_LEVEL, checkZ);

            // Find an adjacent solid walkable ground block to stand on
            let standPos = null;
            const neighbors = [
                { dx: 1, dz: 0 }, { dx: -1, dz: 0 }, { dx: 0, dz: 1 }, { dx: 0, dz: -1 },
                { dx: 1, dz: 1 }, { dx: -1, dz: 1 }, { dx: 1, dz: -1 }, { dx: -1, dz: -1 }
            ];

            for (const n of neighbors) {
                const sx = checkX + n.dx;
                const sz = checkZ + n.dz;
                for (let dy = 0; dy <= 2; dy++) {
                    const sy = waterY + dy;
                    try {
                        const ground = dimension.getBlock({ x: sx, y: sy, z: sz });
                        const head = dimension.getBlock({ x: sx, y: sy + 1, z: sz });
                        const aboveHead = dimension.getBlock({ x: sx, y: sy + 2, z: sz });
                        if (ground && isSolidGround(ground) && !isWaterBlock(ground)) {
                            if ((!head || head.isAir || isPassableBlock(head)) &&
                                (!aboveHead || aboveHead.isAir || isPassableBlock(aboveHead))) {
                                standPos = { x: sx + 0.5, y: sy + 1.0, z: sz + 0.5 };
                                break;
                            }
                        }
                    } catch {}
                }
                if (standPos) break;
            }

            if (!standPos) continue;

            const dist = Math.hypot(checkX - originX, checkZ - originZ);

            const spot = {
                shore: standPos,
                standPos: standPos,
                castTarget: { x: checkX + 0.5, y: waterY + 0.88, z: checkZ + 0.5 },
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

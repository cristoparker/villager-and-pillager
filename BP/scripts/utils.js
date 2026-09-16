/**
 * Fisherman Villager Addon - Utility Module (Namespace: rpc)
 * Math calculations, robust block detection, sound/particle helpers, and string rendering.
 */

import { FISHING_CONFIG } from "./config.js";

/**
 * Calculates 3D Euclidean distance between two locations.
 */
export function distance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.hypot(dx, dy, dz);
}

/**
 * Calculates 2D horizontal distance between two locations.
 */
export function distance2D(a, b) {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return Math.hypot(dx, dz);
}

/**
 * Calculates Bedrock pitch and yaw rotation angles from one point to another.
 */
export function getLookRotation(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const horizDist = Math.hypot(dx, dz) || 0.001;

    const yaw = Math.atan2(-dx, dz) * (180 / Math.PI);
    const pitch = -Math.atan2(dy, horizDist) * (180 / Math.PI);

    return { x: pitch, y: yaw };
}

/**
 * Checks if a block is water.
 */
export function isWaterBlock(block) {
    if (!block) return false;
    const id = block.typeId.toLowerCase();
    return id === "minecraft:water" || 
           id === "minecraft:flowing_water" ||
           (block.isLiquid === true && id.includes("water"));
}

/**
 * Checks if a block is passable for walking (air, grass, flowers, snow layers, etc.).
 */
export function isPassableBlock(block) {
    if (!block) return false;
    if (block.isAir) return true;
    const id = block.typeId.toLowerCase();
    if (id.includes("air") || 
        id.includes("grass") || 
        id.includes("fern") || 
        id.includes("flower") || 
        id.includes("tulip") ||
        id.includes("rose") ||
        id.includes("orchid") ||
        id.includes("daisy") ||
        id.includes("poppy") ||
        id.includes("dandelion") ||
        id.includes("allium") ||
        id.includes("cornflower") ||
        id.includes("snow_layer") ||
        id.includes("sapling") ||
        id.includes("deadbush") ||
        id.includes("carpet") ||
        id.includes("mushroom") ||
        id.includes("torch")) {
        return true;
    }
    return !block.isSolid;
}

/**
 * Checks if a block is solid ground a mob can walk/stand on.
 */
export function isSolidGround(block) {
    if (!block) return false;
    if (block.isAir || block.isLiquid) return false;
    const id = block.typeId.toLowerCase();
    if (id.includes("water") || 
        id.includes("lava") || 
        id.includes("fire") || 
        id.includes("leaves") || 
        id.includes("fence") || 
        id.includes("wall") || 
        id.includes("cactus")) {
        return false;
    }
    return true;
}

/**
 * Picks random loot from weighted table.
 */
export function pickRandomLoot(lootTable) {
    const totalWeight = lootTable.reduce((sum, item) => sum + item.weight, 0);
    let rand = Math.random() * totalWeight;

    for (const entry of lootTable) {
        if (rand < entry.weight) {
            return entry;
        }
        rand -= entry.weight;
    }
    return lootTable[0];
}

/**
 * Safely plays a sound.
 */
export function playSoundSafe(dimension, soundId, location, options = {}) {
    try {
        dimension.playSound(soundId, location, {
            pitch: options.pitch ?? 1.0,
            volume: options.volume ?? 1.0
        });
    } catch {}
}

/**
 * Safely spawns a particle.
 */
export function spawnParticleSafe(dimension, particleId, location) {
    try {
        dimension.spawnParticle(particleId, location);
    } catch {}
}

/**
 * Draws a dense, continuous string line between rod tip and bobber.
 */
export function drawParticleLine(dimension, start, end, steps = 16) {
    if (!dimension) return;
    const dist = distance(start, end);
    const count = Math.max(steps, Math.min(26, Math.floor(dist * 2.5)));

    for (let i = 0; i <= count; i++) {
        const factor = i / count;
        // Natural catenary curve sag
        const sag = Math.sin(factor * Math.PI) * Math.min(1.2, dist * 0.05);

        const pt = {
            x: start.x + (end.x - start.x) * factor,
            y: start.y + (end.y - start.y) * factor - sag,
            z: start.z + (end.z - start.z) * factor
        };

        try {
            dimension.spawnParticle(FISHING_CONFIG.STRING_PARTICLE_ID, pt);
        } catch {
            try {
                dimension.spawnParticle(FISHING_CONFIG.FALLBACK_PARTICLE_ID, pt);
            } catch {}
        }
    }
}

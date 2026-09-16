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
 * Draws a dense, continuous rope/string particle line between rod tip and bobber with realistic catenary physics.
 * @param {Dimension} dimension
 * @param {{x: number, y: number, z: number}} start - Fishing rod tip position
 * @param {{x: number, y: number, z: number}} end - Bobber hook position
 * @param {object} [options]
 * @param {boolean} [options.isTight=false] - Whether line is pulled taut under tension (e.g. fish biting)
 * @param {number|null} [options.waterSurfaceY=null] - Water surface Y to prevent line submergence
 * @param {number} [options.tick=0] - Current tick for wind drift and biting vibration physics
 */
export function drawParticleLine(dimension, start, end, options = {}) {
    if (!dimension || !start || !end) return;

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dz = end.z - start.z;
    const horizDist = Math.hypot(dx, dz) || 0.001;
    const totalDist = Math.hypot(dx, dy, dz);

    // High-frequency particles spaced every ~0.045 blocks for a seamless, continuous thread
    const count = Math.max(30, Math.min(220, Math.ceil(totalDist / 0.045)));

    const isTight = options.isTight ?? false;
    const waterSurfaceY = options.waterSurfaceY ?? null;
    const tick = options.tick ?? 0;

    // Catenary physics:
    // Slack line has a natural, elegant gravity sag proportional to distance.
    // Tight line (fish biting) snaps nearly straight with high-frequency tension vibration.
    const maxSag = isTight 
        ? Math.min(0.08, horizDist * 0.01) 
        : Math.min(0.85, Math.max(0.08, horizDist * 0.048));

    for (let i = 0; i <= count; i++) {
        const factor = i / count;

        // Parabolic catenary curve: 4 * factor * (1 - factor) reaches 1.0 at midpoint and 0.0 at both ends
        const parabolic = 4 * factor * (1 - factor);
        let sag = parabolic * maxSag;

        // Dynamic micro-physics:
        let swayX = 0;
        let swayZ = 0;
        if (isTight) {
            // Rapid biting tension vibration
            const vibration = Math.sin(tick * 1.5 + factor * Math.PI * 3) * 0.02 * parabolic;
            sag += vibration;
        } else {
            // Subtle breeze drift
            const sway = Math.sin(tick * 0.09 + factor * Math.PI) * 0.015 * parabolic;
            swayX = (-dz / horizDist) * sway;
            swayZ = (dx / horizDist) * sway;
        }

        let posY = start.y + dy * factor - sag;

        // Water boundary constraint: line rests gently on the water surface near hook
        if (waterSurfaceY !== null && posY < waterSurfaceY + 0.04) {
            posY = waterSurfaceY + 0.04;
        }

        const pt = {
            x: start.x + dx * factor + swayX,
            y: posY,
            z: start.z + dz * factor + swayZ
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


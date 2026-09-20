/**
 * Fisherman Villager Addon - Utility Module (Namespace: rpc)
 * Math calculations, robust block detection, sound/particle helpers, and string rendering.
 */

import { BlockPermutation } from "@minecraft/server";
import { FISHING_CONFIG } from "./config.js";

/**
 * Safely sets a block's type or permutation with multiple fallbacks.
 * @param {Block} block 
 * @param {string} typeId 
 */
export function setBlockSafe(block, typeId) {
    if (!block) return false;
    try {
        block.setPermutation(BlockPermutation.resolve(typeId));
        return true;
    } catch {}
    try {
        block.setType(typeId);
        return true;
    } catch {}
    try {
        const dim = block.dimension;
        const loc = block.location;
        dim.runCommandAsync(`setblock ${loc.x} ${loc.y} ${loc.z} ${typeId}`).catch(() => {});
        return true;
    } catch {}
    return false;
}

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
 * Checks if a block is passable for walking or replaceable for placement (air, short grass, flowers, etc.).
 */
export function isPassableBlock(block) {
    if (!block) return false;
    if (block.isAir) return true;
    const id = block.typeId.toLowerCase();

    // Solid blocks that must never be treated as passable
    if (id.includes("grass_block") || 
        id.includes("dirt") || 
        id.includes("farmland") || 
        id.includes("path") || 
        id.includes("podzol") || 
        id.includes("mycelium") || 
        id.includes("stone") || 
        id.includes("cobble") || 
        id.includes("deepslate") || 
        id.includes("wood") || 
        id.includes("log") || 
        id.includes("plank") || 
        id.includes("brick") || 
        id.includes("sand") || 
        id.includes("gravel") || 
        id.includes("bed") || 
        id.includes("chest") || 
        id.includes("barrel") || 
        id.includes("composter") || 
        id.includes("door")) {
        return false;
    }

    if (id.includes("air") || 
        id.includes("short_grass") || 
        id.includes("tallgrass") || 
        id.includes("double_plant") || 
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
    if (id.includes("grass_block") || id.includes("grass_path")) return true;
    if (id.includes("water") || 
        id.includes("lava") || 
        id.includes("fire") || 
        id.includes("leaves") || 
        id.includes("fence") || 
        id.includes("wall") || 
        id.includes("cactus") ||
        id.includes("bed") ||
        id.includes("chest") ||
        id.includes("sapling") ||
        id.includes("flower") ||
        id.includes("short_grass") ||
        id.includes("tallgrass")) {
        return false;
    }
    return true;
}

/**
 * Checks if a block is strictly empty/free space (air or replaceable short grass) for safe bed placement.
 * Prevents beds from ever replacing existing furniture, chests, workstations, or structures.
 */
export function isFreeBedSpace(block) {
    if (!block) return false;
    if (block.isAir) return true;
    const id = block.typeId.toLowerCase();
    return id === "minecraft:air" || id === "minecraft:short_grass" || id === "minecraft:tall_grass" || id === "minecraft:snow_layer";
}

/**
 * Checks if a block is replaceable free space (air, short grass, tall grass, snow layer)
 * for placing workbenches, chests, and beds without destroying solid blocks.
 */
export function isReplaceableSpace(block) {
    return isFreeBedSpace(block);
}

/**
 * Safely places a complete 2-block Bedrock bed (foot and head) with matching direction and states.
 * Only places if both foot and head positions are completely free space.
 * @param {Dimension} dimension 
 * @param {{ footPos: Vector3, headPos: Vector3, direction: number }} bedSpot 
 * @returns {boolean}
 */
export function placeBedBlock(dimension, bedSpot) {
    if (!dimension || !bedSpot || !bedSpot.footPos || !bedSpot.headPos) return false;
    const { footPos, headPos, direction: dir } = bedSpot;

    const footBlock = dimension.getBlock(footPos);
    const headBlock = dimension.getBlock(headPos);
    if (!footBlock || !headBlock) return false;

    // Strict safety check: Never replace existing solid blocks or furniture!
    if (!isFreeBedSpace(footBlock) || !isFreeBedSpace(headBlock)) return false;

    let placed = false;

    // 1. Primary: BlockPermutation with Bedrock states
    try {
        const footPerm = BlockPermutation.resolve("minecraft:bed", {
            direction: dir,
            head_piece_bit: false,
            occupied_bit: false
        });
        const headPerm = BlockPermutation.resolve("minecraft:bed", {
            direction: dir,
            head_piece_bit: true,
            occupied_bit: false
        });

        footBlock.setPermutation(footPerm);
        headBlock.setPermutation(headPerm);
        placed = true;
    } catch {
        // 2. Fallback: Command-based placement
        try {
            dimension.runCommandAsync(`setblock ${footPos.x} ${footPos.y} ${footPos.z} bed ["direction"=${dir},"head_piece_bit"=false,"occupied_bit"=false] replace`);
            dimension.runCommandAsync(`setblock ${headPos.x} ${headPos.y} ${headPos.z} bed ["direction"=${dir},"head_piece_bit"=true,"occupied_bit"=false] replace`);
            placed = true;
        } catch {}
    }

    return placed;
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

    // Ultra-frequent particles spaced every ~0.025 blocks for a smooth, unbroken line with 8x smaller particles
    const count = Math.max(40, Math.min(260, Math.ceil(totalDist / 0.025)));

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


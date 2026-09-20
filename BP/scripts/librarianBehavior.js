/**
 * Villager Professions Addon - Librarian Behavior Module (Namespace: rpc)
 * Coordinates enchanted book equipment, lectern studying routines,
 * page turning sounds, magical rune particles, and protective village inspiration buffs.
 */

import { ItemStack, EquipmentSlot } from "@minecraft/server";
import { LIBRARIAN_CONFIG, FLETCHER_CONFIG } from "./config.js";
import { distance, getLookRotation, playSoundSafe, spawnParticleSafe } from "./utils.js";

/**
 * Equips enchanted book or book in the librarian's main hand.
 * @param {Entity} villager 
 */
export function equipBook(villager) {
    if (!villager || !villager.isValid()) return;

    try {
        const equippable = villager.getComponent("minecraft:equippable");
        if (equippable) {
            const current = equippable.getEquipment(EquipmentSlot.Mainhand);
            if (current && (current.typeId === LIBRARIAN_CONFIG.BOOK_ITEM_ID || current.typeId === "minecraft:book")) {
                return;
            }
            try {
                equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack(LIBRARIAN_CONFIG.BOOK_ITEM_ID, 1));
                return;
            } catch {
                try {
                    equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack("minecraft:book", 1));
                    return;
                } catch {}
            }
        }
    } catch {}

    try {
        villager.runCommandAsync(`replaceitem entity @s slot.weapon.mainhand 0 ${LIBRARIAN_CONFIG.BOOK_ITEM_ID}`).catch(() => {
            villager.runCommandAsync(`replaceitem entity @s slot.weapon.mainhand 0 minecraft:book`).catch(() => {});
        });
    } catch {}
}

/**
 * Unequips book from main hand.
 * @param {Entity} villager 
 */
export function unequipBook(villager) {
    if (!villager || !villager.isValid()) return;

    try {
        const equippable = villager.getComponent("minecraft:equippable");
        equippable?.setEquipment(EquipmentSlot.Mainhand, undefined);
    } catch {}
}

/**
 * Finds a nearby Lectern block.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 * @returns {{ block: Block, pos: Vector3 } | null}
 */
export function findNearbyLectern(dimension, location, radius = LIBRARIAN_CONFIG.LECTERN_SEARCH_RADIUS) {
    if (!dimension || !location) return null;

    const startX = Math.floor(location.x);
    const startY = Math.floor(location.y);
    const startZ = Math.floor(location.z);

    for (let dx = -radius; dx <= radius; dx += 2) {
        for (let dz = -radius; dz <= radius; dz += 2) {
            for (let dy = -2; dy <= 2; dy++) {
                const pos = { x: startX + dx, y: startY + dy, z: startZ + dz };
                try {
                    const block = dimension.getBlock(pos);
                    if (block && block.typeId === LIBRARIAN_CONFIG.LECTERN_ID) {
                        return { block, pos };
                    }
                } catch {}
            }
        }
    }

    return null;
}

/**
 * Checks if hostile monsters are nearby.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 * @returns {boolean}
 */
export function isMonsterThreatNearby(dimension, location, radius = 16) {
    if (!dimension || !location) return false;

    for (const hostTypeId of FLETCHER_CONFIG.HOSTILE_TYPES) {
        try {
            const entities = dimension.getEntities({
                type: hostTypeId,
                location: location,
                maxDistance: radius
            });
            if (entities.length > 0) return true;
        } catch {}
    }

    return false;
}

/**
 * Performs lectern study routine: page turn sounds and magical enchanting glyphs.
 * @param {Entity} villager 
 * @param {{ block: Block, pos: Vector3 }} lecternInfo 
 */
export function performStudy(villager, lecternInfo) {
    if (!villager || !villager.isValid() || !lecternInfo) return false;

    const dim = villager.dimension;
    const pos = lecternInfo.pos;

    try {
        const rot = getLookRotation(villager.location, { x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 });
        villager.teleport(villager.location, { rotation: { x: 0, y: rot.y } });
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    playSoundSafe(dim, "item.book.page_turn", pos, { volume: 0.9, pitch: 1.0 });
    spawnParticleSafe(dim, "minecraft:enchanting_table_particle", { x: pos.x + 0.5, y: pos.y + 1.2, z: pos.z + 0.5 });
    spawnParticleSafe(dim, "minecraft:villager_happy", { x: pos.x + 0.5, y: pos.y + 1.0, z: pos.z + 0.5 });

    return true;
}

/**
 * Casts protective inspiration incantation to buff nearby villagers with Speed & Resistance.
 * @param {Entity} villager 
 */
export function performInspirationBuff(villager) {
    if (!villager || !villager.isValid()) return false;

    const dim = villager.dimension;
    const vLoc = villager.location;

    try {
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    playSoundSafe(dim, "beacon.power", vLoc, { volume: 0.9, pitch: 1.2 });
    spawnParticleSafe(dim, "minecraft:enchanting_table_particle", { x: vLoc.x, y: vLoc.y + 1.5, z: vLoc.z });

    // Buff nearby villagers within 12 blocks
    try {
        const allies = dim.getEntities({
            type: "minecraft:villager_v2",
            location: vLoc,
            maxDistance: LIBRARIAN_CONFIG.INSPIRATION_RADIUS
        });

        for (const ally of allies) {
            if (ally && ally.isValid()) {
                ally.addEffect("speed", 240, { amplifier: 1, showParticles: true });
                ally.addEffect("resistance", 240, { amplifier: 1, showParticles: false });
                spawnParticleSafe(dim, "minecraft:villager_happy", { x: ally.location.x, y: ally.location.y + 1.0, z: ally.location.z });
            }
        }
    } catch {}

    return true;
}

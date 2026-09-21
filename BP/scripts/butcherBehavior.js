/**
 * Fisherman Villager Addon - Butcher Behavior Module (Namespace: rpc)
 * Handles equipping butcher axe/cleaver, hunting pigs & cows, collecting fresh meat,
 * locating village Smokers, and placing coal & raw meat into smoker slots for cooking.
 */

import { system, ItemStack, EquipmentSlot } from "@minecraft/server";
import { BUTCHER_CONFIG } from "./config.js";
import { distance, getLookRotation, playSoundSafe, spawnParticleSafe, setEntityLook, isTargetUnreachable } from "./utils.js";

/**
 * Equips cleaver or iron axe in the butcher's main hand.
 * @param {Entity} villager 
 */
export function equipAxe(villager) {
    if (!villager || !villager.isValid()) return;

    try {
        const equippable = villager.getComponent("minecraft:equippable");
        if (equippable) {
            const current = equippable.getEquipment(EquipmentSlot.Mainhand);
            if (current && (current.typeId === BUTCHER_CONFIG.CLEAVER_ITEM_ID || current.typeId === BUTCHER_CONFIG.VANILLA_AXE_ITEM_ID)) {
                return; // Already equipped, prevent pathfinding hitch
            }

            try {
                equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack(BUTCHER_CONFIG.CLEAVER_ITEM_ID, 1));
                return;
            } catch {
                try {
                    equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack(BUTCHER_CONFIG.VANILLA_AXE_ITEM_ID, 1));
                    return;
                } catch {}
            }
        }
    } catch {}

    try {
        villager.runCommandAsync(`replaceitem entity @s slot.weapon.mainhand 0 ${BUTCHER_CONFIG.CLEAVER_ITEM_ID}`).catch(() => {
            villager.runCommandAsync(`replaceitem entity @s slot.weapon.mainhand 0 ${BUTCHER_CONFIG.VANILLA_AXE_ITEM_ID}`).catch(() => {});
        });
    } catch {}
}

/**
 * Unequips items from the butcher's main hand (e.g. for sleeping).
 * @param {Entity} villager 
 */
export function unequipAxe(villager) {
    if (!villager || !villager.isValid()) return;

    try {
        const equippable = villager.getComponent("minecraft:equippable");
        equippable?.setEquipment(EquipmentSlot.Mainhand, undefined);
    } catch {}
}

/**
 * Checks if an entity is an adult pig or cow suitable for meat.
 * @param {Entity} animal 
 * @returns {boolean}
 */
export function isValidPrey(animal) {
    if (!animal || !animal.isValid()) return false;

    // Do not hunt babies
    try {
        if (animal.getComponent("minecraft:is_baby")) return false;
    } catch {}

    const typeId = animal.typeId;
    return typeId === "minecraft:pig" || typeId === "minecraft:cow";
}

/**
 * Finds the closest adult pig or cow near the butcher.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 * @returns {Entity|null}
 */
export function findNearbyPrey(dimension, location, radius = BUTCHER_CONFIG.ANIMAL_SEARCH_RADIUS) {
    if (!dimension || !location) return null;

    let animals = [];
    try {
        const pigs = dimension.getEntities({ type: "minecraft:pig", location: location, maxDistance: radius });
        const cows = dimension.getEntities({ type: "minecraft:cow", location: location, maxDistance: radius });
        animals = [...pigs, ...cows];
    } catch {
        return null;
    }

    let closest = null;
    let closestDist = Infinity;

    for (const animal of animals) {
        if (isValidPrey(animal) && !isTargetUnreachable(animal)) {
            const d = distance(location, animal.location);
            if (d < closestDist) {
                closestDist = d;
                closest = animal;
            }
        }
    }

    return closest;
}

/**
 * Collects dropped meat and items from the ground near slaughter location.
 * Teleports them into the butcher, plays pickup sound, and removes the item entities.
 * @param {Entity} villager 
 * @param {Vector3} location 
 * @param {number} radius 
 * @returns {{ meatId: string, count: number }|null}
 */
export function collectDroppedMeat(villager, location, radius = 5.0) {
    if (!villager || !villager.isValid()) return null;

    const dim = villager.dimension;
    const vLoc = villager.location;
    let foundMeat = null;
    let totalCount = 0;

    const searchLocs = [location, vLoc];
    for (const sLoc of searchLocs) {
        if (!sLoc) continue;
        let items = [];
        try {
            items = dim.getEntities({ type: "minecraft:item", location: sLoc, maxDistance: radius });
        } catch {
            continue;
        }

        for (const item of items) {
            try {
                const itemComp = item.getComponent("minecraft:item");
                if (!itemComp || !itemComp.itemStack) continue;

                const stack = itemComp.itemStack;
                const typeId = stack.typeId;

                // Check if this is a slaughtered animal drop
                if (typeId === "minecraft:porkchop" || typeId === "minecraft:beef" || 
                    typeId === "minecraft:leather" || typeId === "minecraft:mutton") {
                    
                    if (typeId === "minecraft:porkchop" || typeId === "minecraft:beef") {
                        foundMeat = typeId;
                        totalCount += stack.amount;
                    }

                    // Physically vacuum/collect the item to the butcher
                    try {
                        item.teleport(vLoc);
                    } catch {}

                    playSoundSafe(dim, "random.pop", vLoc, { volume: 0.8, pitch: 1.2 });
                    spawnParticleSafe(dim, "minecraft:villager_happy", {
                        x: vLoc.x,
                        y: vLoc.y + 1.2,
                        z: vLoc.z
                    });

                    // Remove item entity from world so it doesn't stay on ground
                    try {
                        item.remove();
                    } catch {
                        try { item.kill(); } catch {}
                    }
                }
            } catch {}
        }
    }

    if (foundMeat && totalCount > 0) {
        return { id: foundMeat, meatId: foundMeat, count: totalCount };
    }
    return null;
}

/**
 * Executes the slaughter of a targeted pig or cow and collects the meat drops.
 * @param {Entity} villager 
 * @param {Entity} animal 
 * @param {function(object): void} onLootCollected
 * @returns {{ id: string, meatId: string, count: number }|null}
 */
export function performSlaughter(villager, animal, onLootCollected = null) {
    if (!villager || !villager.isValid() || !animal || !animal.isValid()) return null;

    const dim = villager.dimension;
    const aLoc = { x: animal.location.x, y: animal.location.y, z: animal.location.z };
    const isPig = (animal.typeId === "minecraft:pig");

    // 1. Turn butcher to face animal
    try {
        setEntityLook(villager, aLoc);
    } catch {}

    // 2. Play arm strike animation
    try {
        villager.playAnimation("animation.villager.raise_arms");
    } catch {}

    // 3. Play strike sounds
    playSoundSafe(dim, "mob.irongolem.attack", aLoc, { volume: 1.0, pitch: 1.1 });
    if (isPig) {
        playSoundSafe(dim, "mob.pig.death", aLoc, { volume: 1.0, pitch: 1.0 });
    } else {
        playSoundSafe(dim, "mob.cow.hurt", aLoc, { volume: 1.0, pitch: 0.9 });
    }

    // 4. Default expected meat
    const defaultMeatId = isPig ? "minecraft:porkchop" : "minecraft:beef";
    const defaultMeatCount = Math.floor(Math.random() * 2) + 1; // 1 to 2 meats
    let collectedLoot = { id: defaultMeatId, meatId: defaultMeatId, count: defaultMeatCount };

    // 5. Strike particles
    spawnParticleSafe(dim, "minecraft:balloon_pop_particle", {
        x: aLoc.x,
        y: aLoc.y + 0.6,
        z: aLoc.z
    });

    // 6. Kill animal
    try {
        animal.kill();
    } catch {}

    // 7. Butcher happiness feedback
    spawnParticleSafe(dim, "minecraft:villager_happy", {
        x: villager.location.x,
        y: villager.location.y + 1.8,
        z: villager.location.z
    });
    playSoundSafe(dim, "mob.villager.yes", villager.location, { volume: 0.9, pitch: 1.05 });

    // 8. Immediately scan and collect dropped meat
    const immediateLoot = collectDroppedMeat(villager, aLoc, 5.0);
    if (immediateLoot) {
        collectedLoot = immediateLoot;
        if (onLootCollected) onLootCollected(collectedLoot);
    }

    // 9. Delayed collection passes to sweep up any items spawned on subsequent ticks
    system.runTimeout(() => {
        if (!villager || !villager.isValid()) return;
        const delayedLoot = collectDroppedMeat(villager, aLoc, 5.0);
        if (delayedLoot) {
            collectedLoot.count = Math.max(collectedLoot.count, delayedLoot.count);
            collectedLoot.meatId = delayedLoot.meatId;
            collectedLoot.id = delayedLoot.meatId;
            if (onLootCollected) onLootCollected(collectedLoot);
        }
    }, 2);

    system.runTimeout(() => {
        if (!villager || !villager.isValid()) return;
        const delayedLoot2 = collectDroppedMeat(villager, aLoc, 5.0);
        if (delayedLoot2) {
            collectedLoot.count = Math.max(collectedLoot.count, delayedLoot2.count);
            collectedLoot.meatId = delayedLoot2.meatId;
            collectedLoot.id = delayedLoot2.meatId;
            if (onLootCollected) onLootCollected(collectedLoot);
        }
    }, 6);

    return collectedLoot;
}

/**
 * Searches for the nearest Smoker block within radius using a thorough concentric ring search.
 * Guaranteed not to skip any blocks.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {number} radius 
 * @returns {{ x: number, y: number, z: number, block: Block }|null}
 */
export function findNearestSmoker(dimension, location, radius = BUTCHER_CONFIG.SMOKER_SEARCH_RADIUS) {
    if (!dimension || !location) return null;

    const originX = Math.floor(location.x);
    const originY = Math.floor(location.y);
    const originZ = Math.floor(location.z);

    const maxR = Math.min(32, Math.max(2, Math.floor(radius)));

    // Concentric square ring search outward from center (radius 0 to maxR)
    for (let r = 0; r <= maxR; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
                // Only inspect blocks on the perimeter of the current ring
                if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;

                // Check vertical slice around ground level
                for (let dy = -2; dy <= 4; dy++) {
                    try {
                        const block = dimension.getBlock({ x: originX + dx, y: originY + dy, z: originZ + dz });
                        if (!block) continue;

                        const id = block.typeId;
                        if (id === "minecraft:smoker" || id === "minecraft:lit_smoker") {
                            const smokerPos = {
                                x: originX + dx + 0.5,
                                y: originY + dy,
                                z: originZ + dz + 0.5
                            };
                            if (!isTargetUnreachable(smokerPos)) {
                                return {
                                    ...smokerPos,
                                    block: block
                                };
                            }
                        }
                    } catch {}
                }
            }
        }
    }

    return null;
}

/**
 * Loads coal into the fuel slot and raw meat into the input slot of the Smoker block.
 * - In slot 0: Puts cow meat (raw beef) or pork (raw porkchop).
 * - In slot 1: If existing fuel exists, skips adding coal. If empty, adds a random amount (1-3) of coal.
 * @param {Dimension} dimension 
 * @param {Block} smokerBlock 
 * @param {string} meatId 
 * @param {number} count 
 * @returns {boolean}
 */
export function loadSmoker(dimension, smokerBlock, meatId, count) {
    if (!smokerBlock) return false;

    // Ensure valid safe meatId and safeCount
    const safeMeatId = (meatId && typeof meatId === "string" && meatId !== "undefined") ? meatId : "minecraft:beef";
    const safeCount = (count && typeof count === "number" && count > 0) ? Math.min(64, Math.floor(count)) : 1;

    const bx = Math.floor(smokerBlock.location.x);
    const by = Math.floor(smokerBlock.location.y);
    const bz = Math.floor(smokerBlock.location.z);
    const bLoc = { x: bx + 0.5, y: by + 0.8, z: bz + 0.5 };

    let loadedViaContainer = false;

    // 1. Attempt using BlockInventoryComponent container
    try {
        const invComp = smokerBlock.getComponent("minecraft:inventory") || smokerBlock.getComponent("inventory");
        if (invComp && invComp.container) {
            const container = invComp.container;

            // Slot 0: Input Item (Raw Porkchop / Beef)
            try {
                const currentInput = container.getItem(0);
                if (currentInput && currentInput.typeId === safeMeatId) {
                    currentInput.amount = Math.min(64, currentInput.amount + safeCount);
                    container.setItem(0, currentInput);
                } else if (!currentInput || currentInput.amount === 0) {
                    container.setItem(0, new ItemStack(safeMeatId, safeCount));
                } else {
                    // Different item in slot 0 - overwrite with fresh meat
                    container.setItem(0, new ItemStack(safeMeatId, safeCount));
                }
            } catch (e) {
                console.warn(`[Butcher] Error setting slot 0: ${e}`);
                try {
                    container.setItem(0, new ItemStack(safeMeatId, safeCount));
                } catch {}
            }

            // Slot 1: Fuel Item (Coal)
            // If existing slot 1 has coal, SKIP. Otherwise add a random amount of coal (1 to 3).
            try {
                const currentFuel = container.getItem(1);
                const hasExistingFuel = currentFuel && currentFuel.amount > 0;

                if (!hasExistingFuel) {
                    const randomCoalCount = Math.floor(Math.random() * 3) + 1; // 1, 2, or 3 coal
                    container.setItem(1, new ItemStack(BUTCHER_CONFIG.COAL_ITEM_ID, randomCoalCount));
                }
                // If hasExistingFuel is true, skip adding coal!
            } catch (e) {
                console.warn(`[Butcher] Error setting slot 1: ${e}`);
            }

            loadedViaContainer = true;
        }
    } catch (err) {
        console.warn(`[Butcher] Block inventory container error: ${err}`);
    }

    // 2. Guaranteed command fallback: /replaceitem block
    if (!loadedViaContainer) {
        try {
            dimension.runCommandAsync(`replaceitem block ${bx} ${by} ${bz} slot.container 0 ${safeMeatId} ${safeCount}`).catch(() => {});
            // Fallback random coal if needed
            const randomCoal = Math.floor(Math.random() * 3) + 1;
            dimension.runCommandAsync(`replaceitem block ${bx} ${by} ${bz} slot.container 1 ${BUTCHER_CONFIG.COAL_ITEM_ID} ${randomCoal}`).catch(() => {});
        } catch {}
    }

    // Sizzle cooking sound & smoke particles
    playSoundSafe(dimension, "random.fizz", bLoc, { volume: 0.9, pitch: 1.1 });
    playSoundSafe(dimension, "fire.fire", bLoc, { volume: 0.6, pitch: 1.0 });

    for (let i = 0; i < 4; i++) {
        spawnParticleSafe(dimension, "minecraft:smoker_smoke_particle", {
            x: bLoc.x + (Math.random() - 0.5) * 0.4,
            y: bLoc.y + 0.2 + Math.random() * 0.5,
            z: bLoc.z + (Math.random() - 0.5) * 0.4
        });
    }

    return true;
}


/**
 * Villager Professions Addon - Profession Detection & Synchronization Module (Namespace: rpc)
 * Ensures that a villager's equipped item, tags, and AI manager ALWAYS match their live,
 * real-time Bedrock workstation occupation (variant / family).
 * If a villager changes workstation or loses their job, their held items and behavior
 * dynamically and automatically update!
 */

import { world, ItemStack, EquipmentSlot } from "@minecraft/server";

export const PROFESSION_DATA = {
    farmer: {
        id: "farmer",
        variant: 1,
        family: "farmer",
        defaultItem: "minecraft:iron_hoe",
        allowedItems: ["minecraft:iron_hoe", "minecraft:bone_meal", "minecraft:wheat", "minecraft:wheat_seeds", "minecraft:carrot", "minecraft:potato", "minecraft:beetroot"],
        tag: "farmer",
        rpcTag: "rpc:farmer",
        displayName: "§e[Farmer]"
    },
    fisherman: {
        id: "fisherman",
        variant: 2,
        family: "fisherman",
        defaultItem: "rpc:fishing_rod",
        allowedItems: ["rpc:fishing_rod", "minecraft:cod", "minecraft:salmon", "minecraft:cooked_cod", "minecraft:cooked_salmon", "minecraft:tropical_fish_bucket", "minecraft:water_bucket"],
        tag: "fisherman",
        rpcTag: "rpc:fisherman",
        displayName: "§b[Fisherman]"
    },
    shepherd: {
        id: "shepherd",
        variant: 3,
        family: "shepherd",
        defaultItem: "rpc:shears",
        allowedItems: ["rpc:shears", "minecraft:shears", "minecraft:wheat", "minecraft:red_dye", "minecraft:blue_dye", "minecraft:yellow_dye", "minecraft:green_dye", "minecraft:purple_dye", "minecraft:orange_dye", "minecraft:pink_dye", "minecraft:cyan_dye", "minecraft:white_carpet"],
        tag: "shepherd",
        rpcTag: "rpc:shepherd",
        displayName: "§a[Shepherd]"
    },
    fletcher: {
        id: "fletcher",
        variant: 4,
        family: "fletcher",
        defaultItem: "minecraft:bow",
        allowedItems: ["minecraft:bow", "minecraft:crossbow", "minecraft:arrow"],
        tag: "fletcher",
        rpcTag: "rpc:fletcher",
        displayName: "§6[Fletcher]"
    },
    librarian: {
        id: "librarian",
        variant: 5,
        family: "librarian",
        defaultItem: "minecraft:enchanted_book",
        allowedItems: ["minecraft:enchanted_book", "minecraft:book", "minecraft:paper", "minecraft:sugar_cane"],
        tag: "librarian",
        rpcTag: "rpc:librarian",
        displayName: "§9[Librarian]"
    },
    cartographer: {
        id: "cartographer",
        variant: 6,
        family: "cartographer",
        defaultItem: "minecraft:map",
        allowedItems: ["minecraft:map"],
        tag: "cartographer",
        rpcTag: "rpc:cartographer",
        displayName: "§2[Cartographer]"
    },
    cleric: {
        id: "cleric",
        variant: 7,
        family: "cleric",
        defaultItem: "minecraft:splash_potion",
        allowedItems: ["minecraft:splash_potion", "minecraft:potion", "minecraft:golden_apple"],
        tag: "cleric",
        rpcTag: "rpc:cleric",
        displayName: "§d[Cleric]"
    },
    armorer: {
        id: "armorer",
        variant: 8,
        family: "armorer",
        defaultItem: "minecraft:iron_ingot",
        allowedItems: ["minecraft:iron_ingot", "minecraft:shield", "minecraft:iron_chestplate"],
        tag: "armorer",
        rpcTag: "rpc:armorer",
        displayName: "§7[Armorer]"
    },
    weaponsmith: {
        id: "weaponsmith",
        variant: 9,
        family: "weaponsmith",
        defaultItem: "minecraft:iron_sword",
        allowedItems: ["minecraft:iron_sword", "minecraft:iron_axe", "minecraft:goat_horn"],
        tag: "weaponsmith",
        rpcTag: "rpc:weaponsmith",
        displayName: "§4[Weaponsmith]"
    },
    toolsmith: {
        id: "toolsmith",
        variant: 10,
        family: "toolsmith",
        defaultItem: "minecraft:iron_pickaxe",
        allowedItems: ["minecraft:iron_pickaxe"],
        tag: "toolsmith",
        rpcTag: "rpc:toolsmith",
        displayName: "§3[Toolsmith]"
    },
    butcher: {
        id: "butcher",
        variant: 11,
        family: "butcher",
        defaultItem: "minecraft:iron_axe",
        allowedItems: ["minecraft:iron_axe", "rpc:cleaver"],
        tag: "butcher",
        rpcTag: "rpc:butcher",
        displayName: "§c[Butcher]"
    },
    leatherworker: {
        id: "leatherworker",
        variant: 12,
        family: "leatherworker",
        defaultItem: "minecraft:leather",
        allowedItems: ["minecraft:leather"],
        tag: "leatherworker",
        rpcTag: "rpc:leatherworker",
        displayName: "§6[Leatherworker]"
    },
    mason: {
        id: "mason",
        variant: 13,
        family: "stone_mason",
        defaultItem: "minecraft:stone_brick",
        allowedItems: ["minecraft:stone_brick"],
        tag: "mason",
        rpcTag: "rpc:mason",
        displayName: "§f[Mason]"
    }
};

export const ALL_PROFESSION_KEYS = Object.keys(PROFESSION_DATA);
export const ALL_RPC_TAGS = ALL_PROFESSION_KEYS.map(k => PROFESSION_DATA[k].rpcTag);
export const ALL_STANDARD_TAGS = ALL_PROFESSION_KEYS.map(k => PROFESSION_DATA[k].tag);

/**
 * Accurately determines a villager's current active profession based on native Bedrock variant & family.
 * @param {Entity} entity 
 * @returns {string|null} Profession key ("farmer", "butcher", etc.) or "unskilled" / "nitwit" / null
 */
export function getVillagerProfession(entity) {
    if (!entity || !entity.isValid()) return null;

    // 1. Primary check: minecraft:variant (set dynamically by Bedrock component groups 1-13)
    try {
        const variantComp = entity.getComponent("minecraft:variant");
        if (variantComp && typeof variantComp.value === "number") {
            const v = variantComp.value;
            for (const key of ALL_PROFESSION_KEYS) {
                if (PROFESSION_DATA[key].variant === v) {
                    return key;
                }
            }
            if (v === 14) return "nitwit";
        }
    } catch {}

    // 2. Secondary check: type_family
    for (const key of ALL_PROFESSION_KEYS) {
        try {
            if (entity.matches({ families: [PROFESSION_DATA[key].family] })) {
                return key;
            }
        } catch {}
    }

    // 3. Custom tags check: rpc:butcher, rpc:farmer, etc. (for summoned / player-converted villagers)
    for (const key of ALL_PROFESSION_KEYS) {
        try {
            if (entity.hasTag(PROFESSION_DATA[key].rpcTag) || entity.hasTag(PROFESSION_DATA[key].tag)) {
                return key;
            }
        } catch {}
    }

    // 4. Fallback check: unskilled or nitwit
    try {
        const variantComp = entity.getComponent("minecraft:variant");
        if (variantComp && variantComp.value === 0) return "unskilled";
        if (entity.matches({ families: ["unskilled"] })) return "unskilled";
        if (entity.matches({ families: ["nitwit"] })) return "nitwit";
    } catch {}

    return null;
}

/**
 * Strips all custom profession tags, unregisters from managers, stops active sessions,
 * and clears held mainhand weapons/tools.
 * @param {Entity} target 
 * @param {object} [managers]
 */
export function clearAllProfessions(target, managers = {}) {
    if (!target || !target.isValid()) return;

    // Remove all profession tags
    for (const t of ALL_RPC_TAGS) {
        try { target.removeTag(t); } catch {}
    }
    for (const t of ALL_STANDARD_TAGS) {
        try { target.removeTag(t); } catch {}
    }
    try { target.removeTag("rpc:shepherd_sheeps_spawned"); } catch {}

    // Stop fishing session if any
    try { target.triggerEvent("rpc:stop_fishing"); } catch {}
    if (managers.fishermanManager?.records.has(target.id)) {
        const rec = managers.fishermanManager.records.get(target.id);
        if (rec && rec.fishingSession) {
            try { rec.fishingSession.bobber?.remove(); } catch {}
        }
    }

    // Unregister from all managers
    managers.fishermanManager?.records.delete(target.id);
    managers.shepherdManager?.records.delete(target.id);
    managers.butcherManager?.records.delete(target.id);
    managers.fletcherManager?.records.delete(target.id);
    managers.farmerManager?.records.delete(target.id);
    managers.weaponsmithManager?.records.delete(target.id);
    managers.clericManager?.records.delete(target.id);
    managers.armorerManager?.records.delete(target.id);
    managers.librarianManager?.records.delete(target.id);

    // Unequip weapon/tool via equippable and fallback replaceitem air
    try {
        const equippable = target.getComponent("minecraft:equippable");
        equippable?.setEquipment(EquipmentSlot.Mainhand, undefined);
    } catch {}
    try {
        target.runCommandAsync("replaceitem entity @s slot.weapon.mainhand 0 air").catch(() => {});
    } catch {}

    // Clear profession nameTag if present
    try {
        if (target.nameTag && target.nameTag.includes("[")) {
            target.nameTag = "";
        }
    } catch {}
}

/**
 * Checks if it is currently nighttime in the overworld.
 */
function isNightTime() {
    try {
        const timeOfDay = world.getTimeOfDay();
        return timeOfDay >= 12000 && timeOfDay < 23500;
    } catch {
        return false;
    }
}

/**
 * Synchronizes a villager's equipment, tags, and AI manager to match their current workbench occupation.
 * Automatically equips the right tool when they claim a new workstation,
 * and removes tools if they lose their workstation or change jobs!
 * @param {Entity} villager 
 * @param {object} managers 
 */
export function synchronizeVillagerOccupation(villager, managers = {}) {
    if (!villager || !villager.isValid()) return;

    const currentProf = getVillagerProfession(villager);
    const equippable = villager.getComponent("minecraft:equippable");
    const heldItem = equippable?.getEquipment(EquipmentSlot.Mainhand);
    const heldTypeId = heldItem?.typeId;

    const expected = currentProf ? PROFESSION_DATA[currentProf] : null;

    // Case 1: Unemployed / Nitwit / Unknown
    // If holding any weapon or profession tool, immediately strip it!
    if (!expected) {
        if (heldTypeId || ALL_RPC_TAGS.some(tag => villager.hasTag(tag))) {
            clearAllProfessions(villager, managers);
        }
        return;
    }

    // Case 2: Holding an item or tag from a DIFFERENT profession
    const hasStaleTag = ALL_RPC_TAGS.some(tag => tag !== expected.rpcTag && villager.hasTag(tag));
    const hasStaleItem = heldTypeId && !expected.allowedItems.includes(heldTypeId);

    if (hasStaleTag || hasStaleItem) {
        // Clear conflicting previous profession data
        clearAllProfessions(villager, managers);

        // Add correct new tags
        villager.addTag(expected.tag);
        villager.addTag(expected.rpcTag);

        // Update profession name tag if already using profession tags
        try {
            if (!villager.nameTag || villager.nameTag.includes("[")) {
                villager.nameTag = expected.displayName;
            }
        } catch {}

        // Equip correct new item (unless sleeping)
        if (!isNightTime()) {
            try {
                equippable?.setEquipment(EquipmentSlot.Mainhand, new ItemStack(expected.defaultItem, 1));
            } catch {
                villager.runCommandAsync(`replaceitem entity @s slot.weapon.mainhand 0 ${expected.defaultItem}`).catch(() => {});
            }
        }

        // Register into the new profession's manager
        registerVillagerIntoManager(villager, currentProf, managers);
        return;
    }

    // Case 3: Villager just took the job naturally via workstation and needs their tool!
    if (!villager.hasTag(expected.rpcTag)) {
        villager.addTag(expected.tag);
        villager.addTag(expected.rpcTag);

        try {
            if (!villager.nameTag || villager.nameTag.includes("[")) {
                villager.nameTag = expected.displayName;
            }
        } catch {}

        if (!isNightTime() && (!heldTypeId || !expected.allowedItems.includes(heldTypeId))) {
            try {
                equippable?.setEquipment(EquipmentSlot.Mainhand, new ItemStack(expected.defaultItem, 1));
            } catch {
                villager.runCommandAsync(`replaceitem entity @s slot.weapon.mainhand 0 ${expected.defaultItem}`).catch(() => {});
            }
        }

        registerVillagerIntoManager(villager, currentProf, managers);
    }
}

/**
 * Registers a villager into the matching manager.
 */
export function registerVillagerIntoManager(villager, profId, managers = {}) {
    if (!villager || !villager.isValid()) return;

    switch (profId) {
        case "fisherman":
            managers.fishermanManager?.registerFisherman(villager);
            break;
        case "shepherd":
            managers.shepherdManager?.registerShepherd(villager);
            break;
        case "butcher":
            managers.butcherManager?.registerButcher(villager);
            break;
        case "fletcher":
            managers.fletcherManager?.setWeapon(villager, "minecraft:bow");
            break;
        case "farmer":
            managers.farmerManager?.registerFarmer(villager);
            break;
        case "weaponsmith":
            managers.weaponsmithManager?.registerWeaponsmith(villager);
            break;
        case "cleric":
            managers.clericManager?.registerCleric(villager);
            break;
        case "armorer":
            managers.armorerManager?.registerArmorer(villager);
            break;
        case "librarian":
            managers.librarianManager?.registerLibrarian(villager);
            break;
    }
}

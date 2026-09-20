/**
 * Fisherman Villager Addon - Configuration Module (Namespace: rpc)
 */

export const SCAN_CONFIG = {
    // Search radius in blocks (48 blocks satisfies "40 blocks or more")
    RADIUS: 48,
    RADIAL_STEP: 4,
    SEA_LEVEL: 63,
    SEARCH_INTERVAL_TICKS: 20, // Check every 1 second when idle
    RIVER_BIOME_IDS: [
        "minecraft:river",
        "minecraft:frozen_river"
    ],
    RIVER_SCORE_BONUS: 5000,
    GENERIC_WATER_BONUS: 800
};

export const FISHING_CONFIG = {
    // Ticks before bite (4 to 8 seconds)
    MIN_BITE_TICKS: 80,
    MAX_BITE_TICKS: 160,
    BITE_WINDOW_TICKS: 25,
    // Cooldown after catch before looking to fish again (1.5 seconds)
    COOLDOWN_TICKS: 30,
    // Distance to cast out into the river
    FAR_CAST_MIN: 7.0,
    FAR_CAST_MAX: 15.0,
    STRING_PARTICLE_POINTS: 16,
    // Custom rpc identifiers
    FISHING_ROD_ITEM_ID: "rpc:fishing_rod",
    BOBBER_ENTITY_ID: "rpc:fishing_bobber",
    STRING_PARTICLE_ID: "rpc:fishing_line_particle",
    FALLBACK_PARTICLE_ID: "minecraft:endrod"
};

export const NAVIGATION_CONFIG = {
    // Step speed along ground in blocks/tick (natural human pace)
    WALK_SPEED_PER_TICK: 0.22,
    ARRIVAL_DISTANCE: 1.4,
    TIMEOUT_TICKS: 600,
    STUCK_TICKS_THRESHOLD: 15
};

export const LOOT_TABLE = [
    { typeId: "minecraft:cod", weight: 45, displayName: "Raw Cod" },
    { typeId: "minecraft:salmon", weight: 32, displayName: "Raw Salmon" },
    { typeId: "minecraft:tropical_fish", weight: 14, displayName: "Tropical Fish" },
    { typeId: "minecraft:pufferfish", weight: 5, displayName: "Pufferfish" },
    { typeId: "minecraft:nautilus_shell", weight: 3, displayName: "Nautilus Shell" },
    { typeId: "minecraft:emerald", weight: 1, displayName: "Emerald" }
];

export const SHEPHERD_CONFIG = {
    SHEEP_SEARCH_RADIUS: 24,
    SHEAR_DISTANCE: 2.5,
    SHEAR_COOLDOWN_TICKS: 60,
    SHEAR_ANIMATION_TICKS: 22,
    SHEARS_ITEM_ID: "rpc:shears",
    VANILLA_SHEARS_ITEM_ID: "minecraft:shears",
    WHEAT_ITEM_ID: "minecraft:wheat",
    LOOM_ID: "minecraft:loom",
    LOOM_SEARCH_RADIUS: 18,
    LOOM_USE_DISTANCE: 2.2,
    PREDATOR_SEARCH_RADIUS: 12,
    DYES: [
        { itemId: "minecraft:red_dye", colorIndex: 14, event: "minecraft:set_color_red" },
        { itemId: "minecraft:blue_dye", colorIndex: 11, event: "minecraft:set_color_blue" },
        { itemId: "minecraft:yellow_dye", colorIndex: 4, event: "minecraft:set_color_yellow" },
        { itemId: "minecraft:green_dye", colorIndex: 13, event: "minecraft:set_color_green" },
        { itemId: "minecraft:purple_dye", colorIndex: 10, event: "minecraft:set_color_purple" },
        { itemId: "minecraft:orange_dye", colorIndex: 1, event: "minecraft:set_color_orange" },
        { itemId: "minecraft:pink_dye", colorIndex: 6, event: "minecraft:set_color_pink" },
        { itemId: "minecraft:cyan_dye", colorIndex: 9, event: "minecraft:set_color_cyan" }
    ],
    WOOL_MAP: [
        "minecraft:white_wool",       // 0
        "minecraft:orange_wool",      // 1
        "minecraft:magenta_wool",     // 2
        "minecraft:light_blue_wool",  // 3
        "minecraft:yellow_wool",      // 4
        "minecraft:lime_wool",        // 5
        "minecraft:pink_wool",        // 6
        "minecraft:gray_wool",        // 7
        "minecraft:light_gray_wool",  // 8
        "minecraft:cyan_wool",        // 9
        "minecraft:purple_wool",      // 10
        "minecraft:blue_wool",        // 11
        "minecraft:brown_wool",       // 12
        "minecraft:green_wool",       // 13
        "minecraft:red_wool",         // 14
        "minecraft:black_wool"        // 15
    ]
};

export const BUTCHER_CONFIG = {
    ANIMAL_SEARCH_RADIUS: 24,
    SMOKER_SEARCH_RADIUS: 32,
    ATTACK_DISTANCE: 2.2,
    SMOKER_LOAD_DISTANCE: 2.5,
    HUNT_COOLDOWN_TICKS: 60,
    SLAUGHTER_ANIMATION_TICKS: 22,
    CLEAVER_ITEM_ID: "rpc:cleaver",
    VANILLA_AXE_ITEM_ID: "minecraft:iron_axe",
    COAL_ITEM_ID: "minecraft:coal",
    COAL_LOAD_AMOUNT: 2
};

export const FISHERMAN_CONFIG = {
    RAW_FISH_ITEMS: ["minecraft:cod", "minecraft:salmon"],
    COOKED_FISH_ITEMS: ["minecraft:cooked_cod", "minecraft:cooked_salmon"],
    TROPICAL_FISH_BUCKET: "minecraft:tropical_fish_bucket",
    WATER_BUCKET: "minecraft:water_bucket",
    CAMPFIRE_ID: "minecraft:campfire",
    SOUL_CAMPFIRE_ID: "minecraft:soul_campfire",
    CAMPFIRE_SEARCH_RADIUS: 18,
    CAT_SEARCH_RADIUS: 14,
    CAT_FEED_DISTANCE: 2.5
};

export const FLETCHER_CONFIG = {
    MONSTER_SEARCH_RADIUS: 18,
    TARGET_BLOCK_SEARCH_RADIUS: 24,
    PRACTICE_DISTANCE_MIN: 5.0,
    PRACTICE_DISTANCE_MAX: 9.0,
    ATTACK_INTERVAL_TICKS: 26,
    PRACTICE_INTERVAL_TICKS: 75,
    AIM_DURATION_TICKS: 18,
    ARROW_SPEED: 2.2,
    BOW_ITEM_ID: "minecraft:bow",
    CROSSBOW_ITEM_ID: "minecraft:crossbow",
    ARROW_ITEM_ID: "minecraft:arrow",
    FLETCHING_TABLE_ID: "minecraft:fletching_table",
    FLETCHING_TABLE_RADIUS: 16,
    FIRE_SEARCH_RADIUS: 4,
    HOSTILE_TYPES: [
        "minecraft:zombie",
        "minecraft:zombie_villager",
        "minecraft:husk",
        "minecraft:drowned",
        "minecraft:skeleton",
        "minecraft:stray",
        "minecraft:creeper",
        "minecraft:spider",
        "minecraft:cave_spider",
        "minecraft:pillager",
        "minecraft:vindicator",
        "minecraft:witch",
        "minecraft:evocation_illager",
        "minecraft:ravager",
        "minecraft:slime",
        "minecraft:phantom",
        "minecraft:silverfish",
        "minecraft:endermite",
        "minecraft:hoglin",
        "minecraft:piglin_brute",
        "minecraft:zoglin"
    ],
    HOSTILE_FAMILIES: [
        "monster",
        "undead",
        "zombie",
        "illager"
    ]
};

export const FARMER_CONFIG = {
    CROP_SEARCH_RADIUS: 16,
    CROP_HARVEST_DISTANCE: 2.2,
    HARVEST_ANIMATION_TICKS: 20,
    COOLDOWN_TICKS: 50,
    HOE_ITEM_ID: "minecraft:iron_hoe",
    CROPS: [
        { typeId: "minecraft:wheat", maxGrowth: 7, loot: "minecraft:wheat", seed: "minecraft:wheat_seeds" },
        { typeId: "minecraft:carrots", maxGrowth: 7, loot: "minecraft:carrot", seed: "minecraft:carrot" },
        { typeId: "minecraft:potatoes", maxGrowth: 7, loot: "minecraft:potato", seed: "minecraft:potato" },
        { typeId: "minecraft:beetroot", maxGrowth: 7, loot: "minecraft:beetroot", seed: "minecraft:beetroot_seeds" }
    ],
    COMPOSTER_ID: "minecraft:composter",
    FLOWERS: [
        "minecraft:dandelion",
        "minecraft:poppy",
        "minecraft:allium",
        "minecraft:azure_bluet",
        "minecraft:red_tulip",
        "minecraft:orange_tulip",
        "minecraft:white_tulip",
        "minecraft:pink_tulip",
        "minecraft:oxeye_daisy",
        "minecraft:cornflower",
        "minecraft:lily_of_the_valley"
    ],
    SAPLINGS: [
        "minecraft:oak_sapling",
        "minecraft:birch_sapling",
        "minecraft:spruce_sapling",
        "minecraft:cherry_sapling",
        "minecraft:acacia_sapling"
    ],
    FLOWER_SEARCH_RADIUS: 12,
    SAPLING_SEARCH_RADIUS: 14,
    BONEMEAL_SEARCH_RADIUS: 12,
    MONSTER_SEARCH_RADIUS: 14,
    ATTACK_DISTANCE: 2.5,
    ATTACK_DAMAGE: 6,
    ANIMAL_SEARCH_RADIUS: 14,
    ANIMAL_FEED_DISTANCE: 2.5,
    ANIMAL_FEED_ANIMATION_TICKS: 25,
    BREEDABLE_ANIMALS: [
        {
            typeId: "minecraft:cow",
            foodItem: "minecraft:wheat",
            foodItemId: "minecraft:wheat",
            family: "cow",
            name: "Cow"
        },
        {
            typeId: "minecraft:sheep",
            foodItem: "minecraft:wheat",
            foodItemId: "minecraft:wheat",
            family: "sheep",
            name: "Sheep"
        },
        {
            typeId: "minecraft:chicken",
            foodItem: "minecraft:wheat_seeds",
            foodItemId: "minecraft:wheat_seeds",
            family: "chicken",
            name: "Chicken"
        },
        {
            typeId: "minecraft:pig",
            foodItem: "minecraft:carrot",
            foodItemId: "minecraft:carrot",
            family: "pig",
            name: "Pig"
        }
    ]
};

export const WEAPONSMITH_CONFIG = {
    SWORD_ITEM_ID: "minecraft:iron_sword",
    AXE_ITEM_ID: "minecraft:iron_axe",
    HORN_ITEM_ID: "minecraft:goat_horn",
    GRINDSTONE_ID: "minecraft:grindstone",
    GRINDSTONE_SEARCH_RADIUS: 18,
    GRINDSTONE_USE_DISTANCE: 2.2,
    SHARPEN_ANIMATION_TICKS: 30,
    COOLDOWN_TICKS: 80,
    MONSTER_SEARCH_RADIUS: 16,
    BUFF_SEARCH_RADIUS: 12,
    BUFF_COOLDOWN_TICKS: 200,
    ATTACK_DISTANCE: 2.5,
    ATTACK_DAMAGE: 7
};

export const CLERIC_CONFIG = {
    SPLASH_POTION_ITEM_ID: "minecraft:splash_potion",
    POTION_ITEM_ID: "minecraft:potion",
    GOLDEN_APPLE_ITEM_ID: "minecraft:golden_apple",
    ALLIED_SEARCH_RADIUS: 14,
    HEAL_DISTANCE: 8.0,
    HEAL_COOLDOWN_TICKS: 50,
    HEAL_ANIMATION_TICKS: 22,
    BREWING_STAND_ID: "minecraft:brewing_stand",
    BREWING_SEARCH_RADIUS: 16,
    RAID_SEARCH_RADIUS: 20,
    OFFENSIVE_SEARCH_RADIUS: 14,
    OFFENSIVE_THROW_DISTANCE: 12,
    SELF_REGEN_HEALTH_THRESHOLD: 0.8,
    POTION_COOLDOWN_TICKS: 40,
    ZOMBIE_VILLAGER_SEARCH_RADIUS: 12,
    SANCTUARY_RADIUS: 8
};

export const ARMORER_CONFIG = {
    INGOT_ITEM_ID: "minecraft:iron_ingot",
    SHIELD_ITEM_ID: "minecraft:shield",
    CHESTPLATE_ITEM_ID: "minecraft:iron_chestplate",
    GOLEM_SEARCH_RADIUS: 20,
    REPAIR_DISTANCE: 3.0,
    REPAIR_COOLDOWN_TICKS: 60,
    REPAIR_ANIMATION_TICKS: 24,
    BLAST_FURNACE_ID: "minecraft:blast_furnace",
    BLAST_FURNACE_SEARCH_RADIUS: 18,
    ANVIL_BLOCK_IDS: ["minecraft:anvil", "minecraft:chipped_anvil", "minecraft:damaged_anvil"],
    ANVIL_SEARCH_RADIUS: 16,
    BUFF_SEARCH_RADIUS: 10,
    BUFF_COOLDOWN_TICKS: 300,
    GOLEM_SUMMON_RADIUS: 32
};

export const LIBRARIAN_CONFIG = {
    BOOK_ITEM_ID: "minecraft:enchanted_book",
    REGULAR_BOOK_ITEM_ID: "minecraft:book",
    PAPER_ITEM_ID: "minecraft:paper",
    LECTERN_ID: "minecraft:lectern",
    LECTERN_SEARCH_RADIUS: 18,
    LECTERN_STUDY_DISTANCE: 2.2,
    STUDY_ANIMATION_TICKS: 40,
    INSPIRATION_RADIUS: 12,
    COOLDOWN_TICKS: 90,
    SUGARCANE_SEARCH_RADIUS: 16,
    SUGARCANE_BLOCK_ID: "minecraft:reeds",
    SUGARCANE_ITEM_ID: "minecraft:sugar_cane",
    HARVEST_DISTANCE: 2.5,
    PLANT_DISTANCE: 2.5,
    DISPEL_SEARCH_RADIUS: 12
};



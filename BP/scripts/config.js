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
    // Search radius to look for sheep (blocks)
    SHEEP_SEARCH_RADIUS: 24,
    // Distance from sheep to perform shearing
    SHEAR_DISTANCE: 2.5,
    // Cooldown ticks after shearing before finding another sheep (3 seconds)
    SHEAR_COOLDOWN_TICKS: 60,
    // Interaction duration in ticks (arm raise and snip animation)
    SHEAR_ANIMATION_TICKS: 22,
    // Preferred item IDs to equip in hand
    SHEARS_ITEM_ID: "rpc:shears",
    VANILLA_SHEARS_ITEM_ID: "minecraft:shears",
    // Color to wool block item ID mapping (0-15 matching Bedrock color component)
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
    // Search radius to look for cows and pigs (blocks)
    ANIMAL_SEARCH_RADIUS: 24,
    // Search radius for Smoker block workstation (blocks)
    SMOKER_SEARCH_RADIUS: 32,
    // Distance to slaughter animal
    ATTACK_DISTANCE: 2.2,
    // Distance to smoker to load meat and fuel
    SMOKER_LOAD_DISTANCE: 2.5,
    // Cooldown ticks after slaughter before hunting again (3 seconds)
    HUNT_COOLDOWN_TICKS: 60,
    // Slaughter swing duration in ticks
    SLAUGHTER_ANIMATION_TICKS: 22,
    // Items
    CLEAVER_ITEM_ID: "rpc:cleaver",
    VANILLA_AXE_ITEM_ID: "minecraft:iron_axe",
    COAL_ITEM_ID: "minecraft:coal",
    COAL_LOAD_AMOUNT: 2
};

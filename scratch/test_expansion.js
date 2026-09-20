const fs = require('fs');
const path = require('path');

console.log("=== RUNNING BUG CHECK & INTEGRATION TEST ===");

// 1. Validate villager_v2.json JSONC
const jsonPath = path.resolve('BP/entities/villager_v2.json');
const jsonRaw = fs.readFileSync(jsonPath, 'utf8');
const jsonClean = jsonRaw.replace(/\/\/.*$/gm, '');
try {
    const parsed = JSON.parse(jsonClean);
    console.log("[PASS] villager_v2.json is valid JSONC.");
    
    // Verify minecraft:inventory
    const comps = parsed['minecraft:entity'].components;
    if (comps['minecraft:inventory'] && comps['minecraft:inventory'].inventory_size === 8) {
        console.log("[PASS] villager_v2.json has minecraft:inventory with size 8.");
    } else {
        console.error("[FAIL] Missing or invalid minecraft:inventory in villager_v2.json");
        process.exit(1);
    }
    
    // Verify accepted_items in slot 0
    const accepted = comps['minecraft:equippable'].slots[0].accepted_items;
    const requiredItems = ["minecraft:chest", "minecraft:barrel", "minecraft:bed", "minecraft:sugar_cane", "minecraft:wheat"];
    for (const req of requiredItems) {
        if (!accepted.includes(req)) {
            console.error(`[FAIL] Missing ${req} in accepted_items`);
            process.exit(1);
        }
    }
    console.log("[PASS] All required expansion items present in accepted_items.");
} catch (e) {
    console.error("[FAIL] Error parsing villager_v2.json:", e);
    process.exit(1);
}

// 2. Validate all 26 scripts syntax
const scriptsDir = path.resolve('BP/scripts');
const files = fs.readdirSync(scriptsDir).filter(f => f.endsWith('.js'));
console.log(`Checking ${files.length} scripts in BP/scripts...`);

for (const file of files) {
    let code = fs.readFileSync(path.join(scriptsDir, file), 'utf8');
    code = code.replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '/* import */');
    code = code.replace(/import\s+['"][^'"]+['"];?/g, '/* import */');
    code = code.replace(/export\s+(?:default\s+)?/g, '/* export */');
    code = code.replace(/export\s*\{[\s\S]*?\};?/g, '/* export list */');
    try {
        new Function(code);
    } catch (err) {
        console.error(`[FAIL] Syntax error in ${file}:`, err);
        process.exit(1);
    }
}
console.log("[PASS] All 26 JavaScript files pass syntax check.");

// 3. Test EXPANSION_CONFIG exports
const configPath = path.resolve('BP/scripts/config.js');
const configContent = fs.readFileSync(configPath, 'utf8');
if (configContent.includes('EXPANSION_CONFIG') && configContent.includes('CHEST_BLOCK_IDS') && configContent.includes('BED_BLOCK_ID')) {
    console.log("[PASS] EXPANSION_CONFIG properly defined in config.js.");
} else {
    console.error("[FAIL] EXPANSION_CONFIG missing in config.js");
    process.exit(1);
}

// 4. Test VillageExpansionManager exports and integration in main.js
const mainPath = path.resolve('BP/scripts/main.js');
const mainContent = fs.readFileSync(mainPath, 'utf8');
if (mainContent.includes('VillageExpansionManager') && mainContent.includes('villageExpansionManager.update()')) {
    console.log("[PASS] VillageExpansionManager properly imported and ticked in main.js.");
} else {
    console.error("[FAIL] VillageExpansionManager missing in main.js");
    process.exit(1);
}

// 5. Test professionHelper allowedItems
const profHelperPath = path.resolve('BP/scripts/professionHelper.js');
const profContent = fs.readFileSync(profHelperPath, 'utf8');
if (profContent.includes('UNIVERSAL_ALLOWED_ITEMS') && profContent.includes('minecraft:chest')) {
    console.log("[PASS] professionHelper allows universal items.");
} else {
    console.error("[FAIL] UNIVERSAL_ALLOWED_ITEMS missing in professionHelper.js");
    process.exit(1);
}

console.log("=== ALL CHECKS PASSED SUCCESSFULLY ===");

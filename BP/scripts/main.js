/**
 * Villager Professions Addon - Main Entry Point (Namespace: rpc)
 * Initializes the addon, binds world events, player interactions, and executes the central game loop
 * for all smart villager professions:
 * - Fisherman (Fishing in rivers, animated bobbers, custom catches)
 * - Shepherd (Leashed starter sheep, authentic shearing, wool drops)
 * - Butcher (Axe combat against monsters, hunting pigs/cows, smoker cooking)
 * - Fletcher (Bow/Crossbow combat against monsters, target block practice)
 * - Farmer (Iron hoe harvesting of ripe crops, replanting, composting)
 * - Weaponsmith (Iron sword combat against monsters, grindstone blade sharpening)
 * - Cleric (Splash healing potions on injured villagers/golems/players, brewing stand)
 * - Armorer (Iron Golem maintenance & repair with iron ingots, blast furnace forging)
 * - Librarian (Enchanted book lectern studying, protective inspiration village buffs)
 */

import { world, system } from "@minecraft/server";
import { FishermanManager } from "./fishermanManager.js";
import { ShepherdManager } from "./shepherdManager.js";
import { ButcherManager } from "./butcherManager.js";
import { FletcherManager } from "./fletcherManager.js";
import { FarmerManager } from "./farmerManager.js";
import { WeaponsmithManager } from "./weaponsmithManager.js";
import { ClericManager } from "./clericManager.js";
import { ArmorerManager } from "./armorerManager.js";
import { LibrarianManager } from "./librarianManager.js";

const fishermanManager = new FishermanManager();
const shepherdManager = new ShepherdManager();
const butcherManager = new ButcherManager();
const fletcherManager = new FletcherManager();
const farmerManager = new FarmerManager();
const weaponsmithManager = new WeaponsmithManager();
const clericManager = new ClericManager();
const armorerManager = new ArmorerManager();
const librarianManager = new LibrarianManager();

// Central game tick loop
system.runInterval(() => {
    try { fishermanManager.update(); } catch (err) { console.error(`[Villager Addon] Error in fisherman loop: ${err}`); }
    try { shepherdManager.update(); } catch (err) { console.error(`[Villager Addon] Error in shepherd loop: ${err}`); }
    try { butcherManager.update(); } catch (err) { console.error(`[Villager Addon] Error in butcher loop: ${err}`); }
    try { fletcherManager.update(); } catch (err) { console.error(`[Villager Addon] Error in fletcher loop: ${err}`); }
    try { farmerManager.update(); } catch (err) { console.error(`[Villager Addon] Error in farmer loop: ${err}`); }
    try { weaponsmithManager.update(); } catch (err) { console.error(`[Villager Addon] Error in weaponsmith loop: ${err}`); }
    try { clericManager.update(); } catch (err) { console.error(`[Villager Addon] Error in cleric loop: ${err}`); }
    try { armorerManager.update(); } catch (err) { console.error(`[Villager Addon] Error in armorer loop: ${err}`); }
    try { librarianManager.update(); } catch (err) { console.error(`[Villager Addon] Error in librarian loop: ${err}`); }
}, 1);

// Register newly spawned or transformed villagers with a 2-tick stabilization delay
world.afterEvents.entitySpawn.subscribe((event) => {
    try {
        const entity = event.entity;
        if (entity && entity.isValid() && (entity.typeId === "minecraft:villager_v2" || entity.typeId === "minecraft:villager")) {
            system.runTimeout(() => {
                if (!entity || !entity.isValid()) return;
                fishermanManager.onEntitySpawn(entity);
                shepherdManager.onEntitySpawn(entity);
                butcherManager.onEntitySpawn(entity);
                fletcherManager.onEntitySpawn(entity);
                farmerManager.onEntitySpawn(entity);
                weaponsmithManager.onEntitySpawn(entity);
                clericManager.onEntitySpawn(entity);
                armorerManager.onEntitySpawn(entity);
                librarianManager.onEntitySpawn(entity);
            }, 2);
        }
    } catch {}
});

// Periodic cleanup: ensure no villager holds a weapon or tool from another profession
system.runInterval(() => {
    try {
        const dimensions = ["overworld", "nether", "the_end"];
        for (const dimId of dimensions) {
            let dim;
            try { dim = world.getDimension(dimId); } catch {}
            if (!dim) continue;

            let villagers = [];
            try {
                villagers = dim.getEntities({ type: "minecraft:villager_v2" });
            } catch {}
            try {
                const legacy = dim.getEntities({ type: "minecraft:villager" });
                if (legacy && legacy.length > 0) villagers = villagers.concat(legacy);
            } catch {}

            for (const villager of villagers) {
            if (!villager || !villager.isValid()) continue;
            const equippable = villager.getComponent("minecraft:equippable");
            const item = equippable?.getEquipment("Mainhand");
            if (!item) continue;

            const isButcher = butcherManager.isButcherVillager(villager);
            const isFletcher = fletcherManager.isFletcherVillager(villager);
            const isFisherman = fishermanManager.isFishermanVillager(villager);
            const isShepherd = shepherdManager.isShepherdVillager(villager);
            const isFarmer = farmerManager.isFarmerVillager(villager);
            const isWeaponsmith = weaponsmithManager.isWeaponsmithVillager(villager);
            const isCleric = clericManager.isClericVillager(villager);
            const isArmorer = armorerManager.isArmorerVillager(villager);
            const isLibrarian = librarianManager.isLibrarianVillager(villager);

            const typeId = item.typeId;
            if ((typeId === "minecraft:iron_axe" || typeId === "rpc:cleaver") && !isButcher) {
                equippable.setEquipment("Mainhand", undefined);
            } else if ((typeId === "minecraft:bow" || typeId === "minecraft:crossbow") && !isFletcher) {
                equippable.setEquipment("Mainhand", undefined);
            } else if (typeId === "rpc:fishing_rod" && !isFisherman) {
                equippable.setEquipment("Mainhand", undefined);
            } else if ((typeId === "minecraft:shears" || typeId === "rpc:shears") && !isShepherd) {
                equippable.setEquipment("Mainhand", undefined);
            } else if (typeId === "minecraft:iron_hoe" && !isFarmer) {
                equippable.setEquipment("Mainhand", undefined);
            } else if (typeId === "minecraft:iron_sword" && !isWeaponsmith) {
                equippable.setEquipment("Mainhand", undefined);
            } else if ((typeId === "minecraft:splash_potion" || typeId === "minecraft:potion") && !isCleric) {
                equippable.setEquipment("Mainhand", undefined);
            } else if (typeId === "minecraft:iron_ingot" && !isArmorer) {
                equippable.setEquipment("Mainhand", undefined);
            } else if ((typeId === "minecraft:enchanted_book" || typeId === "minecraft:book") && !isLibrarian) {
                equippable.setEquipment("Mainhand", undefined);
            }
        }
    }
} catch {}
}, 60);

function clearAllProfessions(target) {
    const profs = ["fisherman", "shepherd", "butcher", "fletcher", "farmer", "weaponsmith", "cleric", "armorer", "librarian"];
    for (const p of profs) {
        target.removeTag(`rpc:${p}`);
        target.removeTag(p);
    }
    try { target.triggerEvent("rpc:stop_fishing"); } catch {}
    if (fishermanManager.records.has(target.id)) {
        const rec = fishermanManager.records.get(target.id);
        if (rec && rec.fishingSession) {
            try { rec.fishingSession.bobber?.remove(); } catch {}
        }
        fishermanManager.records.delete(target.id);
    }
    shepherdManager.records.delete(target.id);
    butcherManager.records.delete(target.id);
    fletcherManager.records.delete(target.id);
    farmerManager.records.delete(target.id);
    weaponsmithManager.records.delete(target.id);
    clericManager.records.delete(target.id);
    armorerManager.records.delete(target.id);
    librarianManager.records.delete(target.id);

    try {
        const equippable = target.getComponent("minecraft:equippable");
        equippable?.setEquipment("Mainhand", undefined);
    } catch {}
}

// Allow player interactions to convert villagers into smart professions
world.afterEvents.playerInteractWithEntity.subscribe((event) => {
    try {
        const { player, target } = event;
        if (!target || !target.isValid()) return;

        const typeId = target.typeId;
        if (typeId === "minecraft:villager_v2" || typeId === "minecraft:villager") {
            const equippable = player.getComponent("minecraft:equippable");
            const mainhand = equippable?.getEquipment("Mainhand");
            if (!mainhand) return;

            const held = mainhand.typeId;

            // 1. Turn into Fisherman
            if (held === "rpc:fishing_rod") {
                clearAllProfessions(target);
                target.triggerEvent("rpc:become_fisherman");
                target.triggerEvent("minecraft:become_fisherman");
                target.addTag("rpc:fisherman");
                target.addTag("fisherman");
                fishermanManager.registerFisherman(target);
            }
            // 2. Turn into Shepherd
            else if (held === "rpc:shears" || held === "minecraft:shears") {
                clearAllProfessions(target);
                target.triggerEvent("rpc:become_shepherd");
                target.triggerEvent("minecraft:become_sheperd");
                target.addTag("rpc:shepherd");
                target.addTag("shepherd");
                shepherdManager.registerShepherd(target);
            }
            // 3. Turn into Butcher
            else if (held === "rpc:cleaver" || held === "minecraft:iron_axe") {
                clearAllProfessions(target);
                target.triggerEvent("rpc:become_butcher");
                target.triggerEvent("minecraft:become_butcher");
                target.addTag("rpc:butcher");
                target.addTag("butcher");
                butcherManager.registerButcher(target);
            }
            // 4. Turn into Fletcher (Bow or Crossbow)
            else if (held === "minecraft:bow" || held === "minecraft:crossbow") {
                clearAllProfessions(target);
                target.triggerEvent("rpc:become_fletcher");
                target.triggerEvent("minecraft:become_fletcher");
                target.addTag("rpc:fletcher");
                target.addTag("fletcher");
                fletcherManager.setWeapon(target, held);
            }
            // 5. Turn into Farmer (Iron Hoe)
            else if (held === "minecraft:iron_hoe") {
                clearAllProfessions(target);
                target.triggerEvent("minecraft:become_farmer");
                target.addTag("rpc:farmer");
                target.addTag("farmer");
                farmerManager.registerFarmer(target);
            }
            // 6. Turn into Weaponsmith (Iron Sword)
            else if (held === "minecraft:iron_sword") {
                clearAllProfessions(target);
                target.triggerEvent("minecraft:become_weaponsmith");
                target.addTag("rpc:weaponsmith");
                target.addTag("weaponsmith");
                weaponsmithManager.registerWeaponsmith(target);
            }
            // 7. Turn into Cleric (Potion or Splash Potion)
            else if (held === "minecraft:potion" || held === "minecraft:splash_potion") {
                clearAllProfessions(target);
                target.triggerEvent("minecraft:become_cleric");
                target.addTag("rpc:cleric");
                target.addTag("cleric");
                clericManager.registerCleric(target);
            }
            // 8. Turn into Armorer (Iron Ingot or Chestplate)
            else if (held === "minecraft:iron_ingot" || held === "minecraft:iron_chestplate") {
                clearAllProfessions(target);
                target.triggerEvent("minecraft:become_armorer");
                target.addTag("rpc:armorer");
                target.addTag("armorer");
                armorerManager.registerArmorer(target);
            }
            // 9. Turn into Librarian (Book or Enchanted Book)
            else if (held === "minecraft:book" || held === "minecraft:enchanted_book") {
                clearAllProfessions(target);
                target.triggerEvent("minecraft:become_librarian");
                target.addTag("rpc:librarian");
                target.addTag("librarian");
                librarianManager.registerLibrarian(target);
            }
        }
    } catch {}
});

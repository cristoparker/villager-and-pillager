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
import { VillageExpansionManager, setGlobalExpansionManager } from "./villageExpansionManager.js";
import { summonAllVillagers } from "./summonHelper.js";
import { synchronizeVillagerOccupation, clearAllProfessions, getVillagerProfession } from "./professionHelper.js";

const fishermanManager = new FishermanManager();
const shepherdManager = new ShepherdManager();
const butcherManager = new ButcherManager();
const fletcherManager = new FletcherManager();
const farmerManager = new FarmerManager();
const weaponsmithManager = new WeaponsmithManager();
const clericManager = new ClericManager();
const armorerManager = new ArmorerManager();
const librarianManager = new LibrarianManager();
const villageExpansionManager = new VillageExpansionManager();
setGlobalExpansionManager(villageExpansionManager);

export const allManagers = {
    fishermanManager,
    shepherdManager,
    butcherManager,
    fletcherManager,
    farmerManager,
    weaponsmithManager,
    clericManager,
    armorerManager,
    librarianManager,
    villageExpansionManager
};

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
    try { villageExpansionManager.update(); } catch (err) { console.error(`[Villager Addon] Error in expansion loop: ${err}`); }
}, 1);

// Register newly spawned or transformed villagers with a 2-tick stabilization delay
world.afterEvents.entitySpawn.subscribe((event) => {
    try {
        const entity = event.entity;
        if (entity && entity.isValid() && (entity.typeId === "minecraft:villager_v2" || entity.typeId === "minecraft:villager")) {
            system.runTimeout(() => {
                if (!entity || !entity.isValid()) return;
                synchronizeVillagerOccupation(entity, allManagers);
                fishermanManager.onEntitySpawn(entity);
                shepherdManager.onEntitySpawn(entity);
                butcherManager.onEntitySpawn(entity);
                fletcherManager.onEntitySpawn(entity);
                farmerManager.onEntitySpawn(entity);
                weaponsmithManager.onEntitySpawn(entity);
                clericManager.onEntitySpawn(entity);
                armorerManager.onEntitySpawn(entity);
                librarianManager.onEntitySpawn(entity);
                villageExpansionManager.onEntitySpawn(entity);
            }, 2);
        }
    } catch {}
});

// Dynamic Profession & Occupation Synchronization Loop
// Runs every 15 ticks across all loaded dimensions:
// Automatically detects when a villager claims a workstation, changes workstation, or loses their job!
// Dynamically updates their held tools, name tags, custom tags, and active AI manager.
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
                if (villager && villager.isValid()) {
                    synchronizeVillagerOccupation(villager, allManagers);
                }
            }
        }
    } catch (err) {
        console.error(`[Villager Addon] Error in occupation sync loop: ${err}`);
    }
}, 15);

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
                clearAllProfessions(target, allManagers);
                target.triggerEvent("rpc:become_fisherman");
                target.triggerEvent("minecraft:become_fisherman");
                target.addTag("rpc:fisherman");
                target.addTag("fisherman");
                fishermanManager.registerFisherman(target);
            }
            // 2. Turn into Shepherd
            else if (held === "rpc:shears" || held === "minecraft:shears") {
                clearAllProfessions(target, allManagers);
                target.triggerEvent("rpc:become_shepherd");
                target.triggerEvent("minecraft:become_sheperd");
                target.addTag("rpc:shepherd");
                target.addTag("shepherd");
                shepherdManager.registerShepherd(target);
            }
            // 3. Turn into Butcher
            else if (held === "rpc:cleaver" || held === "minecraft:iron_axe") {
                clearAllProfessions(target, allManagers);
                target.triggerEvent("rpc:become_butcher");
                target.triggerEvent("minecraft:become_butcher");
                target.addTag("rpc:butcher");
                target.addTag("butcher");
                butcherManager.registerButcher(target);
            }
            // 4. Turn into Fletcher (Bow or Crossbow)
            else if (held === "minecraft:bow" || held === "minecraft:crossbow") {
                clearAllProfessions(target, allManagers);
                target.triggerEvent("rpc:become_fletcher");
                target.triggerEvent("minecraft:become_fletcher");
                target.addTag("rpc:fletcher");
                target.addTag("fletcher");
                fletcherManager.setWeapon(target, held);
            }
            // 5. Turn into Farmer (Iron Hoe)
            else if (held === "minecraft:iron_hoe") {
                clearAllProfessions(target, allManagers);
                target.triggerEvent("minecraft:become_farmer");
                target.addTag("rpc:farmer");
                target.addTag("farmer");
                farmerManager.registerFarmer(target);
            }
            // 6. Turn into Weaponsmith (Iron Sword)
            else if (held === "minecraft:iron_sword") {
                clearAllProfessions(target, allManagers);
                target.triggerEvent("minecraft:become_weaponsmith");
                target.addTag("rpc:weaponsmith");
                target.addTag("weaponsmith");
                weaponsmithManager.registerWeaponsmith(target);
            }
            // 7. Turn into Cleric (Potion or Splash Potion)
            else if (held === "minecraft:potion" || held === "minecraft:splash_potion") {
                clearAllProfessions(target, allManagers);
                target.triggerEvent("minecraft:become_cleric");
                target.addTag("rpc:cleric");
                target.addTag("cleric");
                clericManager.registerCleric(target);
            }
            // 8. Turn into Armorer (Iron Ingot or Chestplate)
            else if (held === "minecraft:iron_ingot" || held === "minecraft:iron_chestplate") {
                clearAllProfessions(target, allManagers);
                target.triggerEvent("minecraft:become_armorer");
                target.addTag("rpc:armorer");
                target.addTag("armorer");
                armorerManager.registerArmorer(target);
            }
            // 9. Turn into Librarian (Book or Enchanted Book)
            else if (held === "minecraft:book" || held === "minecraft:enchanted_book") {
                clearAllProfessions(target, allManagers);
                target.triggerEvent("minecraft:become_librarian");
                target.addTag("rpc:librarian");
                target.addTag("librarian");
                librarianManager.registerLibrarian(target);
            }
        }
    } catch {}
});

// Custom command /function summon_all or /scriptevent rpc:summon_all
system.afterEvents.scriptEventReceive.subscribe((event) => {
    try {
        if (event.id === "rpc:summon_all" || event.id === "rpc:summon_villagers" || event.id === "rpc:summon") {
            const player = event.sourceEntity;
            if (player && player.isValid()) {
                summonAllVillagers(player, allManagers);
            } else {
                const players = world.getAllPlayers();
                if (players && players.length > 0) {
                    summonAllVillagers(players[0], allManagers);
                }
            }
        }
    } catch (e) {
        console.error(`[Villager Addon] Error handling summon script event: ${e}`);
    }
});

// Chat shortcut: type !summonall or !villagers in chat to summon every villager profession!
world.beforeEvents.chatSend.subscribe((event) => {
    try {
        const msg = event.message.trim().toLowerCase();
        if (msg === "!summonall" || msg === "!villagers" || msg === "!summon_villagers" || msg === "!summon") {
            event.cancel = true;
            const player = event.sender;
            system.run(() => {
                summonAllVillagers(player, allManagers);
            });
        }
    } catch {}
});

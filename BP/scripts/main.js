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
import { VillagePopulationManager } from "./villagePopulationManager.js";
import { CustomEventsManager } from "./customEventsManager.js";
import { summonAllVillagers } from "./summonHelper.js";
import { synchronizeVillagerOccupation, clearAllProfessions, getVillagerProfession } from "./professionHelper.js";
import { pruneUnreachableTargets, playSoundSafe, spawnParticleSafe } from "./utils.js";

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
    villageExpansionManager,
    villagePopulationManager: null,
    customEventsManager: null
};

const villagePopulationManager = new VillagePopulationManager(allManagers);
allManagers.villagePopulationManager = villagePopulationManager;

const customEventsManager = new CustomEventsManager(allManagers);
allManagers.customEventsManager = customEventsManager;

let globalTickCounter = 0;

// Central game tick loop - staggered across 4 balanced phases for optimal TPS & zero lag
system.runInterval(() => {
    globalTickCounter++;
    const phase = globalTickCounter % 4;

    // Phase 0: Primary gathering & farming
    if (phase === 0) {
        try { fishermanManager.update(); } catch (err) { console.error(`[Villager Addon] Error in fisherman loop: ${err}`); }
        try { farmerManager.update(); } catch (err) { console.error(`[Villager Addon] Error in farmer loop: ${err}`); }
    }
    // Phase 1: Shepherd & village expansion/population
    else if (phase === 1) {
        try { shepherdManager.update(); } catch (err) { console.error(`[Villager Addon] Error in shepherd loop: ${err}`); }
        try { villageExpansionManager.update(); } catch (err) { console.error(`[Villager Addon] Error in expansion loop: ${err}`); }
        try { villagePopulationManager.update(); } catch (err) { console.error(`[Villager Addon] Error in population loop: ${err}`); }
    }
    // Phase 2: Combat roles (Butcher, Fletcher, Weaponsmith)
    else if (phase === 2) {
        try { butcherManager.update(); } catch (err) { console.error(`[Villager Addon] Error in butcher loop: ${err}`); }
        try { fletcherManager.update(); } catch (err) { console.error(`[Villager Addon] Error in fletcher loop: ${err}`); }
        try { weaponsmithManager.update(); } catch (err) { console.error(`[Villager Addon] Error in weaponsmith loop: ${err}`); }
    }
    // Phase 3: Scholar, healing & repair roles (Cleric, Armorer, Librarian)
    else {
        try { clericManager.update(); } catch (err) { console.error(`[Villager Addon] Error in cleric loop: ${err}`); }
        try { armorerManager.update(); } catch (err) { console.error(`[Villager Addon] Error in armorer loop: ${err}`); }
        try { librarianManager.update(); } catch (err) { console.error(`[Villager Addon] Error in librarian loop: ${err}`); }
    }
}, 2);

// Register newly spawned or transformed villagers with a 2-tick stabilization delay
world.afterEvents.entitySpawn.subscribe((event) => {
    try {
        const entity = event.entity;
        if (entity && entity.isValid() && (entity.typeId === "minecraft:villager_v2" || entity.typeId === "minecraft:villager")) {
            system.runTimeout(() => {
                if (!entity || !entity.isValid()) return;
                const isBaby = entity.getComponent("minecraft:is_baby") !== undefined || (entity.matches && entity.matches({ families: ["baby"] }));
                if (isBaby) {
                    villageExpansionManager.onEntitySpawn(entity);
                    return;
                }
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

// Instant hurt reaction: Safeguards friendly fire & Clerics immediately drink regeneration upon taking damage
world.afterEvents.entityHurt.subscribe((event) => {
    try {
        const hurtEntity = event.hurtEntity;
        if (!hurtEntity || !hurtEntity.isValid()) return;

        // Friendly-fire protection & iron golem anger de-escalation:
        const damageSource = event.damageSource;
        const attacker = damageSource?.damagingEntity;
        if (attacker && attacker.isValid()) {
            const hType = hurtEntity.typeId;
            const aType = attacker.typeId;
            const isHurtVillager = hType === "minecraft:villager_v2" || hType === "minecraft:villager";
            const isAttackerVillager = aType === "minecraft:villager_v2" || aType === "minecraft:villager";
            const isHurtGolem = hType === "minecraft:iron_golem";
            const isAttackerGolem = aType === "minecraft:iron_golem";

            // If a villager damaged another villager or an iron golem damaged a villager or vice versa:
            if ((isHurtVillager && isAttackerVillager) || (isHurtVillager && isAttackerGolem) || (isHurtGolem && isAttackerVillager)) {
                // If iron golem is involved, clear anger/targeting immediately
                if (isAttackerGolem || isHurtGolem) {
                    try {
                        const golem = isAttackerGolem ? attacker : hurtEntity;
                        golem.triggerEvent("minecraft:entity_born");
                    } catch {}
                }
            }
        }

        if (clericManager.isClericVillager(hurtEntity)) {
            clericManager.onClericHurt(hurtEntity, event.damage, event.damageSource);
        }
    } catch {}
});

// Dynamic Profession & Occupation Synchronization Loop
// Runs every 100 ticks (5 seconds) in the overworld to detect workstation changes without lag
system.runInterval(() => {
    try {
        let dim;
        try { dim = world.getDimension("overworld"); } catch {}
        if (!dim) return;

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

                // Check for on-demand entity event tags triggered via /event or /tag
                for (const tag of villager.getTags()) {
                    if (tag.startsWith("rpc:event_")) {
                        const action = tag.replace("rpc:event_", "");
                        customEventsManager.handleEventCommand(action, villager);
                        villager.removeTag(tag);
                    }
                }
            }
        }
    } catch (err) {
        console.error(`[Villager Addon] Error in occupation sync loop: ${err}`);
    }
}, 100);

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

            // Check if baby villager: babies cannot be given professions or trade until grown
            const isBaby = target.getComponent("minecraft:is_baby") !== undefined || (target.matches && target.matches({ families: ["baby"] }));
            if (isBaby) {
                // Growth boost: feed golden apple, emerald, or cake to instantly grow into a trading adult!
                if (held === "minecraft:golden_apple" || held === "minecraft:emerald" || held === "minecraft:cake") {
                    target.triggerEvent("minecraft:ageable_grow_up");
                    target.removeTag("rpc:baby_villager");
                    spawnParticleSafe(target.dimension, "minecraft:villager_happy", {
                        x: target.location.x,
                        y: target.location.y + 1.0,
                        z: target.location.z
                    });
                    playSoundSafe(target.dimension, "random.levelup", target.location, { volume: 1.0, pitch: 1.2 });
                }
                return;
            }

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
            else if (held === "minecraft:shears") {
                clearAllProfessions(target, allManagers);
                target.triggerEvent("rpc:become_shepherd");
                target.triggerEvent("minecraft:become_sheperd");
                target.addTag("rpc:shepherd");
                target.addTag("shepherd");
                shepherdManager.registerShepherd(target);
            }
            // 3. Turn into Butcher
            else if (held === "minecraft:iron_axe") {
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

// Custom Event Commands via /scriptevent (e.g. /scriptevent rpc:build_golem, /scriptevent rpc:breed)
system.afterEvents.scriptEventReceive.subscribe((event) => {
    try {
        if (event.id.startsWith("rpc:")) {
            const player = event.sourceEntity || (typeof world.getAllPlayers === "function" ? world.getAllPlayers()[0] : (typeof world.getPlayers === "function" ? world.getPlayers()[0] : null));
            customEventsManager.handleEventCommand(event.id, player, event.message);
        }
    } catch (e) {
        console.error(`[Villager Addon] Error handling script event: ${e}`);
    }
});


// Clean up expired unreachable targets periodically every 100 ticks
system.runInterval(() => {
    try { pruneUnreachableTargets(); } catch {}
}, 100);

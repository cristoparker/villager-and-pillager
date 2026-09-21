/**
 * Villager Professions Addon - Custom Events & Command Dispatcher Module (Namespace: rpc)
 * Allows players to trigger all villager custom features on-demand via:
 * 1. /scriptevent rpc:<command> [arguments]
 * 2. Chat commands: !<command> (e.g. !build_golem, !breed, !cure, !house, !bed, etc.)
 * 3. Entity tags / events: /event entity @e[type=villager_v2] rpc:<event>
 */

import { world, system, ItemStack, EquipmentSlot } from "@minecraft/server";
import { distance, playSoundSafe, spawnParticleSafe, getLookRotation } from "./utils.js";
import { getVillagerProfession } from "./professionHelper.js";
import { summonAllVillagers } from "./summonHelper.js";

// Armorer behaviors
import {
    performAssembleRaidGolem,
    findNearbyGolemConstructionSpot,
    performRepairGolem,
    findNearbyDamagedGolem,
    performFortifyAlly,
    findNearbyUnbuffedAlly,
    equipIronBlock,
    equipChestplate,
    equipIngot
} from "./armorerBehavior.js";
import { ArmorerState } from "./armorerManager.js";

// Farmer behaviors
import {
    findNearbyBreedableAnimalPair,
    performBreedAnimals,
    findNearbyBabyAnimals,
    performFeedBabyAnimal,
    findNearbyRipeCrop,
    performHarvest,
    findNearbyEmptyFarmland,
    performPlantCropOnFarmland,
    findNearbyUngrownCrop,
    performBoneMealCrop,
    findNearbyVillagersToFeed,
    performShareFoodWithVillager,
    equipFoodItem,
    equipHoe
} from "./farmerBehavior.js";
import { FarmerState } from "./farmerManager.js";

// Cleric behaviors
import {
    findNearbyZombieVillager,
    performCureZombieVillager,
    performWitcherRegen,
    performHolySanctuary,
    findNearbyInjuredAlly,
    performHeal,
    findNearbyBrewingStand,
    performBrewPotions,
    equipPotion,
    equipGoldenApple
} from "./clericBehavior.js";
import { ClericState } from "./clericManager.js";

// Expansion behaviors
import {
    ExpansionState
} from "./villageExpansionManager.js";

/**
 * Finds the nearest villager of a specific profession within radius.
 * @param {Dimension} dimension 
 * @param {Vector3} location 
 * @param {string|null} professionName null for any villager
 * @param {number} radius 
 * @returns {Entity|null}
 */
export function findNearestVillager(dimension, location, professionName = null, radius = 32) {
    if (!dimension || !location) return null;

    let villagers = [];
    try {
        villagers = dimension.getEntities({ type: "minecraft:villager_v2", location, maxDistance: radius });
    } catch {}
    try {
        const legacy = dimension.getEntities({ type: "minecraft:villager", location, maxDistance: radius });
        if (legacy && legacy.length > 0) villagers = villagers.concat(legacy);
    } catch {}

    let closest = null;
    let closestDist = Infinity;

    for (const v of villagers) {
        if (!v || !v.isValid()) continue;

        if (professionName) {
            const prof = getVillagerProfession(v);
            const hasTagMatch = v.hasTag(`rpc:${professionName}`) || v.hasTag(professionName);
            if (prof !== professionName && !hasTagMatch) continue;
        }

        const d = distance(location, v.location);
        if (d < closestDist) {
            closestDist = d;
            closest = v;
        }
    }

    return closest;
}

/**
 * Handles custom feature execution for all villager professions.
 */
export class CustomEventsManager {
    constructor(allManagers) {
        this.managers = allManagers;
    }

    /**
     * Sends feedback to player or broadcasts to world.
     */
    notify(sender, message) {
        try {
            if (sender && typeof sender.sendMessage === "function") {
                sender.sendMessage(message);
            } else {
                world.sendMessage(message);
            }
        } catch {
            try { world.sendMessage(message); } catch {}
        }
    }

    /**
     * Dispatches an event command.
     * @param {string} commandName 
     * @param {Entity|null} sourceEntity 
     * @param {string} args 
     */
    handleEventCommand(commandName, sourceEntity = null, args = "") {
        const cmd = commandName.toLowerCase().replace("rpc:", "").replace("!", "").trim();
        const dim = sourceEntity?.dimension || world.getDimension("overworld");
        const origin = sourceEntity?.location || { x: 0, y: 64, z: 0 };

        switch (cmd) {
            // ==========================================
            // ARMORER EVENTS
            // ==========================================
            case "build_golem":
            case "golem":
            case "iron_golem":
            case "make_golem": {
                this.executeBuildGolem(sourceEntity, dim, origin);
                break;
            }

            case "repair_golem":
            case "repair": {
                this.executeRepairGolem(sourceEntity, dim, origin);
                break;
            }

            case "fortify":
            case "buff_armor":
            case "armor_buff": {
                this.executeFortify(sourceEntity, dim, origin);
                break;
            }

            // ==========================================
            // FARMER EVENTS
            // ==========================================
            case "breed":
            case "breed_animals":
            case "animals": {
                this.executeBreedAnimals(sourceEntity, dim, origin);
                break;
            }

            case "feed_baby":
            case "feed_animals": {
                this.executeFeedBaby(sourceEntity, dim, origin);
                break;
            }

            case "harvest":
            case "harvest_crops": {
                this.executeHarvest(sourceEntity, dim, origin);
                break;
            }

            case "plant":
            case "plant_crops": {
                this.executePlant(sourceEntity, dim, origin);
                break;
            }

            case "bonemeal":
            case "grow_crops": {
                this.executeBonemeal(sourceEntity, dim, origin);
                break;
            }

            case "share_food":
            case "feed_villagers": {
                this.executeShareFood(sourceEntity, dim, origin);
                break;
            }

            // ==========================================
            // CLERIC EVENTS
            // ==========================================
            case "cure":
            case "cure_zombie":
            case "cure_villager": {
                this.executeCureZombie(sourceEntity, dim, origin);
                break;
            }

            case "regen":
            case "witcher_regen":
            case "drink_potion": {
                this.executeWitcherRegen(sourceEntity, dim, origin);
                break;
            }

            case "sanctuary":
            case "holy_sanctuary":
            case "aura": {
                this.executeHolySanctuary(sourceEntity, dim, origin);
                break;
            }

            case "heal":
            case "heal_allies": {
                this.executeHeal(sourceEntity, dim, origin);
                break;
            }

            case "brew":
            case "brew_potions": {
                this.executeBrew(sourceEntity, dim, origin);
                break;
            }

            // ==========================================
            // VILLAGE EXPANSION / BUILDER EVENTS
            // ==========================================
            case "build_house":
            case "house":
            case "construct_house": {
                this.executeBuildHouse(sourceEntity, dim, origin);
                break;
            }

            case "place_bed":
            case "bed": {
                this.executePlaceBed(sourceEntity, dim, origin);
                break;
            }

            case "place_workbench":
            case "workbench":
            case "workstation": {
                this.executePlaceWorkbench(sourceEntity, dim, origin);
                break;
            }

            case "place_hay":
            case "hay":
            case "hay_bale": {
                this.executePlaceHay(sourceEntity, dim, origin);
                break;
            }

            case "place_chest":
            case "chest": {
                this.executePlaceChest(sourceEntity, dim, origin);
                break;
            }

            // ==========================================
            // FISHERMAN EVENTS
            // ==========================================
            case "fish":
            case "catch_fish": {
                this.executeFish(sourceEntity, dim, origin);
                break;
            }

            // ==========================================
            // SHEPHERD EVENTS
            // ==========================================
            case "shear":
            case "shear_sheep": {
                this.executeShear(sourceEntity, dim, origin);
                break;
            }

            // ==========================================
            // FLETCHER EVENTS
            // ==========================================
            case "shoot":
            case "shoot_target":
            case "attack": {
                this.executeShoot(sourceEntity, dim, origin);
                break;
            }

            // ==========================================
            // WEAPONSMITH & LIBRARIAN EVENTS
            // ==========================================
            case "sharpen":
            case "buff_weapons": {
                this.executeSharpen(sourceEntity, dim, origin);
                break;
            }

            case "enchant":
            case "study": {
                this.executeEnchant(sourceEntity, dim, origin);
                break;
            }

            // ==========================================
            // SUMMON & HELP
            // ==========================================
            case "summon_all":
            case "summonall":
            case "summon_villagers":
            case "summon": {
                summonAllVillagers(sourceEntity, this.managers);
                break;
            }

            case "help":
            case "events":
            case "commands": {
                this.printHelp(sourceEntity);
                break;
            }

            default: {
                this.notify(sourceEntity, `§e[Villager Addon] Unknown event: §f${commandName}§e. Type §a!help§e or §a!events§e for a list of commands!`);
                break;
            }
        }
    }

    // -------------------------------------------------------------
    // ARMORER ACTIONS
    // -------------------------------------------------------------
    executeBuildGolem(source, dim, origin) {
        const armorer = (source?.typeId?.includes("villager") && getVillagerProfession(source) === "armorer")
            ? source
            : findNearestVillager(dim, origin, "armorer", 32);

        if (!armorer) {
            this.notify(source, "§c[Armorer] No Armorer found within 32 blocks! Type §a!summon armorer §cor §a!summonall§c.");
            return;
        }

        const spot = findNearbyGolemConstructionSpot(dim, armorer.location, 8) || {
            center: {
                x: Math.floor(armorer.location.x + 2),
                y: Math.floor(armorer.location.y),
                z: Math.floor(armorer.location.z)
            },
            axis: 'x'
        };

        const record = this.managers.armorerManager?.records.get(armorer.id);
        if (record) {
            record.state = ArmorerState.BUILDING_RAID_GOLEM;
            record.timer = 45;
        }

        performAssembleRaidGolem(armorer, spot);
        this.notify(source, "§a[Armorer] Building an Iron Golem right now!");
    }

    executeRepairGolem(source, dim, origin) {
        const armorer = findNearestVillager(dim, origin, "armorer", 32);
        if (!armorer) {
            this.notify(source, "§c[Armorer] No Armorer found within 32 blocks!");
            return;
        }

        const golem = findNearbyDamagedGolem(dim, armorer.location, 24);
        if (golem) {
            equipIngot(armorer);
            performRepairGolem(armorer, golem);
            this.notify(source, "§a[Armorer] Repaired nearby Iron Golem with iron ingots!");
        } else {
            this.notify(source, "§e[Armorer] No damaged Iron Golem found nearby to repair.");
        }
    }

    executeFortify(source, dim, origin) {
        const armorer = findNearestVillager(dim, origin, "armorer", 32);
        if (!armorer) {
            this.notify(source, "§c[Armorer] No Armorer found within 32 blocks!");
            return;
        }

        equipChestplate(armorer);
        const target = findNearbyUnbuffedAlly(dim, armorer.location, 16) || source;
        if (target) {
            performFortifyAlly(armorer, target);
            this.notify(source, "§a[Armorer] Fortified allies with Resistance and Absorption armor buffs!");
        }
    }

    // -------------------------------------------------------------
    // FARMER ACTIONS
    // -------------------------------------------------------------
    executeBreedAnimals(source, dim, origin) {
        const farmer = (source?.typeId?.includes("villager") && getVillagerProfession(source) === "farmer")
            ? source
            : findNearestVillager(dim, origin, "farmer", 32);

        if (!farmer) {
            this.notify(source, "§c[Farmer] No Farmer found within 32 blocks! Type §a!summon farmer§c.");
            return;
        }

        const pair = findNearbyBreedableAnimalPair(dim, farmer.location, 24);
        if (pair) {
            equipFoodItem(farmer, pair.speciesDef.foodItemId);
            performBreedAnimals(farmer, pair);
            this.notify(source, `§a[Farmer] Successfully bred a pair of ${pair.speciesDef.typeId.replace("minecraft:", "")}s!`);
            return;
        }

        // Fallback: search for any animal species and spawn love hearts / breed
        const animalTypes = ["minecraft:cow", "minecraft:sheep", "minecraft:pig", "minecraft:chicken", "minecraft:rabbit"];
        for (const typeId of animalTypes) {
            try {
                const animals = dim.getEntities({ type: typeId, location: farmer.location, maxDistance: 16 });
                if (animals.length >= 2) {
                    const fallbackPair = {
                        animalA: animals[0],
                        animalB: animals[1],
                        speciesDef: { typeId, foodItemId: "minecraft:wheat" },
                        centerPos: {
                            x: (animals[0].location.x + animals[1].location.x) / 2,
                            y: (animals[0].location.y + animals[1].location.y) / 2,
                            z: (animals[0].location.z + animals[1].location.z) / 2
                        }
                    };
                    performBreedAnimals(farmer, fallbackPair);
                    this.notify(source, `§a[Farmer] Bred nearby ${typeId.replace("minecraft:", "")}s!`);
                    return;
                } else if (animals.length === 1) {
                    playSoundSafe(dim, "random.eat", animals[0].location, { volume: 1.0, pitch: 1.0 });
                    spawnParticleSafe(dim, "minecraft:heart_particle", { x: animals[0].location.x, y: animals[0].location.y + 1.2, z: animals[0].location.z });
                    this.notify(source, `§e[Farmer] Fed one ${typeId.replace("minecraft:", "")}! Bring another nearby to produce a baby.`);
                    return;
                }
            } catch {}
        }

        this.notify(source, "§e[Farmer] No animals (cows, sheep, pigs, chickens) found within 24 blocks to breed!");
    }

    executeFeedBaby(source, dim, origin) {
        const farmer = findNearestVillager(dim, origin, "farmer", 32);
        if (!farmer) {
            this.notify(source, "§c[Farmer] No Farmer found within 32 blocks!");
            return;
        }

        const baby = findNearbyBabyAnimals(dim, farmer.location, 24);
        if (baby) {
            performFeedBabyAnimal(farmer, baby);
            this.notify(source, "§a[Farmer] Fed baby animal to accelerate growth!");
        } else {
            this.notify(source, "§e[Farmer] No baby animals found nearby to feed.");
        }
    }

    executeHarvest(source, dim, origin) {
        const farmer = findNearestVillager(dim, origin, "farmer", 32);
        if (!farmer) {
            this.notify(source, "§c[Farmer] No Farmer found within 32 blocks!");
            return;
        }

        const crop = findNearbyRipeCrop(dim, farmer.location, 20);
        if (crop) {
            equipHoe(farmer);
            performHarvest(farmer, crop);
            this.notify(source, "§a[Farmer] Harvested ripe crops and replanted seeds!");
        } else {
            this.notify(source, "§e[Farmer] No fully-grown ripe crops found nearby.");
        }
    }

    executePlant(source, dim, origin) {
        const farmer = findNearestVillager(dim, origin, "farmer", 32);
        if (!farmer) {
            this.notify(source, "§c[Farmer] No Farmer found within 32 blocks!");
            return;
        }

        const farmland = findNearbyEmptyFarmland(dim, farmer.location, 20);
        if (farmland) {
            performPlantCropOnFarmland(farmer, farmland);
            this.notify(source, "§a[Farmer] Planted crops on empty farmland!");
        } else {
            this.notify(source, "§e[Farmer] No empty tilled farmland found nearby.");
        }
    }

    executeBonemeal(source, dim, origin) {
        const farmer = findNearestVillager(dim, origin, "farmer", 32);
        if (!farmer) {
            this.notify(source, "§c[Farmer] No Farmer found within 32 blocks!");
            return;
        }

        const crop = findNearbyUngrownCrop(dim, farmer.location, 16);
        if (crop) {
            performBoneMealCrop(farmer, crop);
            this.notify(source, "§a[Farmer] Applied bone meal to boost crop growth!");
        } else {
            this.notify(source, "§e[Farmer] No growing crops found nearby to fertilize.");
        }
    }

    executeShareFood(source, dim, origin) {
        const farmer = findNearestVillager(dim, origin, "farmer", 32);
        if (!farmer) {
            this.notify(source, "§c[Farmer] No Farmer found within 32 blocks!");
            return;
        }

        const hungry = findNearbyVillagersToFeed(dim, farmer.location, 16);
        if (hungry) {
            performShareFoodWithVillager(farmer, hungry);
            this.notify(source, "§a[Farmer] Shared food with a hungry villager!");
        } else {
            this.notify(source, "§e[Farmer] No hungry villagers found nearby.");
        }
    }

    // -------------------------------------------------------------
    // CLERIC ACTIONS
    // -------------------------------------------------------------
    executeCureZombie(source, dim, origin) {
        const cleric = (source?.typeId?.includes("villager") && getVillagerProfession(source) === "cleric")
            ? source
            : findNearestVillager(dim, origin, "cleric", 32);

        if (!cleric) {
            this.notify(source, "§c[Cleric] No Cleric found within 32 blocks! Type §a!summon cleric§c.");
            return;
        }

        const zombie = findNearbyZombieVillager(dim, cleric.location, 28);
        if (zombie) {
            equipGoldenApple(cleric);
            performCureZombieVillager(cleric, zombie);
            this.notify(source, "§d[Cleric] Curing nearby Zombie Villager with Weakness & Golden Apple!");
        } else {
            this.notify(source, "§e[Cleric] No Zombie Villagers found within 28 blocks to cure.");
        }
    }

    executeWitcherRegen(source, dim, origin) {
        const cleric = findNearestVillager(dim, origin, "cleric", 32);
        if (!cleric) {
            this.notify(source, "§c[Cleric] No Cleric found within 32 blocks!");
            return;
        }

        equipPotion(cleric);
        performWitcherRegen(cleric);
        this.notify(source, "§d[Cleric] Drank Witcher regeneration potion (Instant Health + Regen II + Resistance)!");
    }

    executeHolySanctuary(source, dim, origin) {
        const cleric = findNearestVillager(dim, origin, "cleric", 32);
        if (!cleric) {
            this.notify(source, "§c[Cleric] No Cleric found within 32 blocks!");
            return;
        }

        performHolySanctuary(cleric);
        this.notify(source, "§d[Cleric] Activated Holy Sanctuary protective aura repelling monsters!");
    }

    executeHeal(source, dim, origin) {
        const cleric = findNearestVillager(dim, origin, "cleric", 32);
        if (!cleric) {
            this.notify(source, "§c[Cleric] No Cleric found within 32 blocks!");
            return;
        }

        const target = findNearbyInjuredAlly(dim, cleric.location, 24) || source;
        if (target) {
            equipPotion(cleric);
            performHeal(cleric, target);
            this.notify(source, "§d[Cleric] Threw healing potion at allies!");
        }
    }

    executeBrew(source, dim, origin) {
        const cleric = findNearestVillager(dim, origin, "cleric", 32);
        if (!cleric) {
            this.notify(source, "§c[Cleric] No Cleric found within 32 blocks!");
            return;
        }

        const stand = findNearbyBrewingStand(dim, cleric.location, 16);
        if (stand) {
            performBrewPotions(cleric, stand);
            this.notify(source, "§d[Cleric] Brewed and dropped a fresh potion!");
        } else {
            this.notify(source, "§e[Cleric] No Brewing Stand found within 16 blocks.");
        }
    }

    // -------------------------------------------------------------
    // VILLAGE EXPANSION / BUILDER ACTIONS
    // -------------------------------------------------------------
    executeBuildHouse(source, dim, origin) {
        const expMgr = this.managers.villageExpansionManager;
        if (!expMgr) {
            this.notify(source, "§c[Builder] Expansion manager not initialized.");
            return;
        }

        const villager = findNearestVillager(dim, origin, null, 24);
        if (!villager) {
            this.notify(source, "§c[Builder] No adult villager found nearby!");
            return;
        }

        const plot = expMgr.findFreeHousePlot(dim, villager.location, 20);
        if (plot) {
            const record = expMgr.records.get(villager.id);
            if (record) {
                record.state = ExpansionState.APPROACHING_HOUSE_SITE;
                record.housePlotOrigin = plot;
                record.houseStage = 0;
                record.timer = 15;
            }
            this.notify(source, `§6[Builder] Found free plot at (${plot.x}, ${plot.y}, ${plot.z})! Commencing house construction!`);
        } else {
            this.notify(source, "§e[Builder] No flat 5x5 clear ground plot found nearby. Clear a 5x5 area and try again!");
        }
    }

    executePlaceBed(source, dim, origin) {
        const expMgr = this.managers.villageExpansionManager;
        const villager = findNearestVillager(dim, origin, null, 24);
        if (!villager || !expMgr) {
            this.notify(source, "§c[Villager] No villager found nearby!");
            return;
        }

        const spot = expMgr.findNearbyBedPlacementSpot(dim, villager.location, 8);
        if (spot) {
            expMgr.performPlaceBed(villager, spot);
            this.notify(source, "§6[Villager] Placed a bed for village breeding!");
        } else {
            this.notify(source, "§e[Villager] No 2-block ground space with 2 blocks headroom found nearby for a bed.");
        }
    }

    executePlaceWorkbench(source, dim, origin) {
        const expMgr = this.managers.villageExpansionManager;
        const villager = findNearestVillager(dim, origin, null, 24);
        if (!villager || !expMgr) {
            this.notify(source, "§c[Villager] No villager found nearby!");
            return;
        }

        const spot = expMgr.findNearbyWorkbenchPlacementSpot(dim, villager.location, 4);
        if (spot) {
            expMgr.performPlaceWorkbench(villager, spot, "minecraft:composter");
            this.notify(source, "§6[Villager] Placed a workstation!");
        } else {
            this.notify(source, "§e[Villager] No clear spot adjacent to villager for workstation.");
        }
    }

    executePlaceHay(source, dim, origin) {
        const expMgr = this.managers.villageExpansionManager;
        const villager = findNearestVillager(dim, origin, null, 24);
        if (!villager || !expMgr) {
            this.notify(source, "§c[Villager] No villager found nearby!");
            return;
        }

        const existing = expMgr.findNearbyExistingHayBlock(dim, villager.location, 16);
        const spot = existing
            ? expMgr.findAdjacentHayPlacementSpot(dim, existing)
            : expMgr.findStarterHayPlacementSpot(dim, villager.location, 6);

        if (spot) {
            expMgr.performPlaceHayBlock(villager, spot);
            this.notify(source, "§6[Villager] Placed a hay bale!");
        } else {
            this.notify(source, "§e[Villager] No clear ground spot found for hay bale.");
        }
    }

    executePlaceChest(source, dim, origin) {
        const expMgr = this.managers.villageExpansionManager;
        const villager = findNearestVillager(dim, origin, null, 24);
        if (!villager || !expMgr) {
            this.notify(source, "§c[Villager] No villager found nearby!");
            return;
        }

        const spot = expMgr.findNearbyChestPlacementSpot(dim, villager.location, 6);
        if (spot) {
            expMgr.performPlaceChest(villager, spot);
            this.notify(source, "§6[Villager] Placed a community chest!");
        } else {
            this.notify(source, "§e[Villager] No clear ground spot found for chest.");
        }
    }

    // -------------------------------------------------------------
    // OTHER PROFESSIONS
    // -------------------------------------------------------------
    executeFish(source, dim, origin) {
        const fisherman = findNearestVillager(dim, origin, "fisherman", 32);
        if (!fisherman) {
            this.notify(source, "§c[Fisherman] No Fisherman found within 32 blocks!");
            return;
        }

        try {
            const equippable = fisherman.getComponent("minecraft:equippable");
            equippable?.setEquipment(EquipmentSlot.Mainhand, new ItemStack("minecraft:fishing_rod", 1));
            fisherman.playAnimation("animation.villager.raise_arms");
            playSoundSafe(dim, "random.bow", fisherman.location, { volume: 0.9, pitch: 1.0 });
            playSoundSafe(dim, "random.splash", fisherman.location, { volume: 1.0, pitch: 1.0 });
            spawnParticleSafe(dim, "minecraft:water_splash_particle", { x: fisherman.location.x, y: fisherman.location.y + 0.8, z: fisherman.location.z });
            dim.spawnItem(new ItemStack("minecraft:cod", 1), { x: fisherman.location.x, y: fisherman.location.y + 1, z: fisherman.location.z });
            this.notify(source, "§b[Fisherman] Reeled in a fresh catch!");
        } catch {}
    }

    executeShear(source, dim, origin) {
        const shepherd = findNearestVillager(dim, origin, "shepherd", 32);
        if (!shepherd) {
            this.notify(source, "§c[Shepherd] No Shepherd found within 32 blocks!");
            return;
        }

        try {
            const equippable = shepherd.getComponent("minecraft:equippable");
            equippable?.setEquipment(EquipmentSlot.Mainhand, new ItemStack("minecraft:shears", 1));
            shepherd.playAnimation("animation.villager.raise_arms");
            playSoundSafe(dim, "mob.sheep.shear", shepherd.location, { volume: 1.0, pitch: 1.0 });
            dim.spawnItem(new ItemStack("minecraft:white_wool", 2), { x: shepherd.location.x, y: shepherd.location.y + 0.8, z: shepherd.location.z });
            this.notify(source, "§e[Shepherd] Sheared sheep and gathered fresh wool!");
        } catch {}
    }

    executeShoot(source, dim, origin) {
        const fletcher = findNearestVillager(dim, origin, "fletcher", 32);
        if (!fletcher) {
            this.notify(source, "§c[Fletcher] No Fletcher found within 32 blocks!");
            return;
        }

        try {
            const equippable = fletcher.getComponent("minecraft:equippable");
            equippable?.setEquipment(EquipmentSlot.Mainhand, new ItemStack("minecraft:bow", 1));
            fletcher.playAnimation("animation.villager.raise_arms");
            playSoundSafe(dim, "random.bow", fletcher.location, { volume: 1.0, pitch: 1.0 });
            this.notify(source, "§2[Fletcher] Drew bow and fired at hostile targets!");
        } catch {}
    }

    executeSharpen(source, dim, origin) {
        const smith = findNearestVillager(dim, origin, "weaponsmith", 32);
        if (!smith) {
            this.notify(source, "§c[Weaponsmith] No Weaponsmith found within 32 blocks!");
            return;
        }

        try {
            smith.playAnimation("animation.villager.raise_arms");
            playSoundSafe(dim, "block.grindstone.use", smith.location, { volume: 1.0, pitch: 1.0 });
            spawnParticleSafe(dim, "minecraft:villager_happy", { x: smith.location.x, y: smith.location.y + 1.2, z: smith.location.z });
            this.notify(source, "§7[Weaponsmith] Sharpened weapons at the grindstone!");
        } catch {}
    }

    executeEnchant(source, dim, origin) {
        const librarian = findNearestVillager(dim, origin, "librarian", 32);
        if (!librarian) {
            this.notify(source, "§c[Librarian] No Librarian found within 32 blocks!");
            return;
        }

        try {
            librarian.playAnimation("animation.villager.raise_arms");
            playSoundSafe(dim, "enchant.thorns.use", librarian.location, { volume: 1.0, pitch: 1.0 });
            spawnParticleSafe(dim, "minecraft:enchanting_table_particle", { x: librarian.location.x, y: librarian.location.y + 1.2, z: librarian.location.z });
            this.notify(source, "§3[Librarian] Bestowed enchantment knowledge and wisdom!");
        } catch {}
    }

    /**
     * Prints interactive help menu.
     */
    printHelp(source) {
        const lines = [
            "§6§l================ VILLAGER EVENT COMMANDS ================",
            "§7Trigger via chat (§e!<cmd>§7), function (§e/function <cmd>§7), or script (§e/scriptevent rpc:<cmd>§7):",
            "",
            "§6[ARMORER]§r",
            "  §a!build_golem §7/ §a!golem §f- Build Iron Golem with iron blocks & pumpkin",
            "  §a!repair_golem §f- Repair damaged Iron Golem with iron ingots",
            "  §a!fortify §f- Bestow Resistance & Absorption armor buffs on allies",
            "",
            "§6[FARMER]§r",
            "  §a!breed §f- Feed & breed nearby animals (cows, sheep, pigs, chickens)",
            "  §a!feed_baby §f- Feed baby animals to accelerate their growth",
            "  §a!harvest §f- Harvest ripe crops & replant seeds",
            "  §a!plant §f- Plant crops on empty tilled farmland",
            "  §a!bonemeal §f- Fertilize crops & saplings with bone meal",
            "  §a!share_food §f- Distribute bread/wheat to hungry villagers",
            "",
            "§6[CLERIC]§r",
            "  §d!cure §f- Cure nearby Zombie Villager with Golden Apple & Weakness",
            "  §d!regen §f- Drink Witcher potion (Instant Health + Regen II + Resistance)",
            "  §d!sanctuary §f- Cast Holy Sanctuary protective aura (repels monsters)",
            "  §d!heal §f- Hurl healing splash potion at injured allies",
            "  §d!brew §f- Brew and drop fresh potions at brewing stand",
            "",
            "§6[BUILDER & EXPANSION]§r",
            "  §e!house §7/ §e!build_house §f- Build a 5x5 furnished house with bed & door",
            "  §e!bed §f- Place a bed with 2 blocks headroom for breeding",
            "  §e!workbench §f- Place a profession workstation",
            "  §e!hay §f- Place a hay bale pile",
            "  §e!chest §f- Place a community chest",
            "",
            "§6[SPECIALISTS]§r",
            "  §b!fish §f- Fisherman catches fresh fish",
            "  §e!shear §f- Shepherd shears nearby sheep",
            "  §2!shoot §f- Fletcher fires arrows at hostile mobs",
            "  §7!sharpen §f- Weaponsmith sharpens weapons at grindstone",
            "  §3!enchant §f- Librarian bestows enchanting wisdom & XP",
            "",
            "§6[UTILITIES]§r",
            "  §e!summonall §f- Spawn all 13 villager professions at your location",
            "  §e!help §7/ §e!events §f- Show this command reference list",
            "§6§l========================================================"
        ];
        this.notify(source, lines.join("\n"));
    }
}

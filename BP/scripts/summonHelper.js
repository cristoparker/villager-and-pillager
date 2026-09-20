/**
 * Villager Professions Addon - Summon Helper Module (Namespace: rpc)
 * Provides functions to summon every villager profession with their custom behaviors,
 * authentic gear, clothing textures, and floating colored name tags.
 */

import { world, system, ItemStack, EquipmentSlot } from "@minecraft/server";
import { playSoundSafe, spawnParticleSafe } from "./utils.js";

export const VILLAGER_PROFESSIONS = [
    {
        id: "fisherman",
        displayName: "§b[Fisherman]",
        event: "minecraft:become_fisherman",
        customEvent: "rpc:become_fisherman",
        tags: ["fisherman", "rpc:fisherman"],
        defaultItem: "rpc:fishing_rod"
    },
    {
        id: "shepherd",
        displayName: "§a[Shepherd]",
        event: "minecraft:become_sheperd",
        customEvent: "rpc:become_shepherd",
        tags: ["shepherd", "rpc:shepherd"],
        defaultItem: "rpc:shears"
    },
    {
        id: "butcher",
        displayName: "§c[Butcher]",
        event: "minecraft:become_butcher",
        customEvent: "rpc:become_butcher",
        tags: ["butcher", "rpc:butcher"],
        defaultItem: "minecraft:iron_axe"
    },
    {
        id: "fletcher",
        displayName: "§6[Fletcher]",
        event: "minecraft:become_fletcher",
        customEvent: "rpc:become_fletcher",
        tags: ["fletcher", "rpc:fletcher"],
        defaultItem: "minecraft:bow"
    },
    {
        id: "farmer",
        displayName: "§e[Farmer]",
        event: "minecraft:become_farmer",
        customEvent: null,
        tags: ["farmer", "rpc:farmer"],
        defaultItem: "minecraft:iron_hoe"
    },
    {
        id: "weaponsmith",
        displayName: "§4[Weaponsmith]",
        event: "minecraft:become_weaponsmith",
        customEvent: null,
        tags: ["weaponsmith", "rpc:weaponsmith"],
        defaultItem: "minecraft:iron_sword"
    },
    {
        id: "cleric",
        displayName: "§d[Cleric]",
        event: "minecraft:become_cleric",
        customEvent: null,
        tags: ["cleric", "rpc:cleric"],
        defaultItem: "minecraft:splash_potion"
    },
    {
        id: "armorer",
        displayName: "§7[Armorer]",
        event: "minecraft:become_armorer",
        customEvent: null,
        tags: ["armorer", "rpc:armorer"],
        defaultItem: "minecraft:iron_ingot"
    },
    {
        id: "librarian",
        displayName: "§9[Librarian]",
        event: "minecraft:become_librarian",
        customEvent: null,
        tags: ["librarian", "rpc:librarian"],
        defaultItem: "minecraft:enchanted_book"
    },
    {
        id: "toolsmith",
        displayName: "§3[Toolsmith]",
        event: "minecraft:become_toolsmith",
        customEvent: null,
        tags: ["toolsmith", "rpc:toolsmith"],
        defaultItem: "minecraft:iron_pickaxe"
    },
    {
        id: "mason",
        displayName: "§f[Mason]",
        event: "minecraft:become_mason",
        customEvent: null,
        tags: ["mason", "rpc:mason"],
        defaultItem: "minecraft:stone_brick"
    },
    {
        id: "cartographer",
        displayName: "§2[Cartographer]",
        event: "minecraft:become_cartographer",
        customEvent: null,
        tags: ["cartographer", "rpc:cartographer"],
        defaultItem: "minecraft:map"
    },
    {
        id: "leatherworker",
        displayName: "§6[Leatherworker]",
        event: "minecraft:become_leatherworker",
        customEvent: null,
        tags: ["leatherworker", "rpc:leatherworker"],
        defaultItem: "minecraft:leather"
    }
];

/**
 * Summons all 13 villager professions in a neat, spaced line in front of the player.
 * @param {Player|Entity} player 
 * @param {object} managers 
 */
export function summonAllVillagers(player, managers = {}) {
    if (!player || !player.isValid()) return;

    const dim = player.dimension;
    const pLoc = player.location;
    const rot = player.getRotation();

    // Calculate forward & perpendicular vectors based on player's yaw
    const yawRad = (rot.y * Math.PI) / 180.0;
    const forwardX = -Math.sin(yawRad);
    const forwardZ = Math.cos(yawRad);
    const rightX = Math.cos(yawRad);
    const rightZ = Math.sin(yawRad);

    // Position the line 4 blocks in front of the player
    const frontDistance = 4.5;
    const spacing = 1.8;
    const total = VILLAGER_PROFESSIONS.length;
    const halfWidth = ((total - 1) * spacing) / 2.0;

    player.sendMessage("§e[Villagers] §aSummoning all 13 smart villager professions...");

    for (let i = 0; i < total; i++) {
        const prof = VILLAGER_PROFESSIONS[i];
        const offset = (i * spacing) - halfWidth;

        const spawnPos = {
            x: pLoc.x + (forwardX * frontDistance) + (rightX * offset),
            y: pLoc.y,
            z: pLoc.z + (forwardZ * frontDistance) + (rightZ * offset)
        };

        // Stagger summons slightly by tick for smooth animation
        system.runTimeout(() => {
            if (!player || !player.isValid()) return;

            try {
                const villager = dim.spawnEntity("minecraft:villager_v2", spawnPos);
                if (!villager || !villager.isValid()) return;

                // Face towards the player
                const villagerYaw = (rot.y + 180) % 360;
                villager.teleport(spawnPos, { rotation: { x: 0, y: villagerYaw } });

                // Set floating colored profession name
                villager.nameTag = prof.displayName;

                // Apply Bedrock profession event
                villager.triggerEvent(prof.event);
                if (prof.customEvent) {
                    villager.triggerEvent(prof.customEvent);
                }

                // Add profession tags
                for (const t of prof.tags) {
                    villager.addTag(t);
                }

                // Register with the corresponding smart manager
                registerWithManager(villager, prof.id, managers);

                // Equip default item in mainhand
                if (prof.defaultItem) {
                    try {
                        const equippable = villager.getComponent("minecraft:equippable");
                        if (equippable) {
                            equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack(prof.defaultItem, 1));
                        }
                    } catch {
                        villager.runCommandAsync(`replaceitem entity @s slot.weapon.mainhand 0 ${prof.defaultItem}`).catch(() => {});
                    }
                }

                // Visual & audio feedback
                spawnParticleSafe(dim, "minecraft:villager_happy", {
                    x: spawnPos.x,
                    y: spawnPos.y + 1.2,
                    z: spawnPos.z
                });
                playSoundSafe(dim, "random.pop", spawnPos, { volume: 0.7, pitch: 1.0 + (i * 0.05) });

            } catch (err) {
                console.error(`[Villager Addon] Error summoning ${prof.id}: ${err}`);
            }
        }, i * 2);
    }

    // Final celebration chime
    system.runTimeout(() => {
        if (!player || !player.isValid()) return;
        playSoundSafe(dim, "random.levelup", player.location, { volume: 1.0, pitch: 1.2 });
        player.sendMessage("§a✔ All 13 villager professions summoned successfully!");
    }, total * 2 + 4);
}

/**
 * Helper to register a villager into its manager.
 */
function registerWithManager(villager, profId, managers) {
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

/**
 * Villager Professions Addon - Main Entry Point (Namespace: rpc)
 * Initializes the addon, binds world events, player interactions, and executes the central game loop
 * for Fisherman, Shepherd, Butcher, and Fletcher villagers.
 */

import { world, system } from "@minecraft/server";
import { FishermanManager } from "./fishermanManager.js";
import { ShepherdManager } from "./shepherdManager.js";
import { ButcherManager } from "./butcherManager.js";
import { FletcherManager } from "./fletcherManager.js";

const fishermanManager = new FishermanManager();
const shepherdManager = new ShepherdManager();
const butcherManager = new ButcherManager();
const fletcherManager = new FletcherManager();

// Central game tick loop
system.runInterval(() => {
    try {
        fishermanManager.update();
    } catch (err) {
        console.error(`[Villager Addon] Error in fisherman loop: ${err}`);
    }

    try {
        shepherdManager.update();
    } catch (err) {
        console.error(`[Villager Addon] Error in shepherd loop: ${err}`);
    }

    try {
        butcherManager.update();
    } catch (err) {
        console.error(`[Villager Addon] Error in butcher loop: ${err}`);
    }

    try {
        fletcherManager.update();
    } catch (err) {
        console.error(`[Villager Addon] Error in fletcher loop: ${err}`);
    }
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
            }, 2);
        }
    } catch {}
});

// Periodic cleanup: ensure no villager holds a weapon or tool from another profession
system.runInterval(() => {
    try {
        const overworld = world.getDimension("overworld");
        if (!overworld) return;
        const villagers = overworld.getEntities({ type: "minecraft:villager_v2" });
        for (const villager of villagers) {
            if (!villager || !villager.isValid()) continue;
            const equippable = villager.getComponent("minecraft:equippable");
            const item = equippable?.getEquipment("Mainhand");
            if (!item) continue;

            const isButcher = butcherManager.isButcherVillager(villager);
            const isFletcher = fletcherManager.isFletcherVillager(villager);
            const isFisherman = fishermanManager.isFishermanVillager(villager);
            const isShepherd = shepherdManager.isShepherdVillager(villager);

            if ((item.typeId === "minecraft:iron_axe" || item.typeId === "rpc:cleaver") && !isButcher) {
                equippable.setEquipment("Mainhand", undefined);
            } else if ((item.typeId === "minecraft:bow" || item.typeId === "minecraft:crossbow") && !isFletcher) {
                equippable.setEquipment("Mainhand", undefined);
            } else if (item.typeId === "rpc:fishing_rod" && !isFisherman) {
                equippable.setEquipment("Mainhand", undefined);
            } else if ((item.typeId === "minecraft:shears" || item.typeId === "rpc:shears") && !isShepherd) {
                equippable.setEquipment("Mainhand", undefined);
            }
        }
    } catch {}
}, 60);

// Allow player interactions:
// - Right-click any villager with rpc:fishing_rod to turn them into a Fisherman
// - Right-click any villager with rpc:shears or minecraft:shears to turn them into a Shepherd
// - Right-click any villager with rpc:cleaver or minecraft:iron_axe to turn them into a Butcher
// - Right-click any villager with minecraft:bow or minecraft:crossbow to turn them into a Fletcher
world.afterEvents.playerInteractWithEntity.subscribe((event) => {
    try {
        const { player, target } = event;
        if (!target || !target.isValid()) return;

        const typeId = target.typeId;
        if (typeId === "minecraft:villager_v2" || typeId === "minecraft:villager") {
            const equippable = player.getComponent("minecraft:equippable");
            const mainhand = equippable?.getEquipment("Mainhand");
            if (!mainhand) return;

            // Turn into Fisherman
            if (mainhand.typeId === "rpc:fishing_rod") {
                target.removeTag("rpc:shepherd");
                target.removeTag("shepherd");
                target.removeTag("rpc:butcher");
                target.removeTag("butcher");
                target.removeTag("rpc:fletcher");
                target.removeTag("fletcher");
                shepherdManager.records.delete(target.id);
                butcherManager.records.delete(target.id);
                fletcherManager.records.delete(target.id);

                target.triggerEvent("rpc:become_fisherman");
                target.triggerEvent("minecraft:become_fisherman");
                target.addTag("rpc:fisherman");
                target.addTag("fisherman");

                fishermanManager.registerFisherman(target);
            }

            // Turn into Shepherd
            if (mainhand.typeId === "rpc:shears" || mainhand.typeId === "minecraft:shears") {
                target.removeTag("rpc:fisherman");
                target.removeTag("fisherman");
                target.removeTag("rpc:butcher");
                target.removeTag("butcher");
                target.removeTag("rpc:fletcher");
                target.removeTag("fletcher");
                try {
                    target.triggerEvent("rpc:stop_fishing");
                } catch {}
                if (fishermanManager.records.has(target.id)) {
                    const rec = fishermanManager.records.get(target.id);
                    if (rec && rec.fishingSession) {
                        try { rec.fishingSession.bobber?.remove(); } catch {}
                    }
                    fishermanManager.records.delete(target.id);
                }
                butcherManager.records.delete(target.id);
                fletcherManager.records.delete(target.id);

                target.triggerEvent("rpc:become_shepherd");
                target.triggerEvent("minecraft:become_sheperd");
                target.addTag("rpc:shepherd");
                target.addTag("shepherd");

                shepherdManager.registerShepherd(target);
            }

            // Turn into Butcher
            if (mainhand.typeId === "rpc:cleaver" || mainhand.typeId === "minecraft:iron_axe") {
                target.removeTag("rpc:fisherman");
                target.removeTag("fisherman");
                target.removeTag("rpc:shepherd");
                target.removeTag("shepherd");
                target.removeTag("rpc:fletcher");
                target.removeTag("fletcher");
                try {
                    target.triggerEvent("rpc:stop_fishing");
                } catch {}
                if (fishermanManager.records.has(target.id)) {
                    const rec = fishermanManager.records.get(target.id);
                    if (rec && rec.fishingSession) {
                        try { rec.fishingSession.bobber?.remove(); } catch {}
                    }
                    fishermanManager.records.delete(target.id);
                }
                shepherdManager.records.delete(target.id);
                fletcherManager.records.delete(target.id);

                target.triggerEvent("rpc:become_butcher");
                target.triggerEvent("minecraft:become_butcher");
                target.addTag("rpc:butcher");
                target.addTag("butcher");

                butcherManager.registerButcher(target);
            }

            // Turn into Fletcher (Bow or Crossbow)
            if (mainhand.typeId === "minecraft:bow" || mainhand.typeId === "minecraft:crossbow") {
                target.removeTag("rpc:fisherman");
                target.removeTag("fisherman");
                target.removeTag("rpc:shepherd");
                target.removeTag("shepherd");
                target.removeTag("rpc:butcher");
                target.removeTag("butcher");
                try {
                    target.triggerEvent("rpc:stop_fishing");
                } catch {}
                if (fishermanManager.records.has(target.id)) {
                    const rec = fishermanManager.records.get(target.id);
                    if (rec && rec.fishingSession) {
                        try { rec.fishingSession.bobber?.remove(); } catch {}
                    }
                    fishermanManager.records.delete(target.id);
                }
                shepherdManager.records.delete(target.id);
                butcherManager.records.delete(target.id);

                target.triggerEvent("rpc:become_fletcher");
                target.triggerEvent("minecraft:become_fletcher");
                target.addTag("rpc:fletcher");
                target.addTag("fletcher");

                fletcherManager.setWeapon(target, mainhand.typeId);
            }
        }
    } catch {}
});


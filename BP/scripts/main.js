/**
 * Villager Professions Addon - Main Entry Point (Namespace: rpc)
 * Initializes the addon, binds world events, player interactions, and executes the central game loop
 * for Fisherman, Shepherd, and Butcher villagers.
 */

import { world, system } from "@minecraft/server";
import { FishermanManager } from "./fishermanManager.js";
import { ShepherdManager } from "./shepherdManager.js";
import { ButcherManager } from "./butcherManager.js";

const fishermanManager = new FishermanManager();
const shepherdManager = new ShepherdManager();
const butcherManager = new ButcherManager();

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
}, 1);

// Immediately register newly spawned or transformed villagers
world.afterEvents.entitySpawn.subscribe((event) => {
    try {
        if (event.entity && event.entity.isValid()) {
            fishermanManager.onEntitySpawn(event.entity);
            shepherdManager.onEntitySpawn(event.entity);
            butcherManager.onEntitySpawn(event.entity);
        }
    } catch {}
});

// Allow player interactions:
// - Right-click any villager with rpc:fishing_rod to turn them into a Fisherman
// - Right-click any villager with rpc:shears or minecraft:shears to turn them into a Shepherd
// - Right-click any villager with rpc:cleaver or minecraft:iron_axe to turn them into a Butcher
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
                shepherdManager.records.delete(target.id);
                butcherManager.records.delete(target.id);

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

                target.triggerEvent("rpc:become_butcher");
                target.triggerEvent("minecraft:become_butcher");
                target.addTag("rpc:butcher");
                target.addTag("butcher");

                butcherManager.registerButcher(target);
            }
        }
    } catch {}
});

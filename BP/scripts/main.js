/**
 * Fisherman Villager Addon - Main Entry Point (Namespace: rpc)
 * Initializes the addon, binds world events, player interactions, and executes the central game loop.
 */

import { world, system } from "@minecraft/server";
import { FishermanManager } from "./fishermanManager.js";
import { SCAN_CONFIG } from "./config.js";

console.warn("[Fisherman Villager Addon] Initializing script module...");

const manager = new FishermanManager();

// Tick loop running every tick
system.runInterval(() => {
    try {
        manager.update();
    } catch (err) {
        console.error(`[Fisherman Villager Addon] Error in manager loop: ${err}`);
    }
}, 1);

// Immediately register newly spawned or transformed fishermen
world.afterEvents.entitySpawn.subscribe((event) => {
    try {
        if (event.entity && event.entity.isValid()) {
            manager.onEntitySpawn(event.entity);
        }
    } catch {}
});

// Allow player to right-click any villager with rpc:fishing_rod to turn them into a Fisherman!
world.afterEvents.playerInteractWithEntity.subscribe((event) => {
    try {
        const { player, target } = event;
        if (!target || !target.isValid()) return;

        const typeId = target.typeId;
        if (typeId === "minecraft:villager_v2" || typeId === "minecraft:villager") {
            const equippable = player.getComponent("minecraft:equippable");
            const mainhand = equippable?.getEquipment("Mainhand");

            if (mainhand && mainhand.typeId === "rpc:fishing_rod") {
                target.triggerEvent("rpc:become_fisherman");
                target.triggerEvent("minecraft:become_fisherman");
                target.addTag("rpc:fisherman");
                target.addTag("fisherman");

                manager.registerFisherman(target);
                player.sendMessage("§a[Fisherman Addon] Villager converted to Fisherman! Heading to water to fish.");
            }
        }
    } catch {}
});

console.warn(
    `[Fisherman Villager Addon] Successfully initialized! River detection radius: ${SCAN_CONFIG.RADIUS} blocks.`
);

# Villager Professions Addon (Minecraft Bedrock)

A modular, high-quality Minecraft Bedrock Behavior & Resource Pack that brings **Fisherman** and **Smart Shepherd** Villagers to life with realistic autonomous behaviors, authentic tools in hand, day/night sleeping schedules, and native Bedrock navigation.

![Minecraft Bedrock](https://img.shields.io/badge/Minecraft%20Bedrock-1.21+-green.svg)
![License](https://img.shields.io/badge/License-MIT-blue.svg)

---

## Features

### 🐑 Smart Shepherd Villager
- **Spawn With Leashed Sheep**:
  - Automatically spawns with **2 companion sheep** connected with a leash/rope to the villager, just like the Wandering Trader with llamas.
- **Shears in Hand**:
  - Actually holds shears in hand (`minecraft:shears` and `rpc:shears`) using a custom attachable connected to the villager's right arm.
- **Smooth Native Movement (No Hardcoded Jumping)**:
  - Uses Minecraft's native `minecraft:behavior.follow_mob` pathfinding to search and smoothly walk towards nearby sheep without conflict, jumping, or unnatural teleportation.
- **Authentic Shearing Action**:
  - Scans for nearby adult sheep with wool.
  - When reaching the sheep, raises arms, snips shears with authentic `mob.sheep.shear` audio, wool pop particles, and triggers `minecraft:on_sheared`.
  - Drops 1 to 2 matching colored wool blocks according to the sheep's color.
  - Celebrates with happy villager particles and positive villager sounds.
- **Day / Night Sleeping Routine**:
  - At sunset (`time >= 12000`), puts away shears and walks to bed to sleep.
  - At sunrise (`time < 12000`), wakes up, re-equips shears, and returns to tending sheep.

---

### 🎣 Fisherman Villager
- **Autonomous River & Water Detection**:
  - Scans up to **48 blocks** away for rivers and open water bodies.
  - Smooth, level shore pathfinding without jumping or hopping.
  - Villagers stand firmly on land at the water's edge and never walk or fall into the water.
- **Realistic Projectile Throw & Reel-In Physics**:
  - The fishing hook launches directly from the rod tip in the villager's hands in a natural ballistic arc.
  - Water splash sounds and particles upon landing.
  - Hook bobs naturally on the water surface with floating waves.
  - When a fish bites, the hook tugs downward with water wake rings and bubbles.
  - Full ballistic trajectory physics during reel-in: hook and caught fish item fly in an arc back to the villager's hands.
- **Continuous Catenary Particle Rope**:
  - Fine, delicate black particle string (50% opacity, 1/8th pixel scale).
  - Dense spacing (~0.025 blocks) creating a continuous, seamless thread from rod tip to hook eyelet.
  - Catenary curve physics with natural gravity sag when slack, and rapid tension vibration when a fish bites.
  - Water surface boundary clamping prevents the rope from clipping beneath the water.
- **Natural Day / Night Sleeping Schedule**:
  - At sunset, packs up rod and sleeps in bed.
  - At sunrise, resumes fishing at the shoreline.

---

## Custom Content (Namespace: `rpc`)

- `rpc:shears`: Custom Shepherd Shears item equipped in main hand.
- `rpc:fishing_rod`: Custom fishing rod item equipped in main hand.
- `rpc:fishing_bobber`: Custom floating fishing bobber entity.
- `rpc:fishing_line_particle`: High-precision translucent particle string.

---

## Installation

### Automatic (`.mcaddon`)
1. Double-click `FishermanVillager.mcaddon`.
2. Minecraft Bedrock will automatically import both the Behavior Pack and Resource Pack.
3. Activate both packs in your world settings (ensure **Beta APIs** / Scripting is enabled).

### Development Mode
Run `update_addon.bat` to mirror the Behavior Pack (`BP`) and Resource Pack (`RP`) directly into your Minecraft Bedrock `development_behavior_packs` and `development_resource_packs` directories.

---

## How to Use in Game

### Shepherd:
1. Find or spawn a Shepherd Villager, or **right-click any villager with shears** (`minecraft:shears` or `rpc:shears`).
2. The Shepherd will spawn with 2 leashed sheep, hold shears in hand, and walk towards nearby sheep to shear them!
3. Collect the fresh wool dropped by sheared sheep.

### Fisherman:
1. Find or spawn a Fisherman Villager, or **right-click any villager with `rpc:fishing_rod`**.
2. If near water or a river within 48 blocks, the villager walks to the shore and fishes.

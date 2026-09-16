# Fisherman Villager Addon (Minecraft Bedrock)

A modular, high-quality Minecraft Bedrock Behavior & Resource Pack that brings Fisherman Villagers to life with realistic autonomous fishing behaviors, day/night schedules, and authentic rope physics.

![Minecraft Bedrock](https://img.shields.io/badge/Minecraft%20Bedrock-1.26+-green.svg)
![License](https://img.shields.io/badge/License-MIT-blue.svg)

---

## Features

- **Autonomous River & Water Detection**:
  - Fisherman villagers scan up to **48 blocks** away for rivers and open water bodies.
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
  - At sunset (`time >= 12000`), villagers wrap up fishing, pack up their rod, and walk back to bed to sleep.
  - At sunrise (`time < 12000`), they wake up and head back to the river to resume fishing.

- **Custom Content (Namespace: `rpc`)**:
  - `rpc:fishing_rod`: Custom fishing rod item equipped in main hand.
  - `rpc:fishing_bobber`: Custom floating fishing bobber entity.
  - `rpc:fishing_line_particle`: High-precision translucent particle string.

---

## Installation

### Automatic (`.mcaddon`)
1. Download or double-click `FishermanVillager.mcaddon`.
2. Minecraft Bedrock will automatically import both the Behavior Pack and Resource Pack.
3. Activate both packs in your world settings (ensure **Beta APIs** / Scripting is enabled).

### Development Mode
Run `update_addon.bat` to mirror the Behavior Pack (`BP`) and Resource Pack (`RP`) directly into your Minecraft Bedrock `development_behavior_packs` and `development_resource_packs` directories.

---

## How to Use in Game

1. Find or spawn a Fisherman Villager (or right-click any villager with `rpc:fishing_rod`).
2. If near water or a river within 48 blocks, the villager will walk to the shore and begin fishing.
3. Watch the hook launch, bob on the waves, bite, and reel in fresh fish!

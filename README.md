# Villager Professions Addon (Minecraft Bedrock)

A modular, high-quality Minecraft Bedrock Behavior & Resource Pack that brings **Fisherman**, **Smart Shepherd**, and **Smart Butcher** Villagers to life with realistic autonomous behaviors, authentic tools in hand, workstation interactions, day/night sleeping schedules, and native Bedrock navigation.

![Minecraft Bedrock](https://img.shields.io/badge/Minecraft%20Bedrock-1.21+-green.svg)
![License](https://img.shields.io/badge/License-MIT-blue.svg)

---

## Features

### 🥩 Smart Butcher Villager
- **Axe / Cleaver in Hand**:
  - Visibly holds an **Iron Axe** or **Cleaver** (`minecraft:iron_axe` and `rpc:cleaver`) in hand using a custom attachable model.
- **Hunting Cows & Pigs**:
  - Scans up to **24 blocks** away for nearby adult pigs and cows (preserves baby animals).
  - Uses native Bedrock `minecraft:behavior.follow_mob` pathfinding to smoothly walk up to animals without jumping or hopping.
- **Slaughter & Meat Gathering**:
  - When in range, swings weapon with attack sounds and particles.
  - Drops raw porkchop or raw beef (and leather).
  - Gathers the raw meat and celebrates with happy villager effects.
- **Smoker Workstation Cooking**:
  - Scans for the nearest **Smoker** block (`minecraft:smoker` or `minecraft:lit_smoker`) within 32 blocks (the Butcher's actual village POI workstation).
  - Walks to the Smoker.
  - Places **2 Coals** into Fuel Slot 1 and the **Raw Meat** into Cooking Slot 0.
  - Plays smoker sizzling audio (`random.fizz`) and chimney smoke particles (`minecraft:smoker_smoke_particle`) as the meat begins cooking!
- **Day / Night Sleeping Routine**:
  - At sunset (`time >= 12000`), puts away weapon and sleeps in bed.
  - At sunrise, wakes up, re-equips weapon, and resumes work.

---

### 🐑 Smart Shepherd Villager
- **Spawn With Leashed Sheep**:
  - Automatically spawns with **2 companion sheep** connected with a leash/rope to the villager, just like the Wandering Trader with llamas.
- **Shears in Hand**:
  - Correctly holds shears in hand (`minecraft:shears` and `rpc:shears`) upright and facing forward at chest level.
- **Smooth Native Movement**:
  - Uses Minecraft's native `minecraft:behavior.follow_mob` pathfinding to search and smoothly walk towards nearby sheep without jumping or hopping.
- **Authentic Shearing Action**:
  - Scans for nearby adult sheep with wool.
  - Raises arms, snips shears with authentic `mob.sheep.shear` audio, wool pop particles, and triggers `minecraft:on_sheared`.
  - Drops 1 to 2 matching colored wool blocks according to the sheep's color.
  - Celebrates with happy villager particles and sounds.
- **Day / Night Sleeping Routine**:
  - At sunset (`time >= 12000`), puts away shears and sleeps in bed.
  - At sunrise (`time < 12000`), wakes up, re-equips shears, and returns to tending sheep.

---

### 🎣 Fisherman Villager
- **Autonomous River & Water Detection**:
  - Scans up to **48 blocks** away for rivers and open water bodies.
  - Smooth shore pathfinding; stands firmly on land and never falls into water.
- **Realistic Projectile Throw & Reel-In Physics**:
  - Fishing hook launches directly from rod tip in natural ballistic arc.
  - Hook bobs on water waves; tugs downward with wake rings and bubbles on bite.
  - Full ballistic trajectory reel-in returning hook and caught fish to hands.
- **Continuous Catenary Particle Rope**:
  - Fine black particle string with gravity sag when slack, and tension vibration when a fish bites.
- **Natural Day / Night Sleeping Schedule**:
  - Sleeps in bed at night; resumes fishing at sunrise.

---

## Custom Content (Namespace: `rpc`)

- `rpc:cleaver`: Custom Butcher Cleaver weapon equipped in main hand.
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
Run `update_addon.bat` to mirror the Behavior Pack (`BP`) and Resource Pack (`RP`) directly into your Minecraft Bedrock development directories.

---

## How to Use in Game

- **Butcher**: Spawn a Butcher or right-click any villager with an **Iron Axe** or **Cleaver**. Watch them hunt pigs/cows, gather meat, and load coal & meat into the village Smoker!
- **Shepherd**: Spawn a Shepherd or right-click any villager with **Shears**. Watch them spawn with 2 leashed sheep, hold shears upright in hand, and shear nearby sheep!
- **Fisherman**: Spawn a Fisherman or right-click any villager with `rpc:fishing_rod`. Watch them find rivers, cast their hook, and reel in fresh fish!

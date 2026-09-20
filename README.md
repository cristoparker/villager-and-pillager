# Villager & Pillager: Enhanced Villager Professions Addon
### Minecraft Bedrock Edition (1.21+)

A modular, high-depth Minecraft Bedrock Behavior & Resource Pack that transforms Minecraft villagers into an authentic, living, and capable civilization. Every villager profession features deep autonomous AI behaviors, visual held items, authentic workstation interactions, dynamic day/night sleeping schedules, combat and raid defense routines, and real-time occupation synchronization.

![Minecraft Bedrock](https://img.shields.io/badge/Minecraft%20Bedrock-1.21+-green.svg)
![Bedrock Scripting API](https://img.shields.io/badge/Scripting%20API-@minecraft/server-orange.svg)
![License](https://img.shields.io/badge/License-MIT-blue.svg)

---

## 🌟 Core System Highlights

- **Dynamic Occupation Synchronization**: When villagers claim, swap, or lose their workstations, their held items, behavior managers, tags, and AI routines dynamically synchronize in real-time. No stuck items or desynced jobs!
- **Smooth Locomotion & Anti-Jitter**: Custom approach states utilize directional impulse propulsion (`applyImpulse`) and throttled rotation heading, preserving native walking leg animations without teleport freeze or stutter.
- **Visual Equipment in Hand**: Villagers visibly hold authentic tools, weapons, food, and crafting components matching their profession and current task.
- **Living Workstation Ecosystem**: Villagers actively operate, cook, craft, and interact with smokers, looms, anvils, grindstones, lecterns, fletching tables, brewing stands, composters, and campfires.
- **Autonomous Village Defense**: Villagers no longer simply flee from monsters—farmers fight with hoes, weaponsmiths blow war horns and cleave with axes, fletchers fire flaming arrows, armorers block with shields and repair golems, librarians dispel curses, and clerics cast holy sanctuary auras and offensive splash potions.

---

## 🏛️ Universal Item Collection, Village Expansion & Chest Organization

This update brings an entirely new layer of autonomous civilization-building to Minecraft Bedrock villagers:

### 🎒 1. Universal Item Collection (All Villagers)
- **Automatic Ground Item Scanning**:
  - Every villager—regardless of profession (including Nitwits and Unemployed villagers)—actively monitors their surroundings for dropped ground items within 12 blocks.
  - Detects meat and leather from butchers, wool and carpets from shepherds, sugarcane and books from librarians, crops and seeds from farmers, arrows from fletchers, fish from fishermen, and any item dropped by players or the environment.
- **Approaching & Vacuuming**:
  - Villagers smoothly walk over to the dropped item with realistic leg locomotion and pickup audio (`random.pop`).
  - Items are picked up and stored directly inside the villager's internal 8-slot inventory or carried storage.
  - Emits villager sparkle particles (`minecraft:villager_happy`) upon collection.

### 🛏️ 2. Autonomous Village Expansion (Beds & Workbenches for Breeding)
- **Bed Placement & Breeding Headroom**:
  - Villagers autonomously build out the village sleeping quarters by placing beds on flat, valid solid ground.
  - Strictly verifies **2-block clear headroom** above the mattress (essential for baby villagers to jump on beds and register valid Bedrock breeding village bounds).
  - Plays authentic bed placement sounds (`dig.wood`) and equips the bed in mainhand while placing.
  - Automatically enables villagers to enter "willing" breeding mode as bed capacity exceeds the current villager count, spawning baby villagers naturally!
- **Workbench Expansion**:
  - Villagers periodically erect workstations nearly (Smokers, Composters, Looms, Lecterns, Barrels, Blast Furnaces, Fletching Tables, Grindstones, Brewing Stands).
  - Unemployed villagers in the vicinity immediately discover the new workstations, claiming them and adopting specialized professions.

### 📦 3. Copper Golem-Style Chest Organization & Placement
- **Chest & Container Deposit**:
  - Villagers carrying collected items scan up to 16 blocks for village storage containers (`minecraft:chest`, `minecraft:trapped_chest`, `minecraft:barrel`).
  - They approach the container, visibly interact, play chest opening audio (`random.chestopen`), transfer and organize their collected goods into the container's inventory slots, and close it (`random.chestclosed`) with happy particles.
- **Autonomous Chest Construction**:
  - If a villager has collected items but no chest or barrel exists within reach, they take initiative:
  - Equips a chest in hand, identifies a valid adjacent solid block, places a brand-new **Village Chest**, and immediately transfers all carried goods into it!

---

## 🧑‍🌾 Profession Roster & Features

### 🌾 1. Smart Farmer Villager
- **Held Items**: Iron Hoe (`minecraft:iron_hoe`), Bone Meal, Seeds, Wheat, Carrots, Potatoes, Beetroots.
- **Farmland Tilling & Crop Seeding**:
  - Automatically detects empty hoed farmland (`minecraft:farmland`) and plants wheat, carrot, potato, or beetroot crops with seed planting audio and particles.
- **Bone Meal Fertilization**:
  - Scans for growing crops (`growth < 7`) and applies bone meal, instantly advancing growth stages with green bone meal particle bursts and audio.
  - Applies bone meal to young saplings to sprout them into full-grown trees with natural logs and leaf canopies.
- **Crop Harvesting & Replanting**:
  - Identifies ripe crops (`growth === 7`), harvests them with hoe-swinging animations, drops produce items, and immediately replants seeds on the farmland.
- **Composter Cycling**:
  - Gathers surplus seeds and fills village composters (`minecraft:composter`) to produce fresh bone meal.
- **Flower & Tree Planting**:
  - Regularly plants wildflowers (`dandelions`, `poppies`, `alliums`, `tulips`, `cornflowers`, `oxeye daisies`) and tree saplings across dirt and grass blocks to beautify the village.
- **Animal Breeding & Baby Care**:
  - **Adult Breeding**: Detects pairs of adult cows, sheep, chickens, and pigs, equips their favorite food (wheat, seeds, or carrots), feeds both parents, emits heart particles, and breeds baby animals with a 60-second cooldown.
  - **Baby Animal Maturation**: Spots baby animals, approaches with food in hand, feeds them, and accelerates their growth into mature adults.
- **Combat Defense**:
  - When threatened by monsters within 14 blocks, brandishes an Iron Hoe, charges the enemy, and inflicts melee damage with critical hit particles.

---

### 🥩 2. Smart Butcher Villager
- **Held Items**: Iron Axe (`minecraft:iron_axe`) or Custom Cleaver (`rpc:cleaver`).
- **Livestock Hunting**:
  - Scans up to 24 blocks for adult pigs and cows (always preserves baby animals).
  - Uses native pursuit pathfinding and smooth forward momentum to approach targets.
- **Slaughter & Meat Gathering**:
  - Executes cleaving weapon swings with impact sounds, harvesting raw porkchop, beef, and leather.
  - Emits happy villager particles upon collecting meat.
- **Smoker Workstation Cooking**:
  - Pathfinds to the nearest village **Smoker** block (`minecraft:smoker` or `minecraft:lit_smoker`).
  - Automatically loads fuel (coal) into the fuel slot and raw meat into the cooking slot.
  - Activates smoking sizzle audio (`random.fizz`) and chimney smoke particles (`minecraft:smoker_smoke_particle`).

---

### 🐑 3. Smart Shepherd Villager
- **Held Items**: Shears (`rpc:shears` and `minecraft:shears`), Dyes, Wheat, Carpets.
- **Starter Flock**:
  - Spawns accompanied by **2 leashed companion sheep** connected by leash ropes, following the shepherd naturally.
- **Authentic Sheep Shearing**:
  - Detects adult sheep with wool, walks up smoothly, snips shears (`mob.sheep.shear`), triggers `minecraft:on_sheared`, and drops 1–2 matching wool blocks.
- **Colorful Wool Dyeing**:
  - Equips dyes (red, blue, yellow, green, purple, orange, pink, cyan) and dyes plain white sheep into vibrant colorful variants with wool dyeing sound and sparkles.
- **Flock Wheat Feeding**:
  - Detects sheared sheep, equips wheat, feeds them to regrow their fleece immediately, and emits heart particles.
- **Predator Repulsion**:
  - Spots hostile wolves or foxes threatening sheep, charges forward with snapping shears, and repels predators with knockback impulses.
- **Loom Carpet Weaving**:
  - Visits village looms (`minecraft:loom`), works with weaving animations and cloth sounds, and crafts decorative carpets (`minecraft:white_carpet`).

---

### 🛡️ 4. Smart Armorer Villager
- **Held Items**: Iron Ingot (`minecraft:iron_ingot`), Shield (`minecraft:shield`), Iron Chestplate (`minecraft:iron_chestplate`).
- **Iron Golem Repair**:
  - Actively patrols for cracked or injured village Iron Golems.
  - Equips iron ingots, hammers the golem, plays authentic metallic anvil ding sounds, and restores the golem's health.
- **Ally Fortification Blessing**:
  - Scans for unfortified villagers and players, equips an iron chestplate in hand, and casts a fortification blessing conferring **Resistance** and **Absorption** accompanied by beacon chimes.
- **Anvil Hammering & Forging**:
  - Approaches village anvils (`minecraft:anvil`, chipped, or damaged), hammering with rhythmic metallic dings and fiery spark particles (`minecraft:crit`).
- **Active Shield Combat Blocking**:
  - When hostile monsters approach within 12 blocks, equips an authentic **Shield** in mainhand, enters defensive blocking stance, and deflects monster strikes.
- **Automated Iron Golem Construction**:
  - If all village golems are defeated during raids or monster swarms, conducts an emergency forge ritual, constructing an Iron Golem with celebratory fireworks and thunderous forge audio.

---

### ⚔️ 5. Smart Weaponsmith Villager
- **Held Items**: Iron Sword (`minecraft:iron_sword`), Iron Axe (`minecraft:iron_axe`), Goat Horn (`minecraft:goat_horn`).
- **Grindstone Blade Sharpening**:
  - Visits village grindstones (`minecraft:grindstone`), equips a sword or axe, and hones the blade edge with authentic grinding sounds and spark particles.
- **War Horn Call to Arms**:
  - When raids or monster swarms threaten the village, equips a **Goat Horn**, sounds the resounding horn blast (`item.goat_horn.sound.0`), and rallies all villagers and players with **Strength** and **Speed**.
- **Ally Blade Sharpening**:
  - Sharpens the weapons of nearby combat-ready allies and players, conferring **Strength I** for 30 seconds.
- **Dynamic Combat Stances**:
  - Engages hostile monsters directly in melee combat, dynamically swapping between **Iron Axe** (for shield-breaking heavy cleaves) and **Iron Sword** (for fast combat strikes).

---

### 🏹 6. Smart Fletcher Villager
- **Held Items**: Bow (`minecraft:bow`), Crossbow (`minecraft:crossbow`), Arrow (`minecraft:arrow`).
- **Bow & Crossbow Archery**:
  - Patrols the village perimeter; upon detecting monsters up to 16 blocks away, takes aim, draws the bowstring (`random.bow` / `crossbow.loading_start`), and releases ballistic arrows with accurate trajectories and critical hit particles.
- **Fire-Tipped Flaming Arrows**:
  - When firing within 4 blocks of a torch, campfire, or fire source, the fletcher dips arrows in flame (`minecraft:basic_flame_particle`), launching flaming projectiles that ignite hostiles on fire.
- **Tactical Combat Debuffs**:
  - Inflicts tailored tactical debuffs based on monster anatomy:
    - **Spiders & Creepers**: Afflicted with **Slowness** to prevent closing the distance.
    - **Illagers & Pillagers**: Afflicted with **Poison** to steadily drain their health.
- **Fletching Table Arrow Crafting**:
  - Gathers at fletching tables (`minecraft:fletching_table`), crafts tipped arrows with wood-carving sounds, and drops fresh arrows for village supply.
- **Target Block Archery Practice**:
  - During peaceful hours, finds village target blocks (`minecraft:target`), steps back into shooting range, and conducts target practice.

---

### 🎣 7. Smart Fisherman Villager
- **Held Items**: Custom Fishing Rod (`rpc:fishing_rod`), Raw/Cooked Fish, Fish Buckets.
- **Autonomous Shoreline Fishing**:
  - Detects natural rivers, oceans, and ponds up to 48 blocks away.
  - Casts a realistic ballistic bobber entity connected by a dynamic catenary particle rope (`rpc:fishing_line_particle`).
  - Reacts to water wave bites with wake particles, downward bobber tugs, and reels in authentic fish catch directly to hand.
- **Stray Cat Feeding & Taming**:
  - Scans for stray village cats, equips raw cod or salmon, approaches gently, and feeds them into loyal village creeper wardens.
- **Campfire Fish Cooking**:
  - Visits lit village campfires (`minecraft:campfire`), cooks raw catch over the open flames, and produces steaming cooked fish.
- **River & Pond Restocking**:
  - Equips water and tropical fish buckets, releasing lively fish into local ponds with water splash sounds.

---

### 📚 8. Smart Librarian Villager
- **Held Items**: Enchanted Book (`minecraft:enchanted_book`), Regular Book (`minecraft:book`), Paper (`minecraft:paper`).
- **Sugarcane Plantation**:
  - Identifies sand, dirt, or grass blocks adjacent to water and plants sugarcane (`minecraft:reeds`).
  - Monitors sugarcane growth: sustainably harvests upper stalks (height $\ge 2$) while leaving the root block intact to regrow indefinitely.
- **Lectern Paper & Book Crafting**:
  - Studies at lecterns (`minecraft:lectern`), turns pages with paper in hand (`item.book.page_turn`), and binds fresh paper and books.
- **Enchanting Blessings**:
  - Channels runic glyphs from the lectern (`minecraft:enchanting_table_particle`), bestowing **Haste** and **Regeneration** on nearby villagers and players.
- **Curse & Debuff Dispel**:
  - Scans for allies afflicted with harmful status effects (Poison, Slowness, Weakness, Wither, Blindness, Hunger), walks over, and purges all negative debuffs with amethyst chimes (`chime.amethyst_block`) and totem sparkles.

---

### 🧪 9. Smart Cleric Villager
- **Held Items**: Splash Potion (`minecraft:splash_potion`), Potion (`minecraft:potion`), Golden Apple (`minecraft:golden_apple`).
- **Zombie Villager Curing Ritual**:
  - Detects nearby Zombie Villagers, hurls a splash potion of Weakness, feeds them a Golden Apple with eating sounds, emits golden totem particles, and triggers the `minecraft:start_transforming` transformation ritual to cure them!
- **Holy Sanctuary Defensive Aura**:
  - During raids or monster swarms, raises arms and channels a radiant circular sanctuary barrier (`minecraft:endrod` and `minecraft:totem_particle`), violently knocking back monsters while granting allies **Absorption** and **Regeneration**.
- **Brewing Stand Alchemy**:
  - Visits village brewing stands (`minecraft:brewing_stand`), plays bubbling brew sounds, and produces healing and splash potions.
- **Witcher Regeneration & Combat Potions**:
  - Drinks self-regeneration potions when low on health, and hurls tactical splash potions:
    - **Living Monsters & Pillagers**: Inflicted with **Slowness** and **Poison**.
    - **Undead Monsters (Zombies, Skeletons)**: Inflicted with **Weakness** and **Instant Damage**.

---

## 🔄 Dynamic Occupation Synchronizer

The addon includes an automated synchronizer module (`professionHelper.js`) that monitors every villager every 15 ticks:
1. Detects changes in the villager's underlying workstation profession (via `minecraft:variant` and `type_family`).
2. If a villager changes workstation or loses their job:
   - Clears old held items and tags immediately.
   - Clears any leashed starter sheep.
   - Unregisters the villager from previous managers.
   - Registers them to their new profession manager, equipping the proper tool and tags seamlessly.

---

## 📦 Custom Items & Entities (Namespace: `rpc`)

| Identifier | Description |
|---|---|
| `rpc:fishing_rod` | Custom 3D animated fishing rod item. |
| `rpc:fishing_bobber` | Ballistic water-floating bobber entity with wake particles. |
| `rpc:fishing_line_particle` | High-precision catenary particle line connecting rod tip to bobber. |
| `rpc:shears` | Custom Shepherd shears model held upright in hand. |
| `rpc:cleaver` | Heavy butcher cleaver weapon for livestock harvesting. |

---

## 🚀 Installation & Setup

### Requirements
- **Minecraft Bedrock Edition** v1.21.0 or higher.
- Enable the following **Experimental Features** in world settings:
  - **Beta APIs** (Required for `@minecraft/server` scripting).

### Quick Install (`.mcaddon`)
1. Download or locate `FishermanVillager.mcaddon`.
2. Double-click or open with Minecraft Bedrock to automatically import both Behavior and Resource packs.
3. Apply both packs to your world.

### Development Mode (Automatic Sync)
Run the included batch script from the repository root:
```cmd
update_addon.bat
```
This automatically synchronizes changes from `BP/` and `RP/` directly into your local Minecraft Bedrock development folders and rebuilds the `.mcaddon` bundle.

---

## 🎮 How to Test In-Game

- **Farmer**: Place a Composter or summon a farmer (`/summon villager_v2 ~ ~ ~ 0 1`). Hoe some farmland nearby, plant saplings, or place cows/sheep/pigs/chickens to watch breeding and feeding!
- **Butcher**: Place a Smoker or spawn a butcher (`/summon villager_v2 ~ ~ ~ 0 11`). Spawn cows or pigs nearby and watch the butcher hunt, gather, and smoke meat!
- **Shepherd**: Place a Loom or spawn a shepherd (`/summon villager_v2 ~ ~ ~ 0 3`). The shepherd spawns with 2 leashed sheep, shears them, dyes them, and feeds them wheat!
- **Armorer**: Place a Blast Furnace or Anvil (`/summon villager_v2 ~ ~ ~ 0 8`). Damage an Iron Golem nearby to watch the armorer repair it with ingots!
- **Weaponsmith**: Place a Grindstone (`/summon villager_v2 ~ ~ ~ 0 9`). Trigger a raid or spawn monsters nearby to hear the war horn call to arms!
- **Fletcher**: Place a Fletching Table or Target (`/summon villager_v2 ~ ~ ~ 0 4`). Spawn hostile monsters nearby to watch arrow archery and flaming arrows near torches!
- **Fisherman**: Place a Barrel near water (`/summon villager_v2 ~ ~ ~ 0 2`). Watch the fisherman detect water, cast, and reel in catch!
- **Librarian**: Place a Lectern near water (`/summon villager_v2 ~ ~ ~ 0 5`). Watch them plant and harvest sugarcane, study, and dispel negative curses from allies!
- **Cleric**: Place a Brewing Stand (`/summon villager_v2 ~ ~ ~ 0 7`). Spawn a Zombie Villager nearby to watch the weakness + golden apple curing ritual!
- **Universal Item Pickup**: Drop any items on the ground near any villager (raw meat, wool, paper, wheat, seeds, or arrows). The nearest villager will approach, collect the items with pop sounds, and store them!
- **Chest Storage & Organization**: Place a chest nearby, or let a villager collect items when no chest exists. Watch them deposit items with chest animations or autonomously construct a new village chest!
- **Village Expansion & Breeding**: Place several villagers in an open area. Watch them place beds with valid clearance and workbenches, creating new homes and breeding baby villagers!

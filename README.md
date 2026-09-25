# Cabin Fever

A browser FPS remake of the Combat Arms (2009) Fireteam zombie mode **Cabin Fever**, with modern graphics.
It uses three.js, a post-processing stack (N8AO ambient occlusion, bloom, AgX tone mapping, color grading and SMAA), procedural PBR textures and synthesized audio. The level, most guns and the fallback characters are procedural; characters, some weapons and the first-person arms are GLB models (see [Assets](#assets)).

```bash
npm install
npm run dev      # http://localhost:5173 (the game), /viewer.html (weapon + arms viewer)
```

## Main menu

The title sits over the live farmhouse scene. A slow camera moves between shots, cutting through black when you change screens, and the lightning brightens the title. **Play** sets up a run in three steps: game mode, difficulty and fireteam size (0–3 bots). A briefing panel shows the rounds, time limit, floors that open, the threat timeline and the standard kit. Everyone deploys with the same kit: M4A1, M9, knife and 2 frags. Better guns are bought in the store between rounds. The menu also has **Settings** (with a separate music volume), **Controls** and **Credits**. You can use the mouse, or the arrow keys, Enter and Esc.

**Menu music**: `public/audio/abandoned-farmhouse.mp3` loops on the main menu screens. Browsers block audio until the first click or key press, so the track starts then, or right away if the page already has permission. It fades out over 1.5 s when you deploy and fades back in when you return to the menu. It is silent in the pause menu, on the end screens and in `/viewer.html`. Volume is master × music, and both settings are saved with the others. The track plays through an `HTMLAudioElement` (`src/ui/music.js`), separate from the synthesized game mix.

## Game modes

A group of double agents escaped with a virus sample and are pinned down in an abandoned farmhouse.

**Cabin Fever** (classic Fireteam) is the original mode. Hold out against a fixed number of waves until extraction arrives at dawn.

| Difficulty | Rounds | Time limit | Unlocks |
|---|---|---|---|
| Easy | 10 | 30:00 | Upstairs opens at round 4 (Golden Punisher, balcony over the yard) |
| Hard | 15 | 45:00 | Upstairs at 4, basement at 10 (interior stairs + outside cellar) |
| Extreme | 20 | 60:00 | Upstairs at 4, basement at 10 |

**Endless** has no extraction, no time limit and no victory, so the run ends when the fireteam is wiped. The end screen shows the round you reached.
- Difficulty still sets the horde's health, damage, count and speed.
- The upstairs opens at round 4 and the basement at round 10 on every difficulty. The special weapons appear on their usual rounds.
- Past round 20, zombie health keeps climbing, but wave size grows more slowly. Striker share, crusher count and speed are capped.
- Every fifth round after 20 gets a "The horde grows stronger" banner. The HUD shows the round as `07/∞`.

- **Infected**
  - **Mauler**: the standard infected. The bodies rotate between the zombie woman, the Smoker and the gas-mask zombie.
  - **Boomer**: bloated. It explodes when it reaches you or dies, and shooting its gut sets it off.
  - **Mutant Dog**: from round 3. Dogs arrive in packs of 2 or 3. They are fast, pounce, and bite.
  - **Biter**: a feral kid, from round 4, in packs of 3 to 5 (smaller and rarer on easy). It is small, fast and fragile, and its head is a small target.
    - From 3–6 m it crouches and shrieks, then leaps at you. Shoot it in the air to knock it down, or sidestep so it tumbles.
    - If the leap lands, it clings to your back and bites through your kevlar (8 HP/s on hard). You move at 60% and can't sprint or aim down sights.
    - **Mash V** to shake it off (about 5 quick presses). It lands stunned for a second, which makes it an easy kill.
    - Teammates' shots pry it off you and never hit you. Bots go for a latched Biter first, and a bot shakes one off its own back after about 3 s.
    - Only one Biter latches onto a survivor at a time. The rest of the pack circles and waits.
  - **Striker**: female, in a white suit, from round 5. It is fast, leaps, and drops 3 shells that explode when it dies.
  - **Crusher**: a huge blue tank, from round 11. Its death leaves a blue acid cloud.
- **How the horde hunts**
  - Each infected goes for the survivor nearest to it by path, not in a straight line. It keeps that target instead of flip-flopping. A survivor who is already mobbed loses some attackers to teammates nearby.
  - It charges straight at you, leading you a little when you move, only when it could actually walk that line. It won't run into boarded windows, furniture, the stair cage or a barricade. Otherwise it follows a smoothed flow field that keeps off walls and door frames.
  - Coming from outside, a wave splits over the ways in: the front door, the back door, the kitchen hole, the cellar once it opens, and a breach. That way they close in from several sides. A barricaded door and a queue at it count against a way in, so the first ones claw at the planks and the rest go round. Boomers head for barricades on purpose, and Biters, which can't claw, avoid them.
  - In a crowd they step round each other and queue in doorways. Heavy ones shove light ones aside, and dogs and Biters weave through gaps. A stuck one sidesteps to the roomier side, then feels its way cell by cell, then tries another way in.
  - Taking the stairs doesn't shake them. You still pull them after you while you're on the flight, and they turn round if you come back down.
- **Wall breach** (rare, 1% per round with a Boomer in the wave): one Boomer ignores you and runs for a weak spot in a ground-floor wall (the living room's west wall, the storage room's north wall or the back room's east wall), then blows it in.
  - The wall caves in with a crash, dust, rubble and a "THE WALL IS BREACHED" banner. It stays open for the rest of the game.
  - The infected get a new, favoured way in, and part of every wave spawns on that side. You can board the hole up with a barricade kit.
  - Kill the Boomer before it gets there and the wall holds, unless a later Boomer in the same wave takes over. `__game.breach.force(id?)` arms it for testing.
- **Supply drops**
  - Green box: HP restored.
  - Red box: full ammo, grenades and AP.
  - White box: primary ammo.
- **Between rounds** HP is restored, ammo is restocked and fallen teammates respawn. The **buy phase** follows and nothing opens by itself.
  - The gate to the **gun shop** in the cellar under the back room opens. A HUD waypoint points to the stairs.
  - At the counter, tap **F** to open the shop overlay. It has three tabs (Q / E or 1 / 2 / 3). **WEAPONS** has the guns and their upgrades. **EQUIPMENT** has the consumables: frags, Molotovs, barricade kits, kevlar and the ammo crate. **GEAR** has the wearable items (see Gear below). Arrows pick an item and Enter buys it. Esc, F or Enter (with nothing to buy) closes the shop.
  - On the GEAR tab, the items are grouped by body slot (head, torso, back, belt, hands, feet), and each card shows its slot as an icon. On the right, a **paperdoll** shows your character with all eight slots around it. Each slot box is tied to its body part by a line and shows what you wear there, or a dashed EMPTY outline. Selecting an item lights up its slot, and under the figure are its effects and the BUY / EQUIP / UPGRADE button. Clicking a slot box picks that slot's items, and a worn item lists the other items you own for its slot, one click to swap.
  - **Hold F** for 1.2 s anywhere to ready up. A ring fills around the crosshair, and letting go early cancels it. A 3-second countdown follows (bots are always ready).
  - When the round starts the gate closes, and anyone still in the cellar is moved to the top of the stairs.
  - The mission clock is paused during the buy phase.
- **Money**: every kill by anyone in the fireteam pays every member the same amount (mauler $60, dog $70, biter $75, striker $80, charger $90, crusher $400, +$20 for a headshot), plus a round-clear bonus of $250 + $50 × round. Everyone starts with $500 and spends from an own wallet; bots buy rifle damage upgrades.
- **Store arsenal**
  - Rifles: M4A1, M16A2 (3-round burst, modeled in Blender), R-201 Carbine, X-55 Devotion (LMG whose fire rate winds up), SIGMA-420 (heavy drum-fed LMG, 100 rounds).
  - P90 ($2,000): a bullpup SMG with a 50-round top magazine, 900 rpm and fast handling. It aims over its iron sights, and the reload slides the magazine back out from under the rail.
  - Shotguns: M4 Super 90 (semi-auto), SPAS-12 (pump action).
  - R-6P Softball: a 6-round drum grenade launcher.
  - SA-3 Mozambique: a triple-barrel shotgun pistol that replaces the M9.
  - **Akimbo** (premium, one-time per pistol: M9 $2,500, Mozambique $3,200): a second pistol in the left hand. It shows up among the upgrades once you own the pistol. Owned pairs get a ×2 badge and a crossed-pair preview.
    - Mouse1 fires the right gun and Mouse2 the left one. Each gun has its own semi-auto trigger, cooldown and magazine with your upgrades applied, and the reserve is shared. The HUD shows both mags as `left | right`.
    - There's no aiming down sights. The hip cone is 30% wider (the crosshair shows it) and each round kicks the aim a little less. Damage per shot is unchanged, so the gain is double the fire rate and capacity.
    - One reload does both guns and takes 1.35× as long: both empties drop, then each gun dips onto a fresh mag, right first. Pulling an empty gun's trigger reloads, and so does running both dry.
- **Spent magazines**: when you reload a magazine gun, the empty drops out and clatters to the floor. It lies there for 8 s, then sinks away, with at most 16 on the floor at once.
  - Throwables: M67 frags and Molotovs. A Molotov shatters into a burning pool that sets the Infected on fire.
- **Special weapons**
  - Round 11: L96A1 Black-Magnum (in the basement crate)
  - Round 13: M32 MGL (kitchen table)
  - Round 16: Golden Punisher (upstairs by the bathroom)
  - Round 19: Chain Gun (living room)
- **Barricade kits** ($300 each, carry up to 3, from the gun shop) sit in their own slot (**5**). With the kit out, the free doorways around you show faint plank outlines. Aim at one within 2.5 m and hold **Mouse1**: about 1.2 s of hammering nails six planks across it and uses one kit. Holding it on a damaged barricade repairs it to full.
  - Barricade spots: the front door, the back door, the kitchen wall hole, and the ground-floor interior doors (living room, storage room, storage passage, kitchen, back room and pantry). Once the basement opens, the basement door and the outside cellar door are added. You can't nail up a doorway while someone stands in it.
  - A barricade stops the Infected and the fireteam, but bullets and grenades pass through the gaps. The Infected still path to it (some take another way in), claw at it with their normal attacks and hit anyone standing right behind it. Bots route around barricades.
  - Barricades have 600 HP. Every sixth of that, a plank tears off and clatters to the floor, so you can see how much is left; at 0 the doorway is open again. A mauler takes about 25 s alone, a Crusher about 7 s, and a Boomer that blows up against it takes most of it down. Your own explosives only chip it, and the knife hacks it apart if you need to get through.
  - Barricades last between rounds (Endless too) until they break. Fallen planks are swept away at the end of each round, and a new game starts with bare doorways.
- **The generator** in the basement's south-west corner powers every electric light: the house, basement, stairs, porch, the gun shop's lamps and neon, and the barn's yard floodlights. Moonlight, lightning, fire, muzzle flashes, kerosene lanterns, the lab's emergency circuit and your flashlight don't depend on it.
  - Until the basement opens it just runs. From then on (hard / extreme from round 10, Endless too) it burns fuel and can break down. A small HUD meter under the radar shows the fuel and its status: green running, amber failing or low, red off.
  - **Fuel**: it burns only during combat, not in the buy phase or countdowns. A full tank lasts 8 minutes of fighting, about 3–4 rounds. Below 20% a banner warns you, and on the last fumes the lights surge. When it runs dry it sputters and dies (**OUT OF FUEL**).
  - **Breakdowns**: random, on average once per 5 minutes of combat (about every 2–3 rounds). It never breaks within 60 s of a (re)start or in the first 12 s of a round. It sputters for about 3 s while the lights brown out and flicker, then dies (**THE GENERATOR IS DOWN**). To fix it, walk up to it and **hold F** for 2.5 s: a pipe wrench on a seized nut, then you rip the pull-start and the engine catches. F there doesn't toggle the flashlight.
  - **Gas cans**: two red jerry cans wait upstairs, one in the back bedroom (north-west) and one in the junk room behind the south-east room. They appear when the basement opens and glow and show on the radar. Walk over one to pick it up (carry up to 2, slot **6**). At the generator, with the can out, **hold Mouse1** for 2 s to pour it in. That adds 65% of a tank and restarts a dry engine; a broken one still needs the repair. An emptied can comes back at the spot it was taken from at the start of the round after next.
  - With the power out, a waypoint and a red radar marker lead to the generator. If it's dry and you have no can, they lead to the nearest gas can instead.
  - The lights stutter back on when the engine catches. In a blackout the house is lit only by the moon through the boards, so use the flashlight (**F**).
- **The lab**: once the basement opens, its south wall shows a hazard-striped vault door (keypad, locking wheel, hinges, bolts) and a 4 m pane of armored glass. The glass stops players and bullets; shots only chip it. Behind it, Nadja works at her lab counter on a gallery. She pours between flasks, swirls one and holds it up to the light, pipettes into test tubes, writes on a clipboard, looks into a microscope, types at a monitor, trims a gas valve and stretches. Now and then she glances at whoever stands at the glass, and she flinches when a bullet hits it. Past her railing a big lab hall drops a level and runs under the front yard: vats, a specimen tank, benches, fume hoods and freezers. It is scenery only for now: no way in, and nothing to interact with.
- **The ranch**: the farmhouse stands on a small ranch. A big red **barn** sits north-east of the house, turned 35° so its big doors face the house's east side. The house's east wall, its back door and the barn doors frame a shared **farmyard**. Gravel paths from the kitchen wall hole and from the back door meet on an apron in front of the barn doors, and a track runs from the barn's side door to the windmill. Around the yard: an old rusted tractor, a hay wagon, the power pole, bales and barrels. South-east of the barn is a post-and-rail paddock with a gate, a scarecrow and troughs. Behind the house are a windmill water pump whose wheel turns in the gusts, its stock tank and a chicken coop. The barn's gable floodlights light the yard and are on the generator circuit.
  - **The barn**: gambrel roof of rusty tin, weathered red board-and-batten walls with white trim, a timber frame (posts, tie beams, knee braces, rafters). The big sliding doors stand open at the west end, the east doors are half stuck shut, and a side door opens north. Inside are three horse stalls with feed troughs, a workbench and tool rack, feed sacks, barrels, straw everywhere and hanging work lights.
  - **The hayloft** (upper level, 3.1 m) covers the west third of the barn. It holds hay stacks for cover and a railing along its open edge. The **loft door** over the main doors is a sniping perch over the farmyard and the kitchen wall hole, barred at hip height. A **vertical ladder** at the railing gap is the only way up.
  - The barn is **sheltered and gas-free** on both floors: no toxic fog inside, no rain under its roof, indoor ambience. The yard around it is still gas, so crossing over is a risk (the gas mask helps).
  - **Ladders**: face the ladder and hold **W** (or press **Space**) to grab it. **W** climbs and **S** goes down; looking steeply down turns W into down. Walking off the loft into the railing gap grabs the ladder and climbs down. **C** slides down fast and **Space** jumps off. You step off onto the loft at the top and onto the floor at the bottom. The gun is lowered while you climb, so you can't fire or switch.
  - **The Infected climb too** (the nav grid has a ladder portal between the barn floor and the loft). Maulers, Boomers and Strikers climb at about 1.2 m/s and Biters at about 2 m/s, hand over hand on the rungs. They go one at a time with 1.7 m between them, and never against the traffic; the rest crowd at the foot and wait their turn. One shot off the ladder falls as a ragdoll, and a blast knocks them off. A climbing Infected claws at a survivor on the ladder just above or below it. **Dogs and Crushers can't climb**: they wait at the foot until their target comes down.
  - **Bots** hold their posts in the house and never climb. A bot that respawns up on the loft next to you walks out through the railing gap and drops to the floor.
  - **Lightning strike** (rare event, 2% per round, once per game): at a random moment in the round a bolt comes down on the barn roof. You get a white flash, a crack right overhead, sparks and a **LIGHTNING STRUCK THE BARN** banner.
    - The fire front creeps over the roof and the barn burns through in 20–40 s. The hay in the loft and on the floor catches first and burns hottest, and burning debris drops onto the loft floor.
    - Flames, embers and a smoke column rise from the barn, lit by orange light that flickers through the windows, with a roar and creaking timbers nearby.
    - Burning hay and floor spots hurt anyone standing in them and set the Infected alight, like a Molotov. The loft is no place to be.
    - The barn chars and blackens as the fire passes. After a few minutes the fire burns out, and the barn smoulders, charred, for the rest of the game. A new game restores it.
    - Debug: `__game.barnFire.force()` strikes 2 s into the current round (or early in the next one), and `__game.barnFire.strike()` strikes at once.
- **Toxic gas** hurts you and hides your view outside the house and the barn.
- **Gas mask** ($600, gear, head slot): its filter holds 8 s of clean air, and each upgrade adds 4 s ($400 / $700 / $1,100, up to 20 s).
  - While the filter lasts, the gas does no damage and doesn't make you cough, and the green haze stays out of your eyes. You get a lens vignette and hear your breathing.
  - The filter drains only in the gas and recharges at 0.5 s per second outside it. It refills at every round end.
  - A HUD meter appears near the gas and warns you below 25%.
- **Gear** (the store's GEAR tab) is made of real items. You buy each one once and keep it for the whole match.
  - Each item sits on a **body slot**: head, neck, torso, back, belt, hands, feet or pocket. The slot shows as an icon on the card and as a box on the paperdoll.
  - You can wear only one item per slot. Buying a second item for a taken slot puts it on and takes the other one off.
  - You keep everything you buy. An owned item goes back on for free with **EQUIP**, and the store names the item it replaces.
  - Only worn gear works. Bots don't wear gear, and a new game starts without any.
  - `ONE_PER_SLOT` in `src/game/gear.js` turns the slot rule off, so that everything you own is worn at once.
  - **Gas mask** (head, $600): see above.
  - **Grenadier vest** (torso, $600): carry 2 more frags (6), Molotovs (5) and barricade kits (5). If you take it off, you keep what you carry but can't buy past the normal cap.
  - **Mag-pouch vest** (torso, $1,000): every weapon reloads 15% faster (reload time ×0.85). Its upgrade ($700) makes it 25% (×0.75). This covers shell-by-shell reloads and the akimbo pair too.
  - **Weapon backpack** (back, $2,500): carry a second primary.
    - While you wear it, a primary you buy goes into the backpack instead of replacing your main gun.
    - The weapon's detail panel has a PRIMARY / BACKPACK picker that sets which slot a gun goes into. Picking the other slot for a gun you already carry swaps the two.
    - Press **1** for your primary and **1** again to swap to the backpack gun. The scroll wheel goes primary → backpack gun → pistol. The HUD shows the other primary (with its key) next to the weapon name.
    - A special weapon you pick up goes into an empty backpack instead of replacing your gun.
    - If you take the backpack off (the defibrillator shares the back slot), its gun leaves your loadout but stays owned, with its ammo. It comes back when you wear the backpack again, and you can also equip it in slot 1 from the store.
  - **Defibrillator** (back, $1,500): every revive you take part in is 40% faster (1.8 s instead of 3 s), and the revived one gets up with 40 HP instead of 20.
    - This covers you reviving a bot and a bot reviving you (with your paddles).
    - Bot-to-bot revives and the 15 s revive window don't change.
  - **Tactical gloves** (hands, $800): aiming down sights and drawing weapons are 30% faster (ADS and draw time ×0.7). Your first-person gloves turn coyote tan.
  - **Combat boots** (feet, $600): sprint 15% faster (7.1 → 8.2 m/s). Stairs never slowed you down (you climb at full walking or sprinting speed), so the boots speed up the stairs as well.
  - **Machete** (belt, $500): it replaces the knife in slot 3.
    - It does double the damage (160 slash / 380 heavy, against 80 / 190) and swings faster (0.33 s against 0.42 s, heavy 0.72 s against 0.9 s), with a little more reach.
    - Any hit cuts a Biter down.
    - **Mouse1** is a diagonal slash and **Mouse2** an overhead chop.
- **AI fireteam**: up to 3 bots that hold defensive posts, engage the Infected and respawn each round. A full team is Coach, Ellis and Viper; two bots are Viper and the armored soldier; one bot is Viper.
- **Revives**: whoever goes down (you or a bot) can be revived for **15 s**, once per character per round. After that, or on a second death in the same round, they wait for the round end as before.
  - A pulsing green cross hangs over a downed teammate, visible through walls. A waypoint with the seconds left and a green radar blip lead you there.
  - To revive a bot, **hold F** within 1.5 m of the body for 3 s: you kneel and press down on them. Letting go, moving away or taking damage cancels it. Near a body, F doesn't toggle the flashlight.
  - Bots revive you and each other. When someone is down and the body isn't swarmed (at most one Infected within 4.5 m, none within 2.2 m), the nearest free bot runs over and kneels for 3 s. It gives up if Infected close in or it loses 18 HP, and tries again a moment later. Only one bot revives at a time; the others keep defending. While you're down, the screen shows WAITING FOR REVIVE with a countdown, then which bot is reviving you, and the camera follows your rescuer.
  - A revived character gets up where they fell with 20 HP, the armor they had when they fell, 1.5 s of invulnerability and a kill-feed line. You keep your weapons, ammo and gear. The defibrillator (gear) makes revives 40% faster and brings them back with 40 HP. Revives are counted in the run stats, and the end screen shows each bot's.

## Controls

WASD move · Shift sprint · Space jump · Ctrl/C crouch · Mouse1 fire · Mouse2 aim/scope (akimbo pistols: Mouse1 right gun, Mouse2 left gun) · R reload ·
W / Space at a ladder climb (S down, C slide, Space jump off) · 1–6 / wheel switch (1 again: primary ↔ backpack gun, with the weapon backpack; 4 again: frag ↔ Molotov; 5 = barricade kit, hold Mouse1 at a doorway to nail it up; 6 = gas can, hold Mouse1 at the generator to refuel it; empty slots are skipped) · Q last weapon · G quick throw · E pick up · V (mash) shake off a Biter · F flashlight (buy phase: tap F at the counter to open the gun shop, hold F to ready up; hold F at the broken generator to repair it, hold F at a downed teammate to revive them) · Tab scoreboard · Esc pause / close the shop

## Code map

- `src/core`
  - `renderer.js`: the post-processing stack and the viewmodel layer pass.
  - `fogShader.js`: global toxic fog that only builds up outside the buildings (a short list of "inside" rects, axis-aligned or oriented: the house and the turned barn, one slab test each).
  - `audio.js`: synthesized, spatialized sound.
- `src/world`
  - `level.js`: the farmhouse layout.
  - `ranch.js`, `barn.js`, `ranchLayout.js`, `ranchProps.js`: the ranch. `ranch.js` builds the yard (gravel path ribbons, paddock, windmill, coop, tractor, wagon), keeps trees and zombie spawns off the ranch, and turns the windmill. `barn.js` builds the barn: walls, gambrel roof, timber frame, loft, stalls, ladder, doors, props and lamps, plus the ladder nav portal. `ranchLayout.js` holds the shared coordinates: the barn is built in its own local frame (x 21..35, z -8..4) and placed by `BARN_XF` (35°, centre at world (26.5, -11.5)), with helpers `barnToWorld` / `worldToBarn` / `inBarn`, the world ladder definition, and the oriented rects for fog and rain plus the gas, spawn and tree-clearing tests. Its colliders are oriented boxes: `collision.js addOBB()` stores a chain of AABB pieces for the grid, the nav rasterizer and ragdolls, while movement, ground and ceiling queries and raycasts test the exact oriented box. Walls slide smoothly, and bullets and decals hit the real wall face. `ranchProps.js` holds the procedural ranch props, registered into `props.js` through `registerProp`.
  - `barnFire.js`: the lightning-strike barn fire event (`BARN_FIRE` tuning).
  - `levelBuilder.js`: static batching and baked grime.
  - `lighting.js`: pooled shadow-casting lamps, light cones, lightning.
  - `weather.js`: rain, storm sky and fog banks.
  - `power.js`: the generator circuit and its state. It covers fuel, faults, repair and refuelling, the mains level with its brown-out and restore flicker, and `registerPowered()` for anything else on the circuit. `generator.js` has its moving parts (gauges, status lamps, pull-start, fuse panel with breaker, cables and conduit, engine shake and exhaust), and `gasCans.js` the jerry can spots upstairs. Any `level.lamps` entry is on the circuit unless it has `mains: false`.
  - `lab.js`: the lab behind the basement's south wall. It builds the vault door, the armored window (glass colliders tagged `labGlass`) and the lab itself. The static interior is merged per material, with light from virtual ceiling panels baked into a vertex attribute that the materials add as emission; one pooled spot (`fx: false`, aimed away from the glass) lights the counter. It's drawn and animated only while the camera is in the basement. It lies inside the yard's mud slab, which gets a hole and a matching cap, and the fog shader exempts it (`labRect`).
  - `barricades.js`: the store barricades. It handles the ghost preview and nailing, the planks, colliders and loose debris, the Infected clawing at them, blast and knife damage, and the nav costs (the Infected pay extra to go through, the bots' fields are closed off). The spots are `barricadeSpots` in `level.js`, plus a wall breach once one opens (`addSpot`).
  - `breach.js`: the rare wall breach. It covers the hideable wall patches and the caved-in look (broken masonry, rubble, collidable rubble steps outside), the sapper Boomer, the nav refresh, the new entrance and the spawn bias. The spots are `breachSpots` in `level.js`, and `BREACH.chance` sets the odds.
  - Also procedural textures, props and the collision world.
- `src/nav`
  - `navgrid.js`: a multi-level grid with stair portals (and ladders via `addPortal`). Its costs are 8-connected with no corner cutting, plus a clearance cost next to obstacles. Flow fields label each cell with the survivor they lead to. `steer()` string-pulls to the farthest cell in a clear walkable line. `lineClear()` tests a walkable straight line, and `refreshRect()` re-rasterizes after the level changes.
  - `horde.js`: crowd-level decisions. It picks each zombie's entrance route (weighing path, personal bias, load and barricades), keeps count of attackers per survivor, and builds the entrance route fields.
- `src/actors`
  - `rig.js`: skinned procedural humanoids and the `createCharacter` factory.
  - `gltfCharacter.js`: rigged GLB bodies (L4D2 Coach, Ellis and Boomer, the Scorpion soldier, Viper, the UniRig zombie in the Smoker slot, the zombie woman and the gas-mask zombie among the Maulers, the Biter kid and the mutant dog). A proxy skeleton with `rig.js` bone names is retargeted onto the model's joints, so one set of procedural animation drives both kinds of body. Valve and Mixamo joints are matched by name. Other skeletons, such as UniRig's `Bone_NNN`, are matched by hierarchy and joint position. Hit volumes are measured from the skinned mesh. If a GLB is missing, the procedural body is used instead.
  - `zombie.js`: the Infected AI, animation and hit volumes. The chase covers target choice, direct pursuit with an intercept, entrance routes, stairs, stuck recovery, wall and crowd avoidance, and doorway queueing (see the header).
  - `ladders.js`: ladder climbing for the player (grab, climb, step off) and the Infected (portal mount, queueing, climbing pose on the proxy bones, dismount, the ragdoll drop).
  - `biter.js`: the Biter, a `Zombie` subclass. It covers the skittering chase, the pounce, the latch, the shake-off and the stun, and has its own procedural poses.
  - `dogAnim.js`: procedural quadruped animation for the dog (trot and gallop, pounce, bite, death roll).
  - `jiggle.js`: spring-driven secondary motion for Viper's chest. `gltfCharacter.js` re-skins that region to two added bones.
  - `teammate.js`: the fireteam bots, including rifle aiming, two-bone arm IK and team lineups.
  - `shopkeeper.js` / `labTech.js`: the gun shop clerk and Nadja in the lab, GLB characters animated by idle state machines (pose crossfades, arm and leg IK, breathing, look-at). Nadja also sidesteps between three spots along her counter, and holds props in her hand while she works with them.
- `src/player`
  - Controller, weapon logic (auto / semi / burst / bolt / pump / throwables) and viewmodel animation.
  - `gunModels.js`: the procedural guns and the shared gun materials.
  - `gltfGuns.js`: GLB weapons that follow the Blender contract (see Assets). Blender-built guns get the procedural materials plus baked wear and AO; imported guns keep their textures.
  - `gltfArms.js`: the first-person gloved arms. A skinned GLB, mirrored for the left side, driven by two-bone IK with the wrist roll shared out down a forearm twist bone and grip-driven finger curl.
  - `gunSafe.js`: picks the GLB or the procedural model and falls back gracefully.
  - `akimbo.js`: the akimbo pistol rules (derived def, both triggers, the pair reload). `akimboRig.js` adds the left gun to the viewmodel, a mirrored second instance that the mirrored left arm grips like the right one, with its own recoil, flash, shells and reload timing.
  - `gasCan.js`: the jerry can (world pickup and viewmodel) and the generator repair tools (pipe wrench, pull-start handle).
  - `barricadeKit.js`: the barricade kit viewmodel (a claw hammer and a tied bundle of planks) and the plank geometry that the world barricades share.
- `src/tools/viewer.js` (`/viewer.html`): the real viewmodel in a lit room. It covers every weapon, ADS, fire/reload/pump animations and a freeze-and-orbit mode for inspecting the hands.
- `src/fx`: particles, decals, impacts, blood, explosions, casings and tracers. `magDrops.js` handles the player's dropped magazines: pooled world clones of the viewmodel mag that take over at the same spot on screen, then fall, bounce, settle flat and sink away. `latchView.js` is the first-person view with a Biter on your back: its GLB clawing in at the screen corners (arm IK on the viewmodel layer), a bite vignette and the shake-off prompt.
- `src/game/gear.js`: the wearable gear. It covers body slots, owned vs worn, and the effect hooks: `sprintMul`, `reloadMul`, `handlingMul`, `carryBonus`, `defibFor`, and `gearDef()`, which puts the worn gear onto the held weapon's def. It also switches the backpack slot and the melee weapon. The store entries are in `shop.js`, the product models in `src/world/gearModels.js`, the store pieces (slot icons, details) in `src/ui/storeGear.js` and the paperdoll in `src/ui/storeDoll.js`. The paperdoll's figure is the Scorpion body, rendered once through `src/actors/portraits.js`. `src/player/machete.js` is the machete's procedural viewmodel and its swing poses, built with `gunModels.js`' kit.
- `src/game/revive.js`: revives. It covers the downed window and markers, the player's revive channel, the bots' revive runs (a `Teammate.update` hook), and the `reviveTime` / `reviveHp` tuning hooks the defibrillator plugs into.
- `src/game`: round and wave logic, scoring, projectiles and pickups. `modes.js` holds the game modes and difficulties that the menu briefing and the game share. `economy.js` holds the wallets and rewards, and `shop.js` the data-driven store catalog, upgrade math and purchases.
- `src/ui`: the Combat Arms-style HUD, the menus (`menu.js`, and `menu.css` for the cinematic main menu), the menu music (`music.js`) and the between-round store (`store.js`, `store.css`).

## Assets

GLB sources live in `assets/source/` and are not served (nor committed: the original downloads and intermediate `*_raw.glb` exports add up to ~400 MB; the optimized files in `public/models/` are). `node tools/optimize-assets.mjs [filter]` turns them into web-ready files in `public/models/`, using glTF-Transform (a dev dependency). It converts spec/gloss materials to metal/rough, resizes textures and re-encodes them as WebP, prunes unused data (keeping marker empties) and applies meshopt compression to everything except the skinned arms. `src/core/assetList.js` lists every model; they are preloaded during loading.

UniRig auto-rigs tend to bleed hand and forearm weights onto the thighs, and sometimes hip weights onto the hands, wherever the two touch in the rest pose. `node tools/fix-viper-weights.mjs --model <name> [--dry] [--out file]` repairs that. It tells arm from leg by surface distance from the hands and the knees, strips the wrong influences and blends them back in from the neighbouring vertices. It keeps the untouched file as `<name>_orig.glb`. It has been applied to Viper, the Smoker and Crusher bodies, the gas-mask zombie, the zombie woman, the Biter, the Striker and Nadja. The walk runs per hand, so a hand modeled as its own mesh island (Nadja's left) is reached through its own sleeve.

`characters/nadja.glb` is the lab tech. It comes from a 2.2M-triangle scan that has no skeleton: the scan is simplified to 100k triangles with meshoptimizer (`gltf-transform weld` + `simplify`, which keeps UV seams intact), scaled to the old rigged Nadja (1.7 m, same A-pose), and put on that model's UniRig skeleton. Each vertex takes the old skin weights, interpolated from the nearest point on the old surface, and the result goes through the weight fix above (`assets/source/nadja.glb`; the first rigged version is kept as `nadja_v1.glb`).

The Blender pipeline in `tools/blender/` is plain Python, run inside Blender (for example through the Blender MCP):

- `gunkit.py` holds the hard-surface helpers: profiles, lathe/loft/prism, booleans, bevels with wear marking, weighted normals, an AO bake into a `wear_ao` vertex color, and GLB export.
- `m16a2.py` builds the M16A2 (about 68k tris, 45 parts). `k = m16a2.build(); k.finish(); k.export('assets/source/m16a2_raw.glb')`.
- `import_weapon.py` and `weapons_import.py` normalize third-party weapon GLBs:
  - They bake skinning, scale to meters and point the muzzle along +Y.
  - They split animated parts (magazine, pump, bolt, drum).
  - Dense AI scans (the SIGMA-420, the P90) are collapse-decimated first, and a part is cut out by region when the mesh is one piece. `decimate(..., keep_normals=True)` projects the dense mesh's normals back onto the result, so flat panels don't dent.
  - They add markers.
- `arms.py` builds the gloved first-person arm: palm, fingers and thumb are voxel-remeshed into one surface, with a molded knuckle guard, finger plates, wrist strap and sleeve. It uses a 19-bone skeleton with procedural weights.

The weapon contract, in Blender space (+Y muzzle, +Z up, meters): a root empty holds meshes (one material each), `prefix_<part>` empties for animated parts, and `prefix_<marker>` empties for `web` (grip origin), `muzzle`, `ejectPort`, `rightHand`, `leftHand`, `rearSight`, and optionally `loadPort` and `rag`. Hand orientation, grip sizes and eye distance are set per weapon in `src/player/gltfGuns.js`.

The ranch (barn, tractor, windmill, wagon, fences, coop, scarecrow, bales and the rest) is fully procedural: `src/world/barn.js`, `ranch.js` and `ranchProps.js` build it in code, and `textures.js` synthesizes its barn siding, bare plank, tin roof, straw and gravel textures. It downloads nothing and needs no third-party licences.

The L4D2, Titanfall 2, SPAS-12 and Meshy models were supplied by the owner. They are fine for a private project, but check their licences before publishing the game.

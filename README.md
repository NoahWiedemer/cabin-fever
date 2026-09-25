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
| Easy | 10 | 30:00 | — |
| Hard | 15 | 45:00 | Basement opens at round 10 (interior stairs + outside cellar) |
| Extreme | 20 | 60:00 | Basement at 10, upstairs at 16 |

**Endless** has no extraction, no time limit and no victory, so the run ends when the fireteam is wiped. The end screen shows the round you reached.
- Difficulty still sets the horde's health, damage, count and speed.
- The basement opens at round 10 and the upstairs at 16 on every difficulty. The special weapons appear on their usual rounds.
- Past round 20, zombie health keeps climbing, but wave size grows more slowly. Striker share, crusher count and speed are capped.
- Every fifth round after 20 gets a "The horde grows stronger" banner. The HUD shows the round as `07/∞`.

- **Infected**
  - **Mauler**: the standard infected (some of them are Smokers).
  - **Boomer**: bloated. It explodes when it reaches you or dies, and shooting its gut sets it off.
  - **Mutant Dog**: from round 3. Dogs arrive in packs of 2 or 3. They are fast, pounce, and bite.
  - **Striker**: female, in a white suit, from round 5. It is fast, leaps, and drops 3 shells that explode when it dies.
  - **Crusher**: a huge blue tank, from round 11. Its death leaves a blue acid cloud.
- **Supply drops**
  - Green box: HP restored.
  - Red box: full ammo, grenades and AP.
  - White box: primary ammo.
- **Between rounds** HP is restored, ammo is restocked and fallen teammates respawn. The **buy phase** follows and nothing opens by itself.
  - The gate to the **gun shop** in the cellar under the back room opens. A HUD waypoint points to the stairs.
  - At the counter, tap **F** to open the shop overlay: weapons, upgrades, frags, Molotovs, kevlar, the ammo crate and the gas mask. Esc, F or Enter closes it.
  - **Hold F** for 1.2 s anywhere to ready up. A ring fills around the crosshair, and letting go early cancels it. A 3-second countdown follows (bots are always ready).
  - When the round starts the gate closes, and anyone still in the cellar is moved to the top of the stairs.
  - The mission clock is paused during the buy phase.
- **Money**: every kill by anyone in the fireteam pays every member the same amount (mauler $60, striker $80, charger $90, crusher $400, +$20 for a headshot), plus a round-clear bonus of $250 + $50 × round. Everyone starts with $500 and spends from an own wallet; bots buy rifle damage upgrades.
- **Store arsenal**
  - Rifles: M4A1, M16A2 (3-round burst, modeled in Blender), R-201 Carbine, X-55 Devotion (LMG whose fire rate winds up), SIGMA-420 (heavy drum-fed LMG, 100 rounds).
  - Shotguns: M4 Super 90 (semi-auto), SPAS-12 (pump action).
  - R-6P Softball: a 6-round drum grenade launcher.
  - SA-3 Mozambique: a triple-barrel shotgun pistol that replaces the M9.
  - Throwables: M67 frags and Molotovs. A Molotov shatters into a burning pool that sets the Infected on fire.
- **Special weapons**
  - Round 11: L96A1 Black-Magnum (in the basement crate)
  - Round 13: M32 MGL (kitchen table)
  - Round 16: Golden Punisher (upstairs by the bathroom)
  - Round 19: Chain Gun (living room)
- **Toxic gas** hurts you and hides your view outside the house.
- **Gas mask** ($600, from the gun shop): its filter holds 8 s of clean air, and each upgrade adds 4 s ($400 / $700 / $1,100, up to 20 s).
  - While the filter lasts, the gas does no damage and doesn't make you cough, and the green haze stays out of your eyes. You get a lens vignette and hear your breathing.
  - The filter drains only in the gas and recharges at 0.5 s per second outside it. It refills at every round end.
  - A HUD meter appears near the gas and warns you below 25%.
- **AI fireteam**: up to 3 bots that hold defensive posts, engage the Infected and respawn each round. A full team is Coach, Ellis and Viper; two bots are Viper and the armored soldier; one bot is Viper.

## Controls

WASD move · Shift sprint · Space jump · Ctrl/C crouch · Mouse1 fire · Mouse2 aim/scope · R reload ·
1–4 / wheel switch (4 again: frag ↔ Molotov) · Q last weapon · G quick throw · E pick up · F flashlight (buy phase: tap F at the counter to open the gun shop, hold F to ready up) · Tab scoreboard · Esc pause / close the shop

## Code map

- `src/core`
  - `renderer.js`: the post-processing stack and the viewmodel layer pass.
  - `fogShader.js`: global toxic fog that only builds up outside the house.
  - `audio.js`: synthesized, spatialized sound.
- `src/world`
  - `level.js`: the farmhouse layout.
  - `levelBuilder.js`: static batching and baked grime.
  - `lighting.js`: pooled shadow-casting lamps, light cones, lightning.
  - `weather.js`: rain, storm sky and fog banks.
  - Also procedural textures, props and the collision world.
- `src/nav`: a multi-level grid with stair portals, plus flow fields for the horde.
- `src/actors`
  - `rig.js`: skinned procedural humanoids and the `createCharacter` factory.
  - `gltfCharacter.js`: rigged GLB bodies (L4D2 Coach, Ellis, Smoker, Boomer, the Meshy soldier, Viper and the mutant dog). A proxy skeleton with `rig.js` bone names is retargeted onto the model's joints, so one set of procedural animation drives both kinds of body. Valve and Mixamo joints are matched by name. Other skeletons, such as UniRig's `Bone_NNN`, are matched by hierarchy and joint position. Hit volumes are measured from the skinned mesh. If a GLB is missing, the procedural body is used instead.
  - `zombie.js`: the Infected AI, animation and hit volumes.
  - `dogAnim.js`: procedural quadruped animation for the dog (trot and gallop, pounce, bite, death roll).
  - `jiggle.js`: spring-driven secondary motion for Viper's chest. `gltfCharacter.js` re-skins that region to two added bones.
  - `teammate.js`: the fireteam bots, including rifle aiming, two-bone arm IK and team lineups.
- `src/player`
  - Controller, weapon logic (auto / semi / burst / bolt / pump / throwables) and viewmodel animation.
  - `gunModels.js`: the procedural guns and the shared gun materials.
  - `gltfGuns.js`: GLB weapons that follow the Blender contract (see Assets). Blender-built guns get the procedural materials plus baked wear and AO; imported guns keep their textures.
  - `gltfArms.js`: the first-person gloved arms. A skinned GLB, mirrored for the left side, driven by two-bone IK with the wrist roll shared out down a forearm twist bone and grip-driven finger curl.
  - `gunSafe.js`: picks the GLB or the procedural model and falls back gracefully.
- `src/tools/viewer.js` (`/viewer.html`): the real viewmodel in a lit room. It covers every weapon, ADS, fire/reload/pump animations and a freeze-and-orbit mode for inspecting the hands.
- `src/fx`: particles, decals, impacts, blood, explosions, casings and tracers.
- `src/game`: round and wave logic, scoring, projectiles and pickups. `modes.js` holds the game modes and difficulties that the menu briefing and the game share. `economy.js` holds the wallets and rewards, and `shop.js` the data-driven store catalog, upgrade math and purchases.
- `src/ui`: the Combat Arms-style HUD, the menus (`menu.js`, and `menu.css` for the cinematic main menu), the menu music (`music.js`) and the between-round store (`store.js`, `store.css`).

## Assets

GLB sources live in `assets/source/` and are not served (nor committed: the original downloads and intermediate `*_raw.glb` exports add up to ~400 MB; the optimized files in `public/models/` are). `node tools/optimize-assets.mjs [filter]` turns them into web-ready files in `public/models/`, using glTF-Transform (a dev dependency). It converts spec/gloss materials to metal/rough, resizes textures and re-encodes them as WebP, prunes unused data (keeping marker empties) and applies meshopt compression to everything except the skinned arms. `src/core/assetList.js` lists every model; they are preloaded during loading.

The Blender pipeline in `tools/blender/` is plain Python, run inside Blender (for example through the Blender MCP):

- `gunkit.py` holds the hard-surface helpers: profiles, lathe/loft/prism, booleans, bevels with wear marking, weighted normals, an AO bake into a `wear_ao` vertex color, and GLB export.
- `m16a2.py` builds the M16A2 (about 68k tris, 45 parts). `k = m16a2.build(); k.finish(); k.export('assets/source/m16a2_raw.glb')`.
- `import_weapon.py` and `weapons_import.py` normalize third-party weapon GLBs:
  - They bake skinning, scale to meters and point the muzzle along +Y.
  - They split animated parts (magazine, pump, bolt, drum).
  - Dense AI scans (the SIGMA-420) are collapse-decimated first, and a part is cut out by region when the mesh is one piece.
  - They add markers.
- `arms.py` builds the gloved first-person arm: palm, fingers and thumb are voxel-remeshed into one surface, with a molded knuckle guard, finger plates, wrist strap and sleeve. It uses a 19-bone skeleton with procedural weights.

The weapon contract, in Blender space (+Y muzzle, +Z up, meters): a root empty holds meshes (one material each), `prefix_<part>` empties for animated parts, and `prefix_<marker>` empties for `web` (grip origin), `muzzle`, `ejectPort`, `rightHand`, `leftHand`, `rearSight`, and optionally `loadPort` and `rag`. Hand orientation, grip sizes and eye distance are set per weapon in `src/player/gltfGuns.js`.

The L4D2, Titanfall 2, SPAS-12 and Meshy models were supplied by the owner. They are fine for a private project, but check their licences before publishing the game.

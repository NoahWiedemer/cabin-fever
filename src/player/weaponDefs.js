// Weapon definitions (tuned for Fireteam survival: fast TTK on heads, meaningful recoil).
// spread*: full cone in degrees (spreadPerShot = bloom per round, recovers ~0.2 s after you ease off).
// recoilV / recoilH: aim kick per round in degrees (V up, H random left/right); nothing recovers while
//   the gun keeps firing, then recoilRecover x2.5 (1/s) springs 3/4 of it back. kick: viewmodel +
//   camera punch strength. shake: optional screen-shake trauma per round (heavy hitters).
export const WEAPONS = {
  m4a1: {
    id: 'm4a1', name: 'M4A1', slot: 0, model: 'm4a1', mode: 'auto', rpm: 780,
    damage: 36, pellets: 1, penetration: 1, falloff: [35, 90, 0.65],
    spreadHip: 1.6, spreadAds: 0.1, spreadMove: 1.4, spreadAir: 3, spreadPerShot: 0.3, spreadMax: 2.4,
    recoilV: 0.36, recoilH: 0.14, recoilRecover: 7, kick: 1,
    mag: 30, reserve: 180, maxReserve: 300, reload: 2.1, reloadEmpty: 2.55, reloadType: 'mag',
    adsZoom: 1.3, adsTime: 0.16, sound: 'm4_fire', shell: 'rifle', tracerEvery: 2, moveMul: 1.0,
    hip: [0.19, -0.2, -0.18], hipRot: [0.02, 0.08, 0.04], ammoKind: 'rifle', drawTime: 0.36,
  },
  m16a2: {
    id: 'm16a2', name: 'M16A2', slot: 0, model: 'm16a2', mode: 'burst', burst: 3, burstDelay: 0.22, rpm: 900,
    damage: 44, pellets: 1, penetration: 1, falloff: [45, 110, 0.7],
    spreadHip: 1.4, spreadAds: 0.07, spreadMove: 1.3, spreadAir: 3, spreadPerShot: 0.28, spreadMax: 2.2,
    recoilV: 0.34, recoilH: 0.1, recoilRecover: 7.5, kick: 0.95,
    mag: 30, reserve: 180, maxReserve: 300, reload: 2.2, reloadEmpty: 2.65, reloadType: 'mag',
    adsZoom: 1.35, adsTime: 0.17, sound: 'm4_fire', shell: 'rifle', tracerEvery: 3, moveMul: 0.98,
    hip: [0.19, -0.2, -0.16], hipRot: [0.02, 0.08, 0.04], ammoKind: 'rifle', drawTime: 0.4,
  },
  r201: {
    id: 'r201', name: 'R-201 CARBINE', slot: 0, model: 'r201', mode: 'auto', rpm: 810,
    damage: 38, pellets: 1, penetration: 1, falloff: [40, 100, 0.65],
    spreadHip: 1.35, spreadAds: 0.09, spreadMove: 1.2, spreadAir: 3, spreadPerShot: 0.26, spreadMax: 2.2,
    recoilV: 0.3, recoilH: 0.13, recoilRecover: 8, kick: 0.9,
    mag: 30, reserve: 210, maxReserve: 330, reload: 1.9, reloadEmpty: 2.4, reloadType: 'mag',
    adsZoom: 1.35, adsTime: 0.15, sound: 'm4_fire', shell: 'rifle', tracerEvery: 2, moveMul: 1.0,
    hip: [0.2, -0.21, -0.16], hipRot: [0.02, 0.08, 0.04], ammoKind: 'rifle', drawTime: 0.36,
  },
  spas12: {
    id: 'spas12', name: 'SPAS-12', slot: 0, model: 'spas12', mode: 'pump', rpm: 95, boltTime: 0.55, cycleAt: 0.14, cycleSound: 'shotgun_pump',
    damage: 30, pellets: 9, penetration: 0, falloff: [9, 32, 0.35],
    spreadHip: 4.0, spreadAds: 2.4, spreadMove: 1.0, spreadAir: 2, spreadPerShot: 0.6, spreadMax: 1.2,
    recoilV: 2.6, recoilH: 0.6, recoilRecover: 6, kick: 2.5, shake: 0.2,
    mag: 8, reserve: 40, maxReserve: 64, reloadType: 'shell', reloadStart: 0.3, shellTime: 0.42, reloadEnd: 0.45,
    adsZoom: 1.15, adsTime: 0.19, sound: 'shotgun_fire', shell: 'shotgun', tracerEvery: 0, moveMul: 0.96,
    hip: [0.19, -0.2, -0.14], hipRot: [0.02, 0.08, 0.05], ammoKind: 'shotgun', drawTime: 0.42,
  },
  devotion: {
    // fire rate winds up from rpm to rampRpm over rampShots of continuous fire
    id: 'devotion', name: 'X-55 DEVOTION', slot: 0, model: 'devotion', mode: 'auto', rpm: 480, rampRpm: 960, rampShots: 14,
    damage: 34, pellets: 1, penetration: 2, falloff: [45, 110, 0.7],
    spreadHip: 1.9, spreadAds: 0.2, spreadMove: 1.5, spreadAir: 3.5, spreadPerShot: 0.14, spreadMax: 2.4,
    recoilV: 0.26, recoilH: 0.16, recoilRecover: 7, kick: 0.8, shake: 0.05,
    mag: 80, reserve: 240, maxReserve: 400, reload: 3.4, reloadEmpty: 3.9, reloadType: 'mag',
    adsZoom: 1.3, adsTime: 0.23, sound: 'm4_fire', shell: 'rifle', tracerEvery: 2, moveMul: 0.86,
    hip: [0.2, -0.21, -0.17], hipRot: [0.02, 0.07, 0.04], ammoKind: 'rifle', drawTime: 0.55,
  },
  sigma: {
    // heavy drum-fed LMG: hits harder and punches through more than the rifles, slow to handle
    id: 'sigma', name: 'SIGMA-420', slot: 0, model: 'sigma', mode: 'auto', rpm: 750,
    damage: 42, pellets: 1, penetration: 3, falloff: [50, 120, 0.72],
    spreadHip: 2.2, spreadAds: 0.2, spreadMove: 1.7, spreadAir: 3.8, spreadPerShot: 0.16, spreadMax: 2.6,
    recoilV: 0.3, recoilH: 0.15, recoilRecover: 6, kick: 1.1, shake: 0.06,
    mag: 100, reserve: 200, maxReserve: 400, reload: 4.2, reloadEmpty: 4.8, reloadType: 'mag',
    adsZoom: 1.3, adsTime: 0.24, sound: 'lmg_fire', shell: 'rifle', tracerEvery: 2, moveMul: 0.84,
    hip: [0.2, -0.245, -0.2], hipRot: [0.02, 0.07, 0.04], ammoKind: 'rifle', drawTime: 0.6,
  },
  softball: {
    id: 'softball', name: 'R-6P SOFTBALL', slot: 0, model: 'softball', mode: 'semi', rpm: 170, cylStep: Math.PI / 3,
    projectile: 'grenade40', damage: 260, radius: 4.8, velocity: 40, pellets: 1, penetration: 0,
    spreadHip: 0.8, spreadAds: 0.15, spreadMove: 0.7, spreadAir: 1.2, spreadPerShot: 0.5, spreadMax: 1,
    recoilV: 2.2, recoilH: 0.4, recoilRecover: 5.5, kick: 1.8, shake: 0.18,
    mag: 6, reserve: 18, maxReserve: 30, reload: 2.6, reloadEmpty: 2.6, reloadType: 'mag',
    adsZoom: 1.25, adsTime: 0.19, sound: 'm32_fire', shell: 'grenade40', tracerEvery: 0, moveMul: 0.92,
    hip: [0.18, -0.19, -0.23], hipRot: [0.02, 0.07, 0.04], ammoKind: 'explosive', drawTime: 0.48, noEject: true,
  },
  mozambique: {
    id: 'mozambique', name: 'SA-3 MOZAMBIQUE', slot: 1, model: 'mozambique', mode: 'semi', rpm: 280,
    damage: 34, pellets: 3, penetration: 0, falloff: [10, 30, 0.45],
    spreadHip: 2.2, spreadAds: 1.1, spreadMove: 1.0, spreadAir: 2.5, spreadPerShot: 0.6, spreadMax: 2.0,
    recoilV: 1.5, recoilH: 0.45, recoilRecover: 8, kick: 1.5, shake: 0.1,
    mag: 6, reserve: 36, maxReserve: 60, reload: 1.8, reloadEmpty: 2.1, reloadType: 'mag',
    adsZoom: 1.2, adsTime: 0.14, sound: 'shotgun_fire', shell: 'shotgun', tracerEvery: 0, moveMul: 1.05,
    hip: [0.13, -0.15, -0.32], hipRot: [0, 0.06, 0], ammoKind: 'shotgun', drawTime: 0.3,
  },
  m4super90: {
    id: 'm4super90', name: 'M4 SUPER 90', slot: 0, model: 'm4super90', mode: 'semi', rpm: 300,
    damage: 21, pellets: 9, penetration: 0, falloff: [8, 30, 0.35],
    spreadHip: 4.2, spreadAds: 2.8, spreadMove: 1.0, spreadAir: 2, spreadPerShot: 0.5, spreadMax: 1.5,
    recoilV: 2.2, recoilH: 0.6, recoilRecover: 6, kick: 2.2, shake: 0.16,
    mag: 7, reserve: 42, maxReserve: 70, reloadType: 'shell', reloadStart: 0.35, shellTime: 0.46, reloadEnd: 0.35,
    adsZoom: 1.15, adsTime: 0.19, sound: 'shotgun_fire', shell: 'shotgun', tracerEvery: 0, moveMul: 0.97,
    hip: [0.19, -0.2, -0.12], hipRot: [0.02, 0.08, 0.05], ammoKind: 'shotgun', drawTime: 0.42,
  },
  l96a1: {
    id: 'l96a1', name: 'L96A1 BLACK-MAGNUM', slot: 0, model: 'l96a1', mode: 'bolt', rpm: 60, boltTime: 1.05,
    damage: 420, pellets: 1, penetration: 4, falloff: [200, 300, 1],
    spreadHip: 4.5, spreadAds: 0.0, spreadMove: 3, spreadAir: 6, spreadPerShot: 0, spreadMax: 6,
    recoilV: 3.4, recoilH: 0.5, recoilRecover: 5, kick: 2.6, shake: 0.2,
    mag: 6, reserve: 18, maxReserve: 30, reload: 3.1, reloadEmpty: 3.1, reloadType: 'mag',
    adsZoom: 4.5, scope: true, adsTime: 0.25, sound: 'sniper_fire', shell: 'sniper', tracerEvery: 1, moveMul: 0.92,
    hip: [0.2, -0.2, -0.1], hipRot: [0.02, 0.07, 0.04], ammoKind: 'sniper', drawTime: 0.5, special: true,
  },
  m9: {
    id: 'm9', name: 'M9', slot: 1, model: 'm9', mode: 'semi', rpm: 480,
    damage: 34, pellets: 1, penetration: 0, falloff: [20, 60, 0.6],
    spreadHip: 1.2, spreadAds: 0.3, spreadMove: 1.0, spreadAir: 2.5, spreadPerShot: 0.55, spreadMax: 2.4,
    recoilV: 0.9, recoilH: 0.25, recoilRecover: 9, kick: 1.2,
    mag: 15, reserve: 90, maxReserve: 120, reload: 1.55, reloadEmpty: 1.8, reloadType: 'mag',
    adsZoom: 1.2, adsTime: 0.13, sound: 'pistol_fire', shell: 'pistol', tracerEvery: 0, moveMul: 1.05,
    hip: [0.13, -0.15, -0.34], hipRot: [0, 0.06, 0], ammoKind: 'pistol', drawTime: 0.28,
  },
  knife: {
    id: 'knife', name: 'KNIFE', slot: 2, model: 'knife', mode: 'melee',
    damage: 80, heavyDamage: 190, range: 1.9, heavyRange: 1.7, swingTime: 0.42, heavyTime: 0.9,
    moveMul: 1.1, hip: [0.15, -0.15, -0.35], hipRot: [0.35, 0.45, -0.5], drawTime: 0.25,
  },
  m67: {
    id: 'm67', name: 'M67 FRAG', slot: 3, model: 'm67', mode: 'grenade',
    damage: 360, radius: 7.5, fuse: 3.0, throwSpeed: 15, moveMul: 1.05, hip: [0.15, -0.14, -0.33], hipRot: [0.25, 0.2, -0.2], drawTime: 0.3,
  },
  molotov: {
    // damage = burn damage per second inside the flames; burning infected keep taking a third of it
    id: 'molotov', name: 'MOLOTOV', slot: 3, model: 'molotov', mode: 'grenade',
    damage: 55, radius: 3.0, fireTime: 7, throwSpeed: 13.5, moveMul: 1.05,
    hip: [0.15, -0.3, -0.44], hipRot: [-0.4, 0.25, -0.12], drawTime: 0.3,
  },
  barricade: {
    // store kit, slot 5 (world/barricades.js): hold fire at a doorway to nail planks across it
    id: 'barricade', name: 'BARRICADE KIT', slot: 4, model: 'barricade', mode: 'build', moveMul: 1.0,
    hip: [0.17, -0.18, -0.4], hipRot: [0.04, 0.06, 0], drawTime: 0.35,
  },
  m32: {
    id: 'm32', name: 'M32 MGL', slot: 0, model: 'm32', mode: 'semi', rpm: 150,
    projectile: 'grenade40', damage: 330, radius: 5.5, velocity: 46, pellets: 1, penetration: 0,
    spreadHip: 0.6, spreadAds: 0.1, spreadMove: 0.6, spreadAir: 1, spreadPerShot: 0.5, spreadMax: 1,
    recoilV: 2.8, recoilH: 0.4, recoilRecover: 5, kick: 2.2, shake: 0.22,
    mag: 6, reserve: 18, maxReserve: 24, reloadType: 'shell', reloadStart: 0.5, shellTime: 0.55, reloadEnd: 0.45,
    adsZoom: 1.3, adsTime: 0.2, sound: 'm32_fire', shell: 'grenade40', tracerEvery: 0, moveMul: 0.9,
    hip: [0.19, -0.22, -0.15], hipRot: [0.02, 0.07, 0.04], ammoKind: 'explosive', drawTime: 0.5, special: true, noEject: true,
  },
  goldenPunisher: {
    id: 'goldenPunisher', name: 'GOLDEN PUNISHER', slot: 0, model: 'goldenPunisher', mode: 'auto', rpm: 400,
    damage: 26, pellets: 10, penetration: 0, falloff: [10, 34, 0.4],
    spreadHip: 3.6, spreadAds: 2.6, spreadMove: 0.8, spreadAir: 2, spreadPerShot: 0.35, spreadMax: 1.6,
    recoilV: 1.7, recoilH: 0.55, recoilRecover: 6, kick: 1.9, shake: 0.12,
    mag: 12, reserve: 48, maxReserve: 72, reloadType: 'shell', reloadStart: 0.35, shellTime: 0.36, reloadEnd: 0.4,
    adsZoom: 1.15, adsTime: 0.19, sound: 'shotgun_fire', shell: 'shotgun', tracerEvery: 0, moveMul: 0.96,
    hip: [0.19, -0.2, -0.26], hipRot: [0.02, 0.08, 0.04], ammoKind: 'shotgun', drawTime: 0.44, special: true,
  },
  chaingun: {
    id: 'chaingun', name: 'CHAIN GUN', slot: 0, model: 'chaingun', mode: 'auto', rpm: 1500, spinup: 0.5,
    damage: 32, pellets: 1, penetration: 1, falloff: [40, 90, 0.6],
    spreadHip: 2.0, spreadAds: 1.5, spreadMove: 1, spreadAir: 3, spreadPerShot: 0.03, spreadMax: 1.5,
    recoilV: 0.12, recoilH: 0.16, recoilRecover: 8, kick: 0.45, shake: 0.05,
    mag: 900, reserve: 0, maxReserve: 0, noReload: true,
    adsZoom: 1.08, adsTime: 0.27, sound: null, shell: 'rifle', tracerEvery: 3, moveMul: 0.72,
    hip: [0.2, -0.2, -0.28], hipRot: [0, 0.05, 0], ammoKind: 'none', drawTime: 0.68, special: true,
  },
};

export const SPECIAL_SPAWNS = [
  { round: 11, weapon: 'l96a1', spot: 'l96a1', banner: 'L96A1 BLACK-MAGNUM', where: 'in the basement' },
  { round: 13, weapon: 'm32', spot: 'm32', banner: 'M32 MGL', where: 'on the kitchen table' },
  { round: 7, weapon: 'goldenPunisher', spot: 'goldenPunisher', banner: 'GOLDEN PUNISHER', where: 'upstairs by the bathroom' }, // with the upstairs (modes.js UPSTAIRS_ROUND)
  { round: 19, weapon: 'chaingun', spot: 'chaingun', banner: 'CHAIN GUN', where: 'in the living room' },
];

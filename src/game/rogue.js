// The Gauntlet (MODES.gauntlet): Cabin Fever's fifteen waves at Extreme strength, without the story, the gun
// shop or cash. Instead the run is built from cards (ui/draft.js shows them):
//   opening   before round 1: pick one of three (a gun, a perk, supplies)
//   reward    after every cleared round: one WEAPON, one PERK, one SUPPLY card: take one
//   curse     then three curses: take one. PERMANENT ones stack for the rest of the run (the horde faster,
//             tougher, hungrier, bigger, fewer drops, a type infesting every wave, ...); NEXT ROUND ones hit
//             harder but only once (a blood moon, the NOX squad, a blackout, Crushers, the Stalker, ...)
// Perks stack (PERKS: max). Weapons come as MK II / MK III (store upgrade levels) from the middle rounds on;
// the gun they replace drops at your feet. Rarity (common / rare / epic / legendary) weighs the draws and
// shifts toward the rare ones as the rounds go by.
// game.rogue.on only in the Gauntlet. The hooks read its numbers (neutral outside it): game.js (damage,
// drops, the horde, the round flow), player/weapons.js (rogueDef: damage, fire rate, mags, reloads,
// spread), player/player.js (speed, max HP, Second Wind).
// Debug: __game.rogue.add('hollow') · __game.rogue.curse('frenzy') · __game.rogue.draft('reward').
import { WEAPONS } from '../player/weaponDefs.js';
import { SHOP_EQUIPMENT, upgradesFor, MAX_LEVEL } from './shop.js';
import { rand } from '../core/utils.js';

// perks: `max` stacks; `from`: first round it can be drawn; text: what one stack does
export const PERKS = [
  { id: 'hollow', name: 'HOLLOW POINTS', icon: 'bullet', rarity: 'common', max: 3, text: '+15% weapon damage' },
  { id: 'headhunter', name: 'HEADHUNTER', icon: 'skullaim', rarity: 'rare', max: 2, text: '+35% headshot damage' },
  { id: 'quickhands', name: 'QUICK HANDS', icon: 'reload', rarity: 'common', max: 2, text: 'Reload 20% faster' },
  { id: 'hairtrigger', name: 'HAIR TRIGGER', icon: 'bolt', rarity: 'rare', max: 2, text: '+12% fire rate' },
  { id: 'extmags', name: 'EXTENDED MAGS', icon: 'mag', rarity: 'common', max: 2, text: '+35% magazine and reserve' },
  { id: 'steady', name: 'STEADY AIM', icon: 'aim', rarity: 'common', max: 2, text: '30% less spread and recoil' },
  { id: 'adrenaline', name: 'ADRENALINE', icon: 'run', rarity: 'common', max: 2, text: 'Move 8% faster' },
  { id: 'thickskin', name: 'THICK SKIN', icon: 'heart', rarity: 'rare', max: 3, text: '+25 max HP' },
  { id: 'bloodthirst', name: 'BLOODTHIRST', icon: 'drop', rarity: 'rare', max: 3, text: 'Every kill heals 3 HP' },
  { id: 'kevlar', name: 'KEVLAR WEAVE', icon: 'shield', rarity: 'common', max: 2, text: '+40 armor at every round start' },
  { id: 'scavenger', name: 'SCAVENGER', icon: 'crate', rarity: 'common', max: 2, text: '+60% supply drops' },
  { id: 'ap', name: 'AP ROUNDS', icon: 'pierce', rarity: 'rare', max: 2, text: 'Bullets punch through one more body' },
  { id: 'demolition', name: 'DEMOLITION', icon: 'blast', rarity: 'rare', max: 2, text: 'Your explosions: +40% damage, +25% radius' },
  { id: 'lucky', name: 'LUCKY ROUNDS', icon: 'die', rarity: 'rare', max: 2, text: '15% of your shots cost no ammo' },
  { id: 'executioner', name: 'EXECUTIONER', icon: 'knife', rarity: 'epic', max: 1, text: 'Melee hits 75% harder · melee kills heal 12 HP' },
  { id: 'secondwind', name: 'SECOND WIND', icon: 'pulse', rarity: 'epic', max: 1, text: 'Once a round a killing blow leaves you at 1 HP' },
];

// weapon cards: `from` the round (the card's round) it can turn up
const WEAPON_POOL = [
  { id: 'm16a2', rarity: 'common' },
  { id: 'm4super90', rarity: 'common' },
  { id: 'p90', rarity: 'common' },
  { id: 'mozambique', rarity: 'common' },
  { id: 'm4a1', rarity: 'common' },
  { id: 'spas12', rarity: 'rare' },
  { id: 'r201', rarity: 'rare' },
  { id: 'l96a1', rarity: 'epic', from: 3 },
  { id: 'devotion', rarity: 'epic', from: 4 },
  { id: 'sigma', rarity: 'epic', from: 5 },
  { id: 'mg42', rarity: 'epic', from: 5 },
  { id: 'm32', rarity: 'legendary', from: 6 },
  { id: 'goldenPunisher', rarity: 'legendary', from: 7 },
  { id: 'chaingun', rarity: 'legendary', from: 9 },
];
const WEAPON_TYPE = { m16a2: 'BURST RIFLE', m4super90: 'SEMI-AUTO SHOTGUN', p90: 'SUBMACHINE GUN', mozambique: 'SHOTGUN PISTOL · SIDEARM', m4a1: 'ASSAULT RIFLE', spas12: 'COMBAT SHOTGUN', r201: 'ASSAULT RIFLE', l96a1: 'SNIPER RIFLE', devotion: 'LIGHT MACHINE GUN', sigma: 'HEAVY MACHINE GUN', mg42: 'BELT-FED MACHINE GUN', m32: 'GRENADE LAUNCHER · ONE LOAD', goldenPunisher: 'GOLDEN SHOTGUN', chaingun: 'CHAIN GUN · ONE BELT' };
const UPG_SHORT = { dmg: 'DMG', mag: 'MAG', reload: 'RLD', rate: 'ROF' };

// supply cards: instant. `gear`: a store gear item for free (not while you own it)
const SUPPLIES = [
  { id: 'frags', name: 'FRAG PACK', icon: 'grenade', thumb: 'e:frag', rarity: 'common', text: '+3 M67 frag grenades' },
  { id: 'molotovs', name: 'FIREBOMBS', icon: 'flame', thumb: 'e:molotov', rarity: 'common', text: '+2 Molotovs' },
  { id: 'plates', name: 'KEVLAR PLATES', icon: 'shield', thumb: 'e:armor', rarity: 'common', text: '+100 armor (up to 200)' },
  { id: 'ammo', name: 'AMMO CACHE', icon: 'ammo', thumb: 'e:ammo', rarity: 'common', text: 'Every gun to max reserve · +1 frag' },
  { id: 'barricades', name: 'BARRICADE KITS', icon: 'plank', thumb: 'e:barricade', rarity: 'common', text: '+2 barricade kits' },
  { id: 'mines', name: 'MINEFIELD', icon: 'mine', thumb: 'e:mine', rarity: 'common', text: '+3 M16A1 bounding mines' },
  { id: 'pipebomb', name: 'PIPE BOMB', icon: 'pipe', thumb: 'e:pipebomb', rarity: 'rare', text: '+1 pipe bomb: it lures the horde, then blows' },
  { id: 'gear:shockwave', gear: 'shockwave', rarity: 'rare' },
  { id: 'medkit', name: 'FIELD SURGEON', icon: 'medkit', rarity: 'rare', text: 'Full HP now · +10 max HP' },
  { id: 'gear:backpack', gear: 'backpack', rarity: 'rare' },
  { id: 'gear:grenadier', gear: 'grenadier', rarity: 'common' },
  { id: 'gear:magvest', gear: 'magvest', rarity: 'rare' },
  { id: 'gear:gloves', gear: 'gloves', rarity: 'common' },
  { id: 'gear:boots', gear: 'boots', rarity: 'common' },
  { id: 'gear:defib', gear: 'defib', rarity: 'rare' },
  { id: 'gear:machete', gear: 'machete', rarity: 'common' },
  { id: 'gear:gasmask', gear: 'gasmask', rarity: 'rare' },
];

// curses. `next`: for the next round only; `from`: first round it's offered in (the buy phase after it)
export const CURSES = [
  { id: 'frenzy', name: 'FRENZY', icon: 'skullrun', max: 3, text: 'The infected move 8% faster' },
  { id: 'hardened', name: 'HARDENED', icon: 'skullshield', max: 3, text: 'The infected have 15% more health' },
  { id: 'brutality', name: 'BRUTALITY', icon: 'claw', max: 3, text: 'The infected hit 15% harder' },
  { id: 'swarm', name: 'SWARM', icon: 'swarm', max: 3, text: '15% more infected in every wave' },
  { id: 'scarcity', name: 'SCARCITY', icon: 'emptycrate', max: 2, text: 'The infected drop 40% fewer supplies' },
  { id: 'rations', name: 'HALF RATIONS', icon: 'halfmag', max: 1, text: 'Round ends refill only half your reserve' },
  { id: 'wounds', name: 'OPEN WOUNDS', icon: 'wound', max: 1, text: 'Round ends heal you to 70% only' },
  { id: 'rust', name: 'RUSTED GUNS', icon: 'rust', max: 2, text: 'You reload 15% slower' },
  { id: 'heavy', name: 'HEAVY BOOTS', icon: 'weight', max: 1, text: 'You move 8% slower' },
  { id: 'infest:dog', name: 'INFESTATION · DOGS', icon: 'paw', max: 2, from: 2, type: 'dog', text: 'An extra pack of mutant dogs in every wave' },
  { id: 'infest:biter', name: 'INFESTATION · BITERS', icon: 'jaws', max: 2, from: 3, type: 'biter', text: 'An extra pack of Biters in every wave' },
  { id: 'infest:charger', name: 'INFESTATION · BOOMERS', icon: 'boomer', max: 2, from: 1, type: 'charger', text: 'Extra Boomers in every wave' },
  { id: 'infest:striker', name: 'INFESTATION · STRIKERS', icon: 'leap', max: 2, from: 4, type: 'striker', text: 'Extra Strikers in every wave' },
  { id: 'bloodmoon', name: 'BLOOD MOON', icon: 'moon', next: true, from: 2, text: 'Next round: a blood moon. Faster, and 30% more of them' },
  { id: 'hunted', name: 'HUNTED', icon: 'heli', next: true, from: 3, text: 'Next round: the NOX squad drops in' },
  { id: 'blackout', name: 'BLACKOUT', icon: 'bulb', next: true, from: 2, text: 'Next round: lightning cuts the power' },
  { id: 'titans', name: 'TITANS', icon: 'fist', next: true, from: 4, text: 'Next round: two Crushers join the wave' },
  { id: 'marked', name: 'MARKED', icon: 'eye', next: true, from: 3, text: 'Next round: the Stalker comes for you' },
  { id: 'packs', name: 'PACK SEASON', icon: 'paw', next: true, from: 3, text: 'Next round: twice the dogs and Biters' },
  { id: 'berserk', name: 'BERSERK', icon: 'skullfire', next: true, from: 2, text: 'Next round: the infected are 30% faster and hit 30% harder' },
  { id: 'dry', name: 'DRY SPELL', icon: 'nodrop', next: true, from: 1, text: 'Next round: the infected drop nothing' },
];

const RARITY_W = (round) => ({ common: 60, rare: 26 + round * 1.6, epic: 6 + round * 1.3, legendary: round >= 6 ? 1 + round * 0.55 : 0 });

function weighted(list, w) {
  let sum = 0;
  for (const it of list) sum += w(it);
  if (sum <= 0) return list[Math.floor(Math.random() * list.length)] ?? null;
  let r = Math.random() * sum;
  for (const it of list) if ((r -= w(it)) <= 0) return it;
  return list[list.length - 1] ?? null;
}

const ROMAN = ['', 'I', 'II', 'III', 'IV'];

export class Rogue {
  constructor(game) {
    this.game = game;
    this.reset(false);
  }

  /** a new run: on only in the Gauntlet */
  reset(on = !!this.game.mode?.rogue) {
    this.on = on;
    this.perks = {}; // id -> stacks
    this.curses = {}; // id -> stacks (permanent ones)
    this.pending = {}; // next-round curses picked this buy phase
    this.next = {}; // ... and the round they hit (set at its start)
    this.log = []; // every card taken, in order ({ kind, id, name, round })
    this.drafting = false;
    this.draftT = 0; // > 0: a draft opens when it runs out
    this.draftKind = null;
    this.windUsed = false;
    this.markT = 0;
    this.bonusHp = 0; // FIELD SURGEON cards taken
    this.version = (this.version ?? 0) + 1; // weapons.js caches its derived defs by this
    if (on) {
      this.draftT = 1.4; // the opening pick, once the deploy fade is through
      this.draftKind = 'opening';
    }
  }

  stacks(id) {
    return this.perks[id] ?? 0;
  }
  cursed(id) {
    return this.curses[id] ?? 0;
  }

  // ---------------------------------------------------------------- the numbers the hooks read
  get dmgMul() {
    return 1 + 0.15 * this.stacks('hollow');
  }
  get headMul() {
    return 1 + 0.35 * this.stacks('headhunter');
  }
  get reloadMul() {
    return Math.pow(0.8, this.stacks('quickhands')) * Math.pow(1.15, this.cursed('rust'));
  }
  get rateMul() {
    return 1 + 0.12 * this.stacks('hairtrigger');
  }
  get magMul() {
    return 1 + 0.35 * this.stacks('extmags');
  }
  get spreadMul() {
    return Math.pow(0.7, this.stacks('steady'));
  }
  get moveMul() {
    return (1 + 0.08 * this.stacks('adrenaline')) * (this.cursed('heavy') ? 0.92 : 1);
  }
  get maxHp() {
    return 100 + 25 * this.stacks('thickskin') + 10 * (this.bonusHp ?? 0);
  }
  get killHeal() {
    return 3 * this.stacks('bloodthirst');
  }
  get pierce() {
    return this.stacks('ap');
  }
  get blastMul() {
    return 1 + 0.4 * this.stacks('demolition');
  }
  get blastRadius() {
    return 1 + 0.25 * this.stacks('demolition');
  }
  get luck() {
    return 0.15 * this.stacks('lucky');
  }
  get meleeMul() {
    return this.stacks('executioner') ? 1.75 : 1;
  }
  get dropMul() {
    return this.next.dry ? 0 : (1 + 0.6 * this.stacks('scavenger')) * Math.pow(0.6, this.cursed('scarcity'));
  }
  // the horde
  get zSpeed() {
    return (1 + 0.08 * this.cursed('frenzy')) * (this.next.berserk ? 1.3 : 1);
  }
  get zHp() {
    return 1 + 0.15 * this.cursed('hardened');
  }
  get zDmg() {
    return (1 + 0.15 * this.cursed('brutality')) * (this.next.berserk ? 1.3 : 1);
  }
  get zCount() {
    return 1 + 0.15 * this.cursed('swarm');
  }
  get restockMul() {
    return this.cursed('rations') ? 0.5 : 1;
  }
  get healTo() {
    return this.cursed('wounds') ? 0.7 : 1;
  }

  /** Second Wind (player.js): a killing blow; true = it's spent on this one (the player stays up at 1 HP) */
  secondWind(p) {
    if (!this.on || !this.stacks('secondwind') || this.windUsed) return false;
    this.windUsed = true;
    const g = this.game;
    p.hp = 1;
    p.invulnT = 2;
    g.hud.banner('SECOND WIND', 'Two seconds. Move!', 2, 'danger');
    g.audio.play('pickup_health', { volume: 1, pitch: 0.7 });
    g.shake.add(0.4);
    return true;
  }

  // ---------------------------------------------------------------- the round flow (game.js)
  /** round start: the next-round curses hit now; the horde's numbers for this round */
  onRoundStart(round) {
    if (!this.on) return;
    const g = this.game;
    this.next = this.pending;
    this.pending = {};
    this.windUsed = false;
    g.difficultyDamage = g.diff.dmg * this.zDmg;
    const kev = 40 * this.stacks('kevlar');
    if (kev) g.player.ap = Math.min(200, g.player.ap + kev);
    const list = g.toSpawn;
    // permanent infestations: every wave
    for (const c of CURSES) {
      const n = c.type ? this.cursed(c.id) : 0;
      if (!n) continue;
      const per = c.type === 'dog' || c.type === 'biter' ? 3 + Math.floor(round / 5) : c.type === 'charger' ? 2 + Math.floor(round / 4) : 2 + Math.floor(round / 6);
      for (let k = 0; k < n; k++) this._insert(list, c.type, per);
    }
    const N = this.next;
    if (N.packs) {
      const dogs = list.filter((t) => t === 'dog').length, biters = list.filter((t) => t === 'biter').length;
      this._insert(list, 'dog', Math.max(3, dogs));
      this._insert(list, 'biter', Math.max(3, biters));
    }
    if (N.titans) list.push('crusher', 'crusher');
    g.roundTotal = list.length;
    if (N.bloodmoon) g.events?.force('bloodmoon');
    if (N.blackout) setTimeout(() => g.running && g.state === 'combat' && g.events?.force('blackout'), 9000);
    if (N.hunted && g.events) g.events.squadT = rand(10, 20);
    if (N.marked) this.markT = rand(18, 30);
    const hit = CURSES.filter((c) => c.next && N[c.id]).map((c) => c.name);
    if (hit.length) setTimeout(() => g.running && g.hud.banner(hit.join(' · '), 'The curse you chose comes due', 2.8, 'danger'), 3300);
  }

  onRoundEnd(round, final) {
    if (!this.on) return;
    this.next = {};
    this.markT = 0;
    this.game.difficultyDamage = this.game.diff.dmg * this.zDmg;
    if (!final) {
      this.draftT = 2.6; // after the ROUND CLEAR banner
      this.draftKind = 'reward';
    }
  }

  update(dt) {
    if (!this.on) return;
    const g = this.game;
    if (this.markT > 0 && (this.markT -= dt) <= 0 && g.state === 'combat') g.stalker?.force('attack');
    if (this.draftT > 0 && !this.drafting && !g.cinema?.active) {
      this.draftT -= dt;
      if (this.draftT <= 0) this.draft(this.draftKind);
    }
  }

  /** a pack of `n` of a type into the queue, back to back (game._spawnOne lets a pack in together) */
  _insert(list, type, n) {
    if (n <= 0) return;
    const at = Math.floor(list.length * rand(0.1, 0.9));
    let i = at;
    // not inside another pack
    while (i < list.length && i > 0 && list[i] === list[i - 1] && (list[i] === 'dog' || list[i] === 'biter')) i++;
    if (type === 'dog' || type === 'biter') list.splice(i, 0, ...Array(n).fill(type));
    else for (let k = 0; k < n; k++) list.splice(Math.floor(Math.random() * (list.length + 1)), 0, type);
    // Crushers stay at the back
    list.sort((a, b) => (a === 'crusher' ? 1 : 0) - (b === 'crusher' ? 1 : 0));
  }

  // ---------------------------------------------------------------- drafts
  /** open a draft ('opening' | 'reward' | 'curse') through game.onDraft (main.js shows ui/draft.js) */
  draft(kind = 'reward') {
    const g = this.game;
    if (!g.onDraft) return;
    this.drafting = true;
    this.draftKind = null;
    this.draftT = 0;
    const round = Math.max(1, g.round);
    const cards = kind === 'curse' ? this.offerCurses(round) : kind === 'opening' ? this.offerOpening() : this.offerReward(round);
    const spec = {
      kind,
      step: kind === 'curse' ? 1 : 0,
      steps: kind === 'opening' ? ['LOADOUT'] : ['REWARD', 'CURSE'],
      kicker: kind === 'opening' ? 'THE GAUNTLET · NO SHOP · NO MERCY' : `THE GAUNTLET · ROUND ${round} CLEARED`,
      title: kind === 'curse' ? 'CHOOSE YOUR CURSE' : kind === 'opening' ? 'CHOOSE YOUR EDGE' : 'CHOOSE YOUR REWARD',
      sub: kind === 'curse' ? 'One of them you must take. Permanent ones stay for the rest of the run' : kind === 'opening' ? 'Fifteen waves. No gun shop: every round deals you cards' : 'Take one',
      cards,
      have: this.summary(),
      pick: (i) => this.pick(kind, cards[i]),
    };
    g.onDraft(spec);
  }

  /** a card taken: apply it; returns the next draft step's spec (reward -> curse) or null when done */
  pick(kind, card) {
    const g = this.game;
    if (card) {
      this.apply(card);
      this.log.push({ kind: card.kind, id: card.id, name: card.name, round: g.round });
    }
    if (kind === 'reward') {
      const round = Math.max(1, g.round);
      const cards = this.offerCurses(round);
      return {
        kind: 'curse',
        step: 1,
        steps: ['REWARD', 'CURSE'],
        kicker: `THE GAUNTLET · ROUND ${round} CLEARED`,
        title: 'CHOOSE YOUR CURSE',
        sub: 'One of them you must take. Permanent ones stay for the rest of the run',
        cards,
        have: this.summary(),
        pick: (i) => this.pick('curse', cards[i]),
      };
    }
    this.drafting = false;
    if (kind === 'curse') setTimeout(() => g.running && g.state === 'shop' && g.hud.banner('BREATHER', 'No shop in the Gauntlet · hold F when ready', 2.6, 'normal'), 400);
    return null;
  }

  /** what you carry into the next round: [{ id, name, icon, n, kind }] */
  summary() {
    const perks = PERKS.filter((p) => this.stacks(p.id)).map((p) => ({ id: p.id, name: p.name, icon: p.icon, n: this.stacks(p.id) }));
    const curses = CURSES.filter((c) => this.cursed(c.id) || this.pending[c.id]).map((c) => ({ id: c.id, name: c.name, icon: c.icon, n: this.cursed(c.id) || 1, next: !!c.next }));
    return { perks, curses };
  }

  offerOpening() {
    const r = 1;
    const cards = [this._weaponCard(r, true), this._perkCard(r), this._perkCard(r, (p) => p.rarity !== 'epic')];
    // two different perks
    if (cards[1] && cards[2] && cards[1].id === cards[2].id) cards[2] = this._supplyCard(r);
    return cards.filter(Boolean);
  }

  offerReward(round) {
    return [this._weaponCard(round), this._perkCard(round), this._supplyCard(round)].filter(Boolean);
  }

  offerCurses(round) {
    const ok = (c) => (c.from ?? 0) <= round && (c.next ? !this.pending[c.id] : this.cursed(c.id) < c.max);
    const perm = CURSES.filter((c) => !c.next && ok(c));
    const next = CURSES.filter((c) => c.next && ok(c));
    const out = [];
    const take = (pool) => {
      const left = pool.filter((c) => !out.includes(c));
      if (!left.length) return;
      out.push(left[Math.floor(Math.random() * left.length)]);
    };
    take(perm);
    take(perm);
    take(next.length ? next : perm);
    // shuffle
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out.map((c) => {
      const n = this.cursed(c.id);
      return {
        kind: 'curse',
        id: c.id,
        name: c.name,
        icon: c.icon,
        rarity: 'curse',
        text: c.text,
        tag: c.next ? 'NEXT ROUND' : c.max > 1 ? `PERMANENT · ${ROMAN[n + 1]}` : 'PERMANENT',
        next: !!c.next,
      };
    });
  }

  _perkCard(round, filter = null) {
    const pool = PERKS.filter((p) => this.stacks(p.id) < p.max && (!filter || filter(p)));
    const W = RARITY_W(round);
    const p = weighted(pool, (x) => W[x.rarity] ?? 1);
    if (!p) return null;
    const n = this.stacks(p.id);
    return { kind: 'perk', id: p.id, name: p.name, icon: p.icon, rarity: p.rarity, text: p.text, tag: p.max > 1 ? `STACK ${ROMAN[n + 1]} / ${ROMAN[p.max]}` : 'UNIQUE' };
  }

  _weaponCard(round, opening = false) {
    const w = this.game.weapons;
    const carried = w?._carried?.() ?? [];
    const pool = WEAPON_POOL.filter((e) => WEAPONS[e.id] && (e.from ?? 0) <= round && !carried.includes(e.id) && !(opening && e.rarity !== 'common' && e.rarity !== 'rare'));
    const W = RARITY_W(round);
    const e = weighted(pool, (x) => W[x.rarity] ?? 1);
    if (!e) return null;
    const def = WEAPONS[e.id];
    // MK II / MK III: store upgrade levels, spread over what the gun can take
    const mk = def.fixedAmmo || def.noReload ? 1 : round >= 10 ? 3 : round >= 5 ? 2 : 1;
    const levels = {};
    if (mk > 1) {
      const keys = upgradesFor(def).map((u) => u.key);
      for (let k = 0; k < (mk - 1) * 2 && keys.length; k++) {
        const key = keys[Math.floor(Math.random() * keys.length)];
        levels[key] = Math.min(MAX_LEVEL, (levels[key] ?? 0) + 1);
      }
    }
    const ups = Object.entries(levels).map(([k, v]) => `+${v} ${UPG_SHORT[k] ?? k.toUpperCase()}`).join(' ');
    const side = def.slot === 1;
    return {
      kind: 'weapon',
      id: 'w:' + e.id,
      weapon: e.id,
      name: def.name,
      rarity: e.rarity,
      levels,
      thumb: 'w:' + e.id,
      text: `${WEAPON_TYPE[e.id] ?? 'WEAPON'}. ${side ? 'Replaces your sidearm' : def.fixedAmmo ? 'Your gun waits on your back until it runs dry' : def.noReload ? 'No reloads. Replaces the gun in your hands; that one drops at your feet' : 'Replaces the gun in your hands; that one drops at your feet'}`,
      tag: mk > 1 ? `MK ${ROMAN[mk]} · ${ups}` : 'FACTORY',
    };
  }

  _supplyCard(round) {
    const g = this.game;
    const pool = SUPPLIES.filter((s) => !s.gear || (SHOP_EQUIPMENT.some((it) => it.key === s.gear) && !g.gear?.owns?.(s.gear)));
    const W = RARITY_W(round);
    const s = weighted(pool, (x) => W[x.rarity] ?? 1);
    if (!s) return null;
    if (s.gear) {
      const it = SHOP_EQUIPMENT.find((x) => x.key === s.gear);
      return { kind: 'supply', id: s.id, gear: s.gear, name: it.short ?? it.name, icon: 'gear', rarity: s.rarity, thumb: 'g:' + s.gear, text: (it.desc ?? [it.type]).join(' · '), tag: 'GEAR · FREE' };
    }
    return { kind: 'supply', id: s.id, name: s.name, icon: s.icon, rarity: s.rarity, thumb: s.thumb ?? null, text: s.text, tag: 'SUPPLY' };
  }

  // ---------------------------------------------------------------- applying cards
  apply(card) {
    const g = this.game;
    if (card.kind === 'perk') {
      this.perks[card.id] = this.stacks(card.id) + 1;
      this.version++;
      if (card.id === 'thickskin') {
        g.player.maxHp = this.maxHp;
        g.player.hp = Math.min(g.player.maxHp, g.player.hp + 25);
      }
      if (card.id === 'extmags') for (const id of g.weapons._carried()) this._topUp(id);
    } else if (card.kind === 'curse') {
      const c = CURSES.find((x) => x.id === card.id);
      if (c?.next) this.pending[c.id] = true;
      else this.curses[card.id] = this.cursed(card.id) + 1;
      this.version++;
      g.player.maxHp = this.maxHp;
    } else if (card.kind === 'weapon') this._giveWeapon(card);
    else if (card.kind === 'supply') this._giveSupply(card);
  }

  _topUp(id) {
    const w = this.game.weapons;
    const d = w.defOf(id);
    const a = w.ammo[id];
    if (!d?.mag || !a || d.noReload || d.fixedAmmo) return;
    const m = Math.round(d.mag * this.magMul);
    a.mag = Math.max(a.mag, m);
    a.reserve = Math.max(a.reserve, Math.round(d.reserve * this.magMul));
  }

  _giveWeapon(card) {
    const g = this.game;
    const w = g.weapons;
    const id = card.weapon;
    const d = WEAPONS[id];
    if (!d) return;
    for (const [k, lv] of Object.entries(card.levels ?? {})) w.setUpgrade(id, k, lv);
    w.owned?.add(id);
    if (d.slot === 1) {
      w.slots[1] = id;
      const dd = w.defOf(id);
      w.ammo[id] = { mag: dd.mag, mag2: dd.mag, reserve: dd.reserve };
      w.switchTo(1, true);
    } else {
      const drops = w.giveWeapon(id);
      for (const drop of drops) g.pickups?.dropWeapon(drop, g.player.pos);
      const dd = w.defOf(id);
      if (!d.fixedAmmo && dd.mag) w.ammo[id] = { mag: dd.mag, mag2: dd.mag, reserve: dd.reserve };
    }
    this._topUp(id);
    g.audio.play('pickup_weapon', { volume: 0.8 });
  }

  _giveSupply(card) {
    const g = this.game;
    const w = g.weapons;
    const p = g.player;
    if (card.gear) {
      const it = SHOP_EQUIPMENT.find((x) => x.key === card.gear);
      it?.give(g);
      g.audio.play('pickup_weapon', { volume: 0.6 });
      return;
    }
    switch (card.id) {
      case 'frags':
        w.grenades += 3;
        break;
      case 'molotovs':
        w.molotovs = (w.molotovs ?? 0) + 2;
        break;
      case 'plates':
        p.ap = Math.min(200, p.ap + 100);
        break;
      case 'ammo':
        w.refillReserves();
        w.grenades++;
        break;
      case 'barricades':
        w.barricades = (w.barricades ?? 0) + 2;
        break;
      case 'mines':
        w.mines = (w.mines ?? 0) + 3;
        break;
      case 'pipebomb':
        w.pipebombs = (w.pipebombs ?? 0) + 1;
        break;
      case 'medkit':
        this.bonusHp = (this.bonusHp ?? 0) + 1;
        p.maxHp = this.maxHp;
        p.hp = p.maxHp;
        break;
      default:
        break;
    }
    g.audio.play('pickup_ammo', { volume: 0.7 });
  }

  // ---------------------------------------------------------------- debug
  add(id) {
    const p = PERKS.find((x) => x.id === id);
    if (p) this.apply({ kind: 'perk', id });
    return this.perks;
  }

  curse(id) {
    if (CURSES.some((x) => x.id === id)) this.apply({ kind: 'curse', id });
    return { curses: this.curses, pending: this.pending };
  }
}

/**
 * A weapon def with the Gauntlet's perks on it (player/weapons.js `def`): damage, fire rate, mags, reloads,
 * spread and recoil, penetration. Cached per def and perk version, so the same object comes back every frame.
 */
const RELOAD_KEYS = ['reload', 'reloadEmpty', 'reloadStart', 'shellTime', 'reloadEnd'];
const CYCLE_KEYS = ['boltTime', 'cycleAt', 'burstDelay'];
const SPREAD_KEYS = ['spreadHip', 'spreadAds', 'spreadMove', 'spreadAir', 'spreadPerShot', 'spreadMax', 'recoilV', 'recoilH'];
const _rd = new WeakMap();

export function rogueDef(game, d) {
  const R = game?.rogue;
  if (!d || !R?.on) return d;
  const c = _rd.get(d);
  if (c && c.v === R.version) return c.def;
  const def = { ...d };
  const dm = R.dmgMul, rm = R.reloadMul, fm = R.rateMul, mm = R.magMul, sm = R.spreadMul;
  if (d.damage && d.mode !== 'melee') def.damage = d.damage * dm;
  if (d.mode === 'melee' && R.meleeMul !== 1) {
    if (d.damage) def.damage = d.damage * R.meleeMul;
    if (d.heavyDamage) def.heavyDamage = d.heavyDamage * R.meleeMul;
  }
  if (rm !== 1) for (const k of RELOAD_KEYS) if (d[k]) def[k] = d[k] * rm;
  if (fm !== 1 && d.rpm && d.mode !== 'melee' && d.mode !== 'grenade') {
    def.rpm = d.rpm * fm;
    if (d.rampRpm) def.rampRpm = d.rampRpm * fm;
    for (const k of CYCLE_KEYS) if (d[k]) def[k] = d[k] / fm;
  }
  if (mm !== 1 && d.mag && !d.noReload && !d.fixedAmmo) {
    def.mag = Math.round(d.mag * mm);
    if (d.reserve) def.reserve = Math.round(d.reserve * mm);
    if (d.maxReserve) def.maxReserve = Math.round(d.maxReserve * mm);
  }
  if (sm !== 1) for (const k of SPREAD_KEYS) if (d[k]) def[k] = d[k] * sm;
  if (R.pierce && d.mode !== 'melee' && d.mode !== 'grenade') def.penetration = (d.penetration ?? 0) + R.pierce;
  _rd.set(d, { v: R.version, def });
  return def;
}

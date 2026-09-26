// Team economy: every fireteam member (player + bots) has an own wallet, but every payout goes
// to all of them in equal amounts (a teammate's kill pays you the same as your own).
// Bots spend their cash on damage upgrades for their signature gun between rounds.

export const ECON = {
  start: 500,
  kill: { mauler: 60, worker: 70, survivor: 150, charger: 90, boomer: 90, striker: 80, crusher: 600, dog: 70, biter: 75, stalker: 400 },
  killDefault: 60,
  headshot: 20,
  roundBase: 250,
  roundPer: 50,
};

// bot signature-gun damage upgrades (max one level per buy phase): cost of level n+1, damage gain per level
export const BOT_DMG = { costs: [800, 1500, 2400, 3500, 5000], perLevel: 0.12 };

export function killReward(typeName, headshot) {
  return (ECON.kill[typeName] ?? ECON.killDefault) + (headshot ? ECON.headshot : 0);
}

export function roundBonus(round) {
  return ECON.roundBase + ECON.roundPer * round;
}

export class Economy {
  constructor() {
    this.wallets = new Map(); // member -> wallet
    this.onPay = null; // (amount, reason) → HUD feedback
  }

  /** New match: fresh wallets for the given team members. */
  reset(members) {
    this.wallets.clear();
    for (const m of members) {
      this.wallets.set(m, { cash: ECON.start, earned: 0, spent: 0, round: { kills: 0, bonus: 0, count: 0 }, dmgLv: 0 });
      if (!m.isPlayer) m.dmgMul = 1;
    }
  }

  wallet(m) {
    return this.wallets.get(m);
  }

  cash(m) {
    return this.wallets.get(m)?.cash ?? 0;
  }

  /** Pay the same amount into every participant's wallet (alive or dead). */
  payAll(amount, reason = 'kill') {
    amount = Math.round(amount);
    if (!(amount > 0)) return;
    for (const w of this.wallets.values()) {
      w.cash += amount;
      w.earned += amount;
      if (reason === 'round') w.round.bonus += amount;
      else {
        w.round.kills += amount;
        w.round.count++;
      }
    }
    this.onPay?.(amount, reason);
  }

  canAfford(m, cost) {
    return this.cash(m) >= cost;
  }

  spend(m, cost) {
    const w = this.wallets.get(m);
    if (!w || w.cash < cost) return false;
    w.cash -= cost;
    w.spent += cost;
    return true;
  }

  beginRound() {
    for (const w of this.wallets.values()) w.round = { kills: 0, bonus: 0, count: 0 };
  }

  /** Each bot buys its next damage level for its signature gun if it can afford it. Returns [{ bot, level }]. */
  botsShop() {
    const bought = [];
    for (const [m, w] of this.wallets) {
      if (m.isPlayer) continue;
      if (w.dmgLv < BOT_DMG.costs.length && this.spend(m, BOT_DMG.costs[w.dmgLv])) {
        w.dmgLv++;
        bought.push({ bot: m, level: w.dmgLv });
      }
      m.dmgMul = 1 + w.dmgLv * BOT_DMG.perLevel;
    }
    return bought;
  }
}

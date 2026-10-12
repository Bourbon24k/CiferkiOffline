/* Local reconstruction of Ciferki's API. No original server is contacted. */
(function (root) {
  "use strict";
  const config =
    typeof module !== "undefined" ? require("./config.js") : root.CiferkiConfig;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const rarities = [
    "common",
    "uncommon",
    "rare",
    "epic",
    "legendary",
    "mythic",
  ];
  const key = "ciferki.offline.v1";
  function createEngine(storage, clock = Date.now, random = Math.random) {
    let recovered = false,
      state;
    const now = () => clock(),
      iso = (t) => new Date(t ?? now()).toISOString();
    const day = () => {
      const d = new Date(now());
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    const tomorrow = () => {
      const d = new Date(now());
      d.setHours(24, 0, 0, 0);
      return d.toISOString();
    };
    const rnd = () => Math.max(0, Math.min(0.999999999, random()));
    const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const err = (message, code = "OFFLINE_ERROR") => {
      const e = new Error(message);
      e.code = code;
      throw e;
    };
    const seed = () => ({
      version: 1,
      balance: 50000,
      numbers: [],
      nextId: 100,
      spins: 0,
      xp: 0,
      passXp: 0,
      spentPoints: 0,
      ranks: {},
      sold: 0,
      counters: {},
      earnedByRarity: Object.fromEntries(rarities.map((r) => [r, 0])),
      ledger: [],
      consumables: clone(config.spins_config.consumables),
      settings: {
        autoSell: { rarities: [], maxValue: 25000 },
        defaultSkin: null,
        background: null,
        haptics: true,
        fastReveal: false,
        showUsername: true,
        showAds: false,
        achievementToasts: true,
        notify: { trade: true, reminders: true, phone: true, all: true },
        nameColor: null,
        frame: null,
      },
      ownedSkins: [],
      vip: false,
      extra: 0,
      primaryId: null,
      primaryChanges: 0,
      daily: { last: null, streak: 0 },
      bonusAt: 0,
      roulette: { day: null, used: 0 },
      phones: [],
      passClaims: [],
      questClaims: [],
      questCounts: {},
      achievements: [],
      achSeen: [],
      games: { coins: [], dice: [], duels: [] },
      market: [],
      auctions: [],
      offers: [],
      salons: {},
      promoUsed: [],
      minted: {},
      forgeTargets: {},
      crash: null,
      lottery: { id: 1, drawAt: now() + 300000, tickets: 0, last: null },
      profile: { name: "Игрок", tag: null, color: null, frame: null },
    });
    function valid(s) {
      return (
        s &&
        s.version === 1 &&
        Number.isFinite(s.balance) &&
        s.balance >= 0 &&
        Array.isArray(s.numbers) &&
        s.settings &&
        s.games &&
        s.consumables
      );
    }
    for (const k of [key, key + ".backup"]) {
      try {
        const raw = storage.getItem(k);
        if (raw) {
          const s = JSON.parse(raw);
          if (!valid(s)) throw Error("bad save");
          state = s;
          recovered = k.endsWith("backup");
          break;
        }
      } catch {
        recovered = true;
      }
    }
    if (!state) state = seed();
    function save() {
      const raw = JSON.stringify(state);
      storage.setItem(key + ".backup", raw);
      storage.setItem(key, raw);
    }
    function user(id = 1) {
      return {
        id,
        name: id === 1 ? state.profile.name : `Игрок ${id - 100}`,
        firstName: id === 1 ? state.profile.name : `Игрок ${id - 100}`,
        tgUsername: id === 1 ? "offline" : `bot_${id}`,
        photoUrl: null,
        role: state.vip && id === 1 ? "vip" : null,
        isAdmin: false,
        cosmetics: {
          tag: id === 1 ? state.profile.tag : null,
          color: id === 1 ? state.profile.color : null,
          frame: id === 1 ? state.profile.frame : null,
          supporter: null,
        },
      };
    }
    function change(amount, reason) {
      if (!Number.isSafeInteger(amount)) err("Некорректная сумма");
      if (state.balance + amount < 0)
        err("Не хватает денег", "INSUFFICIENT_FUNDS");
      state.balance += amount;
      state.ledger.unshift({
        id: state.nextId++,
        amount,
        balance: state.balance,
        type: reason,
        reason,
        createdAt: iso(),
        currency: "soft",
        meta: {},
      });
      state.ledger = state.ledger.slice(0, 200);
    }
    function level() {
      let l = 1;
      while (l < 100 && state.xp >= threshold(l + 1)) l++;
      return l;
    }
    function threshold(l) {
      return l <= 1 ? 0 : Math.round(200 * Math.pow(l - 1, 1.7));
    }
    function skill(code) {
      const s = config.progress.skills.find((x) => x.code === code);
      if (!s) return 0;
      const rank = state.ranks[code] || 0;
      return rank ? s.values[Math.min(rank - 1, s.values.length - 1)] : s.base;
    }
    function luck() {
      const every = skill("luck_interval") || 100,
        n = state.spins + 1;
      const big = skill("luck_thousand") || 25,
        small = skill("luck_multiplier") || 5;
      let mult = n % 1000 === 0 ? big : n % every === 0 ? small : 1;
      if (state.consumables.luckBoostSpins > 0)
        mult *= state.consumables.luckBoostMultiplier;
      return {
        next: mult,
        hundred: {
          every,
          multiplier: small,
          spinsLeft: every - (state.spins % every),
        },
        thousand: {
          every: 1000,
          multiplier: big,
          spinsLeft: 1000 - (state.spins % 1000),
        },
      };
    }
    function shifted(odds, mult) {
      const out = rarities.map((r) => ({ rarity: r, ppm: 0 })),
        shift = Math.log(Math.max(1, mult)) / Math.log(8),
        whole = Math.floor(shift),
        frac = shift - whole;
      for (const o of odds) {
        const i = rarities.indexOf(o.rarity);
        out[Math.min(5, i + whole)].ppm += Math.round(o.ppm * (1 - frac));
        out[Math.min(5, i + whole + 1)].ppm += Math.round(o.ppm * frac);
      }
      out[0].ppm += 1000000 - out.reduce((s, x) => s + x.ppm, 0);
      return out;
    }
    function spinConfig() {
      const c = clone(config.spins_config),
        l = luck();
      c.luck = l;
      c.consumables = clone(state.consumables);
      c.prefixSpin.unlocked = level() >= c.prefixSpin.unlockLevel;
      c.prefixSpin.surchargePercent = Math.max(0, 10 - skill("code_discount"));
      c.tiers = c.tiers.map((t) => ({
        ...t,
        effectivePrice:
          state.consumables[t.code + "Tickets"] > 0
            ? 0
            : Math.round(
                t.price *
                  (state.consumables.spinDiscountUses > 0
                    ? (100 - state.consumables.spinDiscountPercent) / 100
                    : 1),
              ),
        paymentKind:
          state.consumables[t.code + "Tickets"] > 0 ? "ticket" : "money",
        nextOdds: shifted(t.odds, l.next),
        nextLuck: l.next,
        nominalLuck: l.next,
      }));
      return c;
    }
    function progress() {
      const p = clone(config.progress),
        l = level();
      Object.assign(p, {
        level: l,
        xp: state.xp,
        levelStartXp: threshold(l),
        nextLevelXp: threshold(l + 1),
        skillPoints: Math.max(0, l - 1 - state.spentPoints),
        spinsTotal: state.spins,
        luck: luck(),
      });
      p.skills = p.skills.map((s) => {
        const rank = state.ranks[s.code] || 0;
        return {
          ...s,
          rank,
          nextCost: rank >= s.maxRank ? null : (s.nextCost ?? 1),
          nextMinLevel: rank >= s.maxRank ? null : (s.nextMinLevel ?? 1),
        };
      });
      p.unlocks = p.unlocks.map((u) => ({ ...u, unlocked: l >= u.level }));
      return p;
    }
    function decorate(n) {
      const x = clone(n);
      x.isPrimary = n.id === state.primaryId;
      x.skin = n.skin
        ? clone(config.shop.skins.find((s) => s.code === n.skin)) || null
        : null;
      return x;
    }
    function me() {
      const ns = state.numbers.filter(
        (n) => !["listed", "auctioned", "salon"].includes(n.status),
      );
      return {
        user: { ...user(), vip: state.vip, tag: state.profile.tag },
        wallet: { soft: state.balance, premium: 0 },
        primary: state.numbers.find((n) => n.id === state.primaryId)
          ? decorate(state.numbers.find((n) => n.id === state.primaryId))
          : null,
        stats: {
          total: ns.length,
          byRarity: Object.fromEntries(
            rarities.map((r) => [r, ns.filter((n) => n.rarity === r).length]),
          ),
        },
        settings: clone(state.settings),
        season: {
          code: "offline",
          title: "Offline",
          startsAt: "2026-10-12T00:00:00Z",
          endsAt: null,
        },
        subscription: { required: false, subscribed: true, url: "" },
        inventory: {
          used: state.numbers.length,
          limit: 100 + (state.vip ? 100 : 0) + state.extra,
          vip: state.vip,
          extra: state.extra,
          extraMax: 200,
          reserved: 0,
        },
        termsVersion: 999,
      };
    }
    function weighted(list, field = "ppm") {
      let n = rnd() * list.reduce((s, x) => s + x[field], 0);
      for (const x of list) {
        n -= x[field];
        if (n < 0) return x;
      }
      return list[list.length - 1];
    }
    function format(country, op, national) {
      let mask = country.displayMask || `+${country.dialCode} ### ###-##-##`;
      if (op.networkCode)
        return (
          "+" +
          national.slice(0, op.networkCode.length) +
          " " +
          national
            .slice(op.networkCode.length)
            .replace(/(\d{3})(\d{2})(\d{2})$/, "$1-$2-$3")
        );
      let i = 0;
      return mask.replace(/#/g, () => national[i++] || "0");
    }
    function generate(rarity, options = {}, origin = "spin") {
      const country =
        config.countries.find((c) => c.iso2 === options.country) ||
        pick(config.countries.filter((c) => c.category === "standard"));
      const ops = country.operators.filter(
        (o) => o.prefixes?.length || o.networkCode,
      );
      const op =
        ops.find((o) => o.code === options.operator) ||
        pick(ops.length ? ops : country.operators);
      const prefix =
        options.prefix ||
        op.networkCode ||
        pick(op.prefixes?.length ? op.prefixes : ["900"]);
      const total = op.localLength
        ? prefix.length + op.localLength
        : (country.displayMask.match(/#/g) || []).length || 10;
      const len = Math.max(1, total - prefix.length),
        ri = rarities.indexOf(rarity);
      let local = Array.from({ length: len }, () => String(int(0, 9))).join("");
      let run = Math.min(len, [1, 2, 4, 5, 6, 7][ri]);
      if (ri > 0)
        local = local.slice(0, len - run) + String(int(0, 9)).repeat(run);
      let national = prefix + local,
        code = country.iso2 + national;
      if (ri >= 4 && state.minted[code]) {
        const salt = String(state.nextId % 1000).padStart(3, "0");
        national =
          prefix + salt.slice(0, Math.max(0, len - run)) + local.slice(-run);
        code = country.iso2 + national;
      }
      state.minted[code] = (state.minted[code] || 0) + 1;
      const formatted = format(country, op, national);
      const base = [500, 1800, 5000, 35000, 200000, 1000000][ri];
      const n = {
        id: state.nextId++,
        country: {
          iso2: country.iso2,
          name: country.name,
          flag: country.flag,
          dialCode: country.dialCode,
          themeColor: country.themeColor,
        },
        operator: { ...clone(op), prefixes: undefined },
        limited: country.category !== "standard",
        nationalNumber: national,
        prefixLength: prefix.length,
        formatted,
        digitPositions: Array.from(formatted.matchAll(/\d/g))
          .map((x) => x.index)
          .slice(String(op.networkCode || country.dialCode).length),
        rarity,
        score: [10, 25, 60, 130, 300, 700][ri] + int(0, 20),
        algorithmVersion: "offline-v1",
        patterns:
          ri > 0
            ? [
                {
                  type: "run",
                  part: "national",
                  start: national.length - run,
                  end: national.length,
                  strength: run,
                  points: [0, 10, 40, 80, 180, 500][ri],
                  explanation: `Серия из ${run} одинаковых цифр «${national.slice(-run)}»`,
                },
              ]
            : [],
        serial: ri >= 4 ? 1 : state.minted[code],
        supplyLimit: ri >= 4 ? 1 : ri === 3 ? 10 : ri === 2 ? 50 : null,
        mintedCount: state.minted[code],
        status: "owned",
        origin,
        firstMintedAt: iso(),
        acquiredAt: iso(),
        previousOwnersCount: 0,
        isPrimary: false,
        skin: state.settings.defaultSkin,
        value: Math.round(
          base * (0.75 + rnd() * 0.5) * (1 + skill("trade") / 100),
        ),
        engraving: null,
      };
      return n;
    }
    function getNumber(id) {
      const n = state.numbers.find((x) => x.id === Number(id));
      if (!n) err("Номер не найден", "NOT_FOUND");
      return n;
    }
    function spins(body) {
      const count = body.count ?? 1;
      if (!Number.isInteger(count) || count < 1 || count > 5)
        err("Можно выпустить от 1 до 5 SIM");
      const tier = config.spins_config.tiers.find((t) => t.code === body.tier);
      if (!tier) err("Неизвестный тариф");
      if (state.numbers.length + count > me().inventory.limit)
        err("Коллекция заполнена");
      const ticket = tier.code + "Tickets",
        uses = Math.min(state.consumables[ticket] || 0, count);
      let total = 0;
      for (let i = uses; i < count; i++) {
        let p = tier.price;
        if (body.country)
          p = Math.round(
            (p *
              (config.spins_config.countries.find(
                (c) => c.iso2 === body.country,
              )?.pricePercent || 100)) /
              100,
          );
        if (body.prefix)
          p = Math.round(
            p * (1 + spinConfig().prefixSpin.surchargePercent / 100),
          );
        if (state.consumables.spinDiscountUses > i - uses)
          p = Math.round(
            (p * (100 - state.consumables.spinDiscountPercent)) / 100,
          );
        total += p;
      }
      change(-total, "spin");
      state.consumables[ticket] -= uses;
      if (state.consumables.spinDiscountUses > 0)
        state.consumables.spinDiscountUses = Math.max(
          0,
          state.consumables.spinDiscountUses - (count - uses),
        );
      const results = [];
      for (let i = 0; i < count; i++) {
        const mult = luck().next;
        const rarity = weighted(shifted(tier.odds, mult)).rarity;
        const n = generate(rarity, body);
        state.numbers.push(n);
        state.spins++;
        state.counters["spins_" + tier.code] =
          (state.counters["spins_" + tier.code] || 0) + 1;
        if (mult >= 2)
          state.counters.lucky_spins = (state.counters.lucky_spins || 0) + 1;
        state.xp += 20 + rarities.indexOf(rarity) * 15;
        state.passXp += config.pass.xpPerSpin[tier.code] || 1;
        state.earnedByRarity[rarity]++;
        if (state.consumables.luckBoostSpins > 0)
          state.consumables.luckBoostSpins--;
        questCount("spin");
        if (rarities.indexOf(rarity) >= 3) questCount("epic");
        const result = {
          spinId: state.nextId++,
          xpGained: 20 + rarities.indexOf(rarity) * 15,
          levelUp: null,
          downgraded: false,
          valueBreakdown: { base: n.value, steps: [] },
          number: decorate(n),
          tier: tier.code,
          price: i < uses ? 0 : Math.round(total / Math.max(1, count - uses)),
          luck: mult,
          paid: total,
          wallet: { soft: state.balance, premium: 0 },
          autoSold: null,
        };
        if (
          state.settings.autoSell.rarities.includes(rarity) &&
          n.value <= state.settings.autoSell.maxValue
        ) {
          const sale = sell(n.id);
          result.autoSold = { value: sale.value };
        }
        results.push(result);
      }
      if (count === 5)
        state.counters.batches = (state.counters.batches || 0) + 1;
      unlockAchievements();
      return count === 1 ? results[0] : { results };
    }
    function sell(id) {
      const n = getNumber(id);
      if (n.status !== "owned" && n.status !== "in_phone")
        err("Номер сейчас занят");
      state.numbers = state.numbers.filter((x) => x.id !== n.id);
      if (state.primaryId === n.id) state.primaryId = null;
      for (const p of state.phones)
        for (const slot of p.slots)
          if (slot.number?.id === n.id) slot.number = null;
      change(n.value, "sell");
      state.sold++;
      questCount("sell");
      unlockAchievements();
      return { value: n.value, payout: n.value, balance: state.balance };
    }
    function reward(r) {
      if (r.luck) {
        state.consumables.luckBoostSpins += r.luck.spins || 0;
        state.consumables.luckBoostMultiplier = r.luck.multiplier || 2;
      }
      if (r.discount) {
        state.consumables.spinDiscountPercent = r.discount.percent || 0;
        state.consumables.spinDiscountUses += r.discount.uses || 0;
      }
      if (r.soft) change(Math.round(r.soft), "reward");
      for (const k of [
        "standardTickets",
        "plusTickets",
        "premiumTickets",
        "eliteTickets",
        "epicTickets",
        "topSecretTickets",
      ])
        if (r[k]) state.consumables[k] += r[k];
      if (r.luckSpins) {
        state.consumables.luckBoostSpins += r.luckSpins;
        state.consumables.luckBoostMultiplier = r.luckMultiplier || 2;
      }
      if (r.luckBoostSpins) {
        state.consumables.luckBoostSpins += r.luckBoostSpins;
        state.consumables.luckBoostMultiplier = r.luckBoostMultiplier || 2;
      }
      if (r.skin && !state.ownedSkins.includes(r.skin))
        state.ownedSkins.push(r.skin);
      if (r.vipDays || r.vipLifetime) state.vip = true;
      if (r.inventoryExtra)
        state.extra = Math.min(200, state.extra + r.inventoryExtra);
      if (r.phoneBox)
        state.consumables["box_" + r.phoneBox] =
          (state.consumables["box_" + r.phoneBox] || 0) + 1;
    }
    function questCount(kind) {
      for (const period of [day(), "week:" + Math.floor(now() / 604800000)]) {
        const k = period + ":" + kind;
        state.questCounts[k] = (state.questCounts[k] || 0) + 1;
      }
    }
    function daily() {
      const same = state.daily.last === day();
      const previous = new Date(now() - 86400000);
      const prev = `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, "0")}-${String(previous.getDate()).padStart(2, "0")}`;
      const next = state.daily.last === prev ? state.daily.streak + 1 : 1;
      return {
        ...clone(config.daily_status),
        gameDay: day(),
        canClaim: !same,
        currentStreak: state.daily.streak,
        nextStreak: next,
        nextReward:
          config.daily_status.rewards[
            (next - 1) % config.daily_status.rewards.length
          ],
        nextResetAt: tomorrow(),
        lastClaimDay: state.daily.last,
      };
    }
    function roulette() {
      const c = clone(config.roulette_status),
        total = 1 + skill("roulette_free");
      return {
        ...c,
        unlocked: level() >= c.unlockLevel,
        freeTotal: total,
        freeLeft: Math.max(
          0,
          total - (state.roulette.day === day() ? state.roulette.used : 0),
        ),
        consumables: clone(state.consumables),
      };
    }
    function shop() {
      const s = clone(config.shop);
      s.me = { ...s.me, vipLifetime: state.vip, tag: state.profile.tag };
      s.skins = s.skins.map((x) => ({
        ...x,
        owned: state.ownedSkins.includes(x.code),
        priceSoft: x.priceSoft ?? x.priceStars * 1000,
        priceStars: null,
      }));
      s.products = s.products.map((p) => ({
        ...p,
        stars: p.stars * 1000,
        owned: false,
        giftable: false,
      }));
      return s;
    }
    function pass() {
      const p = clone(config.pass);
      p.season = me().season;
      p.level = Math.min(p.maxLevel, Math.floor(state.passXp / p.levelXp));
      p.xp = state.passXp;
      p.xpInLevel = state.passXp % p.levelXp;
      p.vip = state.vip;
      if (p.vipProduct) p.vipProduct.stars *= 1000;
      p.levels = p.levels.map((x) => ({
        ...x,
        freeClaimed: state.passClaims.includes("free:" + x.level),
        vipClaimed: state.passClaims.includes("vip:" + x.level),
      }));
      p.claimable = p.levels.filter(
        (x) => x.level <= p.level && !x.freeClaimed,
      ).length;
      p.dailyResetAt = tomorrow();
      p.weeklyResetAt = iso(now() + 604800000);
      for (const type of ["daily", "weekly"])
        p[type] = p[type].map((q) => {
          const period =
              type === "daily"
                ? day()
                : "week:" + Math.floor(now() / 604800000),
            kind = q.code.includes("spin")
              ? "spin"
              : q.code.includes("epic")
                ? "epic"
                : q.code.includes("sell")
                  ? "sell"
                  : "daily";
          return {
            ...q,
            period,
            progress: Math.min(
              q.target,
              state.questCounts[period + ":" + kind] || 0,
            ),
            claimed: state.questClaims.includes(period + ":" + q.code),
          };
        });
      return p;
    }
    function achValue(a) {
      const code = a.code.replace(/_\d+$/, "");
      if (code === "spins") return state.spins;
      if (code.startsWith("rarity_"))
        return state.earnedByRarity[code.slice(7)] || 0;
      if (code === "countries")
        return new Set(state.numbers.map((n) => n.country.iso2)).size;
      if (code === "operators")
        return new Set(state.numbers.map((n) => n.operator.code)).size;
      if (code === "rarities_all")
        return Object.values(state.earnedByRarity).filter((n) => n > 0).length;
      if (code === "best_value")
        return Math.max(0, ...state.numbers.map((n) => n.value));
      if (code === "level") return level();
      if (code === "daily_streak") return state.daily.streak;
      if (code === "balance_max") return state.balance;
      if (code === "sold_system") return state.sold;
      if (code === "salons") return Object.keys(state.salons).length;
      if (code === "promos") return state.promoUsed.length;
      if (code === "skins_bought") return state.ownedSkins.length;
      return state.counters[code] || 0;
    }
    function unlockAchievements() {
      for (const a of config.achievements.items) {
        if (a.hidden) continue;
        if (!state.achievements.includes(a.code) && achValue(a) >= a.target) {
          state.achievements.push(a.code);
          reward(a.reward || {});
        }
      }
    }
    function achievements() {
      const a = clone(config.achievements);
      a.season = me().season;
      a.items = a.items.map((x) => ({
        ...x,
        id: x.code,
        progress: Math.min(x.target, achValue(x)),
        unlockedAt: state.achievements.includes(x.code) ? iso() : null,
      }));
      a.unlocked = state.achievements.length;
      return a;
    }
    function bot(id) {
      return user(id || int(101, 120));
    }
    function market() {
      if (!state.market.length) {
        for (let i = 0; i < 12; i++) {
          const n = generate(rarities[1 + (i % 4)], {}, "market");
          state.market.push({
            id: state.nextId++,
            number: n,
            seller: bot(101 + i),
            price: Math.round(n.value * (1.15 + i * 0.08)),
            isMine: false,
            createdAt: iso(),
          });
        }
      }
      return {
        unlocked: level() >= 6,
        unlockLevel: 6,
        commissionPercent: 5,
        listings: state.market.filter((x) => !x.isMine),
        mine: state.market.filter((x) => x.isMine),
      };
    }
    function auctions() {
      if (!state.auctions.length) {
        for (let i = 0; i < 4; i++) {
          const n = generate(rarities[2 + (i % 3)], {}, "auction"),
            p = Math.round(n.value * 0.8);
          state.auctions.push({
            id: state.nextId++,
            number: n,
            seller: bot(110 + i),
            startPrice: p,
            currentBid: null,
            bidsCount: 0,
            minNextBid: p,
            endsAt: iso(now() + 120000 * (i + 1)),
            status: "open",
            isMine: false,
            iAmLeading: false,
            isSystem: false,
          });
        }
      }
      settleAuctions();
      const open = state.auctions.filter((x) => x.status === "open");
      return {
        unlocked: level() >= 5,
        unlockLevel: 5,
        commissionPercent: 5,
        lots: open.filter((x) => !x.isMine),
        mine: state.auctions.filter((x) => x.isMine),
        bidding: state.auctions.filter((x) => x.iAmLeading),
        system: null,
      };
    }
    function settleAuctions() {
      for (const a of state.auctions) {
        if (a.status === "open" && Date.parse(a.endsAt) <= now()) {
          a.status = "finished";
          if (a.iAmLeading) {
            const n = {
              ...a.number,
              id: state.nextId++,
              status: "owned",
              origin: "auction",
              acquiredAt: iso(),
            };
            state.numbers.push(n);
          } else if (a.isMine) {
            if (rnd() < 0.7) {
              change(Math.round(a.startPrice * 0.95), "auction");
              state.numbers = state.numbers.filter((n) => n.id !== a.number.id);
              a.currentBid = a.startPrice;
              a.bidsCount = 1;
            } else {
              const n = state.numbers.find((n) => n.id === a.number.id);
              if (n) n.status = "owned";
            }
          }
        }
      }
    }
    function gameConfig(kind) {
      return {
        ...clone(config[kind + "_config"]),
        balance: state.balance,
        openCount: state.games[kind].filter(
          (g) => g.status === "open" && g.creator.id === 1,
        ).length,
        freeSlots: Math.max(0, me().inventory.limit - state.numbers.length),
      };
    }
    function gameBase(kind, body, creator = user()) {
      const c = gameConfig(kind),
        stake = Number(
          body.stake ??
            (kind === "duels"
              ? config.spins_config.tiers.find((t) => t.code === body.tier)
                  ?.price
              : 1000),
        );
      if (
        !Number.isSafeInteger(stake) ||
        stake < (c.minStake || 1) ||
        (c.maxStake && stake > c.maxStake)
      )
        err("Некорректная ставка");
      const g = {
        id: state.nextId++,
        status: "open",
        stake,
        creator,
        opponent: null,
        addressee: null,
        creatorOnline: true,
        winnerId: null,
        payout: null,
        commission: null,
        commissionPercent: 5,
        createdAt: iso(),
        expiresAt: iso(now() + 86400000),
        finishedAt: null,
        role: creator.id === 1 ? "creator" : null,
        canAccept: creator.id !== 1,
        canCancel: creator.id === 1,
        canReady: false,
        canRoll: false,
        canSpin: false,
        rematchOf: null,
        rematch: null,
        serverNow: iso(),
        creatorSide: body.side || "heads",
        side: body.side || "heads",
        winnerSide: null,
        firstId: null,
        readyDeadline: null,
        turnUserId: null,
        turnRound: null,
        turnDeadline: null,
        turnSec: 15,
        rollMs: 1800,
        revealMs: 3000,
        rolls: [],
        spins: [],
        tier: body.tier || "standard",
        tierTitle:
          config.spins_config.tiers.find((t) => t.code === body.tier)?.title ||
          "Стандарт",
        count: body.count || 1,
        creatorTotal: 0,
        opponentTotal: 0,
      };
      return g;
    }
    function settleCoin(g) {
      if (g.status === "finished") return;
      g.opponent = g.creator.id === 1 ? bot(102) : user();
      g.winnerSide = rnd() < 0.5 ? "heads" : "tails";
      g.winnerId = g.winnerSide === g.side ? g.creator.id : g.opponent.id;
      g.result = g.winnerSide;
      g.payout = Math.floor(g.stake * 1.9);
      g.commission = g.stake * 2 - g.payout;
      g.status = "finished";
      g.finishedAt = iso();
      g.canAccept = false;
      g.canCancel = false;
      if (g.winnerId === 1) change(g.payout, "coin_win");
    }
    function game(kind, id) {
      const g = state.games[kind].find((x) => x.id === Number(id));
      if (!g) err("Игра не найдена");
      g.serverNow = iso();
      return g;
    }
    function phoneStatus() {
      return { ...clone(config.phones), phones: clone(state.phones) };
    }
    function buyer() {
      const b = clone(config.buyer);
      b.gameDay = day();
      b.refreshAt = tomorrow();
      b.orders = b.orders.map((o) => ({
        ...o,
        sold: state.questCounts["buyer:" + o.id] || 0,
        matches: state.numbers
          .filter(
            (n) =>
              n.status === "owned" &&
              (o.kind === "ending"
                ? n.nationalNumber.endsWith(o.ending)
                : o.kind === "operator"
                  ? n.operator.color === o.operatorColor
                  : true),
          )
          .map((n) => ({
            instanceId: n.id,
            formatted: n.formatted,
            rarity: n.rarity,
            value: Math.round(n.value * o.multiplier),
            payout: Math.round(n.value * o.multiplier),
          })),
      }));
      return b;
    }
    function advanceSalons() {
      for (const salon of Object.values(state.salons)) {
        while (salon.stock.length && Date.parse(salon.nextSaleAt) <= now()) {
          const n = salon.stock.shift(),
            payout = Math.round(
              n.value * (1 + (skill("salon_markup") || 30) / 100),
            );
          salon.balance += payout;
          salon.earned += payout;
          state.numbers = state.numbers.filter((x) => x.id !== n.id);
          if (state.primaryId === n.id) state.primaryId = null;
          salon.nextSaleAt = iso(Date.parse(salon.nextSaleAt) + 60000);
        }
      }
    }
    function salonStatus() {
      advanceSalons();
      const s = clone(config.salons);
      s.markupPercent = skill("salon_markup") || 30;
      s.salons = s.salons.map((x) => {
        const salon = state.salons[x.operator.code];
        const candidates = state.numbers
          .filter(
            (n) =>
              n.operator.code === x.operator.code &&
              n.status === "owned" &&
              n.id !== state.primaryId,
          )
          .map((n) => ({
            ...decorate(n),
            instanceId: n.id,
            price: Math.round(n.value * (1 + s.markupPercent / 100)),
          }));
        return {
          ...x,
          owned: state.numbers.filter(
            (n) => n.operator.code === x.operator.code,
          ).length,
          salon: salon
            ? {
                ...clone(salon),
                cash: salon.balance,
                items: salon.stock.map((n) => ({
                  ...n,
                  instanceId: n.id,
                  price: Math.round(n.value * (1 + s.markupPercent / 100)),
                })),
                candidates,
                intervalMin: 1,
                maxLevel: 5,
                nextUpgradePrice: 50000 * salon.level,
                nextSaleAt: salon.stock.length ? salon.nextSaleAt : null,
              }
            : null,
        };
      });
      return s;
    }

    function forgeTargets(rarity) {
      if (!rarities.includes(rarity) || rarities.indexOf(rarity) < 2)
        rarity = "rare";
      if (
        !state.forgeTargets[rarity] ||
        Date.parse(state.forgeTargets[rarity].expiresAt) <= now()
      ) {
        const f = clone(config.forge_targets);
        Object.assign(f, {
          rarity,
          unlocked: level() >= 5,
          expiresAt: iso(now() + 300000),
          targets: Array.from({ length: 6 }, (_, i) => {
            const n = generate(rarity, {}, "forge");
            return { ...n, index: i };
          }),
        });
        state.forgeTargets[rarity] = f;
      }
      return state.forgeTargets[rarity];
    }
    function forgeQuote(body) {
      const f = forgeTargets(body.rarity || "rare");
      const target = f.targets[body.targetIndex ?? body.target ?? 0];
      if (!target) err("Цель не найдена");
      const ns = (body.instanceIds || []).map(getNumber);
      if (!ns.length || ns.length > 10) err("Выберите от 1 до 10 номеров");
      if (
        new Set(ns.map((n) => n.id)).size !== ns.length ||
        ns.some((n) => n.status !== "owned")
      )
        err("Номера недоступны");
      const stake = ns.reduce((s, n) => s + n.value, 0),
        soft = Number(body.soft || body.addSoft || 0);
      if (!Number.isSafeInteger(soft) || soft < 0 || soft > stake)
        err("Некорректная доплата");
      const chance =
        body.mode === "random"
          ? Number(body.chancePpm) / 1e6
          : Math.max(
              0.005,
              Math.min(0.75, ((stake + soft) / target.value) * 0.9),
            );
      if (!Number.isFinite(chance) || chance < 0.005 || chance > 0.75)
        err("Недопустимый шанс");
      return {
        mode: body.mode || "target",
        numbersValue: stake,
        enabled: true,
        unlocked: level() >= 5,
        target,
        rarity: f.rarity,
        chance,
        chancePpm: Math.round(chance * 1e6),
        chancePercent: chance * 100,
        stakeValue: stake,
        totalValue: stake + soft,
        soft,
        price: soft,
        maxSoft: stake,
        instanceIds: ns.map((n) => n.id),
        expiresAt: f.expiresAt,
        canRoll: true,
        houseEdge: 0.1,
      };
    }
    function crashState() {
      if (!state.crash)
        state.crash = {
          id: 1,
          start: now() + 7000,
          point: int(110, 800),
          myBet: null,
          last: null,
          history: [180, 240, 113, 388, 165],
        };
      const c = state.crash,
        elapsed = now() - c.start,
        mult = Math.floor(100 * Math.exp(Math.max(0, elapsed) * 0.00009));
      if (
        c.myBet?.status === "active" &&
        c.myBet.autoCashout &&
        mult >= c.myBet.autoCashout &&
        c.myBet.autoCashout <= c.point
      ) {
        c.myBet.status = "cashed";
        c.myBet.cashoutMult = c.myBet.autoCashout;
        c.myBet.payout = Math.floor(
          (c.myBet.stake * c.myBet.autoCashout) / 100,
        );
        change(c.myBet.payout, "crash_win");
      }
      if (elapsed > 0 && mult >= c.point) {
        if (c.myBet?.status === "active") {
          c.myBet.status = "lost";
          c.myBet.payout = 0;
        }
        c.last = {
          id: c.id,
          status: "crashed",
          bettingEndsAt: iso(c.start),
          startedAt: iso(c.start),
          crashPoint: c.point,
          crashedAt: iso(c.start + Math.log(c.point / 100) / 0.00009),
        };
        c.history.unshift(c.point);
        c.history = c.history.slice(0, 20);
        c.id++;
        c.start = now() + 7000;
        c.point = int(110, 800);
        c.myBet = null;
      }
      const flying = now() >= c.start,
        round = {
          id: c.id,
          status: flying ? "flying" : "betting",
          bettingEndsAt: iso(c.start),
          startedAt: flying ? iso(c.start) : null,
          crashPoint: null,
          crashedAt: null,
        };
      return {
        enabled: true,
        round,
        bets: c.myBet ? [clone(c.myBet)] : [],
        myBet: clone(c.myBet),
        last: clone(c.last),
        history: clone(c.history),
        minStake: 1000,
        maxStake: 10000000,
        maxMult: 10000,
        balance: state.balance,
        serverNow: iso(),
      };
    }
    function lottery() {
      const l = state.lottery;
      if (l.drawAt <= now()) {
        const won = l.tickets > 0 && rnd() < l.tickets / (l.tickets + 50);
        const payout = won ? Math.round((l.tickets + 50) * 10000 * 0.5) : 0;
        if (payout) change(payout, "lottery");
        l.last = {
          id: l.id,
          drawnAt: iso(),
          pool: (l.tickets + 50) * 10000,
          winners: won
            ? [{ user: user(), place: 1, prize: payout, amount: payout }]
            : [{ user: bot(108), place: 1, prize: 250000, amount: 250000 }],
        };
        l.id++;
        l.drawAt = now() + 300000;
        l.tickets = 0;
      }
      return {
        enabled: true,
        ticketPrice: 10000,
        maxPerUser: 100,
        shares: [50, 15, 5],
        burnPercent: 30,
        draw: {
          id: l.id,
          drawAt: iso(l.drawAt),
          pool: (l.tickets + 50) * 10000,
          tickets: l.tickets + 50,
          players: 10,
        },
        myTickets: l.tickets,
        last: clone(l.last),
        balance: state.balance,
      };
    }
    function run(path, method = "GET", body = {}) {
      const url = new URL(path, "http://offline.local"),
        p = url.pathname.replace(/^\/v1/, "");
      const q = url.searchParams;
      let m;
      if (p === "/auth/telegram" || p === "/auth/dev")
        return { token: "offline-local" };
      if (p === "/me") return me();
      if (p === "/countries") return clone(config.countries);
      if (p === "/spins/config") return spinConfig();
      if (p === "/progress") return progress();
      if (p === "/me/settings") {
        state.settings = {
          ...state.settings,
          ...body,
          notify: { ...state.settings.notify, ...body.notify },
        };
        return clone(state.settings);
      }
      if (p === "/subscription") return me().subscription;
      if (p === "/me/terms" || p === "/me/seen" || p === "/banners/views")
        return me();
      if (p === "/numbers" && method === "GET") {
        let ns = state.numbers.slice();
        if (q.get("rarity"))
          ns = ns.filter((n) => q.get("rarity").split(",").includes(n.rarity));
        if (q.get("status"))
          ns = ns.filter((n) => n.status === q.get("status"));
        if (q.get("country"))
          ns = ns.filter((n) => n.country.iso2 === q.get("country"));
        if (q.get("digits") || q.get("q"))
          ns = ns.filter((n) =>
            n.nationalNumber.includes(q.get("digits") || q.get("q")),
          );
        if (q.get("sort")?.includes("value"))
          ns.sort((a, b) => b.value - a.value);
        else ns.sort((a, b) => b.id - a.id);
        const total = ns.length;
        return {
          items: ns
            .slice(
              Number(q.get("offset") || 0),
              Number(q.get("offset") || 0) + Number(q.get("limit") || 100),
            )
            .map(decorate),
          total,
        };
      }
      if (p === "/spins" || p === "/spins/batch")
        return spins({
          ...body,
          count: p.endsWith("batch") ? body.count || 5 : 1,
        });
      if (p === "/numbers/bulk-sell") {
        const ids = body.instanceIds || [];
        if (new Set(ids).size !== ids.length) err("Повторяющиеся номера");
        const value = ids.reduce((s, id) => s + sell(id).value, 0);
        return { value, payout: value, count: ids.length };
      }
      if (p === "/numbers/sell-preview") {
        const ns = (body.instanceIds || []).map(getNumber);
        return {
          total: ns.reduce((s, n) => s + n.value, 0),
          payout: ns.reduce((s, n) => s + n.value, 0),
          count: ns.length,
          items: ns.map((n) => ({
            instanceId: n.id,
            formatted: n.formatted,
            rarity: n.rarity,
            value: n.value,
          })),
        };
      }
      if ((m = p.match(/^\/numbers\/(\d+)(?:\/(.+))?$/))) {
        const n = getNumber(m[1]),
          action = m[2];
        if (!action)
          return {
            ...decorate(n),
            number: decorate(n),
            canSell: n.status === "owned",
            canReroll: true,
            history: [{ type: n.origin, at: n.acquiredAt }],
            marketEstimate: null,
            owned: true,
            isMine: true,
            reroll: { unlocked: level() >= 4, unlockLevel: 4 },
            trade: { unlocked: level() >= 6, unlockLevel: 6 },
            skin: shop().skins,
          };
        if (action === "sell") return sell(n.id);
        if (action === "set-primary") {
          if (state.primaryChanges >= 3) change(-500, "primary");
          state.primaryChanges++;
          state.primaryId = n.id;
          return me();
        }
        if (action === "skin") {
          if (body.skin && !state.ownedSkins.includes(body.skin))
            err("Оформление не куплено");
          n.skin = body.skin;
          return { number: decorate(n) };
        }
        if (action === "trade-quote")
          return {
            marketUnlocked: level() >= 6,
            marketUnlockLevel: 6,
            auctionUnlocked: level() >= 5,
            auctionUnlockLevel: 5,
            durationsHours: [1, 3, 6, 12, 24],
            lockedUntil: null,
            minPrice: 1,
            maxPrice: Math.max(1, n.value * 10),
            commissionPercent: 5,
            value: n.value,
            market: true,
            auction: true,
          };
        if (action === "reroll") {
          const position = Number(body.position ?? q.get("position"));
          if (
            !Number.isInteger(position) ||
            position < n.prefixLength ||
            position >= n.nationalNumber.length
          )
            err("Выберите цифру номера");
          const price = Math.max(1000, Math.round(n.value * 0.1));
          if (method === "GET")
            return {
              unlocked: level() >= 4,
              unlockLevel: 4,
              position,
              currentValue: n.value,
              price,
              oldDigit: n.nationalNumber[position],
              options: Array.from({ length: 10 }, (_, i) => ({
                digit: String(i),
                value: n.value * (0.5 + i * 0.12),
                rarity: n.rarity,
                ppm: 100000,
              })).filter((o) => o.digit !== n.nationalNumber[position]),
            };
          change(-price, "reroll");
          const oldDigit = n.nationalNumber[position],
            previousValue = n.value;
          const digit = String((Number(oldDigit) + int(1, 9)) % 10);
          n.nationalNumber =
            n.nationalNumber.slice(0, position) +
            digit +
            n.nationalNumber.slice(position + 1);
          const country = config.countries.find(
            (c) => c.iso2 === n.country.iso2,
          );
          n.formatted = format(country, n.operator, n.nationalNumber);
          n.value = Math.round(n.value * (0.5 + rnd()));
          n.patterns = [];
          n.score = Math.round((n.score * n.value) / previousValue);
          return {
            number: decorate(n),
            oldDigit,
            digit,
            position,
            previousValue,
            price,
          };
        }
        if (action === "trophy/invoice") {
          if (n.trophy) err("Трофей уже сохранён");
          change(-99, "trophy");
          n.trophy = true;
          return { link: "offline:paid" };
        }
        if (action === "engraving/invoice") {
          if (n.engraving) err("Гравировка уже нанесена");
          change(-50, "engraving");
          n.engraving = { text: "@offline", at: iso(), createdAt: iso() };
          return {
            link: "offline:paid",
            url: "offline:paid",
            invoiceLink: "offline:paid",
          };
        }
      }
      if (p === "/primary-change/quote")
        return {
          freeLeft: Math.max(0, 3 - state.primaryChanges),
          price: state.primaryChanges < 3 ? 0 : 500,
          priceAfterFree: 500,
        };
      if (p === "/wallet/ledger")
        return {
          items: clone(state.ledger.slice(0, Number(q.get("limit") || 50))),
          total: state.ledger.length,
        };
      if (p === "/daily/status") return daily();
      if (p === "/daily/claim") {
        const d = daily();
        if (!d.canClaim) err("Награда уже получена");
        state.daily = { last: day(), streak: d.nextStreak };
        reward({
          soft: Math.round(d.nextReward * (1 + skill("daily_bonus") / 100)),
          ...config.daily_status.extras[
            (d.nextStreak - 1) % config.daily_status.extras.length
          ],
        });
        questCount("daily");
        return daily();
      }
      if (p === "/bonus/status")
        return {
          ...clone(
            config.bonus_status || {
              amount: 10000,
              cooldownSec: 3600,
              minSpinPrice: 1700,
            },
          ),
          needed: state.balance < 1700,
          availableAt: iso(state.bonusAt),
        };
      if (p === "/bonus/claim") {
        if (state.balance >= 1700)
          err("Бонус доступен, когда не хватает на крутку");
        if (state.bonusAt > now()) err("Бонус ещё не готов");
        change(10000, "bonus");
        state.bonusAt = now() + 3600000;
        return { amount: 10000, balance: state.balance };
      }
      if (p === "/roulette/status") return roulette();
      if (p === "/roulette/spin") {
        const r = roulette();
        if (state.roulette.day !== day())
          state.roulette = { day: day(), used: 0 };
        if (r.freeLeft > 0) state.roulette.used++;
        else change(-r.paidPrice, "roulette");
        const prize = weighted(r.prizes, "weight");
        if (prize.type === "soft") reward({ soft: prize.amount });
        else if (prize.type === "luck")
          reward({
            luckBoostMultiplier: prize.multiplier || prize.amount || 2,
            luckBoostSpins: prize.spins || 5,
          });
        else reward(prize.rewards || { [prize.type]: prize.amount || 1 });
        return {
          prize,
          index: r.prizes.findIndex((x) => x.id === prize.id),
          freeLeft: roulette().freeLeft,
          consumables: clone(state.consumables),
          balance: state.balance,
        };
      }
      if ((m = p.match(/^\/skills\/([^/]+)\/upgrade$/))) {
        const s = progress().skills.find((x) => x.code === m[1]);
        if (!s || s.nextCost === null) err("Навык уже улучшен");
        if (level() < s.nextMinLevel || progress().skillPoints < s.nextCost)
          err("Не хватает очков навыков или уровня");
        state.spentPoints += s.nextCost;
        state.ranks[s.code] = (state.ranks[s.code] || 0) + 1;
        return progress();
      }
      if (p === "/shop") return shop();
      if ((m = p.match(/^\/shop\/skins\/([^/]+)\/(buy|invoice)$/))) {
        const s = shop().skins.find((x) => x.code === m[1]);
        if (!s) err("Оформление не найдено");
        if (s.owned) err("Оформление уже куплено");
        change(-s.priceSoft, "shop");
        state.ownedSkins.push(s.code);
        return m[2] === "invoice"
          ? {
              link: "offline:paid",
              url: "offline:paid",
              invoiceLink: "offline:paid",
            }
          : shop();
      }
      if ((m = p.match(/^\/shop\/products\/([^/]+)\/invoice$/))) {
        const s = config.shop.products.find((x) => x.code === m[1]);
        if (!s) err("Предмет не найден");
        change(-s.stars * 1000, "shop");
        reward(s.rewards);
        return {
          link: "offline:paid",
          url: "offline:paid",
          invoiceLink: "offline:paid",
        };
      }
      if (p === "/shop/tag/invoice") {
        const text = String(body.text || body.tag || "")
          .trim()
          .slice(0, 16);
        if (!text) err("Введите подпись");
        change(-10000, "shop");
        state.profile.tag = text;
        return {
          link: "offline:paid",
          url: "offline:paid",
          invoiceLink: "offline:paid",
        };
      }
      if (p === "/shop/tag/clear") {
        state.profile.tag = null;
        return shop();
      }
      if (p === "/shop/support/invoice")
        err("Поддержка автора доступна в оригинальной игре");
      if (p === "/pass") return pass();
      if (p === "/pass/claim") {
        const track = body.track || "free",
          l = Number(body.level);
        const p = pass(),
          r = p.levels.find((x) => x.level === l);
        if (
          !r ||
          l > p.level ||
          (track === "vip" && !state.vip) ||
          state.passClaims.includes(track + ":" + l)
        )
          err("Награда недоступна");
        state.passClaims.push(track + ":" + l);
        reward(r[track] || {});
        return { pass: pass() };
      }
      if (p === "/quests/claim") {
        const p = pass(),
          quest = [...p.daily, ...p.weekly].find((x) => x.code === body.code);
        if (!quest || quest.claimed || quest.progress < quest.target)
          err("Задание ещё не выполнено");
        state.questClaims.push(quest.period + ":" + quest.code);
        state.passXp += quest.xp;
        return pass();
      }
      if (p === "/achievements") return achievements();
      if (p === "/achievements/unseen")
        return {
          items: achievements().items.filter(
            (x) => x.unlockedAt && !state.achSeen.includes(x.code),
          ),
        };
      if (p === "/achievements/seen") {
        state.achSeen.push(...(body.ids || []));
        return { ok: true };
      }
      if (p === "/buyer") return buyer();
      if ((m = p.match(/^\/buyer\/orders\/(\d+)\/sell$/))) {
        const order = buyer().orders.find((x) => x.id === Number(m[1])),
          n = getNumber(body.instanceId);
        if (
          !order ||
          order.sold >= order.limit ||
          !order.matches.some((x) => x.instanceId === n.id)
        )
          err("Номер не подходит заказу");
        const value = n.value,
          normal = sell(n.id);
        const payout = Math.round(
          value * order.multiplier * (1 + skill("buyer_bonus") / 100),
        );
        change(payout - normal.value, "buyer");
        state.questCounts["buyer:" + order.id] =
          (state.questCounts["buyer:" + order.id] || 0) + 1;
        return { payout };
      }
      if (p === "/market" && method === "GET") return market();
      if (p === "/market/stats")
        return {
          rarity: q.get("rarity"),
          period: q.get("period"),
          points: [],
          count: 0,
          median: null,
          volume: 0,
          stats: { count: 0 },
        };
      if (p.startsWith("/market/similar/"))
        return {
          items: market().listings.slice(0, 4),
          listings: market().listings.slice(0, 4),
        };
      if (
        p === "/market/list" ||
        p === "/market/listings" ||
        (p === "/market" && method === "POST")
      ) {
        const n = getNumber(body.instanceId);
        const price = Number(body.price);
        if (n.status !== "owned" || !Number.isSafeInteger(price) || price < 1)
          err("Некорректный лот");
        n.status = "listed";
        state.market.push({
          id: state.nextId++,
          number: decorate(n),
          seller: user(),
          price,
          isMine: true,
          createdAt: iso(),
        });
        return market();
      }
      if ((m = p.match(/^\/market\/(?:listings\/)?(\d+)\/(buy|cancel)$/))) {
        market();
        const listing = state.market.find((x) => x.id === Number(m[1]));
        if (!listing) err("Лот не найден");
        if (m[2] === "buy") {
          if (listing.isMine) err("Это ваш лот");
          if (state.numbers.length >= me().inventory.limit)
            err("Коллекция заполнена");
          change(-listing.price, "market");
          state.numbers.push({
            ...listing.number,
            id: state.nextId++,
            origin: "market",
            status: "owned",
            acquiredAt: iso(),
            previousOwnersCount: 1,
          });
        } else {
          if (!listing.isMine) err("Это чужой лот");
          getNumber(listing.number.id).status = "owned";
        }
        state.market = state.market.filter((x) => x !== listing);
        return market();
      }
      if (p === "/auctions" && method === "GET") return auctions();
      if (
        p === "/auctions/create" ||
        (p === "/auctions" && method === "POST")
      ) {
        const n = getNumber(body.instanceId),
          startPrice = Number(body.startPrice || body.price);
        if (
          n.status !== "owned" ||
          !Number.isSafeInteger(startPrice) ||
          startPrice < 1
        )
          err("Некорректный лот");
        n.status = "auctioned";
        state.auctions.push({
          id: state.nextId++,
          number: decorate(n),
          seller: user(),
          startPrice,
          currentBid: null,
          bidsCount: 0,
          minNextBid: startPrice,
          endsAt: iso(
            now() + Number(body.durationHours || body.hours || 1) * 3600000,
          ),
          status: "open",
          isMine: true,
          iAmLeading: false,
          isSystem: false,
        });
        return auctions();
      }
      if ((m = p.match(/^\/auctions\/(\d+)(?:\/(bid|cancel))?$/))) {
        auctions();
        const a = state.auctions.find((x) => x.id === Number(m[1]));
        if (!a) err("Аукцион не найден");
        if (m[2] === "bid") {
          const bid = Number(body.amount || body.bid);
          if (
            a.isMine ||
            a.status !== "open" ||
            !Number.isSafeInteger(bid) ||
            bid < a.minNextBid
          )
            err("Ставка недоступна");
          change(-(bid - (a.iAmLeading ? a.currentBid : 0)), "auction_bid");
          a.currentBid = bid;
          a.iAmLeading = true;
          a.bidsCount++;
          a.minNextBid = Math.ceil(bid * 1.05);
        }
        if (m[2] === "cancel") {
          if (!a.isMine || a.bidsCount) err("Нельзя отменить аукцион");
          getNumber(a.number.id).status = "owned";
          a.status = "cancelled";
        }
        return {
          lot: clone(a),
          bids: a.currentBid
            ? [
                {
                  user: a.iAmLeading ? user() : bot(),
                  amount: a.currentBid,
                  createdAt: iso(),
                },
              ]
            : [],
          canBid: !a.isMine && a.status === "open",
          canCancel: a.isMine && !a.bidsCount,
        };
      }
      if (p === "/direct-offers")
        return {
          commissionPercent: 5,
          incoming: [],
          outgoing: clone(state.offers),
        };
      if (p.startsWith("/direct-offers/"))
        err("Прямые сделки с реальными игроками недоступны офлайн");
      if (p === "/rating") {
        const entries = Array.from({ length: 10 }, (_, i) => ({
          rank: i + 1,
          user: bot(101 + i),
          value: Math.round(100000 / (i + 1)),
          score: Math.round(100000 / (i + 1)),
          isMe: false,
        }));
        entries.push({
          rank: 11,
          user: user(),
          value: state.balance,
          score: state.balance,
          isMe: true,
        });
        return {
          board: q.get("board") || "wealth",
          period: q.get("period") || "season",
          season: me().season,
          seasons: [me().season],
          entries,
          me: entries[10],
        };
      }
      if (p.startsWith("/players/by-username/")) {
        const name = decodeURIComponent(p.split("/").pop()),
          id = Number(name.replace(/\D/g, "")) || 101;
        return { user: { ...bot(id), name }, player: bot(id) };
      }
      if ((m = p.match(/^\/players\/(\d+)(?:\/numbers\/(\d+))?$/))) {
        if (m[2])
          return {
            number: decorate(getNumber(m[2])),
            owner: bot(Number(m[1])),
          };
        return {
          user: bot(Number(m[1])),
          stats: {
            total: 0,
            byRarity: Object.fromEntries(rarities.map((r) => [r, 0])),
          },
          numbers: [],
          primary: null,
          progress: { level: 10 },
          joinedAt: "2026-10-12T00:00:00Z",
        };
      }
      if (p === "/referrals")
        return {
          link: "",
          requiredLevel: 5,
          inviterSoft: 0,
          inviterLuck: { spins: 0, multiplier: 1 },
          inviteeSoft: 0,
          inviteeEliteTickets: 0,
          invited: 0,
          rewarded: 0,
          earned: 0,
          friends: [],
        };
      if (p === "/contest")
        return null; /*return {active:false,title:'Офлайн',numbers:[],startsAt:null,endsAt:null,channelUrl:'',requiredLevel:5,me:{invited:0,qualified:0,rank:null},top:[],participants:0};*/
      if (p === "/banners") return { banners: [] };
      if (p === "/salons" && method === "GET") return salonStatus();
      if (p === "/salons" && method === "POST") {
        const info = salonStatus().salons.find(
          (x) => x.operator.code === body.operator,
        );
        if (!info) err("Оператор не найден");
        if (info.owned < info.simsToOpen) err("Недостаточно номеров оператора");
        if (info.salon) err("Салон уже открыт");
        change(-info.openPrice, "salon_open");
        state.salons[body.operator] = {
          id: state.nextId++,
          level: 1,
          capacity: 10,
          stock: [],
          balance: 0,
          earned: 0,
          openedAt: iso(),
          nextSaleAt: iso(now() + 60000),
        };
        return salonStatus();
      }
      if (
        (m = p.match(
          /^\/salons\/(\d+)\/(shelf|collect|upgrade|shelf\/\d+\/remove)$/,
        ))
      ) {
        advanceSalons();
        const [op, salon] =
          Object.entries(state.salons).find(
            ([op, s]) => s.id === Number(m[1]),
          ) || [];
        if (!salon) err("Салон не найден");
        if (m[2] === "shelf") {
          const ids = body.instanceIds || [];
          if (
            !ids.length ||
            new Set(ids).size !== ids.length ||
            salon.stock.length + ids.length > salon.capacity
          )
            err("Недостаточно мест на витрине");
          for (const id of ids) {
            const n = getNumber(id);
            if (
              n.operator.code !== op ||
              n.status !== "owned" ||
              n.id === state.primaryId
            )
              err("Номер не подходит");
            n.status = "salon";
            salon.stock.push(decorate(n));
          }
          if (salon.stock.length === ids.length)
            salon.nextSaleAt = iso(now() + 60000);
        } else if (m[2] === "collect") {
          change(salon.balance, "salon_income");
          salon.balance = 0;
        } else if (m[2] === "upgrade") {
          if (salon.level >= 5) err("Максимальный уровень");
          change(-50000 * salon.level, "salon_upgrade");
          salon.level++;
          salon.capacity += 5;
        } else {
          const id = Number(m[2].split("/")[1]);
          if (!salon.stock.some((n) => n.id === id))
            err("Номер отсутствует на витрине");
          getNumber(id).status = "owned";
          salon.stock = salon.stock.filter((n) => n.id !== id);
        }
        return salonStatus();
      }

      if (p === "/phones" || p === "/phones/mine" || p === "/phones/inventory")
        return phoneStatus();
      if ((m = p.match(/^\/phones\/boxes\/([^/]+)\/open$/))) {
        const b = config.phones.boxes.find((x) => x.code === m[1]);
        if (!b) err("Коробка не найдена");
        if (state.consumables["box_" + b.code] > 0)
          state.consumables["box_" + b.code]--;
        else change(-b.price, "phone");
        const cls = weighted(
          Object.entries(b.odds).map(([rarity, ppm]) => ({ rarity, ppm })),
        ).rarity;
        const models = {
          budget: ["Syaomi", "Redmi 15C"],
          mid: ["Horror", "400"],
          flagship: ["Huiwai", "Mate 70 Pro"],
          premium: ["YaPhone", "17 Pro Max"],
          legend: ["Fartu", "Signature S"],
        };
        const model = models[cls] || models.budget;
        const phone = {
          id: state.nextId++,
          brand: model[0],
          model: model[1],
          class: cls,
          color: "Полночный чёрный",
          colorHex: "#111111",
          serial: state.nextId,
          supply: null,
          slots: Array.from({ length: cls === "budget" ? 1 : 2 }, (_, i) => ({
            slot: i + 1,
            number: null,
          })),
          value: Math.round(b.price * 0.4),
          bonuses: { salon: cls === "budget" ? 0 : 5, buyer: 0, reroll: 2 },
          active: false,
          match: false,
        };
        state.phones.push(phone);
        return { phone, status: phoneStatus() };
      }
      if ((m = p.match(/^\/phones\/(\d+)(?:\/(sell|slots\/\d+))?$/))) {
        const phone = state.phones.find((x) => x.id === Number(m[1]));
        if (!phone) err("Телефон не найден");
        if (!m[2]) return { phone: clone(phone), status: phoneStatus() };
        if (m[2] === "sell") {
          for (const s of phone.slots)
            if (s.number) {
              getNumber(s.number.id).status = "owned";
            }
          change(phone.value, "phone_sell");
          state.phones = state.phones.filter((x) => x !== phone);
          return { value: phone.value, status: phoneStatus() };
        }
        const slot = phone.slots.find(
          (s) => s.slot === Number(m[2].split("/")[1]),
        );
        if (!slot) err("Слот не найден");
        if (slot.number) getNumber(slot.number.id).status = "owned";
        if (method === "DELETE") slot.number = null;
        else {
          const n = getNumber(body.instanceId);
          if (n.status !== "owned") err("Номер занят");
          n.status = "in_phone";
          slot.number = decorate(n);
        }
        return phoneStatus();
      }
      if (p === "/forge/targets")
        return clone(forgeTargets(q.get("rarity") || "rare"));
      if (p === "/forge/targets/refresh") {
        const r = body.rarity || "rare";
        change(-5000, "forge_refresh");
        delete state.forgeTargets[r];
        return clone(forgeTargets(r));
      }
      if (p === "/forge/quote") return forgeQuote(body);
      if (p === "/forge/roll") {
        const quote = forgeQuote(body);
        change(-quote.soft, "forge");
        state.numbers = state.numbers.filter(
          (n) => !quote.instanceIds.includes(n.id),
        );
        if (quote.instanceIds.includes(state.primaryId)) state.primaryId = null;
        const won = rnd() < quote.chance;
        let n = null;
        if (won) {
          n = {
            ...quote.target,
            value:
              quote.mode === "random"
                ? Math.round(
                    ((quote.stakeValue + quote.soft) * 0.9) / quote.chance,
                  )
                : quote.target.value,
            id: state.nextId++,
            status: "owned",
            origin: "forge",
            acquiredAt: iso(),
          };
          state.numbers.push(n);
        }
        return {
          win: won,
          prize: n ? decorate(n) : null,
          payoutSoft: 0,
          mode: quote.mode,
          chancePpm: quote.chancePpm,
          stopAngle: won ? 180 : 0,
          success: won,
          won,
          number: n ? decorate(n) : null,
          chance: quote.chance,
          roll: rnd(),
          payout: n?.value || 0,
        };
      }
      if (p === "/games/online")
        return {
          online: 11,
          counts: { coin: 3, dice: 4, duel: 2, crash: 1, forge: 1 },
          games: { coin: 3, dice: 4, duel: 2, crash: 1, forge: 1 },
          players: 11,
          total: 11,
        };
      if ((m = p.match(/^\/(coins|dice|duels)(?:\/(.+))?$/))) {
        const kind = m[1],
          tail = m[2];
        if (tail === "config") return gameConfig(kind);
        if (tail === "lobby") {
          if (
            !state.games[kind].some(
              (g) => g.status === "open" && g.creator.id !== 1,
            )
          ) {
            for (let i = 0; i < 3; i++)
              state.games[kind].push(
                gameBase(
                  kind,
                  {
                    stake: [1000, 5000, 10000][i],
                    tier: "standard",
                    count: 1,
                    side: i % 2 ? "tails" : "heads",
                  },
                  bot(101 + i),
                ),
              );
          }
          return {
            [kind === "dice" ? "games" : kind]: clone(
              state.games[kind].filter(
                (g) => g.status === "open" && g.creator.id !== 1,
              ),
            ),
          };
        }
        if (tail === "mine")
          return {
            active: clone(
              state.games[kind].filter((g) =>
                ["ready", "playing"].includes(g.status),
              ),
            ),
            open: clone(
              state.games[kind].filter(
                (g) => g.status === "open" && g.creator.id === 1,
              ),
            ),
            incoming: [],
            history: clone(
              state.games[kind].filter(
                (g) =>
                  g.status === "finished" &&
                  (g.creator.id === 1 || g.opponent?.id === 1),
              ),
            ),
          };
        if (!tail) {
          const g = gameBase(kind, body);
          change(-g.stake * (kind === "duels" ? g.count : 1), kind);
          g.opponent = bot(102);
          g.canCancel = false;
          g.canReady = kind !== "coins";
          g.status = kind === "coins" ? "open" : "ready";
          g.readyDeadline = iso(now() + 60000);
          g.firstId = 1;
          state.games[kind].push(g);
          if (kind === "coins") settleCoin(g);
          return {
            [kind === "coins" ? "coin" : kind === "dice" ? "game" : "duel"]:
              clone(g),
          };
        }
        const [id, action] = tail.split("/"),
          g = game(kind, id);
        const wrapper = () => ({
          [kind === "coins" ? "coin" : kind === "dice" ? "game" : "duel"]:
            clone(g),
        });
        if (!action) return clone(g);
        if (action === "accept") {
          if (g.status !== "open" || g.creator.id === 1)
            err("Вызов недоступен");
          change(-g.stake * (kind === "duels" ? g.count : 1), kind);
          g.opponent = user();
          g.role = "opponent";
          g.canAccept = false;
          g.canReady = kind !== "coins";
          g.status = kind === "coins" ? "open" : "ready";
          g.readyDeadline = iso(now() + 60000);
          g.firstId = 1;
          if (kind === "coins") settleCoin(g);
          return wrapper();
        }
        if (action === "ready") {
          if (g.status !== "ready") err("Игра уже начата");
          g.status = "playing";
          g.canReady = false;
          g.turnUserId = 1;
          g.turnRound = 1;
          g.turnDeadline = iso(now() + 15000);
          g.canRoll = kind === "dice";
          g.canSpin = kind === "duels";
          return wrapper();
        }
        if (action === "roll" || action === "spin") {
          if (g.status !== "playing" || g.turnUserId !== 1)
            err("Сейчас не ваш ход");
          const opponent = g.creator.id === 1 ? g.opponent : g.creator;
          if (kind === "dice") {
            const a = int(1, 6),
              b = int(1, 6);
            g.rolls.push(
              {
                ord: g.rolls.length + 1,
                userId: 1,
                round: g.turnRound,
                value: a,
                at: iso(),
              },
              {
                ord: g.rolls.length + 2,
                userId: opponent.id,
                round: g.turnRound,
                value: b,
                at: iso(),
              },
            );
            g.creatorTotal += g.creator.id === 1 ? a : b;
            g.opponentTotal += g.creator.id === 1 ? b : a;
          } else {
            const tier =
              config.spins_config.tiers.find((t) => t.code === g.tier) ||
              config.spins_config.tiers[0];
            for (const who of [1, opponent.id]) {
              const n = generate(weighted(tier.odds).rarity, {}, "duel");
              g.spins.push({
                ord: g.spins.length + 1,
                userId: who,
                round: g.turnRound,
                number: decorate(n),
                value: n.value,
                at: iso(),
              });
              if (who === g.creator.id) g.creatorTotal += n.value;
              else g.opponentTotal += n.value;
            }
          }
          const rounds = kind === "dice" ? 3 : g.count;
          if (g.turnRound >= rounds) {
            g.status = "finished";
            g.canRoll = false;
            g.canSpin = false;
            g.winnerId =
              g.creatorTotal === g.opponentTotal
                ? null
                : g.creatorTotal > g.opponentTotal
                  ? g.creator.id
                  : g.opponent.id;
            g.payout = Math.floor(
              g.stake * (kind === "duels" ? g.count : 1) * 1.9,
            );
            g.commission =
              g.stake * (kind === "duels" ? g.count : 1) * 2 - g.payout;
            g.finishedAt = iso();
            if (g.winnerId === 1) change(g.payout, kind + "_win");
            else if (!g.winnerId)
              change(
                g.stake * (kind === "duels" ? g.count : 1),
                kind + "_draw",
              );
            if (kind === "duels" && g.winnerId === 1)
              for (const s of g.spins)
                state.numbers.push({
                  ...s.number,
                  id: state.nextId++,
                  origin: "duel",
                });
          } else {
            g.turnRound++;
            g.turnDeadline = iso(now() + 15000);
          }
          return wrapper();
        }
        if (action === "cancel" || action === "decline" || action === "leave") {
          if (g.status === "finished" || g.status === "cancelled")
            err("Игра уже завершена");
          if (g.creator.id === 1 || g.opponent?.id === 1)
            change(
              g.stake * (kind === "duels" ? g.count : 1),
              kind + "_refund",
            );
          g.status = "cancelled";
          g.canCancel = false;
          return wrapper();
        }
        if (action === "rematch") {
          const b = {
            stake: g.stake,
            tier: g.tier,
            count: g.count,
            side: g.side,
          };
          return run("/" + kind, "POST", b);
        }
      }
      if (p === "/crash/state") return crashState();
      if (p === "/crash/bet") {
        crashState();
        const c = state.crash,
          stake = Number(body.stake);
        if (now() >= c.start || c.myBet) err("Ставки закрыты");
        if (!Number.isSafeInteger(stake) || stake < 1000 || stake > 10000000)
          err("Некорректная ставка");
        change(-stake, "crash");
        c.myBet = {
          user: user(),
          stake,
          autoCashout: body.autoCashout || null,
          status: "active",
          cashoutMult: null,
          payout: null,
        };
        return { state: crashState() };
      }
      if (p === "/crash/cashout") {
        const s = crashState(),
          c = state.crash;
        if (
          !c.myBet ||
          c.myBet.status !== "active" ||
          s.round.status !== "flying"
        )
          err("Нельзя забрать ставку");
        const mult = Math.floor(100 * Math.exp((now() - c.start) * 0.00009));
        c.myBet.status = "cashed";
        c.myBet.cashoutMult = mult;
        c.myBet.payout = Math.floor((c.myBet.stake * mult) / 100);
        change(c.myBet.payout, "crash_win");
        return { state: crashState() };
      }
      if (p === "/lottery") return lottery();
      if (p === "/lottery/buy") {
        lottery();
        const count = Number(body.count || body.tickets || 1);
        if (
          !Number.isInteger(count) ||
          count < 1 ||
          state.lottery.tickets + count > 100
        )
          err("Некорректное количество билетов");
        change(-count * 10000, "lottery");
        state.lottery.tickets += count;
        return { state: lottery() };
      }
      if (p === "/promo") {
        const code = String(body.code || "")
          .trim()
          .toUpperCase();
        if (code !== "OFFLINE" || state.promoUsed.includes(code))
          err("Промокод недействителен или уже использован");
        state.promoUsed.push(code);
        reward({ soft: 100000, premiumTickets: 3 });
        return {
          reward: { soft: 100000, premiumTickets: 3 },
          message: "100 000 ₽ и 3 крутки «Премиум»",
        };
      }
      if (p.startsWith("/lookup/number"))
        return { found: false, number: null, owners: [] };
      err("Эта функция недоступна в офлайн-версии", "OFFLINE_UNAVAILABLE");
    }
    function request(path, method = "GET", body = {}) {
      const before = clone(state);
      try {
        const result = run(path, method, body || {});
        save();
        return clone(result);
      } catch (e) {
        state = before;
        throw e;
      }
    }
    save();
    return {
      request,
      get state() {
        return state;
      },
      get recovered() {
        return recovered;
      },
    };
  }
  root.CiferkiOffline = { createEngine };
  if (typeof module !== "undefined") module.exports = { createEngine };
})(globalThis);

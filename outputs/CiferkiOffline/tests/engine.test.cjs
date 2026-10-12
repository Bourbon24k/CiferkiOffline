const { test } = require("node:test");
const assert = require("node:assert/strict");
let createEngine;
try {
  ({ createEngine } = require("../Web/offline-engine.js"));
} catch {
  createEngine = () => {
    throw new Error("Offline engine not implemented");
  };
}
const storage = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
};
const make = (random = () => 0.5, store = storage()) =>
  createEngine(store, () => new Date("2026-10-12T12:00:00Z").getTime(), random);
test("new game has independent balance and an empty collection", () => {
  const e = make();
  assert.equal(e.request("/me").wallet.soft, 50000);
  assert.equal(e.request("/numbers").total, 0);
  assert.equal(e.request("/me").user.id, 1);
});
test("insufficient funds leave balance and collection unchanged", () => {
  const e = make();
  assert.throws(() => e.request("/spins", "POST", { tier: "elite" }), /денег/);
  assert.equal(e.request("/me").wallet.soft, 50000);
  assert.equal(e.request("/numbers").total, 0);
});
test("five standard spins debit exactly 8500 and create five numbers", () => {
  const e = make();
  const r = e.request("/spins/batch", "POST", { tier: "standard", count: 5 });
  assert.equal(r.results.length, 5);
  assert.equal(
    e.state.ledger
      .filter((x) => x.type === "spin")
      .reduce((s, x) => s + x.amount, 0),
    -8500,
  );
  assert.equal(e.request("/me").wallet.soft, 43500);
  assert.equal(e.request("/numbers").total, 5);
});
test("batch with insufficient funds is atomic", () => {
  const e = make();
  assert.throws(() =>
    e.request("/spins/batch", "POST", { tier: "premium", count: 5 }),
  );
  assert.equal(e.request("/me").wallet.soft, 50000);
  assert.equal(e.request("/numbers").total, 0);
});
test("premium guarantees rare or higher even at lower random boundary", () => {
  const e = make(() => 0);
  assert.equal(
    e.request("/spins", "POST", { tier: "premium" }).number.rarity,
    "rare",
  );
});
test("sale credits value once and prevents repeat sale", () => {
  const e = make();
  const n = e.request("/spins", "POST", { tier: "standard" }).number;
  const before = e.request("/me").wallet.soft;
  e.request(`/numbers/${n.id}/sell`, "POST", {});
  assert.equal(e.request("/me").wallet.soft, before + n.value);
  assert.throws(() => e.request(`/numbers/${n.id}/sell`, "POST", {}));
  assert.equal(e.request("/numbers").total, 0);
});
test("reload retains numbers and currency", () => {
  const store = storage();
  const e = make(() => 0.5, store);
  e.request("/spins", "POST", { tier: "standard" });
  const loaded = make(() => 0.5, store);
  assert.equal(loaded.request("/me").wallet.soft, 48300);
  assert.equal(loaded.request("/numbers").total, 1);
});
test("corrupt primary save recovers from backup with a visible recovery status", () => {
  const store = storage();
  const e = make(() => 0.5, store);
  e.request("/spins", "POST", { tier: "standard" });
  store.setItem("ciferki.offline.v1", "broken");
  const loaded = make(() => 0.5, store);
  assert.equal(loaded.request("/numbers").total, 1);
  assert.equal(loaded.recovered, true);
});
test("daily reward cannot be claimed twice on the same local day", () => {
  const e = make();
  e.request("/daily/claim", "POST", {});
  assert.equal(e.request("/me").wallet.soft, 60000);
  assert.throws(() => e.request("/daily/claim", "POST", {}), /получена/);
  assert.equal(e.request("/me").wallet.soft, 60000);
});
test("shop purchase debits currency and owned skin can be equipped", () => {
  const e = make();
  e.request("/shop/skins/graphite/buy", "POST", {});
  assert.equal(e.request("/me").wallet.soft, 20000);
  assert.equal(
    e.request("/shop").skins.find((x) => x.code === "graphite").owned,
    true,
  );
});
test("roulette free allowance cannot be reused by repeated calls", () => {
  const e = make();
  e.request("/roulette/spin", "POST", {});
  const after = e.request("/me").wallet.soft;
  e.request("/roulette/spin", "POST", {});
  assert.ok(e.request("/me").wallet.soft < after + 10000);
  assert.equal(e.request("/roulette/status").freeLeft, 0);
});
test("coin opponent resolves exactly once and reload cannot duplicate payout", () => {
  const e = make(() => 0.01);
  const r = e.request("/coins", "POST", { stake: 1000, side: "heads" });
  const settled = e.request(`/coins/${r.coin.id}`);
  assert.equal(settled.status, "finished");
  const bal = e.request("/me").wallet.soft;
  e.request(`/coins/${r.coin.id}`);
  assert.equal(e.request("/me").wallet.soft, bal);
});
test("offline API rejects unknown mutations rather than reporting fake success", () => {
  const e = make();
  assert.throws(() => e.request("/nonexistent", "POST", {}), /недоступ/);
});
test("spin result contains animation breakdown and unique spin ids", () => {
  const e = make();
  const a = e.request("/spins", "POST", { tier: "standard" }),
    b = e.request("/spins", "POST", { tier: "standard" });
  assert.ok(Array.isArray(a.valueBreakdown?.steps));
  assert.ok(Number.isFinite(a.valueBreakdown.base));
  assert.ok(Number.isInteger(a.xpGained));
  assert.ok(a.spinId);
  assert.notEqual(a.spinId, b.spinId);
});
test("games screen receives active lists and online counts", () => {
  const e = make();
  for (const kind of ["coins", "dice", "duels"])
    assert.ok(Array.isArray(e.request("/" + kind + "/mine").active));
  assert.equal(e.request("/games/online", "POST", {}).counts.dice, 4);
});
test("number detail exposes acquisition metadata at the top level", () => {
  const e = make();
  const n = e.request("/spins", "POST", { tier: "standard" }).number;
  const d = e.request("/numbers/" + n.id);
  assert.equal(d.id, n.id);
  assert.ok(Number.isFinite(Date.parse(d.acquiredAt)));
  assert.ok(Array.isArray(d.history));
});
test("market purchase transfers number once and charges listed price", () => {
  const e = make();
  const lot = e.request("/market").listings[0],
    before = e.state.balance;
  e.request(`/market/${lot.id}/buy`, "POST", {});
  assert.equal(e.state.balance, before - lot.price);
  assert.equal(e.request("/numbers").total, 1);
  assert.throws(() => e.request(`/market/${lot.id}/buy`, "POST", {}));
});
test("auction repeated bid only debits increase and expired win transfers once", () => {
  const store = storage();
  let time = Date.parse("2026-10-12T12:00:00Z");
  const e = createEngine(
    store,
    () => time,
    () => 0.5,
  );
  const lot = e.request("/auctions").lots[0];
  e.request(`/auctions/${lot.id}/bid`, "POST", { amount: lot.startPrice });
  e.request(`/auctions/${lot.id}/bid`, "POST", {
    amount: lot.startPrice + 1000,
  });
  assert.equal(e.state.balance, 50000 - lot.startPrice - 1000);
  time += 200000;
  e.request("/auctions");
  assert.equal(e.request("/numbers").total, 1);
  e.request("/auctions");
  assert.equal(e.request("/numbers").total, 1);
});
test("forge quote reports random mode and roll consumes exact stake once", () => {
  const e = make(() => 0.01);
  const n = e.request("/spins", "POST", { tier: "standard" }).number;
  const body = {
    mode: "random",
    instanceIds: [n.id],
    soft: 0,
    chancePpm: 450000,
  };
  const q = e.request("/forge/quote", "POST", body);
  assert.equal(q.mode, "random");
  assert.equal(q.numbersValue, n.value);
  assert.equal(q.chancePpm, 450000);
  const r = e.request("/forge/roll", "POST", body);
  assert.equal(r.win, true);
  assert.ok(r.prize || r.payoutSoft);
  assert.equal(
    e.request("/numbers").items.some((x) => x.id === n.id),
    false,
  );
  assert.throws(() => e.request("/forge/roll", "POST", body));
});
test("phone insertion and removal preserve number ownership", () => {
  const e = make();
  e.request("/promo", "POST", { code: "OFFLINE" });
  const n = e.request("/spins", "POST", { tier: "standard" }).number;
  const { phone } = e.request("/phones/boxes/budget/open", "POST", {});
  e.request(`/phones/${phone.id}/slots/1`, "PUT", { instanceId: n.id });
  assert.equal(e.request(`/numbers/${n.id}`).status, "in_phone");
  e.request(`/phones/${phone.id}/slots/1`, "DELETE");
  assert.equal(e.request(`/numbers/${n.id}`).status, "owned");
});
test("achievement notifications can be marked seen permanently", () => {
  const e = make();
  e.request("/spins/batch", "POST", { tier: "standard", count: 5 });
  const items = e.request("/achievements/unseen").items;
  assert.ok(items.length > 0);
  e.request("/achievements/seen", "POST", { ids: items.map((x) => x.id) });
  assert.equal(e.request("/achievements/unseen").items.length, 0);
});
test("virtual lobby games do not count against personal open-game limit", () => {
  const e = make();
  e.request("/duels/lobby");
  assert.equal(e.request("/duels/config").openCount, 0);
});
test("daily nested luck reward updates consumables after second day", () => {
  let time = Date.parse("2026-10-12T12:00:00Z");
  const e = createEngine(
    storage(),
    () => time,
    () => 0.5,
  );
  e.request("/daily/claim", "POST", {});
  time += 86400000;
  e.request("/daily/claim", "POST", {});
  assert.ok(e.state.consumables.luckBoostSpins > 0);
  assert.equal(e.state.consumables.luckBoostMultiplier, 2);
});
test("salon stock accrues cash with elapsed time and collection cannot double pay", () => {
  let time = Date.parse("2026-10-12T12:00:00Z");
  const e = createEngine(
    storage(),
    () => time,
    () => 0.5,
  );
  e.request("/promo", "POST", { code: "OFFLINE" });
  for (let i = 0; i < 20; i++)
    e.request("/spins", "POST", {
      tier: "standard",
      country: "US",
      operator: "ATB",
    });
  const open = e
    .request("/salons", "POST", { operator: "ATB" })
    .salons.find((s) => s.operator.code === "ATB").salon;
  assert.ok(Array.isArray(open.items));
  const n = e.request("/numbers").items[0];
  e.request(`/salons/${open.id}/shelf`, "POST", { instanceIds: [n.id] });
  time += 60001;
  const status = e
    .request("/salons")
    .salons.find((s) => s.operator.code === "ATB").salon;
  assert.ok(status.cash > 0);
  const before = e.state.balance;
  e.request(`/salons/${open.id}/collect`, "POST", {});
  assert.equal(e.state.balance, before + status.cash);
  e.request(`/salons/${open.id}/collect`, "POST", {});
  assert.equal(e.state.balance, before + status.cash);
});
test('winning duel with a default skin preserves usable collection after reload',()=>{const store=storage();let seed=7;const rng=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);const e=make(rng,store);e.request('/promo','POST',{code:'OFFLINE'});e.request('/shop/skins/graphite/buy','POST',{});e.request('/me/settings','PUT',{defaultSkin:'graphite'});const g=e.request('/duels','POST',{tier:'standard',count:1}).duel;e.request(`/duels/${g.id}/ready`,'POST',{});e.request(`/duels/${g.id}/spin`,'POST',{});assert.ok(e.request('/numbers').items.length>0);assert.equal(make(rng,store).request('/numbers').items[0].skin.code,'graphite');});
test('save missing required profile falls back to intact backup before rewriting',()=>{const store=storage();const e=make(()=>.5,store);e.request('/spins','POST',{tier:'standard'});const bad=JSON.parse(store.getItem('ciferki.offline.v1'));delete bad.profile;store.setItem('ciferki.offline.v1',JSON.stringify(bad));const loaded=make(()=>.5,store);assert.equal(loaded.recovered,true);assert.equal(loaded.request('/me').user.name,'Игрок');assert.equal(loaded.request('/numbers').total,1);});
test('roulette ticket, boost, discount and extra-attempt prizes are applied',()=>{const cases=[[.65,'standardTickets',1],[.80,'plusTickets',1],[.85,'luckBoostSpins',3],[.95,'spinDiscountUses',1]];for(const [random,key,value] of cases){const e=make(()=>random);e.request('/roulette/spin','POST',{});assert.equal(e.state.consumables[key],value);}const e=make(()=>.99);e.request('/roulette/spin','POST',{});assert.equal(e.request('/roulette/status').freeLeft,1);});
test('buyer daily quota resets on the next date',()=>{let time=Date.parse('2026-10-12T12:00:00Z');const e=createEngine(storage(),()=>time,()=>.5);const cfg=require('../Web/config.js');const order=cfg.buyer.orders.find(x=>x.kind==='operator');const c=cfg.countries.find(c=>c.operators.some(o=>o.color===order.operatorColor));const op=c.operators.find(o=>o.color===order.operatorColor);for(let i=0;i<3;i++){const n=e.request('/spins','POST',{tier:'standard',country:c.iso2,operator:op.code}).number;e.request(`/buyer/orders/${order.id}/sell`,'POST',{instanceId:n.id});}assert.equal(e.request('/buyer').orders.find(x=>x.id===order.id).sold,3);time+=86400000;assert.equal(e.request('/buyer').orders.find(x=>x.id===order.id).sold,0);});
function funded(random=()=>.5){const store=storage();make(random,store);const s=JSON.parse(store.getItem('ciferki.offline.v1'));s.balance=2000000;store.setItem('ciferki.offline.v1',JSON.stringify(s));return make(random,store);}
test('purchased inventory and time-limited luck have actual effects',()=>{const e=funded();e.request('/shop/products/slots_25/invoice','POST',{});assert.equal(e.request('/me').inventory.limit,125);e.request('/shop/products/luck2_1d/invoice','POST',{});assert.equal(e.request('/spins/config').luck.next,2);});
test('lifetime VIP purchase unlocks VIP pass and cannot be bought twice',()=>{const e=funded();e.request('/shop/products/vip_lifetime/invoice','POST',{});assert.equal(e.request('/pass').vip,true);assert.throws(()=>e.request('/shop/products/vip_lifetime/invoice','POST',{}));});
test('TopSecret ticket produces an owned short number and is consumed',()=>{const e=funded();e.request('/shop/products/topsecret_d2/invoice','POST',{});assert.ok(e.request('/spins/config').tiers.some(t=>t.code==='topsecret_d2'));const n=e.request('/spins','POST',{tier:'topsecret_d2'}).number;assert.ok(n.nationalNumber.length<=2);assert.equal(n.rarity,'mythic');assert.equal(e.request('/numbers').total,1);assert.throws(()=>e.request('/spins','POST',{tier:'topsecret_d2'}));});

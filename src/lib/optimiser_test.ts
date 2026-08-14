import { Catalog } from "./catalog";
import {
  optimizeBasket, haversine, normaliseBasket,
  BasketItem, OptimizerParams,
} from "./optimiser";

const HOME = { lat: 3.0, lng: 101.0 };
const KM10 = 0.0899321; // ~10 km of latitude

function mk(
  shops: { name: string; lat: number; lng: number }[],
  items: string[],
  prices: [number, number, number][]
) {
  return new Catalog({
    generated: "2026-08-11", priceDate: "2026-08-10", source: "t", note: "",
    items: items.map((n) => ({ n, u: "1kg", g: "G" })),
    shops: shops.map((s) => ({
      n: s.name, a: "a", t: "Pasar Mini", d: "Petaling", s: "Selangor",
      lat: s.lat, lng: s.lng,
    })),
    prices: prices.map(([s, i, p]) => [s, i, p, 0] as [number, number, number, number]),
  });
}

const P: OptimizerParams = { radiusKm: 30, costPerKm: 0.15, fixedStopCost: 5 };
const B = (...pairs: [number, number][]): BasketItem[] =>
  pairs.map(([itemIndex, qty]) => ({ itemIndex, qty }));

let fails = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        got ${a}\n       want ${e}`}`);
}
function near(label: string, actual: number, expected: number, tol = 0.05) {
  const ok = Math.abs(actual - expected) <= tol;
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  got ${actual}, want ~${expected}`}`);
}

// ============================================================
console.log("--- haversine against known distances ---");
near("KL -> Ipoh ~ 175 km",
  haversine({ lat: 3.139, lng: 101.687 }, { lat: 4.5975, lng: 101.0901 }), 175, 6);
near("KL -> Penang ~ 300 km",
  haversine({ lat: 3.139, lng: 101.687 }, { lat: 5.4141, lng: 100.3288 }), 300, 10);
near("KL -> Johor Bahru ~ 297 km",
  haversine({ lat: 3.139, lng: 101.687 }, { lat: 1.4927, lng: 103.7414 }), 297, 10);
near("same point = 0", haversine(HOME, HOME), 0);
near("0.0899 deg latitude ~ 10 km",
  haversine(HOME, { lat: 3.0 + KM10, lng: 101.0 }), 10, 0.1);

// ============================================================
console.log("\n--- basket normalisation ---");
check("duplicates merged",
  normaliseBasket(B([0, 1], [0, 2], [1, 1])), [{ itemIndex: 0, qty: 3 }, { itemIndex: 1, qty: 1 }]);
check("zero qty dropped", normaliseBasket(B([0, 0], [1, 2])), [{ itemIndex: 1, qty: 2 }]);
check("negative qty dropped", normaliseBasket(B([0, -5])), []);
check("NaN qty dropped", normaliseBasket([{ itemIndex: 0, qty: NaN }]), []);

// ============================================================
console.log("\n--- single shop clearly cheapest ---");
{
  const c = mk(
    [{ name: "A", lat: 3.0, lng: 101.0 }, { name: "B", lat: 3.0 + KM10, lng: 101.0 }],
    ["rice", "eggs"],
    [[0, 0, 5], [0, 1, 3], [1, 0, 9], [1, 1, 8]]
  );
  const r = optimizeBasket(c, B([0, 1], [1, 1]), HOME, P);
  check("recommends single", r.recommended!.type, "single");
  check("picks shop A", (r.recommended as any).shopIndex, 0);
  near("basket 5+3", r.bestSingle!.basketCost, 8);
  near("total 8 + 0km + 5", r.bestSingle!.totalCost, 13);
  check("degenerate pair rejected -> no split offered", r.bestSplit, null);
}

// ============================================================
console.log("\n--- split genuinely wins ---");
{
  const c = mk(
    [{ name: "A", lat: 3.0, lng: 101.0 }, { name: "B", lat: 3.0, lng: 101.0 }],
    ["rice", "eggs"],
    [[0, 0, 5], [0, 1, 50], [1, 0, 50], [1, 1, 5]]
  );
  const r = optimizeBasket(c, B([0, 1], [1, 1]), HOME, P);
  check("recommends split", r.recommended!.type, "two-shop");
  near("split basket 5+5", r.bestSplit!.basketCost, 10);
  near("split total 10 + 0km + 10", r.bestSplit!.totalCost, 20);
  near("single was 55 + 5", r.bestSingle!.totalCost, 60);
  check("rice from A", r.bestSplit!.items.find(i => i.itemIndex === 0)!.shopIndex, 0);
  check("eggs from B", r.bestSplit!.items.find(i => i.itemIndex === 1)!.shopIndex, 1);
  check("both shops genuinely used",
    new Set(r.bestSplit!.items.map(i => i.shopIndex)).size, 2);
}

// ============================================================
console.log("\n--- fixed stop cost suppresses a trivial saving ---");
{
  const c = mk(
    [{ name: "A", lat: 3.0, lng: 101.0 }, { name: "B", lat: 3.0, lng: 101.0 }],
    ["rice", "eggs"],
    [[0, 0, 5], [0, 1, 5], [1, 0, 5], [1, 1, 4]]
  );
  const r = optimizeBasket(c, B([0, 1], [1, 1]), HOME, P);
  check("single wins: RM1 saved is not worth a second stop", r.recommended!.type, "single");
}

// ============================================================
console.log("\n--- distance decides the split ---");
{
  // Savings RM10, extra distance 20km -> break-even k = (10-5)/20 = 0.25
  const c = mk(
    [{ name: "A", lat: 3.0, lng: 101.0 }, { name: "B", lat: 3.0 + KM10, lng: 101.0 }],
    ["rice", "eggs"],
    [[0, 0, 5], [0, 1, 15], [1, 0, 99], [1, 1, 5]]
  );
  const cheap = optimizeBasket(c, B([0, 1], [1, 1]), HOME, { ...P, costPerKm: 0.15 });
  const dear = optimizeBasket(c, B([0, 1], [1, 1]), HOME, { ...P, costPerKm: 0.50 });
  check("split wins when driving is cheap", cheap.recommended!.type, "two-shop");
  check("single wins when driving is expensive", dear.recommended!.type, "single");
  near("break-even ~ RM0.25/km", cheap.breakEvenCostPerKm!, 0.25, 0.02);
}

// ============================================================
console.log("\n--- quantities ---");
{
  const c = mk([{ name: "A", lat: 3.0, lng: 101.0 }], ["rice"], [[0, 0, 7]]);
  near("3 x 7.00", optimizeBasket(c, B([0, 3]), HOME, P).bestSingle!.basketCost, 21);
  near("duplicate entries summed, not double-counted",
    optimizeBasket(c, B([0, 1], [0, 2]), HOME, P).bestSingle!.basketCost, 21);
  check("one line item per product",
    optimizeBasket(c, B([0, 1], [0, 2]), HOME, P).bestSingle!.items.length, 1);
}

// ============================================================
console.log("\n--- no single shop covers the basket ---");
{
  const c = mk(
    [{ name: "A", lat: 3.0, lng: 101.0 }, { name: "B", lat: 3.0, lng: 101.0 }],
    ["rice", "eggs"],
    [[0, 0, 5], [1, 1, 3]]
  );
  const r = optimizeBasket(c, B([0, 1], [1, 1]), HOME, P);
  check("no single option", r.bestSingle, null);
  check("split found", r.bestSplit !== null, true);
  check("recommends split", r.recommended!.type, "two-shop");
  check("gap null when only one option", r.gap, null);
  check("break-even null when only one option", r.breakEvenCostPerKm, null);
}

// ============================================================
console.log("\n--- FIX 1: degenerate split rejected ---");
{
  const c = mk(
    [{ name: "A", lat: 3.0, lng: 101.0 }, { name: "B", lat: 3.0 + KM10, lng: 101.0 }],
    ["rice", "eggs"],
    [[0, 0, 5], [0, 1, 3], [1, 0, 9], [1, 1, 8]]
  );
  const r = optimizeBasket(c, B([0, 1], [1, 1]), HOME, P);
  check("no fake split reported", r.bestSplit, null);
}

// ============================================================
console.log("\n--- FIX 2: item sold nationally but not nearby ---");
{
  const c = mk(
    [{ name: "NEAR", lat: 3.0, lng: 101.0 }, { name: "FAR", lat: 5.0, lng: 101.0 }],
    ["rice", "eggs"],
    [[0, 0, 5], [1, 1, 3]]
  );
  const r = optimizeBasket(c, B([0, 1], [1, 1]), HOME, { ...P, radiusKm: 20 });
  check("eggs flagged out of range", r.outOfRangeItems, [1]);
  check("not confused with 'nobody sells it'", r.unavailableItems, []);
  check("reason is explicit", r.noPlanReason, "items-not-sold-nearby");
}

// ============================================================
console.log("\n--- item nobody sells at all ---");
{
  const c = mk([{ name: "A", lat: 3.0, lng: 101.0 }], ["rice", "caviar"], [[0, 0, 5]]);
  const r = optimizeBasket(c, B([0, 1], [1, 1]), HOME, P);
  check("flagged unavailable", r.unavailableItems, [1]);
  check("distinct from out-of-range", r.outOfRangeItems, []);
  check("reason is explicit", r.noPlanReason, "items-not-sold-anywhere");
}

// ============================================================
console.log("\n--- empty basket ---");
{
  const c = mk([{ name: "A", lat: 3.0, lng: 101.0 }], ["rice"], [[0, 0, 5]]);
  check("reason", optimizeBasket(c, [], HOME, P).noPlanReason, "empty-basket");
  check("all-zero-qty basket also empty",
    optimizeBasket(c, B([0, 0]), HOME, P).noPlanReason, "empty-basket");
}

// ============================================================
console.log("\n--- no shops in range ---");
{
  const c = mk([{ name: "FAR", lat: 5.0, lng: 101.0 }], ["rice"], [[0, 0, 5]]);
  const r = optimizeBasket(c, B([0, 1]), HOME, { ...P, radiusKm: 5 });
  check("reason", r.noPlanReason, "no-shops-in-range");
  near("nearest shop distance reported", r.nearestShopKm!, 222, 5);
}

// ============================================================
console.log("\n--- single candidate shop: no pair possible ---");
{
  const c = mk([{ name: "A", lat: 3.0, lng: 101.0 }], ["rice"], [[0, 0, 5]]);
  const r = optimizeBasket(c, B([0, 1]), HOME, P);
  check("single found", r.bestSingle !== null, true);
  check("no split", r.bestSplit, null);
  check("recommends the single", r.recommended!.type, "single");
}

// ============================================================
console.log("\n--- exact tie prefers fewer stops ---");
{
  const c = mk(
    [{ name: "A", lat: 3.0, lng: 101.0 }, { name: "B", lat: 3.0, lng: 101.0 }],
    ["rice", "eggs"],
    [[0, 0, 5], [0, 1, 10], [1, 0, 20], [1, 1, 5]]
  );
  const r = optimizeBasket(c, B([0, 1], [1, 1]), HOME, P);
  near("single total", r.bestSingle!.totalCost, 20);
  near("split total", r.bestSplit!.totalCost, 20);
  check("tie goes to single shop", r.recommended!.type, "single");
}

// ============================================================
console.log("\n--- performance ---");
{
  const n = 120;
  const shops = Array.from({ length: n }, (_, i) => ({
    name: `S${i}`, lat: 3.0 + (i % 12) * 0.01, lng: 101.0 + Math.floor(i / 12) * 0.01,
  }));
  const items = Array.from({ length: 40 }, (_, i) => `item${i}`);
  const prices: [number, number, number][] = [];
  for (let s = 0; s < n; s++)
    for (let i = 0; i < 40; i++)
      if ((s + i) % 3 !== 0) prices.push([s, i, 5 + ((s * i) % 20)]);
  const c = mk(shops, items, prices);
  const basket = B(...Array.from({ length: 15 }, (_, i) => [i, 1] as [number, number]));
  const t0 = Date.now();
  const r = optimizeBasket(c, basket, HOME, P);
  const ms = Date.now() - t0;
  console.log(`  ${r.candidatesChecked} candidates, ${r.candidatesChecked * (r.candidatesChecked - 1) / 2} pairs, 15 items -> ${ms} ms`);
  check("under 500ms", ms < 500, true);
}

console.log(`\n${fails === 0 ? "ALL PASSED" : `${fails} FAILURE(S)`}`);
process.exit(fails === 0 ? 0 : 1);
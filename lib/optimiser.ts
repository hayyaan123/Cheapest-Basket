import { Catalog, Shop } from "./catalog";

// ============================================================
// Types
// ============================================================

export interface BasketItem {
  itemIndex: number;
  qty: number;
}

export interface HomeLocation {
  lat: number;
  lng: number;
}

export interface OptimizerParams {
  /** Only shops within this straight-line distance are considered. */
  radiusKm: number;
  /** Cost of driving 1 km. Default RM0.15 = RON95 at RM1.99/l / 7L per 100km. */
  costPerKm: number;
  /** Cost of making one stop: parking, queueing, time. Not distance-related. */
  fixedStopCost: number;
}

export interface PurchasedItem {
  itemIndex: number;
  qty: number;
  unitPrice: number;
  totalPrice: number;
  shopIndex: number;
}

export interface SingleShopResult {
  type: "single";
  shopIndex: number;
  basketCost: number;
  distanceKm: number;
  travelCost: number;
  stopCost: number;
  totalCost: number;
  items: PurchasedItem[];
}

export interface TwoShopResult {
  type: "two-shop";
  shopIndices: [number, number];
  basketCost: number;
  distanceKm: number;
  travelCost: number;
  stopCost: number;
  totalCost: number;
  items: PurchasedItem[];
}

export type PlanResult = SingleShopResult | TwoShopResult;

/** Why no plan could be produced. `null` when a plan was found. */
export type NoPlanReason =
  | "empty-basket"
  | "no-shops-in-range"
  | "items-not-sold-anywhere"
  | "items-not-sold-nearby"
  | null;

export interface OptimizerResult {
  bestSingle: SingleShopResult | null;
  bestSplit: TwoShopResult | null;
  recommended: PlanResult | null;

  /** How much cheaper the recommendation is than the runner-up. */
  gap: number | null;

  /**
   * The costPerKm at which single-shop and split become equal cost.
   * Splitting is worth it while costPerKm stays BELOW this.
   *
   * null when the comparison doesn't depend on distance: either one of
   * the two options doesn't exist, or the split needs no extra travel.
   */
  breakEvenCostPerKm: number | null;

  candidatesChecked: number;
  /** Distance to the closest shop, even if it fell outside the radius. */
  nearestShopKm: number | null;

  /** Basket items no shop in the whole dataset sells. */
  unavailableItems: number[];
  /** Basket items sold somewhere, but not by any shop within the radius. */
  outOfRangeItems: number[];

  noPlanReason: NoPlanReason;
}

// ============================================================
// Distance
// ============================================================

const EARTH_RADIUS_KM = 6371;

/**
 * Great-circle distance between two points, in km.
 *
 * Exported so it can be unit tested directly against known distances
 * rather than only inferred from optimizer output.
 *
 * NOTE: this is straight-line distance. Real road distance in the Klang
 * Valley typically runs 20-40% longer. Swapping in a routing service
 * means changing this function only -- nothing else depends on how the
 * number is produced.
 */
export function haversine(a: HomeLocation, b: HomeLocation): number {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const deltaLat = ((b.lat - a.lat) * Math.PI) / 180;
  const deltaLng = ((b.lng - a.lng) * Math.PI) / 180;

  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;

  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// ============================================================
// Basket normalisation
// ============================================================

/**
 * Collapses the basket into one entry per item and drops non-positive
 * quantities.
 *
 * Without this, a basket of [rice x1, rice x2] produced two separate line
 * items for the same product. The arithmetic was right (3 units charged)
 * but the coverage check ran on unique indexes while costing ran on raw
 * entries, so the two halves of the function disagreed about what the
 * basket actually was.
 */
export function normaliseBasket(basket: readonly BasketItem[]): BasketItem[] {
  const merged = new Map<number, number>();

  for (const { itemIndex, qty } of basket) {
    if (!Number.isFinite(qty) || qty <= 0) continue;
    if (!Number.isInteger(itemIndex) || itemIndex < 0) continue;
    merged.set(itemIndex, (merged.get(itemIndex) ?? 0) + qty);
  }

  return [...merged].map(([itemIndex, qty]) => ({ itemIndex, qty }));
}

// ============================================================
// Optimizer
// ============================================================

function emptyResult(
  reason: NoPlanReason,
  extra: Partial<OptimizerResult> = {}
): OptimizerResult {
  return {
    bestSingle: null,
    bestSplit: null,
    recommended: null,
    gap: null,
    breakEvenCostPerKm: null,
    candidatesChecked: 0,
    nearestShopKm: null,
    unavailableItems: [],
    outOfRangeItems: [],
    noPlanReason: reason,
    ...extra,
  };
}

export function optimizeBasket(
  catalog: Catalog,
  rawBasket: readonly BasketItem[],
  home: HomeLocation,
  params: OptimizerParams
): OptimizerResult {
  const basket = normaliseBasket(rawBasket);

  if (basket.length === 0) {
    return emptyResult("empty-basket");
  }

  const itemIndexes = basket.map((b) => b.itemIndex);

  // ----------------------------------------------------------
  // Items nobody in the dataset sells. Distinct from "nothing
  // nearby sells them" -- the user needs to know which it is.
  // ----------------------------------------------------------
  const unavailableItems = catalog.unavailableItems(itemIndexes);
  if (unavailableItems.length > 0) {
    return emptyResult("items-not-sold-anywhere", { unavailableItems });
  }

  // ==========================================================
  // 1. SHORTLIST
  //
  // Home distances are computed once here and reused throughout.
  // Previously haversine ran again for every single-shop candidate
  // and three times per pair -- tens of thousands of redundant calls.
  // ==========================================================
  const candidates: Shop[] = [];
  const homeDist = new Map<number, number>();
  let nearestShopKm: number | null = null;

  for (const shop of catalog.shops) {
    const d = haversine(home, shop);

    if (nearestShopKm === null || d < nearestShopKm) {
      nearestShopKm = d;
    }

    if (d <= params.radiusKm) {
      candidates.push(shop);
      homeDist.set(shop.index, d);
    }
  }

  if (candidates.length === 0) {
    return emptyResult("no-shops-in-range", { nearestShopKm });
  }

  // ----------------------------------------------------------
  // Items sold somewhere in Malaysia, but not by anything nearby.
  //
  // This was the most serious bug in the first version: availability
  // was checked against the ENTIRE national catalogue while shops were
  // filtered by radius. A basket containing an item stocked only 200km
  // away produced `recommended: null` with an empty unavailable list --
  // a silent dead end with nothing to show the user.
  // ----------------------------------------------------------
  const candidateSet = new Set(candidates.map((s) => s.index));
  const outOfRangeItems = itemIndexes.filter(
    (i) => !catalog.shopsStocking(i).some((s) => candidateSet.has(s))
  );

  if (outOfRangeItems.length > 0) {
    return emptyResult("items-not-sold-nearby", {
      outOfRangeItems,
      candidatesChecked: candidates.length,
      nearestShopKm,
    });
  }

  // ==========================================================
  // 2. SINGLE-SHOP
  // ==========================================================
  let bestSingle: SingleShopResult | null = null;

  for (const shop of candidates) {
    if (!catalog.stocksAll(shop.index, itemIndexes)) continue;

    let basketCost = 0;
    const items: PurchasedItem[] = [];

    for (const { itemIndex, qty } of basket) {
      // Guaranteed present: stocksAll() passed for this shop.
      const unitPrice = catalog.priceOf(shop.index, itemIndex)!;
      const totalPrice = unitPrice * qty;
      basketCost += totalPrice;
      items.push({ itemIndex, qty, unitPrice, totalPrice, shopIndex: shop.index });
    }

    // Home -> shop -> home
    const distanceKm = 2 * homeDist.get(shop.index)!;
    const travelCost = distanceKm * params.costPerKm;
    const stopCost = params.fixedStopCost;

    const result: SingleShopResult = {
      type: "single",
      shopIndex: shop.index,
      basketCost,
      distanceKm,
      travelCost,
      stopCost,
      totalCost: basketCost + travelCost + stopCost,
      items,
    };

    if (bestSingle === null || result.totalCost < bestSingle.totalCost) {
      bestSingle = result;
    }
  }

  // ==========================================================
  // 3. TWO-SHOP
  // ==========================================================
  let bestSplit: TwoShopResult | null = null;

  for (let i = 0; i < candidates.length; i++) {
    const shopA = candidates[i];

    for (let j = i + 1; j < candidates.length; j++) {
      const shopB = candidates[j];

      let basketCost = 0;
      let possible = true;
      let usedA = false;
      let usedB = false;
      const items: PurchasedItem[] = [];

      for (const { itemIndex, qty } of basket) {
        const priceA = catalog.priceOf(shopA.index, itemIndex);
        const priceB = catalog.priceOf(shopB.index, itemIndex);

        if (priceA === undefined && priceB === undefined) {
          possible = false;
          break;
        }

        let shopIndex: number;
        let unitPrice: number;

        if (priceA === undefined) {
          shopIndex = shopB.index;
          unitPrice = priceB!;
        } else if (priceB === undefined) {
          shopIndex = shopA.index;
          unitPrice = priceA;
        } else if (priceA <= priceB) {
          // Tie goes to A, so results are deterministic.
          shopIndex = shopA.index;
          unitPrice = priceA;
        } else {
          shopIndex = shopB.index;
          unitPrice = priceB;
        }

        if (shopIndex === shopA.index) usedA = true;
        else usedB = true;

        const totalPrice = unitPrice * qty;
        basketCost += totalPrice;
        items.push({ itemIndex, qty, unitPrice, totalPrice, shopIndex });
      }

      if (!possible) continue;

      // ------------------------------------------------------
      // Reject degenerate pairs.
      //
      // If every item came from one shop, this is a single-shop trip
      // wearing a costume. Charging it two stops plus a detour to a
      // shop you buy nothing from is not a real plan, and the UI would
      // show "split between A and B" with nothing listed under B.
      // The genuine single-shop option is already covered in step 2.
      // ------------------------------------------------------
      if (!usedA || !usedB) continue;

      // Home -> A -> B -> home.
      // The A-to-B leg is what actually decides whether splitting is
      // affordable: two shops next door cost almost nothing extra,
      // two on opposite sides of town cost a lot.
      const distanceKm =
        homeDist.get(shopA.index)! +
        haversine(shopA, shopB) +
        homeDist.get(shopB.index)!;

      const travelCost = distanceKm * params.costPerKm;
      const stopCost = 2 * params.fixedStopCost;

      const result: TwoShopResult = {
        type: "two-shop",
        shopIndices: [shopA.index, shopB.index],
        basketCost,
        distanceKm,
        travelCost,
        stopCost,
        totalCost: basketCost + travelCost + stopCost,
        items,
      };

      if (bestSplit === null || result.totalCost < bestSplit.totalCost) {
        bestSplit = result;
      }
    }
  }

  // ==========================================================
  // 4. COMPARE
  // ==========================================================
  let recommended: PlanResult | null = null;
  let gap: number | null = null;
  let breakEvenCostPerKm: number | null = null;

  if (bestSingle && bestSplit) {
    // Ties favour the single shop: same money, one less stop.
    recommended =
      bestSingle.totalCost <= bestSplit.totalCost ? bestSingle : bestSplit;
    gap = Math.abs(bestSingle.totalCost - bestSplit.totalCost);

    // ------------------------------------------------------
    // Break-even cost per km.
    //
    //   split wins  <=>  splitBasket + pd*k + 2F < singleBasket + sd*k + F
    //               <=>  k < (savings - F) / extraDistance
    //
    // Exposing this turns an assumed constant into something the user
    // can judge: "splitting is worth it as long as you value driving at
    // under RM0.43/km". If the split needs no extra distance, the
    // comparison doesn't depend on k at all.
    // ------------------------------------------------------
    const savings = bestSingle.basketCost - bestSplit.basketCost;
    const extraDistance = bestSplit.distanceKm - bestSingle.distanceKm;

    if (extraDistance > 0) {
      breakEvenCostPerKm = (savings - params.fixedStopCost) / extraDistance;
    }
  } else {
    recommended = bestSingle ?? bestSplit;
  }

  return {
    bestSingle,
    bestSplit,
    recommended,
    gap,
    breakEvenCostPerKm,
    candidatesChecked: candidates.length,
    nearestShopKm,
    unavailableItems: [],
    outOfRangeItems: [],
    noPlanReason: recommended ? null : "items-not-sold-nearby",
  };
}

// ============================================================
// Display helpers
// ============================================================

export function shopName(catalog: Catalog, shopIndex: number): string {
  return catalog.shops[shopIndex]?.name ?? "Unknown shop";
}

export function itemName(catalog: Catalog, itemIndex: number): string {
  return catalog.items[itemIndex]?.name ?? "Unknown item";
}
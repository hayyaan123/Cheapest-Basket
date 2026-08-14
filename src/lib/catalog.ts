/**
 * Loads data.json and builds the lookups the optimizer needs.
 *
 * The optimizer runs over every pair of candidate shops, and for each pair
 * over every basket item. With ~650 shops that is a lot of price lookups,
 * so scanning the flat `prices` array each time would be far too slow.
 * Everything here exists to make `priceOf(shop, item)` an O(1) Map hit.
 *
 * Wire format reminder: prices reference shops and items by ARRAY POSITION,
 * not by the government's premise_code / item_code. Positions are compact
 * and are all the optimizer ever needs.
 */

// ---------- Wire format (matches export_data.py output) ----------

interface RawItem { n: string; u: string; g: string }
interface RawShop { n: string; a: string; t: string; d: string; s: string; lat: number; lng: number }
/** [shopIndex, itemIndex, price, daysOld] */
type RawPrice = [number, number, number, number];

interface RawData {
  generated: string;
  priceDate: string;
  source: string;
  note: string;
  items: RawItem[];
  shops: RawShop[];
  prices: RawPrice[];
}

// ---------- Readable shapes used by the rest of the app ----------

export interface Item {
  index: number;
  name: string;
  unit: string;
  group: string;
}

export interface Shop {
  index: number;
  name: string;
  address: string;
  type: string;
  district: string;
  state: string;
  lat: number;
  lng: number;
}

export interface PriceEntry {
  price: number;
  /** Days between this observation and the newest in the dataset. */
  daysOld: number;
}

export class Catalog {
  readonly items: Item[];
  readonly shops: Shop[];
  readonly priceDate: string;
  readonly source: string;

  /** shopIndex*itemCount + itemIndex  ->  price entry */
  private readonly priceMap: Map<number, PriceEntry>;
  /** shopIndex -> set of itemIndexes that shop stocks */
  private readonly itemsByShop: Set<number>[];
  /** itemIndex -> shopIndexes stocking it */
  private readonly shopsByItem: number[][];

  constructor(raw: RawData) {
    this.priceDate = raw.priceDate;
    this.source = raw.source;

    this.items = raw.items.map((it, index) => ({
      index, name: it.n, unit: it.u, group: it.g,
    }));

    this.shops = raw.shops.map((sh, index) => ({
      index, name: sh.n, address: sh.a, type: sh.t,
      district: sh.d, state: sh.s, lat: sh.lat, lng: sh.lng,
    }));

    this.priceMap = new Map();
    this.itemsByShop = this.shops.map(() => new Set<number>());
    this.shopsByItem = this.items.map(() => [] as number[]);

    for (const [shopIdx, itemIdx, price, daysOld] of raw.prices) {
      this.priceMap.set(this.key(shopIdx, itemIdx), { price, daysOld });
      this.itemsByShop[shopIdx].add(itemIdx);
      this.shopsByItem[itemIdx].push(shopIdx);
    }
  }

  /**
   * Composite key for the price map.
   *
   * Multiplying by itemCount (rather than a hardcoded 1000) guarantees
   * uniqueness no matter how the dataset grows -- a hardcoded multiplier
   * would silently collide the day the item count exceeded it.
   */
  private key(shopIdx: number, itemIdx: number): number {
    return shopIdx * this.items.length + itemIdx;
  }

  /** Price of one item at one shop, or undefined if not stocked. */
  priceOf(shopIdx: number, itemIdx: number): number | undefined {
    return this.priceMap.get(this.key(shopIdx, itemIdx))?.price;
  }

  /** Full price entry, including how stale the observation is. */
  entryOf(shopIdx: number, itemIdx: number): PriceEntry | undefined {
    return this.priceMap.get(this.key(shopIdx, itemIdx));
  }

  stocks(shopIdx: number, itemIdx: number): boolean {
    return this.priceMap.has(this.key(shopIdx, itemIdx));
  }

  /** True only if the shop stocks EVERY item given. */
  stocksAll(shopIdx: number, itemIdxs: readonly number[]): boolean {
    const stocked = this.itemsByShop[shopIdx];
    return itemIdxs.every((i) => stocked.has(i));
  }

  /** Which shops stock this item. Empty means nobody does. */
  shopsStocking(itemIdx: number): readonly number[] {
    return this.shopsByItem[itemIdx] ?? [];
  }

  /** How many distinct items a shop carries. */
  itemCountAt(shopIdx: number): number {
    return this.itemsByShop[shopIdx].size;
  }

  /**
   * Substring search over item names, for the basket autocomplete.
   * Linear over ~300 items, which is nothing -- no index needed.
   */
  searchItems(query: string, limit = 20): Item[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: Item[] = [];
    for (const item of this.items) {
      if (item.name.toLowerCase().includes(q)) {
        out.push(item);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  /**
   * Items in the basket that NO shop in the dataset stocks.
   * The UI must say so explicitly rather than quietly dropping them.
   */
  unavailableItems(itemIdxs: readonly number[]): number[] {
    return itemIdxs.filter((i) => this.shopsStocking(i).length === 0);
  }
}

/** Fetch and parse data.json. */
export async function loadCatalog(url = '/data.json'): Promise<Catalog> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return new Catalog((await res.json()) as RawData);
}
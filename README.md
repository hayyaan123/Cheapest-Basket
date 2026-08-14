# Cheapest Basket

Compares the cost of buying a grocery basket at one shop against splitting it
across two, using real Malaysian price data — and counting what the trip costs,
not just what the groceries cost.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # optimiser + catalog test suites
npm run build    # production build into dist/
```

`public/data.json` currently holds **sample data** so the app runs out of the
box. Replace it with the output of the Python pipeline before submitting.

## Getting the real data

The Python scripts live outside this app. Run them in order:

1. `build_clean_dataset.py` — downloads KPDN PriceCatcher, joins the item and
   premise lookup tables, cleans text, drops unnamed items, and keeps the
   latest price per (shop, item). Writes `prices/premises/items.parquet`.
2. `geocode_premises.py` — resolves shop addresses to coordinates via
   Nominatim. Slow (~40 min) but resumable.
3. `validate_geocoding.py` — checks for coordinates outside Malaysia,
   duplicates, and per-state outliers.
4. `export_data.py` — filters to shops with trustworthy coordinates and writes
   `data.json`. Copy that into `public/`.

## Structure

```
src/
  lib/
    catalog.ts        loads data.json, builds O(1) price lookups
    optimizer.ts      the cost model and search (the core of the project)
    geocode.ts        Nominatim wrapper for the user's address
  components/
    AddressStep.tsx   address entry, shows every candidate match
    BasketStep.tsx    item search and quantities
    ResultsStep.tsx   plan cards, cost breakdown, assumption sliders
  App.tsx             loads the catalog, owns the three-step flow
```

No backend and no database. The whole national dataset compresses to about
280 KB, so the browser loads it once and every calculation runs client-side.
That was measured, not assumed — an earlier plan included a FastAPI backend
until the numbers showed it wasn't needed.

## The cost model

```
total = groceries + (trip distance × cost per km) + (stops × cost per stop)
```

- **One shop**: `2 × d(home, A)`
- **Two shops**: `d(home, A) + d(A, B) + d(B, home)` — the shop-to-shop leg is
  what decides affordability. Two shops next door cost almost nothing extra;
  two on opposite sides of town cost a lot.

Defaults: **RM0.15/km** (RON95 at RM1.99/l under BUDI95, over 7L/100km) and
**RM5/stop** (roughly twenty minutes plus parking). Both are adjustable in the
UI, because they're assumptions rather than facts.

The fixed stop cost exists because fuel alone is too cheap to deter anything —
a 5 km detour costs about RM0.75, so a purely distance-based model recommends
splitting almost every time. What actually stops people making a second stop is
the time and hassle, which is fixed per stop, not proportional to distance.

The UI also shows the **break-even**: the cost per km at which the two plans
cost the same. `(savings − stop cost) ÷ extra distance`.

## Known limits

- **Straight-line distances.** Real roads typically run 20–40% longer. The
  distance function is isolated, so a routing API can replace it without
  touching the optimizer.
- **Only shops with confirmed coordinates.** OpenStreetMap resolves roughly
  29% of Malaysian premises to a specific address. The rest resolve only to
  district level, where every shop shares one point and distances between them
  would be zero — so they're excluded rather than silently wrong.
- **Prices are a snapshot.** KPDN publishes daily, but this ships a dated
  export. The UI states the date.
- **Exactly two shops.** Three-way splits aren't considered.
- **Prices aren't quotes.** A shop may have changed its price or run out.
```

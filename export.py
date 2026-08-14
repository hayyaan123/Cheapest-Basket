# pip install pandas pyarrow
#
# Produces the single data.json the frontend loads.
#
# Two things drive the design:
#
# 1. ONLY SHOPS WITH TRUSTWORTHY COORDINATES ARE INCLUDED.
#    - 'district' precision shops share their district's centre, so the
#      distance between any two of them is 0 -- the optimizer would
#      recommend splitting on a detour that doesn't exist.
#    - 'address'/'name' shops that share coordinates with another shop are
#      false precision (the geocoder matched a town centre and reported it
#      as exact). Six different Lahad Datu shops landed on one point.
#      These are demoted and excluded too.
#
# 2. THE WIRE FORMAT IS INDEX-BASED, NOT KEY-BASED.
#    Repeating {"premise_code": 20724, "item_code": 105, "price": 7.0} for
#    ~85k rows is mostly punctuation. Prices are emitted as
#    [shopIndex, itemIndex, price] triples instead, which is several times
#    smaller and trivially rehydrated in JS.

import gzip
import json
import pandas as pd

OUT_FILE = 'data.json'
MIN_ITEMS_PER_SHOP = 5      # a shop with 2 items can't meaningfully compete

# ---------- Load ----------
prices = pd.read_parquet('prices.parquet')
premises = pd.read_parquet('premises.parquet')
items = pd.read_parquet('items.parquet')
geo = pd.read_parquet('geocoded_premises.parquet')

shops = premises.merge(geo, on='premise_code', how='left')
print(f"Loaded {len(prices)} prices, {len(shops)} premises, {len(items)} items")

# ---------- Filter to trustworthy coordinates ----------
usable = shops[shops['precision'].isin(['address', 'name'])].copy()
print(f"\n{len(usable)} shops with address/name precision")

dup_mask = usable.duplicated(subset=['lat', 'lng'], keep=False)
n_dupes = int(dup_mask.sum())
usable = usable[~dup_mask]
print(f"  -{n_dupes} sharing coordinates with another shop (false precision)")
print(f"  = {len(usable)} shops with distinct, trustworthy coordinates")

# ---------- Keep only prices for those shops ----------
prices = prices[prices['premise_code'].isin(usable['premise_code'])].copy()
print(f"\n{len(prices)} price rows for those shops")

# ---------- Drop shops carrying too few items ----------
counts = prices.groupby('premise_code')['item_code'].nunique()
keep = counts[counts >= MIN_ITEMS_PER_SHOP].index
dropped = len(usable) - len(keep)
usable = usable[usable['premise_code'].isin(keep)]
prices = prices[prices['premise_code'].isin(keep)]
print(f"  -{dropped} shops carrying fewer than {MIN_ITEMS_PER_SHOP} items")
print(f"  = {len(usable)} shops, {len(prices)} prices")

# ---------- Drop items nobody stocks ----------
items = items[items['item_code'].isin(prices['item_code'])]
print(f"  = {len(items)} items actually stocked")

# ---------- Build index maps (wire format uses positions, not codes) ----------
shop_list = usable.sort_values('premise_code').reset_index(drop=True)
item_list = items.sort_values('item_code').reset_index(drop=True)
shop_idx = {c: i for i, c in enumerate(shop_list['premise_code'])}
item_idx = {c: i for i, c in enumerate(item_list['item_code'])}

# ---------- Price age, so the UI can be honest about freshness ----------
# Stored as days-old integers rather than dates: compact, and leaves the
# staleness cutoff as a frontend decision rather than baking one in here.
newest = prices['date'].max()
prices['age'] = (newest - prices['date']).dt.days

# ---------- Assemble ----------
data = {
    'generated': pd.Timestamp.now().strftime('%Y-%m-%d'),
    'priceDate': newest.strftime('%Y-%m-%d'),
    'source': 'KPDN PriceCatcher via data.gov.my (CC BY 4.0)',
    'note': ('Only shops whose coordinates resolved to a distinct, specific '
             'location are included. Shops that could only be located to '
             'district level are excluded, because distances between them '
             'would be meaningless.'),
    'items': [
        {'n': r.item, 'u': r.unit, 'g': r.item_group}
        for r in item_list.itertuples()
    ],
    'shops': [
        {'n': r.premise, 'a': r.address, 't': r.premise_type,
         'd': r.district, 's': r.state,
         'lat': round(float(r.lat), 6), 'lng': round(float(r.lng), 6)}
        for r in shop_list.itertuples()
    ],
    # [shopIndex, itemIndex, price, daysOld]
    'prices': [
        [shop_idx[r.premise_code], item_idx[r.item_code], round(float(r.price), 2), int(r.age)]
        for r in prices.itertuples()
    ],
}

with open(OUT_FILE, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, separators=(',', ':'))

raw = len(json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode())
gz = len(gzip.compress(json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode()))
print(f"\nWrote {OUT_FILE}")
print(f"  raw:      {raw/1_000_000:.2f} MB")
print(f"  gzipped:  {gz/1_000_000:.2f} MB   <-- what the browser actually downloads")

# ---------- Coverage summary ----------
print(f"\nDistricts with 2+ shops: "
      f"{(shop_list.groupby(['state','district']).size() >= 2).sum()}")
per_item = prices.groupby('item_code')['premise_code'].nunique()
print(f"Items stocked by 2+ shops: {(per_item >= 2).sum()} of {len(item_list)}")
print(f"Price age: median {int(prices['age'].median())} days, "
      f"{(prices['age'] > 14).mean()*100:.1f}% older than 14 days")
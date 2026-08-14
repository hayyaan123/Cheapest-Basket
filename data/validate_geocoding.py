# pip install pandas pyarrow
#
# Validates geocoded coordinates BEFORE they reach the optimizer.
#
# The point: Nominatim always returns its best guess and never says
# "I'm not sure". A missing coordinate is harmless (the shop is excluded).
# A WRONG coordinate is dangerous -- the shop stays in, gets a plausible
# distance, and the app confidently recommends a trip to a place that
# isn't there. Nothing errors. These checks catch that.

import pandas as pd

# Malaysia's approximate bounding box (includes Sabah/Sarawak).
LAT_MIN, LAT_MAX = 0.8, 7.5
LNG_MIN, LNG_MAX = 99.5, 119.5

premises = pd.read_parquet('premises.parquet')
geo = pd.read_parquet('geocoded_premises.parquet')
df = premises.merge(geo, on='premise_code', how='left')

print(f"{len(df)} premises total\n")

# ---------- 1. Precision breakdown ----------
print("--- precision ---")
print(df['precision'].value_counts(dropna=False).to_string())

usable = df[df['precision'].isin(['address', 'name'])].copy()
print(f"\nUsable (real coordinates): {len(usable)}")
print("NOTE: 'district' shops all share their district centre, so distances "
      "between them are 0. They cannot participate in the optimizer.\n")

# ---------- 2. Outside Malaysia = definitely wrong ----------
outside = usable[
    (usable['lat'] < LAT_MIN) | (usable['lat'] > LAT_MAX) |
    (usable['lng'] < LNG_MIN) | (usable['lng'] > LNG_MAX)
]
print(f"--- outside Malaysia's bounding box: {len(outside)} ---")
if len(outside):
    print(outside[['premise', 'state', 'district', 'lat', 'lng', 'precision']].to_string(index=False))
print()

# ---------- 3. Missing coordinates ----------
missing = usable[usable['lat'].isna() | usable['lng'].isna()]
print(f"--- missing coordinates despite non-failed precision: {len(missing)} ---\n")

# ---------- 4. State consistency ----------
# A state's shops should cluster. A wide spread means some landed elsewhere.
# Perlis is tiny; Sarawak is huge -- interpret the spread accordingly.
print("--- lat/lng spread per state (wide spread = suspicious) ---")
spread = usable.groupby('state').agg(
    n=('premise_code', 'size'),
    lat_min=('lat', 'min'), lat_max=('lat', 'max'),
    lng_min=('lng', 'min'), lng_max=('lng', 'max'),
)
spread['lat_range'] = (spread['lat_max'] - spread['lat_min']).round(2)
spread['lng_range'] = (spread['lng_max'] - spread['lng_min']).round(2)
print(spread[['n', 'lat_range', 'lng_range']].sort_values('lat_range', ascending=False).to_string())
print()

# ---------- 5. Outliers within their own state ----------
# Flag shops far from their state's median position. Not proof of error,
# but the right shortlist to eyeball manually.
print("--- shops furthest from their state's centre ---")
usable['state_lat'] = usable.groupby('state')['lat'].transform('median')
usable['state_lng'] = usable.groupby('state')['lng'].transform('median')
usable['deg_from_centre'] = (
    (usable['lat'] - usable['state_lat']).abs() +
    (usable['lng'] - usable['state_lng']).abs()
).round(3)
print(usable.nlargest(15, 'deg_from_centre')[
    ['premise', 'district', 'state', 'lat', 'lng', 'precision', 'deg_from_centre']
].to_string(index=False))
print()

# ---------- 6. Duplicate coordinates ----------
# Two DIFFERENT shops at identical coordinates means the geocoder fell back
# to the same generic place for both. Expected for 'district' precision,
# suspicious for 'address'/'name'.
dupes = usable[usable.duplicated(subset=['lat', 'lng'], keep=False)]
print(f"--- usable shops sharing identical coordinates: {len(dupes)} ---")
if len(dupes):
    print(dupes.sort_values(['lat', 'lng'])[
        ['premise', 'district', 'state', 'lat', 'lng', 'precision']
    ].head(30).to_string(index=False))
print()

# ---------- 7. Where can the app actually work? ----------
# National totals matter less than LOCAL density: the optimizer needs
# several shops near one user, not many shops spread thinly.
print("--- usable shops per district ---")
counts = usable.groupby(['state', 'district']).size().sort_values(ascending=False)
print(f"districts with 2+: {(counts >= 2).sum()}   "
      f"5+: {(counts >= 5).sum()}   10+: {(counts >= 10).sum()}")
print(counts.head(25).to_string())

# ---------- 8. Suggested exclusions ----------
bad = set(outside['premise_code']) | set(missing['premise_code'])
print(f"\n=== {len(bad)} shops flagged for exclusion (outside bbox or no coords) ===")
if bad:
    pd.Series(sorted(bad), name='premise_code').to_csv('excluded_premises.csv', index=False)
    print("Written to excluded_premises.csv")
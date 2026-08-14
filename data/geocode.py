# pip install pandas pyarrow requests
#
# Geocodes premise addresses to lat/lng using OpenStreetMap Nominatim.
#
# Design notes:
#   - Nominatim's usage policy allows 1 request/second and requires a
#     descriptive User-Agent. Both are respected below. Do not lower the delay.
#   - 2000+ addresses takes 40 minutes, so this is RESUMABLE: results are
#     saved incrementally and already-geocoded premises are skipped on re-run.
#   - PriceCatcher addresses are messy ("KAMPUNG CHUANG,RASA," with no
#     postcode). So we try progressively looser queries and record HOW
#     precisely each shop was located, because a silently wrong coordinate
#     produces a confidently wrong distance recommendation.

import time
import sys
import pandas as pd
import requests

NOMINATIM = 'https://nominatim.openstreetmap.org/search'
USER_AGENT = 'CheapestBasket/1.0 (student project; contact: hayyaan.jumoorty2004@gmail.com)'
DELAY_SECONDS = 1.1          # be a good citizen; policy is ~1 req/sec
SAVE_EVERY = 25              # checkpoint frequency
CACHE_FILE = 'geocoded_premises.parquet'

session = requests.Session()
session.headers.update({'User-Agent': USER_AGENT})

# District centroids get reused across many shops, so cache them in memory
# rather than re-querying the same district hundreds of times.
_district_cache: dict[str, tuple[float, float] | None] = {}


def query(q: str) -> tuple[float, float] | None:
    """Single Nominatim lookup. Returns (lat, lng) or None."""
    try:
        r = session.get(NOMINATIM,
                        params={'q': q, 'format': 'json', 'limit': 1, 'countrycodes': 'my'},
                        timeout=15)
        if r.status_code != 200:
            return None
        data = r.json()
        if not data:
            return None
        return float(data[0]['lat']), float(data[0]['lon'])
    except Exception:
        return None
    finally:
        time.sleep(DELAY_SECONDS)


def clean_address(addr: str | None) -> str:
    """Strip the trailing/duplicated commas that litter the source data."""
    if not addr or pd.isna(addr):
        return ''
    parts = [p.strip() for p in str(addr).split(',')]
    return ', '.join(p for p in parts if p)


def district_centroid(district: str, state: str) -> tuple[float, float] | None:
    key = f'{district}|{state}'
    if key not in _district_cache:
        _district_cache[key] = query(f'{district}, {state}, Malaysia')
    return _district_cache[key]


def geocode_premise(row) -> dict:
    """Try progressively looser queries, recording which one worked.

    precision:
      'address'  - matched the shop's own address (best)
      'name'     - matched the shop name within its district
      'district' - fell back to the district centroid (approximate!)
      'failed'   - no coordinates at all
    """
    addr = clean_address(row.address)
    district, state = row.district, row.state

    if addr:
        hit = query(f'{addr}, {district}, {state}, Malaysia')
        if hit:
            return {'lat': hit[0], 'lng': hit[1], 'precision': 'address'}

    hit = query(f'{row.premise}, {district}, {state}, Malaysia')
    if hit:
        return {'lat': hit[0], 'lng': hit[1], 'precision': 'name'}

    hit = district_centroid(district, state)
    if hit:
        return {'lat': hit[0], 'lng': hit[1], 'precision': 'district'}

    return {'lat': None, 'lng': None, 'precision': 'failed'}


def main():
    premises = pd.read_parquet('premises.parquet')

    try:
        done = pd.read_parquet(CACHE_FILE)
        print(f'Resuming: {len(done)} premises already geocoded')
    except FileNotFoundError:
        done = pd.DataFrame(columns=['premise_code', 'lat', 'lng', 'precision'])
        print('Starting fresh')

    todo = premises[~premises['premise_code'].isin(done['premise_code'])]
    total = len(todo)
    if total == 0:
        print('Nothing to do.')
        return

    est_min = total * DELAY_SECONDS / 60
    print(f'{total} premises to geocode (~{est_min:.0f}+ minutes). Ctrl-C is safe; progress is saved.\n')

    results = []
    for i, row in enumerate(todo.itertuples(), 1):
        res = geocode_premise(row)
        res['premise_code'] = row.premise_code
        results.append(res)

        print(f'[{i}/{total}] {str(row.premise)[:45]:45} -> {res["precision"]}')

        if i % SAVE_EVERY == 0 or i == total:
            done = pd.concat([done, pd.DataFrame(results)], ignore_index=True)
            done.to_parquet(CACHE_FILE, index=False)
            results = []
            print(f'  ... checkpoint saved ({len(done)} total)')

    print('\n--- precision breakdown ---')
    print(done['precision'].value_counts().to_string())
    print(f'\nSaved {CACHE_FILE}')
    print('NOTE: "district" precision means the shop is placed at its district '
          'centre, not its real location. Distances for those shops are rough.')


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        sys.exit('\nInterrupted. Re-run to resume from the last checkpoint.')
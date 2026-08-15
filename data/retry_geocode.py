# pip install pandas pyarrow requests
#
# Retries ONLY the premises that came back as 'failed'.
#
# WHY THIS EXISTS -- two bugs in the original geocoding pass:
#
#   1. Negative caching. District centroid lookups were cached even when
#      they returned None, so one transient failure permanently poisoned
#      every later shop in that district.
#
#   2. Silent error swallowing. A bare `except: return None` treated
#      "Nominatim returned an HTML error page" identically to "no match
#      found". During the long original run the service started rate-
#      limiting, and every affected shop fell through all three tiers to
#      'failed' with no indication anything had gone wrong.
#
#   Evidence: 184/184 Kuala Lumpur shops failed, plus all of Labuan --
#   while every other state had zero failures. KL addresses in the source
#   data are high quality and Nominatim resolves "Kuala Lumpur, Malaysia"
#   fine when queried directly, so the data was never the problem.
#
# FIXES: only successful district lookups are cached; non-JSON responses
# are retried rather than mistaken for a miss; retries use backoff.

import time
import sys
import pandas as pd
import requests

NOMINATIM = 'https://nominatim.openstreetmap.org/search'

# Nominatim REQUIRES a real contact address. A placeholder here can get
# you blocked, which is itself a plausible cause of mass failures.
USER_AGENT = 'CheapestBasket/1.0 (student project; contact: hayyan.jumoorty2004@gmail.com)'

DELAY_SECONDS = 1.2      # policy is 1 req/sec; do not lower this
MAX_RETRIES = 3
SAVE_EVERY = 20
CACHE_FILE = 'geocoded_premises.parquet'

session = requests.Session()
session.headers.update({'User-Agent': USER_AGENT})

# Holds SUCCESSFUL lookups only -- this is bug fix #1.
_district_cache: dict[str, tuple[float, float]] = {}

# OSM doesn't recognise Malaysia's "W.P." (Wilayah Persekutuan) prefix.
# This was the real cause of the 239 failures: every query tier embedded
# the state string, so all three missed for KL, Labuan and Putrajaya.
STATE_ALIASES = {
    'W.P. Kuala Lumpur': 'Kuala Lumpur',
    'W.P. Labuan': 'Labuan',
    'W.P. Putrajaya': 'Putrajaya',
}

def norm_state(state: str) -> str:
    return STATE_ALIASES.get(str(state).strip(), state)


def query(q: str) -> tuple[float, float] | None:
    """Nominatim lookup with retries.

    Returns (lat, lng) on a hit, or None ONLY when the service gave a
    valid response containing no results. Transport errors, non-200
    statuses and unparseable bodies are retried -- bug fix #2.
    """
    for attempt in range(MAX_RETRIES):
        try:
            r = session.get(
                NOMINATIM,
                params={'q': q, 'format': 'json', 'limit': 1, 'countrycodes': 'my'},
                timeout=20,
            )
            time.sleep(DELAY_SECONDS)

            if r.status_code != 200:
                print(f"    HTTP {r.status_code}, retrying...")
                time.sleep(DELAY_SECONDS * (attempt + 2))
                continue

            try:
                data = r.json()
            except ValueError:
                # A 200 that isn't JSON means the service is unhappy
                # (throttling page, maintenance notice). NOT a real miss.
                print(f"    non-JSON response, retrying...")
                time.sleep(DELAY_SECONDS * (attempt + 2))
                continue

            if data:
                return float(data[0]['lat']), float(data[0]['lon'])
            return None          # genuine "no match for this query"

        except Exception as e:
            print(f"    error ({type(e).__name__}: {e}), retrying...")
            time.sleep(DELAY_SECONDS * (attempt + 2))

    print("    gave up after retries")
    return None


def clean_address(addr) -> str:
    """Strip the trailing/duplicated commas that litter the source data."""
    if not addr or pd.isna(addr):
        return ''
    return ', '.join(p.strip() for p in str(addr).split(',') if p.strip())


def district_centroid(district: str, state: str) -> tuple[float, float] | None:
    key = f'{district}|{state}'
    if key in _district_cache:
        return _district_cache[key]
    hit = query(f'{district}, {state}, Malaysia')
    if hit:
        _district_cache[key] = hit       # cache successes ONLY
    return hit


def geocode_premise(row) -> dict:
    """
    Geocode a premise using its address, premise name, or district centroid.

    The function first attempts to geocode the cleaned address with the
    district and normalized state. If that fails, it retries using only the
    cleaned address. If no address match is found, it attempts to geocode
    the premise name. As a final fallback, it uses the centroid of the
    district.

    Args:
        row: A row containing the premise address, state, district, and
            premise name.

    Returns:
        dict: A dictionary containing latitude (`lat`), longitude (`lng`),
            and the precision of the geocoding result. Precision can be
            `address`, `name`, `district`, or `failed`.
    """
    addr = clean_address(row.address)
    state = norm_state(row.state)

    if addr:
        hit = query(f'{addr}, {row.district}, {state}, Malaysia')
        if hit:
            return {'lat': hit[0], 'lng': hit[1], 'precision': 'address'}
        # some addresses already contain their own locality; try bare
        hit = query(f'{addr}, Malaysia')
        if hit:
            return {'lat': hit[0], 'lng': hit[1], 'precision': 'address'}

    hit = query(f'{row.premise}, {row.district}, {state}, Malaysia')
    if hit:
        return {'lat': hit[0], 'lng': hit[1], 'precision': 'name'}

    hit = district_centroid(row.district, state)
    if hit:
        return {'lat': hit[0], 'lng': hit[1], 'precision': 'district'}

    return {'lat': None, 'lng': None, 'precision': 'failed'}

def main():
    if 'your-email@example.com' in USER_AGENT:
        sys.exit("Set a real contact email in USER_AGENT before running.")

    premises = pd.read_parquet('premises.parquet')
    done = pd.read_parquet(CACHE_FILE)

    failed_codes = done.loc[done['precision'] == 'failed', 'premise_code']
    todo = premises[premises['premise_code'].isin(failed_codes)]
    print(f"Retrying {len(todo)} premises that previously failed\n")

    if todo.empty:
        print("Nothing to retry.")
        return

    results = []
    for i, row in enumerate(todo.itertuples(), 1):
        res = geocode_premise(row)
        res['premise_code'] = row.premise_code
        results.append(res)
        print(f'[{i}/{len(todo)}] {str(row.premise)[:45]:45} -> {res["precision"]}')

        if i % SAVE_EVERY == 0 or i == len(todo):
            fixed = pd.DataFrame(results)
            # Replace the old 'failed' rows rather than appending duplicates
            done = done[~done['premise_code'].isin(fixed['premise_code'])]
            done = pd.concat([done, fixed], ignore_index=True)
            done.to_parquet(CACHE_FILE, index=False)
            results = []
            print(f'  ... saved ({len(done)} total)')

    print('\n--- precision breakdown after retry ---')
    print(done['precision'].value_counts().to_string())
    print("\nReminder: 'district' shops all share their district's coordinates, "
          "so distances between them are 0. Treat them as unusable for the optimizer.")


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        sys.exit('\nInterrupted. Re-run to resume from the last checkpoint.')
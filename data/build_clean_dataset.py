# pip install pandas pyarrow
#
# Builds the cleaned Cheapest Basket dataset from KPDN PriceCatcher.
#
# Handles future updates safely:
#   - URLs are built from today's date, not hardcoded, so this keeps working
#     when KPDN rolls over to a new monthly file.
#   - Fetches current AND previous month, so the dataset is never sparse on
#     the 1st of a month (when the new file has only one day of data).
#   - Warns loudly if the data looks stale, so a silent upstream failure
#     doesn't quietly serve months-old prices.

import re
import sys
import datetime
import pandas as pd

BASE = 'https://storage.data.gov.my/pricecatcher'
URL_ITEMS = f'{BASE}/lookup_item.parquet'
URL_PREMISES = f'{BASE}/lookup_premise.parquet'

# If the newest price is older than this, something upstream is wrong.
STALENESS_WARN_DAYS = 7


def month_url(d: datetime.date) -> str:
    return f'{BASE}/pricecatcher_{d.year:04d}-{d.month:02d}.parquet'


def previous_month(d: datetime.date) -> datetime.date:
    return (d.replace(day=1) - datetime.timedelta(days=1))


def load_transactions(today: datetime.date) -> pd.DataFrame:
    """Load current month, plus previous month as a safety net.

    The previous month matters most on the 1st-7th, when the current file
    barely has any data yet. Missing previous month is not fatal.
    """
    frames = []

    url_now = month_url(today)
    print(f"Loading {url_now}")
    frames.append(pd.read_parquet(url_now))

    url_prev = month_url(previous_month(today))
    try:
        print(f"Loading {url_prev}")
        frames.append(pd.read_parquet(url_prev))
    except Exception as e:
        print(f"  (previous month unavailable, continuing without it: {e})")

    df = pd.concat(frames, ignore_index=True)
    df['date'] = pd.to_datetime(df['date'])
    return df


def clean_text_columns(df: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    """Strip whitespace and normalise control characters.

    Found in the real data:
      - 'Pasar Basah' appeared as TWO distinct premise_type values because
        one variant carried trailing whitespace. Grouping without this fix
        silently splits categories.
      - Some item names contain literal tab characters, which break CSV
        export and render badly in the UI.
    """
    for col in cols:
        if col not in df.columns:
            continue
        before_unique = df[col].nunique(dropna=True)
        cleaned = (df[col].astype('string')
                          .str.replace(r'[\t\r\n]+', ' ', regex=True)
                          .str.replace(r'\s+', ' ', regex=True)
                          .str.strip())
        after_unique = cleaned.nunique(dropna=True)
        if after_unique != before_unique:
            print(f"  {col}: {before_unique} -> {after_unique} distinct values after cleaning")
        df[col] = cleaned
    return df


def main():
    today = datetime.date.today()

    # ---------- Load ----------
    df = load_transactions(today)
    items = pd.read_parquet(URL_ITEMS)
    premises = pd.read_parquet(URL_PREMISES)
    print(f"\ntransactions: {df.shape}  items: {items.shape}  premises: {premises.shape}")

    # ---------- Freshness check ----------
    newest = df['date'].max().date()
    age_days = (today - newest).days
    print(f"Newest price date: {newest} ({age_days} days old)")
    if age_days > STALENESS_WARN_DAYS:
        print(f"  *** WARNING: data is {age_days} days old. Check whether KPDN "
              f"changed the URL pattern or stopped publishing. ***")

    # ---------- Guard against duplicate lookup keys ----------
    if items['item_code'].duplicated().any() or premises['premise_code'].duplicated().any():
        sys.exit("ERROR: lookup tables contain duplicate codes; join would inflate rows.")

    # ---------- Join ----------
    before = len(df)
    full = df.merge(items, on='item_code', how='left').merge(premises, on='premise_code', how='left')
    assert len(full) == before, f"Join changed row count: {before} -> {len(full)}"

    # ---------- Clean ----------
    print("\nCleaning text columns...")
    full = clean_text_columns(full, [
        'item', 'unit', 'item_group', 'item_category',
        'premise', 'address', 'premise_type', 'state', 'district',
    ])

    # ---------- Drop unnamed items ----------
    # An item with no name can't be added to a shopping list, so these rows
    # are unusable regardless of why they're missing. Re-evaluated every run:
    # if KPDN publishes the missing lookup entries later, they come back
    # automatically with no code change.
    unmatched = full['item'].isna()
    print(f"\nDropping {unmatched.sum()} rows ({unmatched.mean()*100:.1f}%) with no item name")
    if unmatched.any():
        print("  top codes:", full.loc[unmatched, 'item_code'].value_counts().head(5).to_dict())
    full = full[~unmatched].copy()

    # ---------- Dedupe to latest price per (premise, item) ----------
    latest = (full.sort_values('date')
                  .groupby(['premise_code', 'item_code'], as_index=False)
                  .tail(1)
                  .reset_index(drop=True))

    print(f"\nRows: {len(full)} -> {len(latest)} after keeping latest price per (premise, item)")
    print(f"Unique premises: {latest['premise_code'].nunique()}")
    print(f"Unique items:    {latest['item_code'].nunique()}")
    print(f"Date range kept: {latest['date'].min().date()} to {latest['date'].max().date()}")

    # ---------- Save normalised outputs ----------
    # Kept separate rather than one fat denormalised file: repeating the
    # premise name and address on all 200k+ price rows is what made the
    # export huge in the first place.
    prices = latest[['premise_code', 'item_code', 'price', 'date']]
    premise_out = (latest[['premise_code', 'premise', 'address', 'premise_type', 'state', 'district']]
                   .drop_duplicates('premise_code').reset_index(drop=True))
    item_out = (latest[['item_code', 'item', 'unit', 'item_group', 'item_category']]
                .drop_duplicates('item_code').reset_index(drop=True))

    prices.to_parquet('prices.parquet', index=False)
    premise_out.to_parquet('premises.parquet', index=False)
    item_out.to_parquet('items.parquet', index=False)

    print(f"\nSaved prices.parquet ({len(prices)}), premises.parquet ({len(premise_out)}), "
          f"items.parquet ({len(item_out)})")

    # ---------- Tell us what changed, for the geocoding step ----------
    # Geocoding 2000+ addresses is slow and rate-limited, so it must only
    # ever run for premises we haven't already resolved.
    try:
        known = pd.read_parquet('geocoded_premises.parquet')['premise_code']
        new = premise_out[~premise_out['premise_code'].isin(known)]
        print(f"\n{len(new)} new premises need geocoding (of {len(premise_out)} total)")
    except FileNotFoundError:
        print(f"\nNo geocode cache yet: all {len(premise_out)} premises need geocoding")


if __name__ == '__main__':
    main()
import pandas as pd

# Combine premise details with their geocoded coordinates.
prem = pd.read_parquet('premises.parquet').merge(
    pd.read_parquet('geocoded_premises.parquet'),
    on='premise_code'
)

# Keep only premises with precise address or name-based coordinates.
usable = prem[prem['precision'].isin(['address', 'name'])]

# Find different premises sharing the exact same coordinates.
dup_mask = usable.duplicated(subset=['lat', 'lng'], keep=False)

# Get the premise codes that should be excluded from the optimizer.
demote = usable.loc[dup_mask, 'premise_code']

print(f"demoting {len(demote)} shops -> {len(usable) - len(demote)} clean")

# Save premises with duplicate coordinates for exclusion.
demote.to_csv('duplicate_coordinate_premises.csv', index=False)
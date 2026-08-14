import pandas as pd
prem = pd.read_parquet('premises.parquet').merge(
    pd.read_parquet('geocoded_premises.parquet'), on='premise_code')
usable = prem[prem['precision'].isin(['address','name'])]
dup_mask = usable.duplicated(subset=['lat','lng'], keep=False)
demote = usable.loc[dup_mask, 'premise_code']
print(f"demoting {len(demote)} shops -> {len(usable) - len(demote)} clean")
demote.to_csv('excluded_premises.csv', index=False)
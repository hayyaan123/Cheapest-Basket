import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, MapPin, Minus, Plus, Search, ShoppingBasket, Trash2, X } from 'lucide-react';
import type { Catalog } from '../lib/catalog';
import type { BasketLine, LocationPoint } from './ResultsStep';

export function BasketStep({
  catalog,
  location,
  basket,
  setBasket,
  onContinue,
  onBack,
}: {
  catalog: Catalog;
  location: LocationPoint;
  basket: BasketLine[];
  setBasket: (basket: BasketLine[]) => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(false);

  const matches = useMemo(() => catalog.searchItems(search, 7), [catalog, search]);

  function addItem(itemIndex: number) {
    const item = catalog.items[itemIndex];
    if (!item) return;
    const existing = basket.find((line) => line.itemIndex === itemIndex);
    setBasket(
      existing
        ? basket.map((line) =>
            line.itemIndex === itemIndex ? { ...line, quantity: line.quantity + 1 } : line,
          )
        : [...basket, { itemIndex, item: item.name, unit: item.unit, quantity: 1 }],
    );
    setSearch('');
  }

  const changeQty = (itemIndex: number, delta: number) =>
    setBasket(
      basket.map((line) =>
        line.itemIndex === itemIndex
          ? { ...line, quantity: Math.max(1, line.quantity + delta) }
          : line,
      ),
    );

  return (
    <main className="mx-auto max-w-6xl px-5 pb-20 pt-6 sm:px-8 sm:pt-10">
      <div className="rise-in mb-9 flex flex-wrap items-end justify-between gap-4">
        <div>
          <button
            data-testid="button-back-address"
            onClick={onBack}
            className="focus-ring mb-4 flex items-center gap-2 text-xs font-bold text-muted-foreground hover:text-primary"
          >
            <ArrowLeft size={14} /> Change location
          </button>
          <p className="font-mono-app text-[10px] uppercase tracking-[.2em] text-primary">
            Starting point confirmed
          </p>
          <h1 className="mt-2 font-display text-5xl tracking-[-.04em] text-primary sm:text-6xl">
            Pack your basket.
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            <MapPin size={14} className="mr-1 inline text-accent" />
            {location.label.split(',').slice(0, 2).join(', ')}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card px-4 py-3 text-right">
          <span className="block font-mono-app text-[10px] uppercase tracking-wider text-muted-foreground">
            Basket lines
          </span>
          <strong data-testid="text-basket-count" className="font-display text-2xl text-primary">
            {basket.length}
          </strong>
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1.15fr_.85fr]">
        <section className="rise-in rise-in-delay-1 rounded-[26px] border border-border bg-card p-5 shadow-sm sm:p-7">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="font-display text-2xl text-primary">What are you picking up?</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {catalog.items.length} items tracked by KPDN.
              </p>
            </div>
            <Search size={19} className="text-accent" />
          </div>

          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={17} />
            <input
              data-testid="input-item-search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setExpanded(true);
              }}
              onFocus={() => setExpanded(true)}
              placeholder="Try beras, telur, ayam…"
              className="focus-ring h-14 w-full rounded-2xl border border-border bg-background pl-11 pr-4 text-sm outline-none focus:border-primary"
            />
            {search && (
              <button
                data-testid="button-clear-item-search"
                onClick={() => setSearch('')}
                className="focus-ring absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-muted-foreground hover:bg-muted"
                aria-label="Clear search"
              >
                <X size={15} />
              </button>
            )}
          </div>

          {expanded && search && (
            <div className="mt-3 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-background">
              {matches.length > 0 ? (
                matches.map((item) => (
                  <button
                    data-testid={`button-add-item-${item.index}`}
                    key={item.index}
                    onClick={() => addItem(item.index)}
                    className="focus-ring group flex w-full items-center justify-between p-4 text-left hover:bg-secondary/35"
                  >
                    <span className="min-w-0 pr-3">
                      <span className="block truncate text-sm font-bold">{item.name}</span>
                      <span className="mt-1 block font-mono-app text-[10px] uppercase tracking-wider text-muted-foreground">
                        {item.group} · {item.unit}
                      </span>
                    </span>
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-primary transition-transform group-hover:scale-110">
                      <Plus size={15} />
                    </span>
                  </button>
                ))
              ) : (
                <div data-testid="status-no-item-results" className="p-5 text-sm text-muted-foreground">
                  Nothing in the price list matches that. Try a Malay term — beras, telur, minyak.
                </div>
              )}
            </div>
          )}

          {!search && (
            <div className="mt-6 rounded-2xl bg-secondary/40 p-5 text-sm leading-6 text-foreground/75">
              <strong className="text-primary">Quantities matter.</strong> They change which shop wins,
              so add what you actually need today rather than a token of each.
            </div>
          )}

          {basket.length > 0 && (
            <div className="mt-8 border-t border-border pt-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-bold">In your basket</h3>
                <button
                  data-testid="button-clear-basket"
                  onClick={() => setBasket([])}
                  className="focus-ring text-xs font-bold text-muted-foreground hover:text-destructive"
                >
                  Clear all
                </button>
              </div>
              <div className="space-y-3">
                {basket.map((line) => (
                  <div
                    data-testid={`row-basket-item-${line.itemIndex}`}
                    key={line.itemIndex}
                    className="flex items-center justify-between gap-3 rounded-2xl bg-muted/55 p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">{line.item}</p>
                      <p className="mt-1 font-mono-app text-[10px] text-muted-foreground">{line.unit}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        data-testid={`button-decrease-item-${line.itemIndex}`}
                        onClick={() => changeQty(line.itemIndex, -1)}
                        className="focus-ring grid size-8 place-items-center rounded-full border border-border bg-card hover:border-primary"
                        aria-label={`Fewer ${line.item}`}
                      >
                        <Minus size={13} />
                      </button>
                      <span
                        data-testid={`text-quantity-${line.itemIndex}`}
                        className="w-5 text-center font-mono-app text-xs"
                      >
                        {line.quantity}
                      </span>
                      <button
                        data-testid={`button-increase-item-${line.itemIndex}`}
                        onClick={() => changeQty(line.itemIndex, 1)}
                        className="focus-ring grid size-8 place-items-center rounded-full border border-border bg-card hover:border-primary"
                        aria-label={`More ${line.item}`}
                      >
                        <Plus size={13} />
                      </button>
                      <button
                        data-testid={`button-remove-item-${line.itemIndex}`}
                        onClick={() => setBasket(basket.filter((entry) => entry.itemIndex !== line.itemIndex))}
                        className="focus-ring ml-1 rounded-full p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        aria-label={`Remove ${line.item}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <aside className="rise-in rise-in-delay-2 lg:sticky lg:top-5">
          <div className="rounded-[26px] border border-primary/20 bg-primary p-6 text-primary-foreground shadow-md sm:p-7">
            <div className="mb-7 flex items-start justify-between">
              <span className="font-mono-app text-[10px] uppercase tracking-[.18em] text-primary-foreground/65">
                Ready when you are
              </span>
              <ShoppingBasket size={21} />
            </div>
            <p className="font-display text-3xl leading-tight">
              Your basket,
              <br />
              your call.
            </p>
            <p className="mt-4 text-sm leading-6 text-primary-foreground/75">
              We check every one-shop and two-shop combination near you, then add what the driving and
              the stops actually cost.
            </p>
            <button
              data-testid="button-compare-basket"
              disabled={basket.length === 0}
              onClick={onContinue}
              className="focus-ring mt-8 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-secondary px-4 text-sm font-bold text-secondary-foreground transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Compare prices <ArrowRight size={17} />
            </button>
          </div>
        </aside>
      </div>
    </main>
  );
}

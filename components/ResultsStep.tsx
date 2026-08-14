import { useMemo, useState } from 'react';
import { ArrowLeft, Check, CircleAlert, Compass, MapPin, RotateCcw, Store } from 'lucide-react';
import type { Catalog } from '../lib/catalog';
import type { OptimizerParams, OptimizerResult, PlanResult, SingleShopResult, TwoShopResult } from '../lib/optimiser';
import { optimizeBasket } from '../lib/optimiser';

export interface BasketLine {
  itemIndex: number;
  item: string;
  unit: string;
  quantity: number;
}

export interface LocationPoint {
  lat: number;
  lng: number;
  label: string;
}

const currency = (value: number) => `RM ${value.toFixed(2)}`;
const distance = (km: number) => (km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`);

// Defaults are derived, not guessed:
//   costPerKm     RON95 at RM1.99/l (BUDI95) / 7L per 100km = RM0.14/km
//   fixedStopCost roughly 20 minutes plus parking, per stop
// Both are exposed as sliders because they are assumptions, not facts.
const DEFAULT_PARAMS: OptimizerParams = {
  radiusKm: 25,
  costPerKm: 0.15,
  fixedStopCost: 5,
};

// ============================================================
// Small pieces
// ============================================================

function ShopPill({
  catalog,
  shopIndex,
  distanceKm,
  accent = false,
}: {
  catalog: Catalog;
  shopIndex: number;
  distanceKm?: number;
  accent?: boolean;
}) {
  const shop = catalog.shops[shopIndex];
  if (!shop) return null;
  return (
    <div className="flex items-start gap-3">
      <span className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl ${accent ? 'bg-secondary text-primary' : 'bg-muted text-primary'}`}>
        <Store size={17} />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-bold">{shop.name}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">{shop.address}</p>
        {distanceKm !== undefined && (
          <p className="mt-1 flex items-center gap-1 font-mono-app text-[10px] text-primary">
            <MapPin size={11} />
            {distance(distanceKm)} away
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The cost breakdown is the whole point of the app, so it is always shown
 * rather than tucked behind a toggle. A single "RM 41.00" tells the user
 * nothing about why one plan beat another.
 */
function CostBreakdown({ plan, muted = false }: { plan: PlanResult; muted?: boolean }) {
  const dim = muted ? 'text-primary-foreground/60' : 'text-muted-foreground';
  const strong = muted ? 'text-primary-foreground' : 'text-foreground';
  const stops = plan.type === 'single' ? 1 : 2;
  return (
    <dl className={`mt-5 space-y-1.5 border-t pt-4 text-sm ${muted ? 'border-primary-foreground/20' : 'border-border'}`}>
      <div className="flex justify-between">
        <dt className={dim}>Groceries</dt>
        <dd className={`font-mono-app text-xs ${strong}`}>{currency(plan.basketCost)}</dd>
      </div>
      <div className="flex justify-between">
        <dt className={dim}>Driving · {distance(plan.distanceKm)} round trip</dt>
        <dd className={`font-mono-app text-xs ${strong}`}>{currency(plan.travelCost)}</dd>
      </div>
      <div className="flex justify-between">
        <dt className={dim}>{stops === 1 ? '1 stop' : '2 stops'}</dt>
        <dd className={`font-mono-app text-xs ${strong}`}>{currency(plan.stopCost)}</dd>
      </div>
    </dl>
  );
}

function PlanCard({
  catalog,
  plan,
  isRecommended,
}: {
  catalog: Catalog;
  plan: PlanResult;
  isRecommended: boolean;
}) {
  const single = plan.type === 'single' ? (plan as SingleShopResult) : null;
  const split = plan.type === 'two-shop' ? (plan as TwoShopResult) : null;

  const title = single
    ? catalog.shops[single.shopIndex]?.name
    : `${catalog.shops[split!.shopIndices[0]]?.name} + ${catalog.shops[split!.shopIndices[1]]?.name}`;

  const atFirst = split ? split.items.filter((i) => i.shopIndex === split.shopIndices[0]).length : 0;
  const atSecond = split ? split.items.length - atFirst : 0;

  return (
    <div
      data-testid={single ? 'card-single-shop' : 'card-two-shop'}
      className={`rounded-[26px] border p-6 shadow-sm sm:p-7 ${
        isRecommended ? 'border-primary/25 bg-primary text-primary-foreground' : 'border-border bg-card'
      }`}
    >
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <span className={`font-mono-app text-[10px] uppercase tracking-[.18em] ${isRecommended ? 'text-primary-foreground/65' : 'text-accent'}`}>
            {single ? 'One stop' : 'Two stops'}
          </span>
          <h2 className={`mt-2 font-display text-3xl leading-tight ${isRecommended ? '' : 'text-primary'}`}>{title}</h2>
        </div>
        <span className="shrink-0 rounded-full bg-secondary px-3 py-1 font-mono-app text-[10px] text-secondary-foreground">
          {single ? '1 shop' : '2 shops'}
        </span>
      </div>

      {single ? (
        <ShopPill catalog={catalog} shopIndex={single.shopIndex} distanceKm={single.distanceKm / 2} accent={isRecommended} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <ShopPill catalog={catalog} shopIndex={split!.shopIndices[0]} accent={isRecommended} />
          <ShopPill catalog={catalog} shopIndex={split!.shopIndices[1]} accent={isRecommended} />
        </div>
      )}

      {split && (
        <p className={`mt-4 font-mono-app text-[10px] ${isRecommended ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
          {atFirst} {atFirst === 1 ? 'item' : 'items'} at the first · {atSecond} at the second
        </p>
      )}

      <CostBreakdown plan={plan} muted={isRecommended} />

      <div className={`mt-4 flex items-end justify-between border-t pt-4 ${isRecommended ? 'border-primary-foreground/20' : 'border-border'}`}>
        <span className={`font-mono-app text-[10px] uppercase tracking-widest ${isRecommended ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
          Total cost
        </span>
        <p data-testid={single ? 'text-single-total' : 'text-split-total'} className="font-display text-4xl">
          {currency(plan.totalCost)}
        </p>
      </div>
    </div>
  );
}

/**
 * Sliders for the two assumptions the answer depends on.
 *
 * Exposing them is deliberate: the recommendation hinges on numbers we
 * chose, and a user who values their time differently should be able to
 * see the answer change rather than take ours on faith.
 */
function Assumptions({
  params,
  setParams,
}: {
  params: OptimizerParams;
  setParams: (next: OptimizerParams) => void;
}) {
  return (
    <div className="rounded-[26px] border border-border bg-card p-6 shadow-sm sm:p-7">
      <h2 className="font-display text-2xl text-primary">What a trip costs you</h2>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        Change these and the answer updates. Our defaults assume RON95 at RM1.99/l and about twenty
        minutes per stop.
      </p>

      <label className="mt-6 block">
        <span className="flex items-baseline justify-between text-sm font-bold">
          Driving
          <span className="font-mono-app text-xs text-primary">{currency(params.costPerKm)} / km</span>
        </span>
        <input
          data-testid="slider-cost-per-km"
          type="range"
          min={0}
          max={1.5}
          step={0.05}
          value={params.costPerKm}
          onChange={(e) => setParams({ ...params, costPerKm: Number(e.target.value) })}
          className="mt-3 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
        />
      </label>

      <label className="mt-6 block">
        <span className="flex items-baseline justify-between text-sm font-bold">
          Each stop
          <span className="font-mono-app text-xs text-primary">{currency(params.fixedStopCost)}</span>
        </span>
        <input
          data-testid="slider-stop-cost"
          type="range"
          min={0}
          max={20}
          step={0.5}
          value={params.fixedStopCost}
          onChange={(e) => setParams({ ...params, fixedStopCost: Number(e.target.value) })}
          className="mt-3 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
        />
      </label>

      <label className="mt-6 block">
        <span className="flex items-baseline justify-between text-sm font-bold">
          How far you'll go
          <span className="font-mono-app text-xs text-primary">{params.radiusKm} km</span>
        </span>
        <input
          data-testid="slider-radius"
          type="range"
          min={5}
          max={60}
          step={5}
          value={params.radiusKm}
          onChange={(e) => setParams({ ...params, radiusKm: Number(e.target.value) })}
          className="mt-3 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
        />
      </label>
    </div>
  );
}

function Verdict({
  result,
  params,
}: {
  result: OptimizerResult;
  params: OptimizerParams;
}) {
  const { recommended, bestSingle, bestSplit, gap, breakEvenCostPerKm } = result;
  if (!recommended) return null;

  const splitWon = recommended.type === 'two-shop';
  const bothExist = bestSingle !== null && bestSplit !== null;

  let headline: string;
  let body: string;

  if (!bothExist) {
    headline = splitWon ? 'Two stops is the only way' : 'One stop covers everything';
    body = splitWon
      ? 'No single nearby shop carries this whole basket, so the two-stop plan is the only complete option.'
      : 'No pair of shops beat shopping in one place, so this is your answer.';
  } else if (gap !== null && gap < 0.01) {
    headline = 'Too close to call';
    body = `Both plans land at ${currency(recommended.totalCost)}. Take the one that fits your day.`;
  } else if (splitWon) {
    headline = 'The extra stop pays for itself';
    body = `Splitting costs ${currency(gap!)} less all in, once driving and the second stop are counted.${
      breakEvenCostPerKm !== null
        ? ` That holds while you value driving under ${currency(breakEvenCostPerKm)} a km — you're at ${currency(params.costPerKm)}.`
        : ''
    }`;
  } else {
    headline = 'Stick to one shop';
    const cheaperBasket = bestSingle!.basketCost - bestSplit!.basketCost;
    body =
      cheaperBasket > 0
        ? `The split shaves ${currency(cheaperBasket)} off the groceries, but the extra driving and second stop add ${currency(cheaperBasket + gap!)}. One shop wins by ${currency(gap!)}.`
        : `One shop is cheaper by ${currency(gap!)} before you even leave the house.`;
  }

  return (
    <div data-testid="card-recommendation" className="rounded-[26px] bg-secondary p-6 sm:p-7">
      <div className="flex gap-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-background/65 text-primary">
          {splitWon ? <Compass size={20} /> : <Check size={20} />}
        </span>
        <div>
          <p className="font-mono-app text-[10px] uppercase tracking-[.18em] text-primary/65">Our read</p>
          <h3 className="mt-2 font-display text-2xl text-primary">{headline}</h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-primary/80">{body}</p>
        </div>
      </div>
    </div>
  );
}

function NoPlan({ catalog, result }: { catalog: Catalog; result: OptimizerResult }) {
  const names = (indexes: number[]) =>
    indexes.map((i) => catalog.items[i]?.name ?? `item ${i}`).join(', ');

  switch (result.noPlanReason) {
    case 'empty-basket':
      return (
        <div data-testid="status-empty-basket" className="rounded-[26px] border border-border bg-card p-8 text-center">
          <h2 className="font-display text-2xl text-primary">Nothing to compare yet</h2>
          <p className="mt-2 text-sm text-muted-foreground">Add an item to your basket and we'll do the math.</p>
        </div>
      );

    case 'no-shops-in-range':
      return (
        <div data-testid="status-no-shops" className="rounded-[26px] border border-border bg-card p-7">
          <CircleAlert className="mb-4 text-accent" size={25} />
          <h2 className="font-display text-2xl text-primary">No shops close enough</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {result.nearestShopKm !== null
              ? `The nearest shop we have prices for is ${distance(result.nearestShopKm)} away. Widen how far you'll go, or start from somewhere else.`
              : 'We have no shops with confirmed locations near this starting point.'}
          </p>
        </div>
      );

    case 'items-not-sold-anywhere':
      return (
        <div data-testid="status-unavailable-items" className="rounded-[26px] border border-destructive/20 bg-card p-7">
          <CircleAlert className="mb-4 text-destructive" size={25} />
          <h2 className="font-display text-2xl text-primary">Not in this price list</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            No shop in the dataset lists <strong className="text-foreground">{names(result.unavailableItems)}</strong>.
            Remove {result.unavailableItems.length === 1 ? 'it' : 'them'} to compare the rest.
          </p>
        </div>
      );

    case 'items-not-sold-nearby':
      return (
        <div data-testid="status-out-of-range-items" className="rounded-[26px] border border-border bg-card p-7">
          <CircleAlert className="mb-4 text-accent" size={25} />
          <h2 className="font-display text-2xl text-primary">Sold, but not near you</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {result.outOfRangeItems.length > 0 ? (
              <>
                <strong className="text-foreground">{names(result.outOfRangeItems)}</strong>{' '}
                {result.outOfRangeItems.length === 1 ? 'is' : 'are'} in our price list, but none of the{' '}
                {result.candidatesChecked} shops near you carry{' '}
                {result.outOfRangeItems.length === 1 ? 'it' : 'them'}. Widen your search or drop{' '}
                {result.outOfRangeItems.length === 1 ? 'it' : 'them'} from the basket.
              </>
            ) : (
              <>
                We checked {result.candidatesChecked} nearby shops and no single shop or pair carries this whole basket.
                Try a smaller basket or a wider search.
              </>
            )}
          </p>
        </div>
      );

    default:
      return null;
  }
}

// ============================================================
// Step
// ============================================================

export function ResultsStep({
  catalog,
  location,
  basket,
  onBack,
  onReset,
}: {
  catalog: Catalog;
  location: LocationPoint;
  basket: BasketLine[];
  onBack: () => void;
  onReset: () => void;
}) {
  const [params, setParams] = useState<OptimizerParams>(DEFAULT_PARAMS);

  // Recomputes as the sliders move. Cheap enough to do synchronously:
  // a few thousand shop pairs takes well under 100ms.
  const result = useMemo(
    () =>
      optimizeBasket(
        catalog,
        basket.map((line) => ({ itemIndex: line.itemIndex, qty: line.quantity })),
        location,
        params,
      ),
    [catalog, basket, location, params],
  );

  const { recommended, bestSingle, bestSplit } = result;
  const runnerUp: PlanResult | null =
    recommended === null ? null : recommended === bestSingle ? bestSplit : bestSingle;

  return (
    <main className="mx-auto max-w-6xl px-5 pb-20 pt-6 sm:px-8 sm:pt-10">
      <div className="rise-in mb-9 flex flex-wrap items-end justify-between gap-5">
        <div>
          <button
            data-testid="button-back-basket"
            onClick={onBack}
            className="focus-ring mb-4 flex items-center gap-2 text-xs font-bold text-muted-foreground hover:text-primary"
          >
            <ArrowLeft size={14} /> Edit basket
          </button>
          <p className="font-mono-app text-[10px] uppercase tracking-[.2em] text-primary">The market-day verdict</p>
          <h1 className="mt-2 font-display text-5xl tracking-[-.04em] text-primary sm:text-6xl">Here's the math.</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            <MapPin size={14} className="mr-1 inline text-accent" />
            From {location.label.split(',').slice(0, 2).join(', ')}
          </p>
        </div>
        <button
          data-testid="button-start-over"
          onClick={onReset}
          className="focus-ring flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-xs font-bold text-muted-foreground hover:border-primary hover:text-primary"
        >
          <RotateCcw size={14} /> Start a new basket
        </button>
      </div>

      <div className="grid gap-7 lg:grid-cols-[1.2fr_.8fr]">
        <section className="rise-in rise-in-delay-1 space-y-5">
          {recommended ? (
            <>
              <PlanCard catalog={catalog} plan={recommended} isRecommended />
              {runnerUp && <PlanCard catalog={catalog} plan={runnerUp} isRecommended={false} />}
              <Verdict result={result} params={params} />
            </>
          ) : (
            <NoPlan catalog={catalog} result={result} />
          )}
        </section>

        <aside className="rise-in rise-in-delay-2 space-y-6 lg:sticky lg:top-5">
          <Assumptions params={params} setParams={setParams} />

          <div className="rounded-[26px] border border-border bg-card p-6 shadow-sm sm:p-7">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="font-display text-2xl text-primary">Your list</h2>
              <span className="rounded-full bg-muted px-3 py-1 font-mono-app text-[10px]">
                {basket.reduce((sum, line) => sum + line.quantity, 0)} units
              </span>
            </div>
            <div className="space-y-3">
              {basket.map((line) => (
                <div
                  data-testid={`text-result-item-${line.itemIndex}`}
                  key={line.itemIndex}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="min-w-0 truncate text-foreground/80">{line.item}</span>
                  <span className="shrink-0 font-mono-app text-xs text-muted-foreground">× {line.quantity}</span>
                </div>
              ))}
            </div>
            <div className="my-6 border-t border-dashed border-border" />
            <div className="space-y-3 text-xs leading-5 text-muted-foreground">
              <p className="flex items-start gap-3">
                <Compass size={16} className="mt-0.5 shrink-0 text-accent" />
                <span>
                  Distances are straight lines, not driving routes. Real roads usually run 20–40% longer.
                </span>
              </p>
              <p className="flex items-start gap-3">
                <Store size={16} className="mt-0.5 shrink-0 text-accent" />
                <span>
                  {result.candidatesChecked > 0
                    ? `Compared ${result.candidatesChecked} shops within ${params.radiusKm} km.`
                    : 'Only shops with a confirmed street location are included.'}
                </span>
              </p>
              <p className="flex items-start gap-3">
                <MapPin size={16} className="mt-0.5 shrink-0 text-accent" />
                <span>Prices collected by KPDN, as of {catalog.priceDate}.</span>
              </p>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

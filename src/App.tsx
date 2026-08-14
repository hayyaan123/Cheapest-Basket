import { useEffect, useState } from 'react';
import { Check, RotateCcw, ShoppingBasket } from 'lucide-react';
import { loadCatalog, type Catalog } from '../lib/catalog';
import { AddressStep } from '../components/AddressStep';
import { BasketStep } from '../components/BasketStep';
import { ResultsStep, type BasketLine, type LocationPoint } from '../components/ResultsStep';

type Stage = 'address' | 'basket' | 'results';

function Header({ onReset }: { onReset: () => void }) {
  return (
    <header className="border-b border-border/70 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <button
          data-testid="button-reset-app"
          onClick={onReset}
          className="focus-ring group flex items-center gap-3 text-left"
        >
          <span className="grid size-10 place-items-center rounded-[13px] bg-primary text-primary-foreground shadow-sm transition-transform group-hover:-rotate-3">
            <ShoppingBasket size={19} strokeWidth={2.2} />
          </span>
          <span>
            <span className="block font-display text-[22px] font-semibold leading-none tracking-tight">
              Cheapest Basket
            </span>
            <span className="mt-1 block font-mono-app text-[9px] uppercase tracking-[.18em] text-muted-foreground">
              Malaysia • market day math
            </span>
          </span>
        </button>
        <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
          <span className="size-2 rounded-full bg-primary" />
          Price snapshots, not live quotes
        </div>
        <button
          data-testid="button-reset-app-mobile"
          onClick={onReset}
          className="focus-ring rounded-full p-2 text-muted-foreground hover:bg-muted sm:hidden"
          aria-label="Start over"
        >
          <RotateCcw size={17} />
        </button>
      </div>
    </header>
  );
}

/**
 * The numbering is not decoration: this genuinely is a three-step sequence
 * where each step needs the one before it. Distance cannot be computed
 * without a location, and nothing can be compared without a basket.
 */
function Progress({ stage }: { stage: Stage }) {
  const steps: Array<{ id: Stage; number: string; label: string }> = [
    { id: 'address', number: '01', label: 'Your location' },
    { id: 'basket', number: '02', label: 'Build basket' },
    { id: 'results', number: '03', label: 'Compare shops' },
  ];
  const current = steps.findIndex((step) => step.id === stage);

  return (
    <div className="mx-auto flex max-w-6xl items-center gap-2 px-5 pb-8 pt-7 sm:gap-4 sm:px-8">
      {steps.map((step, index) => (
        <div key={step.id} className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <div
            className={`step-number shrink-0 ${
              index <= current ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            }`}
          >
            {index < current ? <Check size={15} /> : step.number}
          </div>
          <span
            className={`hidden truncate text-[11px] font-bold uppercase tracking-[.14em] sm:block ${
              index <= current ? 'text-foreground' : 'text-muted-foreground'
            }`}
          >
            {step.label}
          </span>
          {index < steps.length - 1 && (
            <div className={`market-rule flex-1 ${index < current ? 'opacity-70' : 'opacity-20'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadError, setLoadError] = useState('');
  const [stage, setStage] = useState<Stage>('address');
  const [location, setLocation] = useState<LocationPoint | null>(null);
  const [basket, setBasket] = useState<BasketLine[]>([]);

  useEffect(() => {
    loadCatalog()
      .then(setCatalog)
      .catch((err) => setLoadError(String(err)));
  }, []);

  const reset = () => {
    setStage('address');
    setLocation(null);
    setBasket([]);
  };

  return (
    <div className="min-h-[100dvh]">
      <Header onReset={reset} />

      {!catalog ? (
        <main className="mx-auto max-w-6xl px-5 py-24 text-center sm:px-8">
          {loadError ? (
            <>
              <h1 className="font-display text-3xl text-primary">Price data did not load</h1>
              <p className="mt-3 text-sm text-muted-foreground">
                Check that <code className="font-mono-app">data.json</code> is in the public folder.
              </p>
              <p className="mt-2 font-mono-app text-xs text-destructive">{loadError}</p>
            </>
          ) : (
            <p className="animate-pulse text-sm text-muted-foreground">Loading prices…</p>
          )}
        </main>
      ) : (
        <>
          <Progress stage={stage} />

          {stage === 'address' && (
            <AddressStep
              onConfirmed={(next) => {
                setLocation(next);
                setStage('basket');
              }}
            />
          )}

          {stage === 'basket' && location && (
            <BasketStep
              catalog={catalog}
              location={location}
              basket={basket}
              setBasket={setBasket}
              onContinue={() => setStage('results')}
              onBack={() => setStage('address')}
            />
          )}

          {stage === 'results' && location && (
            <ResultsStep
              catalog={catalog}
              location={location}
              basket={basket}
              onBack={() => setStage('basket')}
              onReset={reset}
            />
          )}
        </>
      )}

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 pb-8 text-[10px] uppercase tracking-[.16em] text-muted-foreground sm:px-8">
        <span>Built for the Malaysian grocery run</span>
        <span>Prices: KPDN PriceCatcher · Locations: OpenStreetMap</span>
      </footer>
    </div>
  );
}

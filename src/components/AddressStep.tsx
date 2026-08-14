import { type FormEvent, useState } from 'react';
import { ArrowRight, Check, CircleAlert, Compass, MapPin } from 'lucide-react';
import { geocodeAddress, type GeocodeCandidate } from '../lib/geocode'
import type { LocationPoint } from './ResultsStep';

export function AddressStep({ onConfirmed }: { onConfirmed: (location: LocationPoint) => void }) {
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<GeocodeCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) {
      setError('Enter a street, neighbourhood, or postcode.');
      return;
    }
    setLoading(true);
    setError('');
    setCandidates([]);
    setSearched(true);
    try {
      const results = await geocodeAddress(query.trim());
      setCandidates(results);
      if (results.length === 0) {
        setError('No match. Try a nearby landmark, a postcode, or a bigger road.');
      }
    } catch {
      setError('The map search did not respond. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto grid max-w-6xl gap-12 px-5 pb-20 pt-8 sm:px-8 lg:grid-cols-[1.02fr_.98fr] lg:gap-20 lg:pt-16">
      <section className="rise-in max-w-xl self-center">
        <p className="mb-5 font-mono-app text-[11px] font-medium uppercase tracking-[.2em] text-primary">
          A little local arithmetic
        </p>
        <h1 className="font-display text-[clamp(3.5rem,8vw,6.6rem)] leading-[.87] tracking-[-.055em] text-primary">
          Know where
          <br />
          <em className="text-accent">to shop.</em>
        </h1>
        <p className="mt-8 max-w-md text-[16px] leading-7 text-muted-foreground">
          Tell us where you start. We compare a one-stop trip against a two-stop split, counting the
          driving and the second stop, so the cheaper basket is not automatically the cheaper trip.
        </p>
        <div className="mt-10 flex flex-wrap gap-x-7 gap-y-3 text-xs font-bold text-foreground/70">
          <span className="flex items-center gap-2">
            <Check size={14} className="text-primary" />
            Government price data
          </span>
          <span className="flex items-center gap-2">
            <Check size={14} className="text-primary" />
            No account needed
          </span>
        </div>
      </section>

      <section className="rise-in rise-in-delay-1">
        <div className="relative overflow-hidden rounded-[28px] border border-border bg-card p-6 shadow-md sm:p-9">
          <div className="absolute -right-14 -top-14 size-44 rounded-full border-[18px] border-secondary/70" />
          <div className="absolute -bottom-20 -left-16 size-48 rounded-full border-[20px] border-accent/10" />
          <div className="relative">
            <div className="mb-8 flex items-center justify-between">
              <div>
                <span className="font-mono-app text-[10px] uppercase tracking-[.18em] text-muted-foreground">
                  First,
                </span>
                <h2 className="mt-2 font-display text-3xl text-primary">Where are you today?</h2>
              </div>
              <Compass className="text-accent" size={27} />
            </div>

            <form onSubmit={submit}>
              <label htmlFor="address" className="mb-2 block text-sm font-bold">
                Home, workplace, or starting point
              </label>
              <div className="relative">
                <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-primary" size={18} />
                <input
                  id="address"
                  data-testid="input-address"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="e.g. 12 Jalan Bangsar, Kuala Lumpur"
                  className="focus-ring h-14 w-full rounded-2xl border border-border bg-background pl-11 pr-4 text-sm outline-none transition-colors placeholder:text-muted-foreground/65 focus:border-primary"
                />
              </div>
              <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
                We look the address up with OpenStreetMap. Nothing is saved.
              </p>
              <button
                data-testid="button-find-address"
                type="submit"
                disabled={loading}
                className="focus-ring mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 text-sm font-bold text-primary-foreground shadow-sm transition-transform hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-70"
              >
                {loading ? 'Looking it up…' : 'Find my starting point'}
                {!loading && <ArrowRight size={17} />}
              </button>
            </form>

            {searched && loading && (
              <div className="mt-6 flex animate-pulse items-center gap-3 rounded-2xl bg-muted p-4 text-sm text-muted-foreground">
                <span className="size-2 rounded-full bg-accent" />
                Searching the map…
              </div>
            )}

            {error && !loading && (
              <div
                data-testid="status-geocode-error"
                className="mt-6 flex gap-3 rounded-2xl border border-destructive/20 bg-destructive/5 p-4 text-sm leading-5 text-destructive"
              >
                <CircleAlert className="mt-0.5 shrink-0" size={17} />
                <span>{error}</span>
              </div>
            )}

            {candidates.length > 0 && !loading && (
              <div className="mt-7">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-bold">Which one looks right?</p>
                  <span className="font-mono-app text-[10px] text-muted-foreground">
                    {candidates.length} matches
                  </span>
                </div>
                <div className="space-y-2">
                  {candidates.map((candidate, index) => (
                    <button
                      data-testid={`button-address-candidate-${index}`}
                      key={`${candidate.lat}-${candidate.lon}-${index}`}
                      onClick={() =>
                        onConfirmed({
                          lat: Number(candidate.lat),
                          lng: Number(candidate.lon),
                          label: candidate.display_name,
                        })
                      }
                      className="focus-ring group flex w-full items-start gap-3 rounded-2xl border border-border bg-background p-4 text-left transition-colors hover:border-primary hover:bg-secondary/30"
                    >
                      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-secondary font-mono-app text-[10px] text-primary">
                        {index + 1}
                      </span>
                      <span className="text-sm leading-5 text-foreground/80">
                        {candidate.display_name}
                        <span className="mt-1 block text-[11px] font-bold text-primary opacity-0 transition-opacity group-hover:opacity-100">
                          Use this starting point <ArrowRight className="ml-1 inline" size={12} />
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        <p className="mt-5 flex items-center justify-center gap-2 text-center text-[11px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-primary/60" />
          You pick the match — we never guess your location
        </p>
      </section>
    </main>
  );
}

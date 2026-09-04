'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PriceEvidenceBadge } from '@/components/price-evidence-badge';
import { ResultsMap710D } from '@/components/results/results-map-710d';
import { getPublicMultiCityTours, GlobevoyApiError } from '@/lib/api';
import {
  adaptMultiCityTours,
  multiCityApiParams,
  normalizeLegacyImage,
  parseResultsSearch,
  type RecommendationCardModel,
  type ResultsSearch
} from '@/lib/recommendations-708a';

const GV_WEB_710D_VERSION = 'GV-WEB-710D-R2';

type NoFeasibleTour = {
  reason?: string;
  suggestedMinimumBudgetDisplay?: number;
  cheapestPlanningEstimateDisplay?: number;
  displayCurrency?: string;
};

function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0
    }).format(value);
  } catch {
    return `${currency} ${Math.round(value).toLocaleString()}`;
  }
}

function currentSearch(): URLSearchParams {
  return typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);
}

function originName(search: ResultsSearch): string {
  const raw = search.rawOrigin || search.originCode;
  if (raw.toUpperCase() === 'YYZ') return 'Toronto';
  return raw || 'Origin';
}

function noFeasibleFromPayload(payload: unknown): NoFeasibleTour | null {
  if (!payload || typeof payload !== 'object') return null;
  const row = payload as { noFeasibleTour?: unknown };
  if (!row.noFeasibleTour || typeof row.noFeasibleTour !== 'object') return null;
  return row.noFeasibleTour as NoFeasibleTour;
}

function routeTitle(item: RecommendationCardModel): string {
  const cities = item.cities || [];
  return cities.map((city) => city.city).filter(Boolean).join(' + ') || item.title;
}

function routeLine(item: RecommendationCardModel, search: ResultsSearch): string[] {
  const origin = originName(search);
  return [origin, ...(item.cities || []).map((city) => city.city), origin];
}

function RouteChoice({
  item,
  search,
  active,
  onSelect
}: {
  item: RecommendationCardModel;
  search: ResultsSearch;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`gv-story-route-choice${active ? ' is-active' : ''}`}
      aria-pressed={active}
      onClick={onSelect}
    >
      <span>{item.label || 'Curated route'}</span>
      <strong>{routeTitle(item)}</strong>
      <b>{money(item.total, search.currency)}</b>
    </button>
  );
}

function JourneyCard({
  label,
  city,
  country,
  nights,
  image,
  active,
  returning,
  onFocus
}: {
  label: string;
  city: string;
  country?: string;
  nights?: number;
  image?: string | null;
  active: boolean;
  returning?: boolean;
  onFocus: () => void;
}) {
  const normalizedImage = normalizeLegacyImage(image);
  return (
    <article
      className={`gv-story-stop-card${active ? ' is-active' : ''}${returning ? ' is-return' : ''}`}
      tabIndex={0}
      onMouseEnter={onFocus}
      onFocus={onFocus}
    >
      <div className={`gv-story-stop-card__image${normalizedImage ? '' : ' is-fallback'}`}>
        {normalizedImage ? <img src={normalizedImage} alt={`${city} destination`} /> : <span>{city.slice(0, 1)}</span>}
        <small>{label}</small>
      </div>
      <div className="gv-story-stop-card__body">
        <p>{country || (returning ? 'Return home' : 'Starting point')}</p>
        <h3>{city}</h3>
        {typeof nights === 'number' && nights > 0 ? <strong>{nights} night{nights === 1 ? '' : 's'}</strong> : null}
        <span>{returning ? 'Journey complete' : label === 'Origin' ? 'Your journey starts here' : 'Destination stop'}</span>
      </div>
    </article>
  );
}

export function ResultsClient() {
  const [params, setParams] = useState<URLSearchParams>(() => new URLSearchParams());
  const [search, setSearch] = useState<ResultsSearch | null>(null);
  const [routes, setRoutes] = useState<RecommendationCardModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [noFeasible, setNoFeasible] = useState<NoFeasibleTour | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [formOrigin, setFormOrigin] = useState('');
  const [formBudget, setFormBudget] = useState('');
  const [formNights, setFormNights] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [storyStop, setStoryStop] = useState<number | null>(null);
  const [focusStop, setFocusStop] = useState<number | null>(null);

  useEffect(() => {
    const nextParams = currentSearch();
    const nextSearch = parseResultsSearch(nextParams);
    setParams(nextParams);
    setSearch(nextSearch);
    setFormOrigin(nextSearch.rawOrigin || nextSearch.originCode);
    setFormBudget(String(nextSearch.budget));
    setFormNights(String(nextSearch.nights));
  }, []);

  const load = useCallback(async () => {
    if (!search) return;
    setLoading(true);
    setError('');
    setRoutes([]);
    setSelectedId(null);
    setStoryStop(null);
    setNoFeasible(null);

    if (!search.rawOrigin && !search.originCode) {
      setLoading(false);
      setError('Choose a starting city before asking Globevoy for multi-city routes.');
      return;
    }

    try {
      const payload = await getPublicMultiCityTours(multiCityApiParams(search));
      const next = adaptMultiCityTours(payload, search).filter((item) => item.kind === 'multi').slice(0, 3);
      const noRoute = noFeasibleFromPayload(payload);
      setNoFeasible(noRoute);

      if (!next.length) {
        if (noRoute?.reason === 'no-route-within-protected-budget' && noRoute.suggestedMinimumBudgetDisplay) {
          setError(`No connected route currently fits the protected budget. Routes begin around ${money(noRoute.suggestedMinimumBudgetDisplay, noRoute.displayCurrency || search.currency)}.`);
        } else {
          setError('No connected multi-city route met the current budget and evidence rules. Try a higher budget or flexible timing.');
        }
      } else {
        setRoutes(next);
        setSelectedId(next[0].id);
      }
    } catch (err) {
      const message = err instanceof GlobevoyApiError ? err.message : 'The multi-city recommendation request failed.';
      setError(message || 'The multi-city recommendation request failed.');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    if (search) void load();
  }, [search, load]);

  const selected = useMemo(
    () => routes.find((item) => item.id === selectedId) || routes[0] || null,
    [routes, selectedId]
  );

  function chooseRoute(id: string) {
    setSelectedId(id);
    setStoryStop(null);
    setFocusStop(null);
  }

  function applyEdit() {
    const budget = Number(formBudget);
    const nights = Number(formNights);
    if (!formOrigin.trim() || !Number.isFinite(budget) || budget < 300 || !Number.isFinite(nights) || nights < 2 || nights > 21) return;
    const next = new URLSearchParams(params);
    next.set('origin', formOrigin.trim());
    next.set('budget', String(Math.round(budget)));
    next.set('nights', String(Math.round(nights)));
    window.location.assign(`/react/results/?${next.toString()}`);
  }

  if (!search) {
    return <main className="gv-story-page"><section className="gv-story-state"><p>Preparing your route search…</p></section></main>;
  }

  const origin = originName(search);
  const selectedStops = selected?.cities || [];
  const selectedRouteLine = selected ? routeLine(selected, search) : [];

  return (
    <main className="gv-story-page">
      <section className="gv-story-searchbar" aria-label="Current search">
        <div>
          <span>{search.rawOrigin || search.originCode}</span>
          <span>{money(search.budget, search.currency)}</span>
          <span>{search.adults} adult{search.adults === 1 ? '' : 's'}{search.children ? `, ${search.children} child${search.children === 1 ? '' : 'ren'}` : ''}</span>
          <span>{search.tripLength === 'auto' ? 'Flexible length' : `${search.nights} nights`}</span>
        </div>
        <button type="button" onClick={() => setEditOpen((value) => !value)}>Edit search</button>
      </section>

      {editOpen ? (
        <section className="gv-story-edit" aria-label="Edit route search">
          <label>Leaving from<input value={formOrigin} onChange={(event) => setFormOrigin(event.target.value)} /></label>
          <label>Total budget<input type="number" min="300" step="50" value={formBudget} onChange={(event) => setFormBudget(event.target.value)} /></label>
          <label>Nights<input type="number" min="2" max="21" value={formNights} onChange={(event) => setFormNights(event.target.value)} /></label>
          <button type="button" onClick={applyEdit}>Apply changes</button>
        </section>
      ) : null}

      <header className="gv-story-intro">
        <p>{GV_WEB_710D_VERSION} · MULTI-CITY DISCOVERY</p>
        <h1>Choose a route. Then experience the story.</h1>
        <span>Globevoy builds a small set of connected journeys that fit your starting city and budget, then lets you play the route before deciding what to explore next.</span>
      </header>

      {loading ? (
        <section className="gv-story-state" role="status">
          <div className="gv-story-spinner" />
          <h2>Building connected journeys…</h2>
          <p>Comparing route shape, stop combinations and the planning evidence available to Globevoy.</p>
        </section>
      ) : null}

      {!loading && error ? (
        <section className="gv-story-state gv-story-state--error" role="alert">
          <p>ROUTE STATUS</p>
          <h2>We could not build a multi-city journey yet</h2>
          <span>{error}</span>
          {noFeasible?.cheapestPlanningEstimateDisplay ? <small>Cheapest planning estimate found: {money(noFeasible.cheapestPlanningEstimateDisplay, noFeasible.displayCurrency || search.currency)}</small> : null}
          <div><button type="button" onClick={() => void load()}>Retry</button><button type="button" onClick={() => setEditOpen(true)}>Edit search</button></div>
        </section>
      ) : null}

      {!loading && !error && selected ? (
        <>
          <section className="gv-story-route-section" aria-label="Choose a connected route">
            <div className="gv-story-section-heading">
              <div><p>ROUTES</p><h2>Your trip options</h2></div>
              <span>Choose one route to update the map, story and complete journey below.</span>
            </div>
            <div className="gv-story-route-choices">
              {routes.map((item) => (
                <RouteChoice
                  key={item.id}
                  item={item}
                  search={search}
                  active={item.id === selected.id}
                  onSelect={() => chooseRoute(item.id)}
                />
              ))}
            </div>
          </section>

          <section className="gv-story-player" aria-label="Journey player">
            <div className="gv-story-player__copy">
              <p>YOUR ROUTE, IN MOTION</p>
              <h2>Play your journey.</h2>
              <span>Follow each flight leg and watch the story move from {origin} through your selected stops and home again.</span>
            </div>
            <ol className="gv-story-timeline">
              {selectedRouteLine.map((city, index) => {
                const isStopActive = storyStop === (index === selectedRouteLine.length - 1 ? selectedStops.length : index - 1);
                return (
                  <li key={`${city}-${index}`} className={isStopActive ? 'is-active' : ''}>
                    <i>{index === 0 || index === selectedRouteLine.length - 1 ? '⌂' : index}</i>
                    <span>{city}</span>
                    {index < selectedRouteLine.length - 1 ? <b aria-hidden="true">✈</b> : null}
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="gv-story-map-grid">
            <ResultsMap710D
              item={selected}
              search={search}
              focusStopIndex={focusStop}
              onStoryStop={setStoryStop}
            />

            <aside className="gv-story-summary">
              <p>YOUR GENERATED TOUR</p>
              <h2>{routeTitle(selected)}</h2>
              <span>{selectedRouteLine.join(' → ')}</span>
              <div className="gv-story-summary__evidence"><PriceEvidenceBadge evidence={selected.evidence} /></div>
              <dl>
                <div><dt>Origin</dt><dd>{search.rawOrigin || search.originCode}</dd></div>
                <div><dt>Budget</dt><dd>{money(search.budget, search.currency)}</dd></div>
                <div><dt>Estimated total</dt><dd>{money(selected.total, search.currency)}</dd></div>
                <div><dt>Nights</dt><dd>{selected.nights}</dd></div>
                <div><dt>Stops</dt><dd>{selectedStops.length}</dd></div>
                <div><dt>Planning room</dt><dd>{selected.remaining >= 0 ? money(selected.remaining, search.currency) : 'Tight fit'}</dd></div>
              </dl>
              <button type="button" onClick={() => document.getElementById('gv-complete-journey')?.scrollIntoView({ behavior: 'smooth' })}>Explore complete journey</button>
              <small>Prices remain planning evidence until fresh verification. Full flight and hotel detail is reconstructed in the next phase.</small>
            </aside>
          </section>

          <section className="gv-story-budget-strip" aria-label="Selected route budget summary">
            <span><small>Selected route</small><strong>{selectedRouteLine.join(' → ')}</strong></span>
            <span><small>Protected trip estimate</small><strong>{money(selected.total, search.currency)}</strong></span>
            <span><small>Planning room</small><strong>{selected.remaining >= 0 ? money(selected.remaining, search.currency) : 'Tight fit'}</strong></span>
            <span><small>Evidence</small><strong>{selected.evidence.label}</strong></span>
          </section>

          <section className="gv-story-complete" id="gv-complete-journey">
            <div className="gv-story-section-heading">
              <div><p>YOUR JOURNEY, DAY BY DAY</p><h2>Your complete journey</h2></div>
              <span>Move across the cards to focus each stop on the map. Flight and hotel specifics remain behind the next verification/detail step.</span>
            </div>
            <div className="gv-story-stop-track">
              <JourneyCard
                label="Origin"
                city={origin}
                active={storyStop === null && focusStop === -1}
                onFocus={() => setFocusStop(-1)}
              />
              {selectedStops.map((city, index) => (
                <div className="gv-story-stop-track__segment" key={`${city.city}-${index}`}>
                  <span className="gv-story-stop-track__arrow" aria-hidden="true">✈</span>
                  <JourneyCard
                    label={`Stop ${index + 1}`}
                    city={city.city}
                    country={city.country}
                    nights={city.nights}
                    image={city.image}
                    active={storyStop === index || focusStop === index}
                    onFocus={() => setFocusStop(index)}
                  />
                </div>
              ))}
              <div className="gv-story-stop-track__segment">
                <span className="gv-story-stop-track__arrow" aria-hidden="true">✈</span>
                <JourneyCard
                  label="Return"
                  city={origin}
                  returning
                  active={storyStop === selectedStops.length || focusStop === selectedStops.length}
                  onFocus={() => setFocusStop(selectedStops.length)}
                />
              </div>
            </div>
          </section>

          <aside className="gv-story-boundary">
            <strong>Planning evidence, not a checkout quote.</strong>
            <p>Globevoy is helping you choose the route first. Fresh flight schedules, hotel availability and final partner prices are verified later in the journey.</p>
          </aside>
        </>
      ) : null}
    </main>
  );
}

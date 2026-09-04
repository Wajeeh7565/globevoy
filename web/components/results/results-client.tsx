'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PriceEvidenceBadge } from '@/components/price-evidence-badge';
import { JourneyStoryDeck710DR4 } from '@/components/results/journey-story-deck-710d-r4';
import { ResultsMap710D } from '@/components/results/results-map-710d';
import { getPublicMultiCityTours, GlobevoyApiError } from '@/lib/api';
import {
  adaptMultiCityTours,
  multiCityApiParams,
  parseResultsSearch,
  type RecommendationCardModel,
  type ResultsCity,
  type ResultsSearch
} from '@/lib/recommendations-708a';

const GV_WEB_710D_VERSION = 'GV-WEB-710D-R4';

type NoFeasibleTour = {
  reason?: string;
  suggestedMinimumBudgetDisplay?: number;
  cheapestPlanningEstimateDisplay?: number;
  displayCurrency?: string;
};

function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
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

function cityKey(city: ResultsCity): string {
  return String(city.id || city.code || `${city.city}|${city.country}`).trim().toLowerCase();
}

function cityIds(item: RecommendationCardModel): string[] {
  return (item.cities || []).map((city) => String(city.id || '').trim().toLowerCase()).filter(Boolean);
}

function samePreferredStops(item: RecommendationCardModel, preferredIds: string[]): boolean {
  const current = cityIds(item).slice().sort();
  const wanted = preferredIds.map((id) => id.toLowerCase()).slice().sort();
  return current.length === wanted.length && current.every((id, index) => id === wanted[index]);
}

function RouteChoice({ item, search, active, onSelect }: {
  item: RecommendationCardModel;
  search: ResultsSearch;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button type="button" className={`gv-story-route-choice${active ? ' is-active' : ''}`} aria-pressed={active} onClick={onSelect}>
      <span>{item.label || 'Curated route'}</span>
      <strong>{routeTitle(item)}</strong>
      <b>{money(item.total, search.currency)}</b>
    </button>
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
  const [revealedStops, setRevealedStops] = useState<number[]>([]);
  const [latestRevealed, setLatestRevealed] = useState<number | null>(null);
  const [replaySignal, setReplaySignal] = useState(0);
  const [routeActionBusy, setRouteActionBusy] = useState(false);
  const [routeActionMessage, setRouteActionMessage] = useState('');
  const [shuffleCursor, setShuffleCursor] = useState(0);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const revealTimers = useRef<number[]>([]);

  useEffect(() => {
    const nextParams = currentSearch();
    const nextSearch = parseResultsSearch(nextParams);
    setParams(nextParams);
    setSearch(nextSearch);
    setFormOrigin(nextSearch.rawOrigin || nextSearch.originCode);
    setFormBudget(String(nextSearch.budget));
    setFormNights(String(nextSearch.nights));
  }, []);

  useEffect(() => () => {
    revealTimers.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  function resetStory() {
    revealTimers.current.forEach((timer) => window.clearTimeout(timer));
    revealTimers.current = [];
    setStoryStop(null);
    setRevealedStops([]);
    setLatestRevealed(null);
  }

  const load = useCallback(async () => {
    if (!search) return;
    setLoading(true);
    setError('');
    setRoutes([]);
    setSelectedId(null);
    setStoryStop(null);
    setRevealedStops([]);
    setLatestRevealed(null);
    setNoFeasible(null);
    setRouteActionMessage('');
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

  useEffect(() => { if (search) void load(); }, [search, load]);

  const selected = useMemo(() => routes.find((item) => item.id === selectedId) || routes[0] || null, [routes, selectedId]);

  const candidateCities = useMemo(() => {
    if (!selected) return [];
    const selectedKeys = new Set((selected.cities || []).map(cityKey));
    const unique = new Map<string, ResultsCity>();
    routes.forEach((route) => (route.cities || []).forEach((city) => {
      const key = cityKey(city);
      if (!selectedKeys.has(key) && !unique.has(key)) unique.set(key, city);
    }));
    return [...unique.values()];
  }, [routes, selected]);

  function chooseRoute(id: string) {
    setSelectedId(id);
    resetStory();
    setRouteActionMessage('');
    setAdjustOpen(false);
    setReplaySignal((value) => value + 1);
  }

  const handleStoryStop = useCallback((index: number | null) => {
    setStoryStop(index);
    if (index == null) return;
    const revealTimer = window.setTimeout(() => {
      setRevealedStops((current) => current.includes(index) ? current : [...current, index]);
      setLatestRevealed(index);
      const clearTimer = window.setTimeout(() => setLatestRevealed((current) => current === index ? null : current), 950);
      revealTimers.current.push(clearTimer);
    }, index === -1 ? 280 : 520);
    revealTimers.current.push(revealTimer);
  }, []);

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

  function scrollToTrip() {
    document.getElementById('gv-story-trip')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function recalculatePreferred(preferredIds: string[], actionLabel: string) {
    if (!search || routeActionBusy || preferredIds.length < 2) return;
    setRouteActionBusy(true);
    setRouteActionMessage(`${actionLabel}…`);
    try {
      const payload = await getPublicMultiCityTours({
        ...multiCityApiParams(search),
        preferredStops: preferredIds.join(','),
        maxStops: preferredIds.length
      });
      const next = adaptMultiCityTours(payload, search).filter((item) => item.kind === 'multi').slice(0, 3);
      const exact = next.find((item) => samePreferredStops(item, preferredIds));
      if (!exact) {
        setRouteActionMessage('That change did not produce a feasible protected-budget route. Your current trip is unchanged.');
        return;
      }
      setRoutes(next);
      setSelectedId(exact.id);
      resetStory();
      setReplaySignal((value) => value + 1);
      setRouteActionMessage(`${routeTitle(exact)} rebuilt within the route engine.`);
    } catch (err) {
      setRouteActionMessage(err instanceof GlobevoyApiError ? err.message : 'Globevoy could not recalculate that route right now.');
    } finally {
      setRouteActionBusy(false);
    }
  }

  function shuffleStop(index: number) {
    if (!selected) return;
    const currentIds = cityIds(selected);
    if (currentIds.length !== (selected.cities || []).length || !candidateCities.length) {
      setRouteActionMessage('No alternate supported stop is available for this card yet.');
      return;
    }
    const otherIds = new Set(currentIds.filter((_, currentIndex) => currentIndex !== index));
    const candidates = candidateCities.filter((city) => city.id && !otherIds.has(String(city.id).toLowerCase()));
    if (!candidates.length) {
      setRouteActionMessage('No different feasible stop is available from the current recommendation portfolio.');
      return;
    }
    const candidate = candidates[(shuffleCursor + index) % candidates.length];
    const replacementId = String(candidate.id || '').toLowerCase();
    const preferred = currentIds.map((id, currentIndex) => currentIndex === index ? replacementId : id);
    setShuffleCursor((value) => value + 1);
    void recalculatePreferred(preferred, `Trying ${candidate.city} instead`);
  }

  function addDestination(city: ResultsCity) {
    if (!selected || !city.id) return;
    const currentIds = cityIds(selected);
    if (currentIds.length !== (selected.cities || []).length || currentIds.length >= 3) {
      setRouteActionMessage('This route cannot add another supported destination in the current three-stop discovery scope.');
      return;
    }
    const nextId = String(city.id).toLowerCase();
    if (currentIds.includes(nextId)) return;
    void recalculatePreferred([...currentIds, nextId], `Checking ${city.city} as an extra stop`);
  }

  if (!search) return <main className="gv-story-page"><section className="gv-story-state"><p>Preparing your route search…</p></section></main>;

  const selectedStops = selected?.cities || [];
  const selectedRouteLine = selected ? routeLine(selected, search) : [];

  return (
    <main className="gv-story-page gv-story-page--r4">
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

      <header className="gv-story-intro gv-story-intro--r4">
        <p>{GV_WEB_710D_VERSION} · BUDGET-FIRST MULTI-CITY</p>
        <h1>Choose a route. Watch it become your trip.</h1>
        <span>Three connected ideas. One animated journey. Globevoy keeps the route, budget and stop logic behind the scenes.</span>
      </header>

      {loading ? (
        <section className="gv-story-state" role="status"><div className="gv-story-spinner" /><h2>Building connected journeys…</h2><p>Comparing route shape, stop combinations and the planning evidence available to Globevoy.</p></section>
      ) : null}

      {!loading && error ? (
        <section className="gv-story-state gv-story-state--error" role="alert">
          <p>ROUTE STATUS</p><h2>We could not build a multi-city journey yet</h2><span>{error}</span>
          {noFeasible?.cheapestPlanningEstimateDisplay ? <small>Cheapest planning estimate found: {money(noFeasible.cheapestPlanningEstimateDisplay, noFeasible.displayCurrency || search.currency)}</small> : null}
          <div><button type="button" onClick={() => void load()}>Retry</button><button type="button" onClick={() => setEditOpen(true)}>Edit search</button></div>
        </section>
      ) : null}

      {!loading && !error && selected ? (
        <>
          <section className="gv-story-route-section" aria-label="Choose a connected route">
            <div className="gv-story-section-heading"><div><p>ROUTES</p><h2>Your trip options</h2></div><span>Pick one. The story restarts automatically.</span></div>
            <div className="gv-story-route-choices">
              {routes.map((item) => <RouteChoice key={item.id} item={item} search={search} active={item.id === selected.id} onSelect={() => chooseRoute(item.id)} />)}
            </div>
          </section>

          <section className="gv-story-player" aria-label="Journey player">
            <div className="gv-story-player__copy"><p>YOUR ROUTE, IN MOTION</p><h2>Watch your journey unfold.</h2><span>Each stop appears on the map, then lands in your trip deck below.</span></div>
            <ol className="gv-story-timeline">
              {selectedRouteLine.map((city, index) => {
                const isStopActive = storyStop === (index === selectedRouteLine.length - 1 ? selectedStops.length : index - 1);
                return <li key={`${city}-${index}`} className={isStopActive ? 'is-active' : ''}><i>{index === 0 || index === selectedRouteLine.length - 1 ? '⌂' : index}</i><span>{city}</span>{index < selectedRouteLine.length - 1 ? <b aria-hidden="true">✈</b> : null}</li>;
              })}
            </ol>
          </section>

          <section className="gv-story-map-grid">
            <ResultsMap710D item={selected} search={search} onStoryStop={handleStoryStop} replaySignal={replaySignal} />
            <aside className="gv-story-summary gv-story-summary--r4">
              <p>YOUR GENERATED TOUR</p>
              <h2>{routeTitle(selected)}</h2>
              <span>{selected.label || 'Curated route'} · {search.rawOrigin || search.originCode} loop · {selected.nights} nights · {selectedStops.length} stops</span>
              <div className="gv-story-summary__chips"><b>GENERATED ROUTE</b><i>ESTIMATED VALUE ROUTE</i></div>
              <div className="gv-story-summary__evidence"><PriceEvidenceBadge evidence={selected.evidence} /></div>
              <dl>
                <div><dt>Origin</dt><dd>{search.rawOrigin || search.originCode}</dd></div>
                <div><dt>Budget</dt><dd>{money(search.budget, search.currency)}</dd></div>
                <div className="is-total"><dt>Estimated total</dt><dd>{money(selected.total, search.currency)}</dd></div>
                <div><dt>Nights</dt><dd>{selected.nights}</dd></div>
                <div><dt>Stops</dt><dd>{selectedStops.length}</dd></div>
                <div><dt>Planning room</dt><dd>{selected.remaining >= 0 ? money(selected.remaining, search.currency) : 'Tight fit'}</dd></div>
              </dl>
              <div className="gv-story-summary__buttons">
                <button type="button" onClick={scrollToTrip}>View trip</button>
                <button type="button" className="is-secondary" onClick={() => setAdjustOpen((value) => !value)}>Adjust trip</button>
              </div>
              {adjustOpen ? <div className="gv-story-adjust-panel"><button type="button" onClick={() => setEditOpen(true)}>Edit budget / length</button><button type="button" onClick={scrollToTrip}>Swap or add stops</button></div> : null}
            </aside>
          </section>

          <JourneyStoryDeck710DR4
            item={selected}
            search={search}
            revealed={revealedStops}
            activeStop={storyStop}
            latestRevealed={latestRevealed}
            candidateCities={candidateCities}
            busy={routeActionBusy}
            actionMessage={routeActionMessage}
            onShuffleStop={shuffleStop}
            onAddDestination={addDestination}
          />
        </>
      ) : null}
    </main>
  );
}

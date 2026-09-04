'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PriceEvidenceBadge } from '@/components/price-evidence-badge';
import { ResultsMap710D } from '@/components/results/results-map-710d';
import { getPublicMultiCityTours, getPublicRecommendations, GlobevoyApiError } from '@/lib/api';
import { legacyMultiSelectionPayload } from '@/lib/multi-selection-708a';
import {
  adaptMultiCityTours,
  adaptRecommendations,
  multiCityApiParams,
  normalizeLegacyImage,
  parseResultsSearch,
  pickPortfolio,
  recommendationApiParams,
  type RecommendationCardModel,
  type ResultsSearch
} from '@/lib/recommendations-708a';

const GV_WEB_710D_VERSION = 'GV-WEB-710D-R1';
type ResultFilter = 'all' | 'single' | 'multi';

function money(value: number, currency: string): string {
  try { return new Intl.NumberFormat('en-CA', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value); }
  catch { return `${currency} ${Math.round(value).toLocaleString()}`; }
}

function currentSearch(): URLSearchParams {
  return typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);
}

function legacyReturnTo(params: URLSearchParams): string {
  return `/react/results/?${params.toString()}`;
}

function singleHref(item: RecommendationCardModel, search: ResultsSearch, params: URLSearchParams): string {
  const next = new URLSearchParams(params);
  next.set('mode', 'single');
  next.set('origin', search.rawOrigin || search.originCode);
  next.set('city', item.city || '');
  next.set('country', item.country || '');
  next.set('code', item.code || '');
  next.set('budget', String(Math.round(item.sourceBudgetTotal || search.budget)));
  next.set('currency', search.currency);
  next.set('reserve', String(Math.round(item.reserveAmount || 0)));
  next.set('nights', String(item.nights));
  next.set('passengers', String(search.passengers));
  next.set('total', String(Math.round(item.total)));
  next.set('flight', String(Math.round(item.flight || 0)));
  next.set('stay', String(Math.round(item.stay || 0)));
  next.set('remaining', String(Math.round(Math.max(0, item.remaining))));
  next.set('label', item.label);
  next.set('returnTo', legacyReturnTo(params));
  return `/trip.html?${next.toString()}`;
}

function multiHref(item: RecommendationCardModel, search: ResultsSearch, params: URLSearchParams): string {
  const next = new URLSearchParams(params);
  next.set('mode', 'multi');
  next.set('origin', search.rawOrigin || search.originCode);
  next.set('budget', String(Math.round(search.budget)));
  next.set('currency', search.currency);
  next.set('nights', String(item.nights));
  next.set('cities', String(item.cities?.length || 0));
  next.set('routeId', item.routeId || '');
  next.set('returnTo', legacyReturnTo(params));
  return `/multicity-visualizer.html?${next.toString()}`;
}

function persistAndOpen(item: RecommendationCardModel, search: ResultsSearch, params: URLSearchParams): void {
  try {
    if (item.kind === 'single') {
      sessionStorage.setItem('gv-selected-offer', JSON.stringify({ ...item.selectionPayload, _label: item.label }));
    } else {
      sessionStorage.setItem('globevoy.multi.selected.v1', JSON.stringify(legacyMultiSelectionPayload(item, search, params)));
    }
  } catch {}
  window.location.assign(item.kind === 'single' ? singleHref(item, search, params) : multiHref(item, search, params));
}

function ResultVisual({ item }: { item: RecommendationCardModel }) {
  const image = normalizeLegacyImage(item.image);
  if (item.kind === 'single' && image) {
    return <div className="gv-results-next-card__visual"><img src={image} alt={`${item.city || item.title} destination`} /></div>;
  }
  if (item.kind === 'multi') {
    const cities = (item.cities || []).slice(0, 3);
    return (
      <div className="gv-results-next-card__visual gv-results-next-card__visual--route" aria-label={`${item.title} route preview`}>
        {cities.map((city, index) => (
          <div key={`${city.city}-${index}`}>
            <small>STOP {index + 1}</small>
            <strong>{city.city}</strong>
            <span>{city.country}</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="gv-results-next-card__visual gv-results-next-card__visual--fallback">
      <span>{item.city?.slice(0, 1) || 'G'}</span>
      <strong>{item.city || item.title}</strong>
    </div>
  );
}

function ResultCard({
  item,
  search,
  params,
  active,
  onSelect
}: {
  item: RecommendationCardModel;
  search: ResultsSearch;
  params: URLSearchParams;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const type = item.kind === 'single' ? 'Single destination' : `${item.cities?.length || 0}-city route`;
  const planningRoom = item.remaining >= 0 ? `${money(item.remaining, search.currency)} room after estimate` : 'Near the selected budget';

  function select() { onSelect(item.id); }

  return (
    <article
      id={`gv-result-${item.id}`}
      className={`gv-results-next-card${active ? ' is-active' : ''}${item.featured ? ' is-featured' : ''}`}
      tabIndex={0}
      aria-current={active ? 'true' : undefined}
      onMouseEnter={select}
      onFocus={select}
      onClick={select}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          select();
        }
      }}
    >
      <ResultVisual item={item} />
      <div className="gv-results-next-card__content">
        <div className="gv-results-next-card__topline">
          <span className="gv-results-next-card__role">{item.label || 'Trip idea'}</span>
          {item.featured ? <span className="gv-results-next-card__pick">Globevoy pick</span> : null}
        </div>
        <div className="gv-results-next-card__heading">
          <div>
            <p>{type} · {item.nights} nights</p>
            <h3>{item.title}</h3>
          </div>
          <strong>{money(item.total, search.currency)}</strong>
        </div>
        <p className="gv-results-next-card__route">{item.route}</p>
        <div className="gv-results-next-card__evidence"><PriceEvidenceBadge evidence={item.evidence} /></div>
        <p className="gv-results-next-card__why">{item.why}</p>
        <div className="gv-results-next-card__footer">
          <span>{planningRoom}</span>
          <button
            type="button"
            className="gv-results-next-card__details"
            onClick={(event) => {
              event.stopPropagation();
              persistAndOpen(item, search, params);
            }}
          >
            {item.kind === 'single' ? 'View trip details' : 'View route details'}
          </button>
        </div>
      </div>
    </article>
  );
}

export function ResultsClient() {
  const [params, setParams] = useState<URLSearchParams>(() => new URLSearchParams());
  const [search, setSearch] = useState<ResultsSearch | null>(null);
  const [items, setItems] = useState<RecommendationCardModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [formOrigin, setFormOrigin] = useState('');
  const [formBudget, setFormBudget] = useState('');
  const [formNights, setFormNights] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filter, setFilter] = useState<ResultFilter>('all');

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
    setItems([]);
    setActiveId(null);

    if (!search.rawOrigin && !search.originCode) {
      setLoading(false);
      setError('Choose a starting city before asking Globevoy for recommendations.');
      return;
    }

    try {
      const [singleResult, multiResult] = await Promise.allSettled([
        getPublicRecommendations(recommendationApiParams(search)),
        getPublicMultiCityTours(multiCityApiParams(search))
      ]);

      if (singleResult.status === 'rejected' && multiResult.status === 'rejected') {
        throw singleResult.reason;
      }

      const singles = singleResult.status === 'fulfilled' ? adaptRecommendations(singleResult.value, search) : [];
      const multis = multiResult.status === 'fulfilled' ? adaptMultiCityTours(multiResult.value, search) : [];
      const next = pickPortfolio(singles, multis, search);

      if (!next.length) {
        setError('No single-destination or connected route met the current budget and evidence rules. Try a higher budget, broader region or flexible timing.');
      } else {
        setItems(next);
        setActiveId(next[0].id);
      }
    } catch (err) {
      const message = err instanceof GlobevoyApiError ? err.message : 'The recommendation request failed.';
      setError(message || 'The recommendation request failed.');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { if (search) void load(); }, [search, load]);

  const hasSingles = useMemo(() => items.some((item) => item.kind === 'single'), [items]);
  const hasMultis = useMemo(() => items.some((item) => item.kind === 'multi'), [items]);
  const visibleItems = useMemo(() => items.filter((item) => filter === 'all' || item.kind === filter), [items, filter]);

  useEffect(() => {
    if (!visibleItems.length) return;
    if (!activeId || !visibleItems.some((item) => item.id === activeId)) setActiveId(visibleItems[0].id);
  }, [visibleItems, activeId]);

  const handleMapSelect = useCallback((id: string) => {
    setActiveId(id);
    window.requestAnimationFrame(() => {
      document.getElementById(`gv-result-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
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

  if (!search) {
    return <main className="gv-results-next"><section className="gv-results-next-state"><p>Preparing your search…</p></section></main>;
  }

  return (
    <main className="gv-results-next">
      <section className="gv-results-next-searchbar" aria-label="Current search">
        <div className="gv-results-next-searchbar__pills">
          <span>{search.rawOrigin || search.originCode}</span>
          <span>{money(search.budget, search.currency)}</span>
          <span>{search.adults} adult{search.adults === 1 ? '' : 's'}{search.children ? `, ${search.children} child${search.children === 1 ? '' : 'ren'}` : ''}</span>
          <span>{search.tripLength === 'auto' ? 'Flexible length' : `${search.nights} nights`}</span>
        </div>
        <button type="button" onClick={() => setEditOpen((value) => !value)}>Edit search</button>
      </section>

      {editOpen ? (
        <section className="gv-results-next-edit" aria-label="Edit recommendation search">
          <label>Leaving from<input value={formOrigin} onChange={(event) => setFormOrigin(event.target.value)} /></label>
          <label>Total budget<input type="number" min="300" step="50" value={formBudget} onChange={(event) => setFormBudget(event.target.value)} /></label>
          <label>Nights<input type="number" min="2" max="21" value={formNights} onChange={(event) => setFormNights(event.target.value)} /></label>
          <div><button type="button" onClick={applyEdit}>Apply changes</button></div>
        </section>
      ) : null}

      <section className="gv-results-next-intro">
        <div>
          <p>{GV_WEB_710D_VERSION} · CURATED FOR YOUR BUDGET</p>
          <h1>Choose the trip that feels right.</h1>
          <span>Globevoy keeps the list small, then puts every option on the map so you can compare distance, route shape and budget at a glance.</span>
        </div>
        {!loading && !error && items.length ? (
          <div className="gv-results-next-summary">
            <strong>{items.length}</strong>
            <span>strong possibilities</span>
          </div>
        ) : null}
      </section>

      {loading ? (
        <section className="gv-results-next-state" role="status">
          <div className="gv-results-next-spinner" />
          <h2>Comparing trip possibilities…</h2>
          <p>Checking destination fit, connected routes and the budget evidence already available to Globevoy.</p>
        </section>
      ) : null}

      {!loading && error ? (
        <section className="gv-results-next-state gv-results-next-state--error" role="alert">
          <p>SEARCH STATUS</p>
          <h2>We could not build the recommendation set yet</h2>
          <span>{error}</span>
          <div><button type="button" onClick={() => void load()}>Retry</button><button type="button" onClick={() => setEditOpen(true)}>Edit search</button></div>
        </section>
      ) : null}

      {!loading && !error && items.length ? (
        <>
          <section className="gv-results-next-toolbar" aria-label="Filter trip results">
            <div>
              <strong>Your best options</strong>
              <span>Select a card to focus its route on the map.</span>
            </div>
            <div className="gv-results-next-filters" role="group" aria-label="Trip type">
              <button type="button" className={filter === 'all' ? 'is-active' : ''} onClick={() => setFilter('all')}>All</button>
              {hasSingles ? <button type="button" className={filter === 'single' ? 'is-active' : ''} onClick={() => setFilter('single')}>Single city</button> : null}
              {hasMultis ? <button type="button" className={filter === 'multi' ? 'is-active' : ''} onClick={() => setFilter('multi')}>Multi-city</button> : null}
            </div>
          </section>

          <section className="gv-results-next-workspace">
            <div className="gv-results-next-list" aria-label="Trip recommendations">
              {visibleItems.map((item) => (
                <ResultCard
                  key={item.id}
                  item={item}
                  search={search}
                  params={params}
                  active={item.id === activeId}
                  onSelect={setActiveId}
                />
              ))}
            </div>
            <ResultsMap710D items={visibleItems} search={search} activeId={activeId} onSelect={handleMapSelect} />
          </section>

          <aside className="gv-results-next-boundary">
            <strong>Planning evidence, not a checkout quote.</strong>
            <p>Final schedules, inventory and prices are confirmed during fresh verification or on partner websites. Globevoy does not create a reservation or take payment on this page.</p>
          </aside>
        </>
      ) : null}
    </main>
  );
}

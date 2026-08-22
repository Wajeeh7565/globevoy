'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PriceEvidenceBadge } from '@/components/price-evidence-badge';
import { getPublicMultiCityTours, getPublicRecommendations, GlobevoyApiError } from '@/lib/api';
import { legacyMultiSelectionPayload } from '@/lib/multi-selection-708a';
import {
  adaptMultiCityTours,
  adaptRecommendations,
  GV_WEB_708A_VERSION,
  multiCityApiParams,
  normalizeLegacyImage,
  parseResultsSearch,
  pickPortfolio,
  recommendationApiParams,
  type RecommendationCardModel,
  type ResultsSearch
} from '@/lib/recommendations-708a';

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
    return <div className="gv-results-visual"><img src={image} alt={`${item.city || item.title} destination`} /></div>;
  }
  if (item.kind === 'multi') {
    const cities = (item.cities || []).slice(0, 2);
    return (
      <div className="gv-results-visual gv-results-visual--route" aria-label={`${item.title} route preview`}>
        {cities.map((city, index) => <div key={`${city.city}-${index}`}><span>{city.city}</span><small>{city.country}</small></div>)}
      </div>
    );
  }
  return <div className="gv-results-visual gv-results-visual--fallback"><span>{item.city?.slice(0, 1) || 'G'}</span><strong>{item.city || item.title}</strong></div>;
}

function ResultCard({ item, search, params }: { item: RecommendationCardModel; search: ResultsSearch; params: URLSearchParams; compact?: boolean }) {
  const type = item.kind === 'single' ? 'Single destination' : `${item.cities?.length || 0}-city route`;
  return (
    <article className={`gv-results-card${item.featured ? ' is-featured' : ''}`}>
      {item.featured ? <span className="gv-results-pick">Globevoy Pick</span> : null}
      <div className="gv-results-label">{item.label}</div>
      <ResultVisual item={item} />
      <div className="gv-results-card__body">
        <div className="gv-results-card__heading">
          <div>
            <p>{type} · {item.nights} nights</p>
            <h3>{item.title}</h3>
            <span>{item.route}</span>
          </div>
          <div className="gv-results-price"><small>Estimated trip</small><strong>{money(item.total, search.currency)}</strong></div>
        </div>
        <div className="gv-results-trust"><PriceEvidenceBadge evidence={item.evidence} /></div>
        {item.themes.length ? <div className="gv-results-chips">{item.themes.slice(0, 3).map((theme) => <span key={theme}>{theme}</span>)}</div> : null}
        <p className="gv-results-why">{item.why}</p>
        <div className="gv-results-card__footer">
          <span>{item.remaining >= 0 ? `${money(item.remaining, search.currency)} planning room after estimate` : 'Near the selected budget'}</span>
          <button className="gv-button gv-button--primary" type="button" onClick={() => persistAndOpen(item, search, params)}>
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

  useEffect(() => {
    const nextParams = currentSearch();
    const nextSearch = parseResultsSearch(nextParams);
    setParams(nextParams);
    setSearch(nextSearch);
    setFormOrigin(nextSearch.rawOrigin);
    setFormBudget(String(nextSearch.budget));
    setFormNights(String(nextSearch.nights));
  }, []);

  const load = useCallback(async () => {
    if (!search) return;
    setLoading(true); setError(''); setItems([]);
    if (!search.rawOrigin && !search.originCode) {
      setLoading(false); setError('Choose a starting city before asking Globevoy for recommendations.'); return;
    }
    try {
      const singlesPayload = await getPublicRecommendations(recommendationApiParams(search));
      const singles = adaptRecommendations(singlesPayload, search);
      let multis: RecommendationCardModel[] = [];
      try {
        const multiPayload = await getPublicMultiCityTours(multiCityApiParams(search));
        multis = adaptMultiCityTours(multiPayload, search);
      } catch (multiError) {
        console.warn('GV-WEB-708A multi-city recommendations unavailable; preserving single results.', multiError);
      }
      const next = pickPortfolio(singles, multis, search);
      if (!next.length) setError('No single-destination or connected route met the current budget and evidence rules. Try a higher budget, broader region or flexible timing.');
      setItems(next);
    } catch (err) {
      const message = err instanceof GlobevoyApiError ? err.message : 'The recommendation request failed.';
      setError(message || 'The recommendation request failed.');
    } finally { setLoading(false); }
  }, [search]);

  useEffect(() => { if (search) void load(); }, [search, load]);

  const primary = useMemo(() => items.slice(0, 3), [items]);
  const alternatives = useMemo(() => items.slice(3, 6), [items]);

  function applyEdit() {
    const budget = Number(formBudget); const nights = Number(formNights);
    if (!formOrigin.trim() || !Number.isFinite(budget) || budget < 300 || !Number.isFinite(nights) || nights < 2 || nights > 21) return;
    const next = new URLSearchParams(params);
    next.set('origin', formOrigin.trim()); next.set('budget', String(Math.round(budget))); next.set('nights', String(Math.round(nights)));
    window.location.assign(`/react/results/?${next.toString()}`);
  }

  if (!search) return <main className="gv-results-page"><section className="gv-results-state"><p>Preparing your search…</p></section></main>;

  return (
    <main className="gv-results-page">
      <section className="gv-results-searchbar" aria-label="Current search">
        <div className="gv-results-pills">
          <span>{search.rawOrigin || search.originCode}</span><span>{money(search.budget, search.currency)}</span>
          <span>{search.adults} adult{search.adults === 1 ? '' : 's'}{search.children ? `, ${search.children} child${search.children === 1 ? '' : 'ren'}` : ''}</span>
          <span>{search.tripLength === 'auto' ? 'Flexible length' : `${search.nights} nights`}</span>
        </div>
        <button className="gv-button gv-button--secondary" type="button" onClick={() => setEditOpen((value) => !value)}>Edit search</button>
      </section>

      {editOpen ? (
        <section className="gv-results-edit" aria-label="Edit recommendation search">
          <label>Leaving from<input value={formOrigin} onChange={(event) => setFormOrigin(event.target.value)} /></label>
          <label>Total budget<input type="number" min="300" step="50" value={formBudget} onChange={(event) => setFormBudget(event.target.value)} /></label>
          <label>Nights<input type="number" min="2" max="21" value={formNights} onChange={(event) => setFormNights(event.target.value)} /></label>
          <div><button className="gv-button gv-button--primary" type="button" onClick={applyEdit}>Apply changes</button></div>
        </section>
      ) : null}

      <section className="gv-results-intro">
        <p className="gv-kicker">{GV_WEB_708A_VERSION} · RECOMMENDED FOR YOUR BUDGET</p>
        <h1>Your strongest trip possibilities</h1>
        <p>Compare a deliberately small portfolio of single-destination and connected-route ideas. Map-first route interaction stays on the proven legacy pages until the R4 map migration.</p>
      </section>

      {loading ? (
        <section className="gv-results-state" role="status"><div className="gv-results-spinner" /><h2>Comparing trip possibilities…</h2><p>Checking destination fit, route quality and your current budget.</p></section>
      ) : null}

      {!loading && error ? (
        <section className="gv-results-state gv-results-state--error" role="alert"><p className="gv-kicker">SEARCH STATUS</p><h2>We could not build the recommendation set yet</h2><p>{error}</p><div><button className="gv-button gv-button--primary" type="button" onClick={() => void load()}>Retry</button> <button className="gv-button gv-button--secondary" type="button" onClick={() => setEditOpen(true)}>Edit search</button></div></section>
      ) : null}

      {!loading && !error && items.length ? (
        <>
          <section className="gv-results-section">
            <div className="gv-results-section__head"><div><p className="gv-kicker">TOP MATCHES</p><h2>Three easy choices</h2><p>{primary.length} distinct options for this search.</p></div></div>
            <div className="gv-results-grid">{primary.map((item) => <ResultCard key={item.id} item={item} search={search} params={params} />)}</div>
          </section>
          {alternatives.length ? (
            <section className="gv-results-section"><div className="gv-results-section__head"><div><p className="gv-kicker">ALTERNATIVE DISCOVERIES</p><h2>Other possibilities worth considering</h2></div></div><div className="gv-results-grid gv-results-grid--alternatives">{alternatives.map((item) => <ResultCard key={item.id} item={item} search={search} params={params} compact />)}</div></section>
          ) : null}
          <aside className="gv-boundary"><strong>Before booking</strong><p>Recommendation prices are planning evidence, not guaranteed quotes. Final schedules, inventory and prices are confirmed during fresh verification or on partner websites.</p></aside>
        </>
      ) : null}
    </main>
  );
}

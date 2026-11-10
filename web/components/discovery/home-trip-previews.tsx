'use client';

import { useEffect, useMemo, useState } from 'react';
import { getPublicMultiCityTours, getPublicRecommendations } from '@/lib/api';
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

type HomeTripPreviewsProps = {
  origin: string;
  budget: string;
  currency: string;
  adults: number;
  children: number;
  tripLength: string;
  month: string;
  interest: string;
  hotelStyle: string;
  region: string;
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

function evidenceLabel(item: RecommendationCardModel): string {
  switch (item.evidence.state) {
    case 'provider': return 'Provider-backed';
    case 'cached': return 'Cached price';
    case 'unavailable': return 'Needs verification';
    default: return 'Planning estimate';
  }
}

function previewSelection(portfolio: RecommendationCardModel[]): RecommendationCardModel[] {
  const singles = portfolio.filter((item) => item.kind === 'single');
  const multis = portfolio.filter((item) => item.kind === 'multi');
  const selected: RecommendationCardModel[] = [];

  const add = (item?: RecommendationCardModel) => {
    if (item && !selected.some((chosen) => chosen.id === item.id)) selected.push(item);
  };

  add(singles[0]);
  add(singles[1]);
  add(multis[0]);
  portfolio.forEach((item) => { if (selected.length < 3) add(item); });
  return selected.slice(0, 3);
}

function resultParams(props: HomeTripPreviewsProps): URLSearchParams {
  const fixedNights = props.tripLength === 'auto' ? 5 : Number(props.tripLength);
  const params = new URLSearchParams({
    origin: props.origin.trim(),
    budget: String(Math.round(Number(props.budget))),
    currency: props.currency,
    adults: String(props.adults),
    children: String(props.children),
    passengers: String(props.adults + props.children),
    nights: String(fixedNights),
    tripLength: props.tripLength,
    interests: props.interest,
    hotelStyle: props.hotelStyle,
    region: props.region
  });
  if (props.month) params.set('preferredMonth', props.month);
  return params;
}

function routePreview(item: RecommendationCardModel, search: ResultsSearch) {
  if (item.kind === 'single') return `${search.originCity} → ${item.city || item.title}`;
  const cityNames = (item.cities || []).map((city) => city.city).filter(Boolean);
  return [search.originCity, ...cityNames, search.originCity].join(' → ');
}

function TripPreviewCard({ item, search, href }: { item: RecommendationCardModel; search: ResultsSearch; href: string }) {
  const image = item.kind === 'single' ? normalizeLegacyImage(item.image) : '';
  return (
    <a className="gv-home-preview-card" href={href} aria-label={`Explore ${item.title} recommendations`}>
      <div className={`gv-home-preview-card__visual${image ? '' : ' gv-home-preview-card__visual--route'}`}>
        {image ? <img src={image} alt="" loading="lazy" /> : (
          <div className="gv-home-preview-card__route" aria-hidden="true">
            {(item.kind === 'multi' ? (item.cities || []).slice(0, 3).map((city) => city.city) : [item.city || item.title]).map((city, index) => (
              <span key={`${city}-${index}`}>{city}</span>
            ))}
          </div>
        )}
        <span className="gv-home-preview-card__role">{item.label || (item.kind === 'multi' ? 'Multi-city route' : 'Trip idea')}</span>
      </div>
      <div className="gv-home-preview-card__body">
        <div className="gv-home-preview-card__heading">
          <div>
            <h3>{item.title}</h3>
            <p>{item.nights} nights · {item.kind === 'multi' ? `${item.cities?.length || 0}-city route` : 'Single destination'}</p>
          </div>
          <strong>{money(item.total, search.currency)}</strong>
        </div>
        <p className="gv-home-preview-card__route-text">{routePreview(item, search)}</p>
        <div className="gv-home-preview-card__trust">
          <span>{evidenceLabel(item)}</span>
          <span aria-hidden="true">Explore →</span>
        </div>
      </div>
    </a>
  );
}

export function HomeTripPreviews(props: HomeTripPreviewsProps) {
  const [items, setItems] = useState<RecommendationCardModel[]>([]);
  const [search, setSearch] = useState<ResultsSearch | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'empty' | 'error'>('idle');

  const normalizedOrigin = props.origin.trim();
  const numericBudget = Number(props.budget);
  const query = useMemo(() => resultParams(props), [
    props.origin,
    props.budget,
    props.currency,
    props.adults,
    props.children,
    props.tripLength,
    props.month,
    props.interest,
    props.hotelStyle,
    props.region
  ]);
  const resultsHref = `/react/results/?${query.toString()}`;

  useEffect(() => {
    if (normalizedOrigin.length < 3 || !Number.isFinite(numericBudget) || numericBudget < 300) {
      setItems([]);
      setSearch(null);
      setState('idle');
      return;
    }

    let active = true;
    const timer = window.setTimeout(async () => {
      const nextSearch = parseResultsSearch(query);
      setState('loading');

      const [singleResult, multiResult] = await Promise.allSettled([
        getPublicRecommendations(recommendationApiParams(nextSearch)),
        getPublicMultiCityTours(multiCityApiParams(nextSearch))
      ]);
      if (!active) return;

      if (singleResult.status === 'rejected' && multiResult.status === 'rejected') {
        setItems([]);
        setSearch(nextSearch);
        setState('error');
        return;
      }

      const singles = singleResult.status === 'fulfilled' ? adaptRecommendations(singleResult.value, nextSearch) : [];
      const multis = multiResult.status === 'fulfilled' ? adaptMultiCityTours(multiResult.value, nextSearch) : [];
      const portfolio = pickPortfolio(singles, multis, nextSearch);
      const previews = previewSelection(portfolio);

      setSearch(nextSearch);
      setItems(previews);
      setState(previews.length ? 'ready' : 'empty');
    }, 700);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [normalizedOrigin, numericBudget, query]);

  return (
    <section className="gv-home-previews" aria-labelledby="gv-home-previews-title">
      <div className="gv-home-previews__head">
        <div>
          <p>Trip possibilities</p>
          <h2 id="gv-home-previews-title">See what your budget could unlock</h2>
        </div>
        {state === 'ready' ? <a href={resultsHref}>View all recommendations →</a> : null}
      </div>

      {state === 'idle' ? (
        <div className="gv-home-previews__prompt">
          <strong>Start with your city.</strong>
          <span>Choose a starting city or airport above and Globevoy will load real planning ideas here — without inventing prices.</span>
        </div>
      ) : null}

      {state === 'loading' ? (
        <div className="gv-home-previews__loading" role="status">
          <span className="gv-home-previews__spinner" aria-hidden="true" />
          <span>Comparing single-destination and multi-city possibilities…</span>
        </div>
      ) : null}

      {state === 'ready' && search ? (
        <div className="gv-home-previews__grid">
          {items.map((item) => <TripPreviewCard key={item.id} item={item} search={search} href={resultsHref} />)}
        </div>
      ) : null}

      {state === 'empty' ? (
        <div className="gv-home-previews__prompt">
          <strong>No preview matched this budget yet.</strong>
          <span>You can still run the full search above or increase the budget to widen the possibilities.</span>
        </div>
      ) : null}

      {state === 'error' ? (
        <div className="gv-home-previews__prompt">
          <strong>We couldn’t load trip ideas right now.</strong>
          <span>This is a request problem, not proof that your budget has no matches. Try again after the connection is restored.</span>
        </div>
      ) : null}
    </section>
  );
}

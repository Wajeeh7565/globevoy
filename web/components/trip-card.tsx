import type { ReactNode } from 'react';
import { PriceEvidenceBadge } from '@/components/price-evidence-badge';
import type { PriceEvidence } from '@/lib/contracts';

interface TripCardProps {
  title: string;
  route: string;
  amount?: number;
  currency?: string;
  evidence: PriceEvidence;
  typeLabel?: string;
  updatedLabel?: string;
  actions?: ReactNode;
}

export function TripCard({
  title,
  route,
  amount,
  currency = 'CAD',
  evidence,
  typeLabel = 'Saved trip',
  updatedLabel,
  actions
}: TripCardProps) {
  const formatted = Number.isFinite(Number(amount)) && Number(amount) > 0
    ? new Intl.NumberFormat('en-CA', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(amount))
    : 'Price needs verification';

  return (
    <article className="gv-trip-card">
      <div className="gv-trip-card__content">
        <p className="gv-kicker">{typeLabel}</p>
        <h2>{title}</h2>
        <p className="gv-route">{route}</p>
        <div className="gv-trip-card__meta">
          <strong className="gv-trip-price">{formatted}</strong>
          {updatedLabel ? <span>{updatedLabel}</span> : null}
        </div>
        <PriceEvidenceBadge evidence={evidence} />
      </div>
      {actions ? <div className="gv-trip-card__actions">{actions}</div> : null}
    </article>
  );
}

import { PriceEvidenceBadge } from '@/components/price-evidence-badge';
import type { PriceEvidence } from '@/lib/contracts';

interface TripCardProps {
  title: string;
  route: string;
  amount: number;
  currency: string;
  evidence: PriceEvidence;
}

export function TripCard({ title, route, amount, currency, evidence }: TripCardProps) {
  const formatted = new Intl.NumberFormat('en-CA', {
    style: 'currency', currency, maximumFractionDigits: 0
  }).format(amount);

  return (
    <article className="gv-trip-card">
      <div>
        <p className="gv-kicker">SAVED TRIP COMPONENT</p>
        <h2>{title}</h2>
        <p className="gv-route">{route}</p>
        <PriceEvidenceBadge evidence={evidence} />
      </div>
      <strong className="gv-trip-price">{formatted}</strong>
    </article>
  );
}

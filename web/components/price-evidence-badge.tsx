import type { PriceEvidence } from '@/lib/contracts';

export function PriceEvidenceBadge({ evidence }: { evidence: PriceEvidence }) {
  return (
    <span className={`gv-evidence gv-evidence--${evidence.state}`} title={evidence.note || undefined}>
      {evidence.label}
    </span>
  );
}

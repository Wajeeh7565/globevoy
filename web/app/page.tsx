import Link from 'next/link';
import { TripCard } from '@/components/trip-card';

const capabilities = [
  'Next.js App Router',
  'React 19',
  'TypeScript strict mode',
  'Reusable Globevoy components',
  'Compatible Cognito session',
  'Owner-private Saved Trips',
  'Static-export first',
  'Legacy rollback preserved'
];

export default function HomePage() {
  return (
    <div className="gv-foundation-page">
      <section className="gv-hero">
        <p className="gv-kicker">GV-WEB-707A</p>
        <h1>The first real Globevoy account surface is now in React.</h1>
        <p>
          The parallel Next.js + React + TypeScript app now implements Account and My Trips
          against the existing Cognito and owner-private Saved Trips contracts. The proven
          HTML/JavaScript MVP remains available as rollback until staging browser acceptance passes.
        </p>
        <div className="gv-account-actions">
          <Link className="gv-button gv-button--primary" href="/my-trips/">Open React My Trips</Link>
          <Link className="gv-button gv-button--secondary" href="/account/">Open React Account</Link>
        </div>
      </section>

      <section className="gv-section" aria-labelledby="foundation-capabilities">
        <div>
          <p className="gv-kicker">R1 MIGRATION CONTRACT</p>
          <h2 id="foundation-capabilities">What is ready</h2>
        </div>
        <ul className="gv-capability-grid">
          {capabilities.map((capability) => <li key={capability}>{capability}</li>)}
        </ul>
      </section>

      <section className="gv-section" aria-labelledby="component-proof">
        <div>
          <p className="gv-kicker">TRUST COMPONENT</p>
          <h2 id="component-proof">Saved prices remain snapshots</h2>
          <p className="gv-muted">Example only. No provider request is made by this card.</p>
        </div>
        <TripCard
          title="Toronto → Atlanta → Cancun → Toronto"
          route="Saved account route"
          amount={1741}
          currency="CAD"
          evidence={{
            state: 'estimate',
            label: 'Saved snapshot — verification required',
            note: 'A saved amount is historical planning evidence until a provider is checked again.'
          }}
        />
      </section>

      <section className="gv-boundary" aria-label="Migration safety boundary">
        <strong>Migration boundary</strong>
        <p>
          GV-WEB-707A does not replace the current staging routes, does not change Cognito,
          DynamoDB, Lambda, Duffel, Agoda, or the legacy Saved Trips pages, and does not introduce a second backend.
        </p>
      </section>
    </div>
  );
}

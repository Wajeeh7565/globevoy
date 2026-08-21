import { TripCard } from '@/components/trip-card';

const capabilities = [
  'Next.js App Router',
  'React 19',
  'TypeScript strict mode',
  'Reusable Globevoy components',
  'Typed Saved Trips contracts',
  'Existing Lambda API adapter',
  'Static-export first',
  'Existing MVP remains untouched'
];

export default function HomePage() {
  return (
    <div className="gv-foundation-page">
      <section className="gv-hero">
        <p className="gv-kicker">GV-WEB-706R</p>
        <h1>Modern frontend foundation, without a risky rewrite.</h1>
        <p>
          This parallel Next.js + React + TypeScript app is the migration target for Globevoy.
          The proven HTML/JavaScript MVP continues to run unchanged while pages move over one at a time.
        </p>
      </section>

      <section className="gv-section" aria-labelledby="foundation-capabilities">
        <div>
          <p className="gv-kicker">FOUNDATION CONTRACT</p>
          <h2 id="foundation-capabilities">What is ready</h2>
        </div>
        <ul className="gv-capability-grid">
          {capabilities.map((capability) => <li key={capability}>{capability}</li>)}
        </ul>
      </section>

      <section className="gv-section" aria-labelledby="component-proof">
        <div>
          <p className="gv-kicker">COMPONENT PROOF</p>
          <h2 id="component-proof">Travel UI can now be typed and reusable</h2>
          <p className="gv-muted">Example only. No provider request is made by this foundation page.</p>
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
          GV-WEB-706R does not replace production or staging routes, does not change Cognito,
          DynamoDB, Lambda, Duffel, Agoda, or Saved Trips, and does not introduce a second backend.
        </p>
      </section>
    </div>
  );
}

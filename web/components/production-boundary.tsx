'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { browserEnvironment } from '@/lib/public-config';

export function ProductionBoundary({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => { setEnabled(browserEnvironment().reactEnabled); }, []);
  if (!enabled) return (
    <main style={{ maxWidth: 640, margin: '10vh auto', padding: 24 }}>
      <h1>Explore with GlobeVoy</h1>
      <p>Travel recommendations are available on our main website. The new account and trip-planning experience is not available here yet.</p>
      <a href="/index.html">Continue to GlobeVoy</a>
    </main>
  );
  return children;
}

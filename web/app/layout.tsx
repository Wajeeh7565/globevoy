import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Script from 'next/script';
import { AppShell } from '@/components/app-shell';
import { ProductionBoundary } from '@/components/production-boundary';
import '../public/assets/fonts/fonts.css';
import './globals.css';
import './account-707a.css';
import './account-710f.css';
import './account-menu-710f-r2w.css';
import './my-trips-710f-r2v.css';
import './booking-707b.css';
import './booking-710g.css';
import './results-708a.css';
import './reconstruction-710b.css';
import './home-710c.css';
import './home-profile-710f-r2.css';
import './home-previews-710c-r2.css';
import './origin-autocomplete-710c-r3.css';
import './results-710d.css';
import './results-710d-r3.css';
import './results-710d-r4.css';
import './results-710d-r5.css';
import './results-access-710f-r3.css';
import './journey-710e.css';
import './results-710e-link.css';
import './account-home-parity.css';

export const metadata: Metadata = {
  title: {
    default: 'Globevoy',
    template: '%s · Globevoy'
  },
  description: 'Budget-first travel discovery with transparent price evidence.',
  // The production classic homepage is the public entry point. The React
  // export hosts account and trip workflows and also serves as a staging UI.
  robots: { index: false }
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head><Script src="/runtime/environment-policy.js" strategy="beforeInteractive" /></head>
      <body>
        <ProductionBoundary><AppShell>{children}</AppShell></ProductionBoundary>
      </body>
    </html>
  );
}

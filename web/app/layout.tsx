import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import './globals.css';
import './account-707a.css';
import './account-710f.css';
import './booking-707b.css';
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
import './journey-710e.css';
import './results-710e-link.css';

export const metadata: Metadata = {
  title: {
    default: 'Globevoy',
    template: '%s · Globevoy'
  },
  description: 'Budget-first travel discovery with transparent price evidence.'
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}

import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import './globals.css';
import './account-707a.css';
import './booking-707b.css';
import './results-708a.css';
import './reconstruction-710b.css';

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

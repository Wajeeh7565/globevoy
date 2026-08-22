import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import './globals.css';
import './account-707a.css';
import './booking-707b.css';
import './results-708a.css';

export const metadata: Metadata = {
  title: 'Globevoy React Migration',
  description: 'GV-WEB-708A React account, Saved Trips, booking revalidation and recommendation results migration target.'
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

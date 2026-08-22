import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import './globals.css';
import './account-707a.css';
import './booking-707b.css';

export const metadata: Metadata = {
  title: 'Globevoy React Migration',
  description: 'GV-WEB-707B React account, Saved Trips and booking revalidation migration target.'
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

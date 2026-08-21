import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import './globals.css';
import './account-707a.css';

export const metadata: Metadata = {
  title: 'Globevoy React Migration',
  description: 'GV-WEB-707A React account and Saved Trips migration target.'
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

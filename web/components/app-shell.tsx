import Link from 'next/link';
import type { ReactNode } from 'react';
import { AuthProvider } from '@/components/account/auth-provider';
import { AccountNav } from '@/components/account/account-nav';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <div className="gv-app-shell">
        <header className="gv-header">
          <div className="gv-header__inner">
            <Link className="gv-brand" href="/" aria-label="Globevoy home">
              <span aria-hidden="true" className="gv-brand__mark">G</span>
              <span>Globevoy</span>
            </Link>
            <div className="gv-header__actions">
              <nav className="gv-primary-nav" aria-label="Primary navigation">
                <Link href="/">Discover</Link>
              </nav>
              <AccountNav />
            </div>
          </div>
        </header>
        <main>{children}</main>
        <footer className="gv-footer">
          <div className="gv-footer__inner">
            <div className="gv-footer__brand">
              <strong>Globevoy</strong>
              <span>See where your budget can take you.</span>
            </div>
            <p className="gv-footer__trust">Trip prices can change. Globevoy shows the evidence behind important prices and asks you to verify current availability before continuing with an external travel partner.</p>
          </div>
        </footer>
      </div>
    </AuthProvider>
  );
}

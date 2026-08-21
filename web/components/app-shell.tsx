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
            <Link className="gv-brand" href="/" aria-label="Globevoy React home">
              <span aria-hidden="true" className="gv-brand__mark">G</span>
              <span>Globevoy</span>
            </Link>
            <AccountNav />
          </div>
        </header>
        <main>{children}</main>
        <footer className="gv-footer">
          <div className="gv-footer__inner">
            <strong>Globevoy</strong>
            <p>Plan visually. Saved prices are snapshots; verify current prices before booking with external partners.</p>
          </div>
        </footer>
      </div>
    </AuthProvider>
  );
}

import Link from 'next/link';
import type { ReactNode } from 'react';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="gv-app-shell">
      <header className="gv-header">
        <div className="gv-header__inner">
          <Link className="gv-brand" href="/" aria-label="Globevoy home">
            <span aria-hidden="true" className="gv-brand__mark">G</span>
            <span>Globevoy</span>
          </Link>
          <div className="gv-utils">
            <span className="gv-foundation-chip">React foundation</span>
          </div>
        </div>
      </header>
      <main>{children}</main>
      <footer className="gv-footer">
        <div className="gv-footer__inner">
          <strong>Globevoy</strong>
          <p>Plan visually. Verify current prices before booking with external partners.</p>
        </div>
      </footer>
    </div>
  );
}

import type { ReactNode } from 'react';
import { AuthProvider } from '@/components/account/auth-provider';
import { AccountNav } from '@/components/account/account-nav';

// GV-WEB-4: same header and footer as the classic pages (Cinematic Explorer design).
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <div className="cx gv-app-shell">
        <header className="cx-top" data-gv-shell-version="GV-WEB-4">
          <a className="cx-brand" href="/" aria-label="GlobeVoy home"><img src="/assets/images/globevoy-logo-dark.png" alt="GlobeVoy" width="134" height="44" /></a>
          <nav aria-label="Main">
            <a href="/">New search</a>
            <AccountNav />
          </nav>
        </header>
        <main>{children}</main>
        <footer className="cx-wrap cx-footer" data-gv-shell-version="GV-WEB-4">
          <div><img src="/assets/images/globevoy-logo-dark.png" alt="GlobeVoy" width="104" height="34" /><span>Every budget has a map. You book directly with the airline and hotel partners.</span></div>
          <nav aria-label="Footer"><a href="/about.html">About</a><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms</a></nav>
        </footer>
      </div>
    </AuthProvider>
  );
}

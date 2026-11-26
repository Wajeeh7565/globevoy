'use client';

import { useEffect } from 'react';

export function MyTripsRedirect() {
  useEffect(() => { window.location.replace('/react/account/'); }, []);
  return <section className="cx-wrap cx-state"><h1>Opening your account…</h1><p className="cx-fine"><a href="/react/account/">Go to your account</a></p></section>;
}

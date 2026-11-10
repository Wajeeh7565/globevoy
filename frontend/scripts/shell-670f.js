/* GV-SHELL-686D-R1 + GV-ACCOUNT-705B-R3 auth + GV-ACCOUNT-705C saved trips + GV-WEB-FE-R3.1B unified account header */
(function () {
  'use strict';

  const body = document.body;
  const depth = parseInt(body.dataset.depth || '0', 10);
  const root = (path) => depth === 0 ? path : `../${path}`;
  // Use the exact same GlobeVoy logo and wordmark as the React shell.
  const BRAND_MARK_SRC = 'data:image/webp;base64,UklGRlQEAABXRUJQVlA4IEgEAADwEgCdASpAAD0APnk2lkgkoqIhLBVZmJAPCWwAnTKEfKyE7T/k93ZtRttfMB+tPrj+izeGN5Q/vnnARVEyZtPDJlbMz/yefT/sFJ1QdLUQGLKNZ42gQMYY3/8wBppMNDS6oJtt+qqppqixjYmf+3+vu3Lh/mDOCMZtNU3zh3eRnkTB7d+T5DqL13Xc8eC2M2jWL9MV3Uv/sBLVepuziCoAAP7/OchhQWgJwSMYpyD+nr+OOaDfDPWJDr3wedhzn3i8y2nCVGajOXiD5wvSufWrbn3GjeWYT+JRta/qjt+/7eDgiw+yt1hPhdGihb0q6KZ/w0H4R3ArOY0vCeAszG338nzJ7TOT1KMHFGbDkBAYo38a+jFa4/KxlX18vUZzCpseswcRHRdUH+x7e1MnFh9735wLleHxfNq29EY423COXkv5fucoIydkBhjaEFtyNxC/zk+H99NbrylzWdk2pKV/TkxwQDCvTu0niWFqev+eWFrBngWUotd5JOLR+fA8aOmcP0iqw/prcKe07/3vYpn+T4LYK71/5SvAb5Cr9JfbIHtSRhUK7gaF7D8pml0V3z5NbBA8UZiBczg/4bb3l2HqXYHXdtjSfm3OJnie7jiybl65u8sPV9cyE9MnSfs+wddO/mQrk8UNf+Tg5LDvltsn/sPqF+aPs7JMOoz7h9sdebDlFjgdk88kdGNxsyveDmOLgX4DuJ0JR9Db+sGxFul6cMd0chvuneoSWmrugrH4RBWWb96DEM6IBwQeROxHs9FyEe1e8zZMthohISHLQjfKa7pmzD1ZnUar0Q3+mKQn3+Uq/sn+mQz+KM1yd8Sua93ezqtf7VyQhqdZdIBp3nuvjPb0eof0PH5g/ND2x174UIda+5pvn2cpwuNYduMQdr5VMef4nlFgy0WZCSaoKe+8DIWcnkXsgM/nsTqPnjXmvr1Xt/cWXTxiT7JpkSaSLPTBfx/wHQ1Jdb7wYPXvO/WeMyO+Sbf7Ue4JjGJY+kv5oL8TsTVcfuAmRYlxeNmsEg8GQuM+Dfk/gug9TZJLCx8VTFBTG3pOOmx5bhHUjLDBHz0McuIZrVxvJ/lC7jR2Gs/nE2tDo2losWVWzcfj3/9MRiJ2nYbMybeXCkzhX+DkEvTzhqLjqxVv9/4+HFeihjM6NedSJEpOlEqMUBTick70yETDUfQcNkHYDIlmowHCO1nrk6/U2yYOY4kuReqC4E+tfbuIOQWIKc3swsyQfRaa/S3IfY8obomDL/EfbC9O2FI/ctUdIt82OgCdjkSlVpEW6ZZPjC6YGFmpF6LZg2b7KsoJ/gI589xbo1CvIuaU20iLlTsVx/50LhBsHNW4MpFbJSbbuAFFJHw/zHvhVsfR+41HqIVMj3qj5Hb1lfOkdq8/4C3i6jFwtSOvpq1CKf3XLNJ9IZz+kRnpYMmH753J9C9h5aVvTf9SAKtwVy8H2MQX+7pJUAAA';
  const BRAND_WORDMARK_SRC = 'data:image/webp;base64,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';

  const stagingOrigin = window.GLOBEVOY_ENVIRONMENT_POLICY?.stagingOrigin;
  const accountBaseHref =
    stagingOrigin && (location.hostname === '127.0.0.1' || location.hostname === 'localhost')
      ? `${stagingOrigin}/react/account/`
      : root('react/account/');

  function activeAccountSession() {
    if (!window.GLOBEVOY_ENVIRONMENT_POLICY?.resolve(location.origin).accountsEnabled) return null;
    try {
      const raw = sessionStorage.getItem('globevoy.auth.session.705b-r3');
      if (!raw) return null;
      const session = JSON.parse(raw);
      return (
        session &&
        session.version === 'GV-ACCOUNT-705B-R3' &&
        session.accessToken &&
        session.user &&
        session.user.sub &&
        Number(session.expiresAt) > Date.now() + 30000
      ) ? session : null;
    } catch (_) {
      return null;
    }
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const session = activeAccountSession();
  const signedIn = Boolean(session);
  const accountHref = accountBaseHref;
  const myTripsHref = root('react/my-trips/');
  const travelProfileHref = root('react/travel-profile/');
  const accountIdentity = session?.user?.email || session?.user?.username || 'Account';
  const safeAccountIdentity = escapeHtml(accountIdentity);
  const accountInitial = escapeHtml(String(accountIdentity).trim().charAt(0).toUpperCase() || 'G');
  const currentReturnTo = `${location.pathname}${location.search}${location.hash}`;
  const safeCurrentReturnTo = escapeHtml(currentReturnTo);

  const accountNavigation = signedIn
    ? `<nav class="gv-account-nav" aria-label="Account navigation">
        <details class="gv-account-nav__menu">
          <summary aria-label="Open account menu for ${safeAccountIdentity}">
            <span class="gv-account-nav__avatar" aria-hidden="true">${accountInitial}</span>
            <span>Account</span>
            <span class="gv-account-nav__chevron" aria-hidden="true">⌄</span>
          </summary>
          <div class="gv-account-nav__panel">
            <div class="gv-account-nav__identity">
              <span class="gv-account-nav__identity-avatar" aria-hidden="true">${accountInitial}</span>
              <span class="gv-account-nav__identity-copy">
                <strong>Signed in as</strong>
                <span>${safeAccountIdentity}</span>
              </span>
            </div>
            <a class="gv-account-nav__item" href="${travelProfileHref}">
              <span class="gv-account-nav__item-icon" aria-hidden="true">✈</span>
              <span class="gv-account-nav__item-copy"><strong>Travel profile</strong><small>Home airport, countries &amp; preferences</small></span>
              <span class="gv-account-nav__item-arrow" aria-hidden="true">›</span>
            </a>
            <a class="gv-account-nav__item" href="${myTripsHref}">
              <span class="gv-account-nav__item-icon" aria-hidden="true">▣</span>
              <span class="gv-account-nav__item-copy"><strong>My trips</strong><small>Pick up your saved journeys</small></span>
              <span class="gv-account-nav__item-arrow" aria-hidden="true">›</span>
            </a>
            <a class="gv-account-nav__item" href="${accountHref}">
              <span class="gv-account-nav__item-icon" aria-hidden="true">◎</span>
              <span class="gv-account-nav__item-copy"><strong>Account details</strong><small>Session and account information</small></span>
              <span class="gv-account-nav__item-arrow" aria-hidden="true">›</span>
            </a>
            <button class="gv-account-nav__signout" type="button" data-gv-auth-signout>
              <span class="gv-account-nav__signout-icon" aria-hidden="true">↪</span>
              <span>Sign out</span>
            </button>
          </div>
        </details>
      </nav>`
    : `<nav class="gv-account-nav" aria-label="Account navigation">
        <button type="button" class="gv-account-nav__signin" ${window.GLOBEVOY_ENVIRONMENT_POLICY?.resolve(location.origin).accountsEnabled ? '' : 'disabled title="Accounts are not available yet"'} data-gv-auth-signin data-return-to="${safeCurrentReturnTo}">Sign in</button>
      </nav>`;

  const header = `<div class="gv-header__inner">
    <a class="gv-brand" href="${root('index.html')}" aria-label="Globevoy home">
      <img class="gv-brand__mark-image" src="${BRAND_MARK_SRC}" alt="" aria-hidden="true">
      <img class="gv-brand__wordmark" src="${BRAND_WORDMARK_SRC}" alt="Globevoy">
    </a>
    <div class="gv-header__actions">
      ${accountNavigation}
    </div>
  </div>`;

  const footer = `<div class="gv-footer__inner">
    <div class="gv-footer__top">
      <div class="gv-footer__brand">
        <a class="gv-footer__brand-link" href="${root('index.html')}" aria-label="Globevoy home"><img class="gv-footer__logo" src="${root('assets/images/globevoy-logo.png')}" alt="Globevoy"></a>
        <p class="gv-footer__tag">Plan a complete trip around your total group budget, then confirm live prices and availability with booking partners.</p>
      </div>
      <div><h2>Plan</h2><a href="${root('index.html')}">Start a trip</a><a href="${root('explore.html')}">Explore destinations</a><a href="${travelProfileHref}">Travel profile</a><a href="${myTripsHref}">My Trips</a><a href="${accountHref}">Account</a></div>
      <div><h2>Learn</h2><a href="${root('how-it-works.html')}">How it works</a><a href="${root('trust.html')}">Trust and pricing</a><a href="${root('about.html')}">About Globevoy</a></div>
      <div><h2>Legal</h2><a href="${root('privacy.html')}">Privacy</a><a href="${root('terms.html')}">Terms</a><a href="${root('affiliate.html')}">Affiliate disclosure</a></div>
    </div>
    <div class="gv-footer__bottom">
      <p class="gv-footer__disclosure">Prices, availability and booking details can change and are confirmed on partner websites. Globevoy may earn a referral commission when a traveller continues to a partner.</p>
      <p>© 2026 Globevoy</p>
    </div>
  </div>`;

  const headerRoot = document.getElementById('gv-header');
  const footerRoot = document.getElementById('gv-footer');
  if (headerRoot) {
    headerRoot.className = 'gv-header';
    // Preserve the approved visual-shell and 705B-R3 auth baselines. Saved
    // trips are a separate 705C capability, not a replacement auth runtime.
    headerRoot.dataset.gvShellVersion = '686d-r1';
    headerRoot.dataset.gvAccountVersion = '705b-r3';
    headerRoot.dataset.gvSavedTripsVersion = '705c';
    headerRoot.dataset.gvUnifiedAccountHeader = 'GV-WEB-FE-R3.1B';
    if (body.classList.contains('gv-multi-trip-page')) headerRoot.dataset.gvSavedTripsRouteDetails = '705c-r3';
    headerRoot.innerHTML = header;
  }
  if (footerRoot) {
    footerRoot.className = 'gv-footer';
    footerRoot.innerHTML = footer;
  }

  function loadRouteDetailsSavedTrips705CR3() {
    if (!body.classList.contains('gv-multi-trip-page') && !document.getElementById('gv-mtd-save')) return;
    if (window.GLOBEVOY_SAVED_TRIPS_ROUTE_DETAILS_LOADER_705C_R3 || window.GlobevoySavedTripsRouteDetails705CR3) return;
    window.GLOBEVOY_SAVED_TRIPS_ROUTE_DETAILS_LOADER_705C_R3 = true;
    const script = document.createElement('script');
    script.src = root('scripts/saved-trips-705c-r3-route-details.js');
    script.dataset.gvSavedTripsRouteDetailsLoader = '705c-r3';
    document.head.appendChild(script);
  }

  function loadSavedTrips705C() {
    if (window.GlobevoySavedTrips705C) {
      loadRouteDetailsSavedTrips705CR3();
      return;
    }
    if (window.GLOBEVOY_SAVED_TRIPS_LOADER_705C) return;
    window.GLOBEVOY_SAVED_TRIPS_LOADER_705C = true;
    const script = document.createElement('script');
    script.src = root('scripts/saved-trips-705c.js');
    script.dataset.gvSavedTripsLoader = '705c';
    script.onload = loadRouteDetailsSavedTrips705CR3;
    document.head.appendChild(script);
  }

  // Load staging-safe public auth first. Saved trips are loaded only after the
  // auth runtime is present, so secure API calls can use the already verified
  // session access token and never duplicate password/token handling.
  if (!window.GLOBEVOY_AUTH_LOADER_705B_R3) {
    window.GLOBEVOY_AUTH_LOADER_705B_R3 = true;
    const configScript = document.createElement('script');
    configScript.src = root('runtime/auth-config-705b-r3.js');
    configScript.dataset.gvAuthLoader = 'config';
    configScript.onload = function () {
      if (window.GlobevoyAuth705B) {
        loadSavedTrips705C();
        return;
      }
      const sessionScript = document.createElement('script');
      sessionScript.src = root('scripts/auth-session-705b-r3.js');
      sessionScript.dataset.gvAuthLoader = 'session';
      sessionScript.onload = loadSavedTrips705C;
      document.head.appendChild(sessionScript);
    };
    document.head.appendChild(configScript);
  } else if (window.GlobevoyAuth705B) {
    loadSavedTrips705C();
  }
})();

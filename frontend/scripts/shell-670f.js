/* GV-SHELL-686D-R1 + GV-ACCOUNT-705B-R3 auth + GV-ACCOUNT-705C saved trips */
(function () {
  'use strict';

  const body = document.body;
  const depth = parseInt(body.dataset.depth || '0', 10);
  const root = (path) => depth === 0 ? path : `../${path}`;
  const accountBaseHref =
    (location.hostname === '127.0.0.1' || location.hostname === 'localhost')
      ? 'https://staging.dy4fw8gx1ccie.amplifyapp.com/react/account/'
      : root('react/account/');

  function hasActiveAccountSession() {
    try {
      const raw = sessionStorage.getItem('globevoy.auth.session.705b-r3');
      if (!raw) return false;
      const session = JSON.parse(raw);
      return Boolean(
        session &&
        session.version === 'GV-ACCOUNT-705B-R3' &&
        session.accessToken &&
        session.user &&
        session.user.sub &&
        Number(session.expiresAt) > Date.now() + 30000
      );
    } catch (_) {
      return false;
    }
  }

  const signedIn = hasActiveAccountSession();
  const accountHref = accountBaseHref;
  const accountLabel = signedIn ? 'Account' : 'Sign in';
  const myTripsHref = root('react/my-trips/');

  const header = `<div class="gv-header__inner">
    <a class="gv-brand" href="${root('index.html')}" aria-label="Globevoy home">
      <img src="${root('assets/images/globevoy-mark.png')}" alt="">
      <span>Globevoy</span>
    </a>
    <div class="gv-utils">
      <a class="gv-auth gv-auth--account" href="${accountHref}" data-gv-auth-entry aria-label="${signedIn ? 'Open your account' : 'Sign in or create an account'}"><span class="gv-auth__full">${accountLabel}</span><span class="gv-auth__short" aria-hidden="true">${accountLabel}</span></a>
    </div>
  </div>`;

  const footer = `<div class="gv-footer__inner">
    <div class="gv-footer__top">
      <div class="gv-footer__brand">
        <a class="gv-footer__brand-link" href="${root('index.html')}" aria-label="Globevoy home"><img class="gv-footer__logo" src="${root('assets/images/globevoy-logo.png')}" alt="Globevoy"></a>
        <p class="gv-footer__tag">Plan a complete trip around your total group budget, then confirm live prices and availability with booking partners.</p>
      </div>
      <div><h2>Plan</h2><a href="${root('index.html')}">Start a trip</a><a href="${root('explore.html')}">Explore destinations</a><a href="${root('create-account.html')}">Travel profile</a><a href="${myTripsHref}">My Trips</a><a href="${accountHref}">Account</a></div>
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

/* GV-SHELL-686D-R1 + GV-ACCOUNT-705B-R3 auth + GV-ACCOUNT-705C saved trips + GV-WEB-FE-R3.1B unified account header */
(function () {
  'use strict';

  const body = document.body;
  const depth = parseInt(body.dataset.depth || '0', 10);
  const root = (path) => depth === 0 ? path : `../${path}`;
  const accountBaseHref =
    (location.hostname === '127.0.0.1' || location.hostname === 'localhost')
      ? 'https://staging.dy4fw8gx1ccie.amplifyapp.com/react/account/'
      : root('react/account/');

  function activeAccountSession() {
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
        <button type="button" class="gv-account-nav__signin" data-gv-auth-signin data-return-to="${safeCurrentReturnTo}">Sign in</button>
      </nav>`;

  const header = `<div class="gv-header__inner">
    <a class="gv-brand" href="${root('index.html')}" aria-label="Globevoy home">
      <img src="${root('assets/images/globevoy-mark.png')}" alt="">
      <span>Globevoy</span>
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

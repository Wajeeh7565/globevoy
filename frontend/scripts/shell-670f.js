/* GV-SHELL-686D-R1 + GV-ACCOUNT-705B-R3 secure staging auth entry */
(function () {
  'use strict';

  const body = document.body;
  const depth = parseInt(body.dataset.depth || '0', 10);
  const root = (path) => depth === 0 ? path : `../${path}`;
  const profileHref = root('create-account.html');
  const accountHref = root('account.html');

  const header = `<div class="gv-header__inner">
    <a class="gv-brand" href="${root('index.html')}" aria-label="Globevoy home">
      <img src="${root('assets/images/globevoy-mark.png')}" alt="">
      <span>Globevoy</span>
    </a>
    <div class="gv-utils">
      <a class="gv-auth gv-auth--quiet" href="${profileHref}" aria-label="Travel profile"><span class="gv-auth__full">Travel profile</span><span class="gv-auth__short" aria-hidden="true">Profile</span></a>
      <a class="gv-auth gv-auth--account" href="${accountHref}" data-gv-auth-entry aria-label="Sign in or create an account"><span class="gv-auth__full">Sign in</span><span class="gv-auth__short" aria-hidden="true">Sign in</span></a>
    </div>
  </div>`;

  const footer = `<div class="gv-footer__inner">
    <div class="gv-footer__top">
      <div class="gv-footer__brand">
        <a class="gv-footer__brand-link" href="${root('index.html')}" aria-label="Globevoy home"><img class="gv-footer__logo" src="${root('assets/images/globevoy-logo.png')}" alt="Globevoy"></a>
        <p class="gv-footer__tag">Plan a complete trip around your total group budget, then confirm live prices and availability with booking partners.</p>
      </div>
      <div><h2>Plan</h2><a href="${root('index.html')}">Start a trip</a><a href="${root('explore.html')}">Explore destinations</a><a href="${root('create-account.html')}">Travel profile</a><a href="${accountHref}">Account</a></div>
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
    headerRoot.dataset.gvShellVersion = '686d-r1+705b-r3';
    headerRoot.innerHTML = header;
  }
  if (footerRoot) {
    footerRoot.className = 'gv-footer';
    footerRoot.innerHTML = footer;
  }

  // Load the staging-safe public auth config and browser PKCE session code on
  // every canonical page without requiring dozens of page-by-page script edits.
  if (!window.GLOBEVOY_AUTH_LOADER_705B_R3) {
    window.GLOBEVOY_AUTH_LOADER_705B_R3 = true;
    const configScript = document.createElement('script');
    configScript.src = root('runtime/auth-config-705b-r3.js');
    configScript.dataset.gvAuthLoader = 'config';
    configScript.onload = function () {
      if (window.GlobevoyAuth705B) return;
      const sessionScript = document.createElement('script');
      sessionScript.src = root('scripts/auth-session-705b-r3.js');
      sessionScript.dataset.gvAuthLoader = 'session';
      document.head.appendChild(sessionScript);
    };
    document.head.appendChild(configScript);
  }
})();

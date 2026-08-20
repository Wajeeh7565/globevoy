/* GV-UX-670E navigation and footer simplification */
(function () {
  'use strict';

  const body = document.body;
  const depth = parseInt(body.dataset.depth || '0', 10);
  const active = String(body.dataset.navActive || '').toLowerCase();
  const signedIn = body.dataset.signedIn === 'true';
  const simpleNav = body.dataset.simpleNav === 'true';

  const root = (path) => depth === 0 ? path : `../${path}`;
  const liveOrPage = (live, design) => depth === 0 ? live : design;
  const NAV = [
    ['Explore', liveOrPage('explore.html', 'explore-curated.html')],
    ['Multi-city', liveOrPage('multi-city.html', 'multi-city-results.html')],
    ['Stays', liveOrPage('stays.html', 'stays.html')],
    ['How it works', liveOrPage('how-it-works.html', 'how-it-works.html')],
    ['Trust', liveOrPage('trust.html', 'trust.html')],
    ['About', liveOrPage('about.html', 'about.html')]
  ];

  function navLinks() {
    return NAV.map(([label, href]) => {
      const isActive = active === label.toLowerCase();
      return `<a class="${isActive ? 'is-active' : ''}" href="${href}"${isActive ? ' aria-current="page"' : ''}>${label}</a>`;
    }).join('');
  }

  const auth = signedIn
    ? `<a class="gv-auth" href="${liveOrPage('saved-trips.html', 'saved-trips.html')}">My Globevoy</a>`
    : `<a class="gv-auth" href="${liveOrPage('sign-in.html', 'sign-in.html')}">Sign in</a>`;
  const links = simpleNav ? '' : navLinks();
  const currency = simpleNav ? '' : '<select class="gv-currency" aria-label="Currency"><option>CAD</option><option>USD</option><option>EUR</option><option>GBP</option></select>';
  const burger = simpleNav ? '' : '<button id="gvBurger" class="gv-burger" aria-label="Open menu" aria-expanded="false">☰</button>';
  const mobile = simpleNav ? '' : `<nav id="gvMobile" class="gv-mobile" aria-label="Mobile">${navLinks()}${auth}</nav>`;

  const header = `<div class="gv-header__inner">
    <a class="gv-brand" href="${root('index.html')}" aria-label="Globevoy home">
      <img src="${root('assets/images/globevoy-mark.png')}" alt="">
      <span>Globevoy</span>
    </a>
    <nav class="gv-nav" aria-label="Primary">${links}</nav>
    <div class="gv-utils">${currency}${auth}${burger}</div>
  </div>${mobile}`;

  const footer = `<div class="gv-footer__inner">
    <div class="gv-footer__compact">
      <a class="gv-footer__brand-link" href="${root('index.html')}" aria-label="Globevoy home">
        <img class="gv-footer__logo" src="${root('assets/images/globevoy-logo.png')}" alt="Globevoy">
      </a>
      <nav class="gv-footer__legal-links" aria-label="Legal">
        <a href="${liveOrPage('privacy.html', 'privacy.html')}">Privacy</a>
        <a href="${liveOrPage('terms.html', 'terms.html')}">Terms</a>
        <a href="${liveOrPage('affiliate.html', 'affiliate.html')}">Affiliate disclosure</a>
      </nav>
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
    headerRoot.innerHTML = header;
  }
  if (footerRoot) {
    footerRoot.className = 'gv-footer';
    footerRoot.innerHTML = footer;
  }

  const burgerButton = document.getElementById('gvBurger');
  const mobileNav = document.getElementById('gvMobile');
  if (burgerButton && mobileNav) {
    burgerButton.addEventListener('click', () => {
      const isOpen = mobileNav.classList.toggle('is-open');
      burgerButton.setAttribute('aria-expanded', String(isOpen));
    });
  }
})();

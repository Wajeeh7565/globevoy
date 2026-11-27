// GV-WEB-4 — GlobeVoy sign-in page. Both buttons are handled by auth-session-705b-r3.js
// ([data-gv-auth-signin] / [data-gv-auth-signup]), which runs Cognito's PKCE sign-in.
// This script only carries the page to return to, and greets a traveller already signed in.
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const q = new URLSearchParams(location.search);

  function safeTarget(value) {
    if (!value || /^(?:javascript|data):/i.test(value)) return '';
    try {
      const target = new URL(value, location.href);
      if (target.origin !== location.origin) return '';
      if (/\/(sign-in|auth-callback)\.html$/.test(target.pathname)) return '';
      return target.pathname + target.search + target.hash;
    } catch (_) { return ''; }
  }

  const back = safeTarget(q.get('returnTo') || q.get('return'));
  if (back) {
    $('#gv-signin-start').dataset.returnTo = back;
    $('#gv-signup-start').dataset.returnTo = back;
    $('#gv-signin-guest').href = back;
    $('#auth-continue').href = back;
  } else {
    // Without a page to return to, a new sign-in lands on the account page.
    $('#gv-signin-start').dataset.returnTo = '/react/account/';
    $('#gv-signup-start').dataset.returnTo = '/react/account/';
  }

  const auth = window.GlobevoyAuth705B;
  const session = auth?.getSession?.();
  if (session) {
    $('#auth-guest').hidden = true;
    $('#auth-member').hidden = false;
    $('#auth-member-email').textContent = session.user?.email ? 'as ' + session.user.email : 'Your GlobeVoy session is active.';
    $('.auth-guest').hidden = true;
  } else if (!auth?.authEnabled?.()) {
    $('#gv-auth-status').textContent = 'Sign-in isn’t available on this website yet. You can keep planning as a guest.';
    $('#gv-signin-start').disabled = true;
    $('#gv-signup-start').disabled = true;
  }
})();

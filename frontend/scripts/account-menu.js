// GV-WEB-4 — header account control on the classic pages (Cinematic Explorer design).
//
// Guests: the #signin button opens the GlobeVoy sign-in page, which hands over to
// Cognito. Members: it becomes an "Account" menu with Account, Travel Profile and
// Sign out. The session itself is read and ended only by auth-session-705b-r3.js.
(function () {
  'use strict';
  const SESSION_KEY = 'globevoy.auth.session.705b-r3';

  function session() {
    const live = window.GlobevoyAuth705B?.getSession?.();
    if (live) return live;
    try {
      const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
      return s && s.version === 'GV-ACCOUNT-705B-R3' && s.accessToken && s.user?.sub && Number(s.expiresAt) > Date.now() + 30000 ? s : null;
    } catch (_) { return null; }
  }
  function initials(user) {
    const name = String(user?.name || user?.email || user?.username || '').split('@')[0];
    const parts = name.split(/[\s._-]+/).filter(Boolean);
    const text = (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)) || 'GV';
    return text.toUpperCase();
  }
  function signInUrl() {
    const here = location.pathname + location.search + location.hash;
    return './sign-in.html?returnTo=' + encodeURIComponent(here);
  }

  function signOut() {
    if (window.GlobevoyAuth705B?.signOut) { window.GlobevoyAuth705B.signOut(); return; }
    try { sessionStorage.removeItem(SESSION_KEY); } catch (_) { /* blocked */ }
    location.href = './index.html';
  }

  function memberMenu(button, user) {
    const wrap = document.createElement('div');
    wrap.className = 'account-menu';
    wrap.innerHTML =
      '<button type="button" class="account-trigger" id="account-trigger" aria-haspopup="true" aria-expanded="false" aria-controls="account-list">' +
      '<span class="account-avatar" aria-hidden="true"></span><span class="account-label">Account</span>' +
      '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3"/></svg></button>' +
      '<div class="account-list" id="account-list" hidden>' +
      '<div class="account-id"><span class="account-avatar" aria-hidden="true"></span><div><strong>Signed in</strong><small class="account-who"></small></div></div>' +
      '<nav aria-label="Account"><a href="./react/account/">Account</a>' +
      '<a href="./react/travel-profile/">Travel Profile</a>' +
      '<button type="button" data-account-signout>Sign out</button></nav></div>';
    wrap.querySelectorAll('.account-avatar').forEach(node => { node.textContent = initials(user); });
    wrap.querySelector('.account-who').textContent = user?.email || user?.username || 'GlobeVoy account';
    button.replaceWith(wrap);
    const trigger = wrap.querySelector('.account-trigger'), list = wrap.querySelector('.account-list');
    const close = () => { list.hidden = true; trigger.setAttribute('aria-expanded', 'false'); };
    trigger.addEventListener('click', () => {
      const open = list.hidden;
      list.hidden = !open;
      trigger.setAttribute('aria-expanded', String(open));
      if (open) list.querySelector('a')?.focus();
    });
    wrap.querySelector('[data-account-signout]').addEventListener('click', signOut);
    document.addEventListener('click', e => { if (!wrap.contains(e.target)) close(); });
    wrap.addEventListener('keydown', e => { if (e.key === 'Escape') { close(); trigger.focus(); } });
  }

  function install() {
    const button = document.getElementById('signin');
    if (!button) return;
    const s = session();
    if (s) { memberMenu(button, s.user); return; }
    button.textContent = 'Sign In';
    button.onclick = event => { event.preventDefault(); location.href = signInUrl(); };
  }

  window.GlobevoyAccountMenu = { install, initials };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();

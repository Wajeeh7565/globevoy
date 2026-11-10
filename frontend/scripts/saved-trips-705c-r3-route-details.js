/* GV-ACCOUNT-705C-R3 — compact multi-city route-details saves for owner-private account storage. */
(function () {
  'use strict';

  if (window.GlobevoySavedTripsRouteDetails705CR3) return;

  const VERSION = 'GV-ACCOUNT-705C-R3';
  const BUTTON_ID = 'gv-mtd-save';
  const state = { busy: false, tripId: null, clientSaveKey: null, installed: false, revision: 0 };

  function runtime() { return window.GlobevoySavedTrips705C || null; }
  function session() { return window.GlobevoyAuth705B?.getSession?.() || null; }
  function button() { return document.getElementById(BUTTON_ID); }
  function compactAccountSnapshot(value) { return runtime()._internal.compactAccountSnapshot(value); }
  function compactTour(value) { return runtime()._internal.compactTour(value); }
  function jsonBytes(value) { return runtime()._internal.jsonBytes(value); }

  function statusNode() {
    let node = document.getElementById('gv-mtd-account-save-status');
    if (node) return node;
    const actions = document.querySelector('.gv-mtd-actions');
    if (!actions) return null;
    node = document.createElement('p');
    node.id = 'gv-mtd-account-save-status';
    node.className = 'gv-mtd-disclaimer';
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    actions.insertAdjacentElement('afterend', node);
    return node;
  }
  function announce(message, kind = '') { const node = statusNode(); if (node) { node.textContent = message || ''; node.dataset.kind = kind; } }
  function setButtonState(saved, busy = false) {
    const node = button();
    if (!node) return;
    node.disabled = Boolean(busy);
    node.setAttribute('aria-busy', String(Boolean(busy)));
    node.setAttribute('aria-pressed', String(Boolean(saved)));
    node.textContent = busy ? 'Saving…' : (saved ? 'Saved to account ✓' : 'Save trip');
  }
  function snapshot() { return runtime()?._internal?.multiSnapshot?.() || null; }
  async function findCloudMatch(currentSnapshot) {
    if (!currentSnapshot || !session() || !runtime()?.api) return null;
    const trips = await runtime().api.list();
    return trips.find((trip) => trip?.tripSnapshot?.clientSaveKey === currentSnapshot.clientSaveKey) || null;
  }
  async function refresh() {
    if (state.busy) return null;
    if (!button() || !session() || !runtime()?.api) return null;
    const currentSnapshot = snapshot();
    if (!currentSnapshot) return null;
    const revision = state.revision;
    try {
      const match = await findCloudMatch(currentSnapshot);
      if (state.busy || revision !== state.revision) return null;
      state.tripId = match?.tripId || null;
      state.clientSaveKey = currentSnapshot.clientSaveKey;
      setButtonState(Boolean(match));
      return match;
    } catch (_) { return null; }
  }
  function errorMessage(error) {
    const code = String(error?.payload?.error || error?.message || 'saved-trip-update-failed');
    if (error?.status === 401 || code === 'sign-in-required') return 'Sign in again to save this trip to your account.';
    if (error?.status === 413 || /too-large/i.test(code)) return 'This route is still too large to save safely. Your trip is unchanged.';
    if (/sensitive-data/i.test(code)) return 'This route contains provider data that cannot be stored in your account. Your trip is unchanged.';
    return 'We could not update your saved trips right now. Your trip itself is unchanged.';
  }
  async function toggle() {
    if (state.busy || !session() || !runtime()?.api) return;
    const fullSnapshot = snapshot();
    if (!fullSnapshot) { announce('The current route snapshot is not ready yet. Try Save trip again in a moment.', 'error'); return; }
    state.busy = true;
    state.revision += 1;
    setButtonState(Boolean(state.tripId), true);
    try {
      let match = null;
      if (state.tripId && state.clientSaveKey === fullSnapshot.clientSaveKey) match = { tripId: state.tripId };
      else match = await findCloudMatch(fullSnapshot);
      if (match?.tripId) {
        await runtime().api.remove(match.tripId);
        state.tripId = null;
        state.clientSaveKey = fullSnapshot.clientSaveKey;
        setButtonState(false);
        announce('Removed from your Globevoy account. Your browser copy is unchanged.', 'success');
      } else {
        const compactSnapshot = compactAccountSnapshot(fullSnapshot);
        const created = await runtime().api.create(compactSnapshot.body);
        if (!created?.tripId) throw new Error('invalid-save-response');
        state.tripId = created?.tripId || null;
        state.clientSaveKey = fullSnapshot.clientSaveKey;
        setButtonState(true);
        announce('Saved privately to your Globevoy account. Prices will be checked again before booking.', 'success');
      }
    } catch (error) {
      setButtonState(Boolean(state.tripId));
      announce(errorMessage(error), 'error');
    } finally {
      state.busy = false;
      const node = button();
      if (node) { node.disabled = false; node.setAttribute('aria-busy', 'false'); }
    }
  }
  function onClick(event) {
    const target = event.target.closest?.(`#${BUTTON_ID}`);
    if (!target || !session()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void toggle();
  }
  function install() {
    if (state.installed || !button()) return;
    state.installed = true;
    document.addEventListener('click', onClick, true);
    if (session()) { setTimeout(refresh, 150); setTimeout(refresh, 600); }
  }

  window.GlobevoySavedTripsRouteDetails705CR3 = Object.freeze({
    version: VERSION,
    install,
    refresh,
    _internal: Object.freeze({ snapshot, findCloudMatch, compactAccountSnapshot, compactTour, jsonBytes, errorMessage })
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();

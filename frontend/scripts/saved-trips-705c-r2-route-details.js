/* GV-ACCOUNT-705C-R2 — bridge multi-city route-details Save trip to owner-private account storage. */
(function () {
  'use strict';

  if (window.GlobevoySavedTripsRouteDetails705CR2) return;

  const VERSION = 'GV-ACCOUNT-705C-R2';
  const BUTTON_ID = 'gv-mtd-save';
  const state = { busy: false, tripId: null, clientSaveKey: null, installed: false };

  function runtime() { return window.GlobevoySavedTrips705C || null; }
  function session() { return window.GlobevoyAuth705B?.getSession?.() || null; }
  function button() { return document.getElementById(BUTTON_ID); }

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

  function announce(message, kind = '') {
    const node = statusNode();
    if (!node) return;
    node.textContent = message || '';
    node.dataset.kind = kind;
  }

  function setButtonState(saved, busy = false) {
    const node = button();
    if (!node) return;
    node.disabled = Boolean(busy);
    node.setAttribute('aria-busy', String(Boolean(busy)));
    node.setAttribute('aria-pressed', String(Boolean(saved)));
    node.textContent = busy ? 'Saving…' : (saved ? 'Saved to account ✓' : 'Save trip');
  }

  function snapshot() {
    return runtime()?._internal?.multiSnapshot?.() || null;
  }

  async function findCloudMatch(currentSnapshot) {
    if (!currentSnapshot || !session() || !runtime()?.api) return null;
    const trips = await runtime().api.list();
    return trips.find((trip) => trip?.tripSnapshot?.clientSaveKey === currentSnapshot.clientSaveKey) || null;
  }

  async function refresh() {
    if (!button() || !session() || !runtime()?.api) return null;
    const currentSnapshot = snapshot();
    if (!currentSnapshot) return null;
    try {
      const match = await findCloudMatch(currentSnapshot);
      state.tripId = match?.tripId || null;
      state.clientSaveKey = currentSnapshot.clientSaveKey;
      setButtonState(Boolean(match));
      return match;
    } catch (_) {
      return null;
    }
  }

  function errorMessage(error) {
    const code = String(error?.payload?.error || error?.message || 'saved-trip-update-failed');
    if (error?.status === 401 || code === 'sign-in-required') return 'Sign in again to save this trip to your account.';
    if (error?.status === 413 || /too-large/i.test(code)) return 'This route snapshot is too large to save to your account yet. Your trip is unchanged.';
    if (/sensitive-data/i.test(code)) return 'This route contains provider data that cannot be stored in your account. Your trip is unchanged.';
    return 'We could not update your saved trips right now. Your trip itself is unchanged.';
  }

  async function toggle() {
    if (state.busy || !session() || !runtime()?.api) return;
    const currentSnapshot = snapshot();
    if (!currentSnapshot) {
      announce('The current route snapshot is not ready yet. Try Save trip again in a moment.', 'error');
      return;
    }

    state.busy = true;
    setButtonState(Boolean(state.tripId), true);
    try {
      let match = null;
      if (state.tripId && state.clientSaveKey === currentSnapshot.clientSaveKey) {
        match = { tripId: state.tripId };
      } else {
        match = await findCloudMatch(currentSnapshot);
      }

      if (match?.tripId) {
        await runtime().api.remove(match.tripId);
        state.tripId = null;
        state.clientSaveKey = currentSnapshot.clientSaveKey;
        setButtonState(false);
        announce('Removed from your Globevoy account. Your browser copy is unchanged.', 'success');
      } else {
        const created = await runtime().api.create(currentSnapshot.body);
        state.tripId = created?.tripId || null;
        state.clientSaveKey = currentSnapshot.clientSaveKey;
        setButtonState(true);
        announce('Saved privately to your Globevoy account. Prices will be checked again before booking.', 'success');
      }
    } catch (error) {
      setButtonState(Boolean(state.tripId));
      announce(errorMessage(error), 'error');
    } finally {
      state.busy = false;
      const node = button();
      if (node) {
        node.disabled = false;
        node.setAttribute('aria-busy', 'false');
      }
    }
  }

  function onClick(event) {
    const target = event.target.closest?.(`#${BUTTON_ID}`);
    if (!target || !session()) return;
    // Signed-in route-details saves are account operations. Prevent the older
    // browser-only handler from claiming "Saved ✓" when DynamoDB was not updated.
    event.preventDefault();
    event.stopImmediatePropagation();
    void toggle();
  }

  function install() {
    if (state.installed || !button()) return;
    state.installed = true;
    document.addEventListener('click', onClick, true);
    if (session()) {
      setTimeout(refresh, 150);
      setTimeout(refresh, 600);
    }
  }

  window.GlobevoySavedTripsRouteDetails705CR2 = Object.freeze({
    version: VERSION,
    install,
    refresh,
    _internal: Object.freeze({ snapshot, findCloudMatch, errorMessage })
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();

/* GV-BOOK-706A — saved account snapshots are historical until revalidated. */
(function () {
  'use strict';

  const VERSION = 'GV-BOOK-706A';
  const q = new URLSearchParams(location.search);
  const marker = window.GLOBEVOY_BOOKING_ACCOUNT_SNAPSHOT_706A;
  if (!q.get('accountTrip') || !marker?.snapshotOnly) return;

  function disableAnchor(anchor) {
    if (!anchor || anchor.dataset.gv706aLocked === 'true') return;
    anchor.dataset.gv706aLocked = 'true';
    anchor.removeAttribute('href');
    anchor.removeAttribute('target');
    anchor.removeAttribute('rel');
    anchor.setAttribute('aria-disabled', 'true');
    anchor.setAttribute('role', 'link');
    anchor.textContent = 'Revalidation required';
  }
  function disableButton(button) {
    if (!button) return;
    button.disabled = true;
    button.setAttribute('aria-disabled', 'true');
    button.dataset.gv706aLocked = 'true';
    button.textContent = 'Revalidation required';
  }
  function lockPartnerHandoffs() {
    document.querySelectorAll('.gv-booking-link[href], .gv-booking-journey-action[href], .gv-workspace-partner[href][data-partner-review]').forEach(disableAnchor);
    ['gv-booking-open-all-flights', 'gv-booking-open-all-stays', 'gv-booking-continue-partner'].forEach(id => disableButton(document.getElementById(id)));
  }
  function installNotice() {
    if (document.getElementById('gv-booking-account-snapshot-706a')) return;
    const hero = document.querySelector('.gv-booking-hero');
    if (!hero) return;
    const notice = document.createElement('div');
    notice.id = 'gv-booking-account-snapshot-706a';
    notice.className = 'gv-booking-note';
    notice.setAttribute('role', 'status');
    notice.dataset.gvBookVersion = VERSION;
    notice.innerHTML = '<strong>Saved account snapshot — verification required.</strong> This workspace was reconstructed from your private Saved Trips record. Saved amounts and any former provider evidence are historical snapshots, not current quotes. Globevoy will not open booking partners from this snapshot until prices are revalidated.';
    hero.insertAdjacentElement('afterend', notice);
    const confidence = document.getElementById('gv-booking-confidence');
    if (confidence) {
      const strong = confidence.querySelector('strong');
      const span = confidence.querySelector('span');
      if (strong) strong.textContent = 'Saved price snapshot — revalidation required';
      if (span) span.textContent = 'These amounts came from your saved trip. Recheck current provider prices and availability before any partner handoff.';
    }
    const handoffTitle = document.getElementById('gv-booking-handoff-title');
    if (handoffTitle) handoffTitle.textContent = 'Revalidate before partner handoff';
  }
  function enforce() {
    installNotice();
    lockPartnerHandoffs();
    document.body.dataset.gvBookingAccountSnapshot = '706a';
  }

  const observer = new MutationObserver(enforce);
  observer.observe(document.body, { childList: true, subtree: true });
  enforce();
  setTimeout(enforce, 100);
  setTimeout(enforce, 500);

  window.GlobevoyBookingAccountSnapshot706A = Object.freeze({ version: VERSION, enforce });
})();
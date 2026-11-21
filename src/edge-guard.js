// Keeps a swipe near the side of a phone's screen from throwing the person out of a drag.
//
// On Android with gesture navigation, a swipe that starts near either side of the screen is the phone's Back. In a
// browser tab, Chrome also has its own swipe to go Back or Forward. A native app (Gboard, say) can tell Android to
// leave part of its screen alone; a web page can't. So a finger tracing, flicking or dragging near the edge can have
// its touch taken away (the page gets pointercancel) and then a Back arrives, which leaves the page or closes the
// installed app. This does the three things a page can do:
//
//   1. No sideways overscroll on the page, so Chrome's own swipe navigation never starts (html and body get
//      overscroll-behavior-x: none; pull-to-refresh is left to the project). The drag surfaces themselves should have touch-action: none in the project's CSS.
//   2. Room at the edges is the project's job, in its CSS: keep whatever a finger drags clear of the screen's sides by
//      about 24 px on touch phones, @media (pointer: coarse) and (max-width: 560px). See references/edge-swipes.md.
//   3. A Back that comes while a finger is dragging on a surface, or within slipMs of the browser taking a touch from
//      one, is treated as a slip: the page stays as it was.
//
// Use, for a page that doesn't use the history itself:
//   import { guardEdges } from './edge-guard.js';
//   guardEdges({ surfaces: [canvas] });
// While a finger is down on a surface, and for slipMs after, the page holds one extra history entry for a slip to use
// up. Then it takes the entry off again, so at any other time Back works exactly as it would without the guard (one
// press leaves, or closes an installed app). A deliberate Back inside that window calls onBack() if given, or goes on
// back past the page's entry.
//
// For a page that runs its own history (screens, sheets), pass history: false and ask slip() in its own popstate:
//   const guard = guardEdges({ surfaces: [board], history: false });
//   addEventListener('popstate', () => { if (guard.slip()) { history.pushState(state, ''); return; } ... });
// (Crosstown does this.)
export function guardEdges({ surfaces = [], history: own = true, onBack = null, slipMs = 1000 } = {}) {
  const STATE = '__edgeGuard';
  const H = window.history;
  const held = new Map(); // pointerId -> the surface holding it
  let takenAt = -Infinity, lastUp = -Infinity;
  let armed = false;      // our entry is the current one
  let removing = false;   // we're taking our entry off: the popstate that follows is ours
  let leaving = false, timer = 0;
  let restore = null;     // the page's scrollRestoration while our entry is in, so stepping off it doesn't scroll
  let lastNav = 'traverse'; // what kind of navigation the last popstate came from (where the Navigation API says)

  if (!document.getElementById('edge-guard-css')) {
    const css = document.createElement('style');
    css.id = 'edge-guard-css';
    css.textContent = 'html, body { overscroll-behavior-x: none; }';
    document.head.append(css);
  }

  const slip = () => held.size > 0 || performance.now() - takenAt < slipMs;

  const arm = () => {
    if (!own || armed || removing || leaving) return;
    try {
      // Scroll restoration belongs to each entry: the page's entry has to say manual too, before ours goes on top.
      if (restore === null) { restore = H.scrollRestoration; H.scrollRestoration = 'manual'; }
      H.pushState({ ...(H.state || {}), [STATE]: true }, ''); armed = true;
    } catch { /* no history here */ }
  };
  // Our entry is out of play: the page's own scroll restoration comes back.
  const settle = () => { armed = false; if (restore !== null) { try { H.scrollRestoration = restore; } catch {} restore = null; } };
  // Off again once no finger is down and slipMs has passed since the last one lifted or was taken.
  const disarmSoon = () => {
    if (!own) return;
    clearTimeout(timer);
    timer = setTimeout(function check() {
      if (!armed || removing || leaving) return;
      const quiet = performance.now() - Math.max(takenAt, lastUp);
      if (held.size || quiet < slipMs) { timer = setTimeout(check, slipMs - quiet + 20); return; }
      // The page may have added an entry of its own since (a menu opened): leave ours under it, harmless (see below).
      if (!H.state?.[STATE]) { settle(); return; }
      removing = true;
      H.back();
    }, slipMs + 20);
  };

  const watch = el => {
    el.addEventListener('pointerdown', e => { held.set(e.pointerId, el); arm(); });
    const lift = e => { if (held.delete(e.pointerId)) { lastUp = performance.now(); disarmSoon(); } };
    el.addEventListener('pointerup', lift);
    el.addEventListener('lostpointercapture', lift);
    el.addEventListener('pointercancel', e => { held.delete(e.pointerId); takenAt = performance.now(); disarmSoon(); });
  };
  surfaces.forEach(watch);

  if (own) {
    // A reload while our entry is current: the entry behind it belongs to the old page, so going back to it would load
    // the page again. Make ours a plain entry instead (one extra Back press, once, in that rare case).
    const plain = st => { const { [STATE]: _, ...rest } = st; try { H.replaceState(Object.keys(rest).length ? rest : null, ''); } catch {} };
    try { if (H.state?.[STATE]) plain(H.state); } catch { /* no history here */ }
    // A link to a #place on this page also fires popstate; only Back and Forward are for us.
    if (window.navigation) navigation.addEventListener('navigate', e => { lastNav = e.navigationType; });
    addEventListener('popstate', e => {
      if (leaving) return;
      if (removing) { removing = false; settle(); return; }
      if (lastNav !== 'traverse') { lastNav = 'traverse'; if (armed && !H.state?.[STATE]) settle(); return; }
      // Back or Forward onto an entry of ours that was left under one of the page's own: make it a plain one, so it
      // never takes a Back away from the page later. (It costs one extra Back press, once, in that rare case.)
      if (e.state?.[STATE]) { plain(e.state); settle(); return; }
      if (!armed) return; // a Back that has nothing to do with us
      armed = false;
      if (slip()) { arm(); disarmSoon(); return; } // the entry took the slip; put it back while the window lasts
      clearTimeout(timer);
      settle();
      if (onBack) { onBack(); return; }
      leaving = true;
      H.back(); // the Back that was meant: past the page's own entry
      // Still here half a second later (an installed app's first page has nothing behind it): carry on as normal.
      setTimeout(() => { leaving = false; }, 500);
    });
  }

  return { slip, watch };
}

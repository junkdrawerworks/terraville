// Keeps a swipe near the side of a phone's screen from throwing the person out of a drag.
//
// On Android with gesture navigation, a swipe that starts near either side of the screen is the phone's Back. In a
// browser tab, Chrome also has its own swipe to go Back or Forward. A native app (Gboard, say) can tell Android to
// leave part of its screen alone; a web page can't. So a finger tracing, flicking or dragging near the edge can have
// its touch taken away (the page gets pointercancel) and then a Back arrives, which leaves the page or closes the
// installed app. This does the three things a page can do:
//
//   1. No sideways overscroll on the page, so Chrome's own swipe navigation never starts (html and body get
//      overscroll-behavior: none). The drag surfaces themselves should have touch-action: none in the project's CSS.
//   2. Room at the edges is the project's job, in its CSS: keep whatever a finger drags clear of the screen's sides by
//      about 24 px on touch phones, @media (pointer: coarse) and (max-width: 560px). See references/edge-swipes.md.
//   3. A Back that comes while a finger is dragging on a surface, or within slipMs of the browser taking a touch from
//      one, is treated as a slip: the page stays as it was.
//
// Use, for a page that doesn't use the history itself:
//   import { guardEdges } from './edge-guard.js';
//   guardEdges({ surfaces: [canvas] });
// That keeps one extra history entry while the page is open, added at the first tap (browsers skip entries added
// without one). A slip uses it up and it comes back at the next tap; a deliberate Back leaves the page as usual,
// or calls onBack() if given (a game that shows its menu on Back, say).
//
// For a page that runs its own history (screens, sheets), pass history: false and ask slip() in its own popstate:
//   const guard = guardEdges({ surfaces: [board], history: false });
//   addEventListener('popstate', () => { if (guard.slip()) { history.pushState(state, ''); return; } ... });
// (Crosstown does this.)
export function guardEdges({ surfaces = [], history: own = true, onBack = null, slipMs = 1000 } = {}) {
  const STATE = '__edgeGuard';
  const held = new Map(); // pointerId -> the surface holding it
  let takenAt = -Infinity, armed = false, leaving = false;

  if (!document.getElementById('edge-guard-css')) {
    const css = document.createElement('style');
    css.id = 'edge-guard-css';
    css.textContent = 'html, body { overscroll-behavior: none; }';
    document.head.append(css);
  }

  const watch = el => {
    el.addEventListener('pointerdown', e => held.set(e.pointerId, el));
    el.addEventListener('pointerup', e => held.delete(e.pointerId));
    el.addEventListener('pointercancel', e => { held.delete(e.pointerId); takenAt = performance.now(); });
    el.addEventListener('lostpointercapture', e => held.delete(e.pointerId));
  };
  surfaces.forEach(watch);

  const slip = () => held.size > 0 || performance.now() - takenAt < slipMs;

  if (own) {
    // A reload while the extra entry is current keeps it: it's already in place, so it counts as armed.
    try { armed = !!window.history.state?.[STATE]; } catch { /* no history here */ }
    // The extra entry goes on at a tap (a user activation), so Back doesn't skip straight past it.
    const arm = () => {
      if (armed || leaving) return;
      try { window.history.pushState({ ...(window.history.state || {}), [STATE]: true }, ''); armed = true; } catch { /* no history here */ }
    };
    ['pointerup', 'keydown', 'click'].forEach(t => addEventListener(t, arm, true));
    addEventListener('popstate', e => {
      if (leaving || e.state?.[STATE]) return; // Forward back onto the entry, or our own way out
      if (!armed) return;
      armed = false;
      if (slip()) return; // the entry took the slip; the next tap puts it back
      if (onBack) { onBack(); return; }
      leaving = true;
      window.history.back(); // the Back that was meant: past the page's own entry
    });
  }

  return { slip, watch };
}

export const MOBILE_BREAKPOINT = 900;
export const BACKGROUND_LOCK_MS = 30000;
export function isReadonlyDevice(nav) {
  return /iPhone|iPad|iPod|Android|Mobile/i.test(nav.userAgent) || (/Mac/i.test(nav.platform || nav.userAgent) && nav.maxTouchPoints > 1);
}
export function createBackgroundLock({ lock, active, now = Date.now, schedule = setTimeout, cancel = clearTimeout }) {
  let hiddenAt = null, timer = null;
  const clear = () => { if (timer !== null) cancel(timer); timer = null; };
  return {
    hide() {
      if (!active()) return;
      if (hiddenAt === null) hiddenAt = now();
      clear();
      timer = schedule(() => { if (active() && hiddenAt !== null && now() - hiddenAt >= BACKGROUND_LOCK_MS) { hiddenAt = null; lock(); } }, Math.max(0, BACKGROUND_LOCK_MS - (now() - hiddenAt)));
    },
    resume() {
      clear();
      const expired = hiddenAt !== null && now() - hiddenAt >= BACKGROUND_LOCK_MS;
      hiddenAt = null;
      if (active() && expired) lock();
    },
    reset() { clear(); hiddenAt = null; }
  };
}

/** Touch screens: on-screen controls in place of the keyboard. `?touch` shows them with a mouse too. */
export const isTouch = matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).has('touch');

// Hints name keys in braces, for example '{W}'. On a touch screen they name the on-screen control instead.
// U+FE0E keeps ◀ and ▶ as text: iOS draws them as emoji without it.
const TOUCH_NAMES = { W: '▲', S: '▼', A: '◀\uFE0E', D: '▶\uFE0E', Q: '↺', E: '↻', Space: 'THRUST', P: '❚❚' };
export const keyLabel = text => text.replace(/\{(\w+)\}/g, (_, k) => (isTouch ? TOUCH_NAMES[k] : k));

/**
 * The stick holds W, A, S and D in eight directions, like the keys. The pads hold Q, E and Space. Each finger
 * holds its own keys, so both thumbs work at the same time. Returns the live set of held key codes.
 */
export function touchControls(root) {
  const fingers = new Map(), held = new Set(), lights = root.querySelectorAll('[data-hold]');
  const hold = (id, codes) => {
    if (codes) fingers.set(id, codes); else fingers.delete(id);
    held.clear();
    for (const c of fingers.values()) c.forEach(k => held.add(k));
    for (const el of lights) el.classList.toggle('on', held.has(el.dataset.hold));
  };

  // Each control captures its finger, so it keeps the finger when the finger slides off. lostpointercapture
  // comes after pointerup and pointercancel.
  const stick = root.querySelector('.stick'), knob = stick.querySelector('i');
  const aim = e => {
    const r = stick.getBoundingClientRect(), radius = r.width / 2;
    const x = (e.clientX - r.left) / radius - 1, y = (e.clientY - r.top) / radius - 1, len = Math.hypot(x, y);
    const k = 0.5 * radius * Math.min(1, 1 / len);   // the knob stops at half the radius
    knob.style.transform = `translate(${x * k}px, ${y * k}px)`;
    // A key is on when the finger points less than 67.5° away from it: eight equal sectors, four of them diagonal.
    const s = Math.sin(Math.PI / 8) * len, codes = [];
    if (len > 0.2) {   // dead zone at the centre
      if (y < -s) codes.push('KeyW');
      if (y > s) codes.push('KeyS');
      if (x < -s) codes.push('KeyA');
      if (x > s) codes.push('KeyD');
    }
    hold(e.pointerId, codes);
  };
  stick.addEventListener('pointerdown', e => { stick.setPointerCapture(e.pointerId); aim(e); });
  stick.addEventListener('pointermove', e => { if (fingers.has(e.pointerId)) aim(e); });
  stick.addEventListener('lostpointercapture', e => { hold(e.pointerId); knob.style.transform = ''; });

  for (const pad of root.querySelectorAll('.pad')) {
    pad.addEventListener('pointerdown', e => { pad.setPointerCapture(e.pointerId); hold(e.pointerId, [pad.dataset.hold]); });
    pad.addEventListener('lostpointercapture', e => hold(e.pointerId));
  }
  root.addEventListener('contextmenu', e => e.preventDefault());   // a long press opens a menu on Android
  return held;
}

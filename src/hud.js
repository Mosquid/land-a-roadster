import { Vector3 } from 'three';
import { keyLabel } from './touch.js';

const $ = id => document.getElementById(id);
const DEG = 180 / Math.PI;
const RATE_RANGE = 360;   // °/s at the end of a spin bar
const _up = new Vector3();

const HINTS = {
  air: 'Stop the spin, level the car, then brake the fall with {Space}.',
  landing: 'Touchdown…',
  result: 'Try again, or go to the next level.',
};
const TITLES = { air: 'AIRBORNE', landing: 'TOUCHDOWN', result: 'RESULT' };

export class Hud {
  constructor() {
    this.el = Object.fromEntries(['hud', 'phase', 'hint', 'progress', 'speed', 'alt', 'flight', 'attitude', 'fuel', 'message', 'result',
      'r-pitch', 'r-roll', 'r-yaw', 't0', 't1', 't2', 't3'].map(id => [id, $(id)]));
    this.msgTime = 0;
    for (const b of document.querySelectorAll('.rate b')) b.textContent = keyLabel(`{${b.textContent}}`);
  }

  show(on) { this.el.hud.hidden = !on; }

  message(html, seconds) { this.el.message.innerHTML = html; this.el.message.classList.add('on'); this.msgTime = seconds; }

  update(sim, dt) {
    const e = this.el, b = sim.body, flying = sim.phase !== 'ramp';
    if ((this.msgTime -= dt) <= 0) e.message.classList.remove('on');
    const n = sim.cfg.levels.indexOf(sim.def) + 1;
    e.phase.textContent = sim.phase === 'ramp' ? `LEVEL ${n} · ${sim.def.name.toUpperCase()}` : TITLES[sim.phase];
    e.hint.textContent = keyLabel(sim.phase === 'ramp' ? sim.def.hint : HINTS[sim.phase]);
    e.progress.style.width = `${Math.min(100, (100 * sim.rail.s) / sim.track.length)}%`;
    e.progress.parentElement.hidden = flying;
    e.speed.textContent = Math.round(b.vel.length() * 3.6);
    const h = Math.max(0, b.pos.y - sim.cfg.car.comHeight);
    e.alt.textContent = `ALT ${h.toFixed(1).padStart(5)} m\nV/S ${b.vel.y.toFixed(1).padStart(5)} m/s`;

    e.flight.hidden = !flying;
    if (!flying) return;
    this.bar(e['r-pitch'], b.omega.x * DEG);
    this.bar(e['r-roll'], b.omega.z * DEG);
    this.bar(e['r-yaw'], -b.omega.y * DEG);
    b.throttle.forEach((p, i) => {
      e[`t${i}`].style.background = p ? `rgba(111,216,255,${0.35 + 0.65 * p})` : '';
      e[`t${i}`].style.boxShadow = p ? `0 0 14px rgba(111,216,255,${p})` : '';
    });
    e.fuel.style.width = `${b.fuel * 100}%`;
    e.fuel.style.background = b.fuel < 0.2 ? 'var(--red)' : '';
    const tilt = Math.acos(Math.max(-1, Math.min(1, _up.set(0, 1, 0).applyQuaternion(b.quat).y))) * DEG;
    e.attitude.textContent = `${tilt < 90 ? 'UPRIGHT' : 'INVERTED'} ${tilt.toFixed(0).padStart(3)}°`;
    e.attitude.style.color = tilt < 10 ? 'var(--green)' : tilt < 90 ? 'var(--amber)' : 'var(--red)';
  }

  /** Bar grows right for a spin that the right-hand key would cause, left for the left-hand key. */
  bar(el, value) {
    const w = Math.min(50, (Math.abs(value) / RATE_RANGE) * 50);
    el.style.width = `${w}%`;
    el.style.left = value >= 0 ? '50%' : `${50 - w}%`;
    el.style.background = Math.abs(value) < 15 ? 'var(--green)' : '';
  }

  showResult(r, best) {
    const rows = r.parts.map(p => `
      <div class="row"><span>${p.label}</span>
        <span class="v">${Number.isFinite(p.value) ? p.value.toFixed(p.digits) : '—'} ${p.unit}</span>
        <span class="p">${Math.round(p.pts)}/${p.max}</span>
        <div class="meter"><i style="width:${(100 * p.pts) / p.max}%"></i></div></div>`).join('');
    const notes = r.penalties.map(p => `${p.text}: −${p.pts}.`);
    if (!r.onWheels) notes.unshift('The car did not end up on its wheels.');
    const color = r.onWheels ? (r.total >= 85 ? 'var(--green)' : r.total >= 50 ? 'var(--cyan)' : 'var(--amber)') : 'var(--red)';
    this.el.result.innerHTML = `
      <div class="grade" style="color:${color}">${r.grade}</div>
      <div class="total">${r.total} / 100 &nbsp;·&nbsp; best ${best}</div>
      ${rows}
      ${notes.map(n => `<div class="note">${n}</div>`).join('')}
      <div class="foot">Launch ${Math.round(r.launchSpeed * 3.6)} km/h · fuel left ${Math.round(r.fuelLeft * 100)}% · seed ${r.seed}</div>
      <div class="acts"><button data-key="KeyR"><kbd class="keys-only">R</kbd> Try again</button>
        <button data-key="KeyN"><kbd class="keys-only">N</kbd> Next level</button>
        <button data-key="KeyM"><kbd class="keys-only">M</kbd> Levels</button></div>`;
    this.el.result.hidden = false;
  }

  hideResult() { this.el.result.hidden = true; }
}

import { Vector3, Quaternion, Matrix4 } from 'three';

const UP = new Vector3(0, 1, 0);
export const smooth = x => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const STEP = 0.5;   // sample spacing along the centre line, m
const CELL = 4;     // contact grid cell, m
const cell = x => Math.floor(x / CELL) + 512;
const key = (i, j, k) => i + 1024 * (j + 1024 * k);

/**
 * Road deck along a sampled centre line. Each sample has a position, a reference up vector and a bank
 * angle. The deck frame (L left, U up, T forward) follows from them, so one class serves every path shape.
 * k is the curvature in the deck plane (+ turns left). kn is the curvature toward the deck normal
 * (+ when the road bends toward the car, as at the bottom of a dip or anywhere inside a loop).
 */
export class Track {
  constructor(c, pts) {
    this.c = c; this.pts = pts;
    const n = pts.length - 1, m = new Matrix4();
    pts.forEach((p, i) => { p.s = i ? pts[i - 1].s + p.pos.distanceTo(pts[i - 1].pos) : 0; });
    pts.forEach((p, i) => {
      const T = new Vector3().subVectors(pts[Math.min(i + 1, n)].pos, pts[Math.max(i - 1, 0)].pos).normalize();
      const L0 = new Vector3().crossVectors(p.up, T).normalize(), U0 = new Vector3().crossVectors(T, L0);
      const b = p.bank || 0;
      p.L = L0.clone().multiplyScalar(Math.cos(b)).addScaledVector(U0, Math.sin(b));
      p.U = U0.clone().multiplyScalar(Math.cos(b)).addScaledVector(L0, -Math.sin(b));
      p.T = T;
      p.quat = new Quaternion().setFromRotationMatrix(m.makeBasis(p.L, p.U, T));
    });
    pts.forEach((p, i) => {
      const a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, n)];
      const dT = new Vector3().subVectors(b.T, a.T).divideScalar(b.s - a.s);
      p.k = dT.dot(p.L); p.kn = dT.dot(p.U);
    });
    this.length = pts[n].s;
    this.top = Math.max(...pts.map(p => p.pos.y));

    // Contact grid: each cell lists the segments whose deck slab passes through it.
    this.grid = new Map();
    const hw = c.width / 2, box = new Vector3(), lo = new Vector3(), hi = new Vector3();
    for (let i = 0; i < n; i++) {
      lo.setScalar(Infinity); hi.setScalar(-Infinity);
      for (const p of [pts[i], pts[i + 1]]) for (const u of [-hw - 1, hw + 1]) for (const v of [-c.thickness - 1, 1]) {
        box.copy(p.pos).addScaledVector(p.L, u).addScaledVector(p.U, v);
        lo.min(box); hi.max(box);
      }
      for (let x = cell(lo.x); x <= cell(hi.x); x++) for (let y = cell(lo.y); y <= cell(hi.y); y++) for (let z = cell(lo.z); z <= cell(hi.z); z++) {
        const k = key(x, y, z);
        if (!this.grid.has(k)) this.grid.set(k, []);
        this.grid.get(k).push(i);
      }
    }
  }

  /** Centre-line frame and curvatures at arc length s. Past the end, the frame continues straight along the last tangent. */
  frame(s, out) {
    const pts = this.pts, last = pts[pts.length - 1];
    if (s >= this.length) {
      out.pos.copy(last.pos).addScaledVector(last.T, s - this.length);
      out.quat.copy(last.quat);
      out.k = out.kn = 0;
    } else {
      let lo = 0, hi = pts.length - 1;
      s = Math.max(0, s);
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid].s <= s) lo = mid; else hi = mid; }
      const a = pts[lo], b = pts[hi], t = (s - a.s) / (b.s - a.s);
      out.pos.lerpVectors(a.pos, b.pos, t);
      out.quat.slerpQuaternions(a.quat, b.quat, t);
      out.k = a.k + (b.k - a.k) * t;
      out.kn = a.kn + (b.kn - a.kn) * t;
    }
    out.L.set(1, 0, 0).applyQuaternion(out.quat);
    out.U.set(0, 1, 0).applyQuaternion(out.quat);
    out.T.set(0, 0, 1).applyQuaternion(out.quat);
    return out;
  }

  /** Penetration of point p into the road deck, if any: sets out.depth and out.normal. */
  contact(p, out) {
    const list = this.grid.get(key(cell(p.x), cell(p.y), cell(p.z)));
    if (!list) return false;
    const c = this.c;
    let found = false;
    for (const i of list) {
      const a = this.pts[i], b = this.pts[i + 1];
      _ab.subVectors(b.pos, a.pos);
      // A little overlap between segments: on the outside of a curve, the end planes of two chords leave a wedge.
      const t = _d.subVectors(p, a.pos).dot(_ab) / _ab.lengthSq();
      if (t < -0.25 || t > 1.25) continue;
      _c.lerpVectors(a.pos, b.pos, t);
      _u.lerpVectors(a.U, b.U, t).normalize();
      _l.lerpVectors(a.L, b.L, t).normalize();
      _d.subVectors(p, _c);
      const v = _d.dot(_u);
      if (Math.abs(_d.dot(_l)) > c.width / 2 || v > 0 || v < -c.thickness) continue;
      if (!found || -v > out.depth) { out.depth = -v; out.normal.copy(_u); found = true; }
    }
    return found;
  }
}
const _ab = new Vector3(), _c = new Vector3(), _u = new Vector3(), _l = new Vector3(), _d = new Vector3();

export const makeFrame = () => ({ pos: new Vector3(), quat: new Quaternion(), L: new Vector3(), U: new Vector3(), T: new Vector3(), k: 0, kn: 0 });

// ---------------------------------------------------------------- path shapes

/** Spiral around the world Y axis, turning right. It starts level, climbs at a constant grade,
 *  banks inward and ends in a kicker lip. */
function spiral(c) {
  const hEnd = c.turns * Math.PI * 2 * c.radius, n = Math.ceil(hEnd / STEP), step = hEnd / n;
  const climb = Math.atan(c.height / (hEnd - c.kickLength - c.entryLength / 2));
  const pts = [];
  let y = 0;
  for (let i = 0; i <= n; i++) {
    const h = i * step, phi = h / c.radius;
    if (i) y += Math.tan(climb * smooth(h / c.entryLength) + c.kickAngle * smooth((h - hEnd + c.kickLength) / c.kickLength)) * step;
    pts.push({ pos: new Vector3(c.radius * Math.cos(phi), y, c.radius * Math.sin(phi)), up: UP, bank: c.bank * smooth(h / c.bankIn) });
  }
  return pts;
}

/** Straight run-up along +Z, then a vertical loop of `angle` around an axis along X.
 *  The loop drifts sideways by `drift`, so a half loop ends beside the run-up, not above it. */
function loop(c) {
  const pts = [];
  for (let i = 0; i < c.runUp / STEP; i++) pts.push({ pos: new Vector3(0, 0, i * STEP), up: UP });
  const n = Math.ceil((c.angle * c.radius) / STEP);
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = t * c.angle;
    pts.push({
      pos: new Vector3(c.drift * smooth(t), c.radius * (1 - Math.cos(a)), c.runUp + c.radius * Math.sin(a)),
      up: new Vector3(0, Math.cos(a), -Math.sin(a)),   // toward the loop axis
    });
  }
  return pts;
}

const SHAPES = { spiral, loop };

// ---------------------------------------------------------------- level

/**
 * Everything the car can touch in one level: flat ground, the track deck and trampoline pads.
 * contact() keeps the deepest penetration. A live pad does not push back: it reports itself in
 * out.pad, and the simulation bounces the car off it once. After that, the pad is a solid surface.
 */
export class Level {
  constructor(def) {
    this.def = def;
    this.track = new Track(def.track, SHAPES[def.track.type](def.track));
    this.pads = (def.pads || []).map(p => ({ ...p, live: true }));
    this._r = { depth: 0, normal: new Vector3() };
  }

  reset() { for (const p of this.pads) p.live = true; }

  padUnder(x, z) {
    return this.pads.find(p => Math.abs(x - p.x) < p.size[0] / 2 && Math.abs(z - p.z) < p.size[1] / 2) || null;
  }

  contact(p, out) {
    out.depth = -p.y; out.normal.copy(UP); out.pad = null;
    if (this.track.contact(p, this._r) && this._r.depth > out.depth) { out.depth = this._r.depth; out.normal.copy(this._r.normal); }
    const pad = this.padUnder(p.x, p.z);
    if (pad && pad.height - p.y > out.depth && p.y > pad.height - 1.5) { out.depth = pad.height - p.y; out.normal.copy(UP); out.pad = pad; }
    return out.depth > 0;
  }
}

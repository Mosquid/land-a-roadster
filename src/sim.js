import { Vector3, Quaternion } from 'three';
import { CarBody } from './physics.js';
import { makeFrame } from './track.js';

const Y = new Vector3(0, 1, 0);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const moveToward = (x, target, step) => (x < target ? Math.min(target, x + step) : Math.max(target, x - step));
const DEG = 180 / Math.PI;
// After a launch or a bounce, contacts do not count as a touchdown for this long. The tyres still
// touch the deck when the car falls off a loop, and the car still dips into the pad after a bounce.
const AIR_GRACE = 0.25;

/** Small seeded generator, so a run can be replayed with ?seed=. */
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Game rules for one level, without rendering. Phases:
 *   ramp     the car drives on the deck: W/S change speed, A/D steer
 *   air      free rigid body: W/S pitch, A/D roll, Q/E yaw, Space lift
 *   landing  first contact happened; thrusters are off; wait for the car to settle
 *   result   score is ready; the car keeps rolling
 * step() pushes 'launch', 'bounce', 'touchdown', 'result' and 'wall' (a side-wall hit) to `events`.
 */
export class Sim {
  constructor(cfg, level, spec) {
    this.cfg = cfg; this.level = level; this.track = level.track; this.def = level.def;
    this.body = new CarBody(cfg, spec, level.def.fuel);
    this.frame = makeFrame(); this.frame0 = makeFrame(); this.hit = { depth: 0, normal: new Vector3() };
    const fz = spec.wheels.map(w => w.pos.z);
    this.wheelbase = Math.max(...fz) - Math.min(...fz);
    // Footprint for the wall test: the widest and longest shell points.
    this.half = { w: Math.max(...cfg.car.hull.map(p => Math.abs(p[0]))), l: Math.max(...cfg.car.hull.map(p => Math.abs(p[2]))) };
    this.events = [];
    this.reset();
  }

  reset(seed = (Math.random() * 2 ** 32) >>> 0) {
    this.seed = seed; this.rng = mulberry32(seed);
    this.phase = 'ramp'; this.time = 0; this.phaseTime = 0; this.airStart = 0;
    // Start with the rear bumper just on the deck.
    this.rail = { s: this.half.l + 0.3, u: 0, v: 0, psi: 0, steer: 0, k: 0, hit: 0, onWall: false };
    this.body.reset();
    this.level.reset();
    this.bounced = false;
    this.touch = { wheels: [null, null, null, null], shell: null, first: null };
    this.result = null; this.events.length = 0;
    this.placeOnRail();
  }

  setPhase(p) { this.phase = p; this.phaseTime = 0; this.events.push(p === 'air' ? 'launch' : p === 'landing' ? 'touchdown' : p); }

  step(dt, input) {
    this.time += dt; this.phaseTime += dt;
    if (this.phase === 'ramp') return this.drive(dt, input);
    this.body.steer = moveToward(this.body.steer, 0, 1.5 * dt);   // the front wheels centre in the air
    if (this.phase === 'air') this.body.mix(input); else this.body.mix({ pitch: 0, roll: 0, yaw: 0, lift: 0 });
    this.body.step(dt, this.level);
    if (this.phase === 'air' && this.body.padHit) this.bounce(this.body.padHit);
    this.watchContacts();
    if (this.phase === 'landing') {
      this.body.brake = this.phaseTime > 0.4 ? 1 : 0;
      const settled = this.phaseTime > 1.2 && this.body.vel.length() < 1 && this.body.omega.length() < 0.3;
      if (settled || this.phaseTime > this.cfg.landing.settle) { this.result = this.evaluate(); this.setPhase('result'); }
    }
  }

  // ------------------------------------------------------------ ramp
  /**
   * Kinematic car on the deck: s along the centre line, u to the left of it, psi the heading
   * from the centre line (+ left). The road does not steer the car: hold the curve with A / D.
   * The deck holds the car only while it presses on it: in a loop, v² × kn must beat gravity.
   */
  drive(dt, input) {
    const r = this.rail, d = this.cfg.drive, g = this.cfg.g, f = this.track.frame(r.s, this.frame);
    // The steering travels toward the held key and centres itself when the key is released.
    const toward = input.steer && input.steer * r.steer >= 0;
    r.steer = moveToward(r.steer, input.steer, (toward ? d.steerIn : d.steerOut) * dt);
    r.k = r.steer / (d.turnRadius + d.understeer * r.v * r.v);
    const cos = Math.cos(r.psi), sin = Math.sin(r.psi);
    const along = -g * (cos * f.T.y + sin * f.L.y);              // gravity along the heading
    const press = r.v * r.v * f.kn * cos * cos + g * f.U.y;      // deck reaction per unit mass
    let a = along;
    if (input.drive > 0) a += d.accel * Math.max(0, 1 - r.v / d.topSpeed);
    if (input.drive < 0) a -= r.v > 0.5 ? d.brake : r.v > -d.maxReverse ? d.reverse : 0;
    r.v = Math.min(r.v + a * dt, d.topSpeed);
    // The brakes hold the car while tyre friction can carry gravity along the slope.
    if (!input.drive && Math.abs(r.v) < 0.5 && Math.abs(along) < this.cfg.car.tyreMu * press) r.v = 0;
    const sd = r.v * cos / (1 - f.k * r.u);
    r.s += sd * dt;
    r.u += r.v * sin * dt;
    r.psi += (r.v * r.k - f.k * sd) * dt;
    r.psi = Math.atan2(Math.sin(r.psi), Math.cos(r.psi));
    if (r.s < 0) { r.s = 0; r.v = Math.max(0, r.v); }
    this.wall();
    for (const w of this.body.wheels) { w.rate = r.v / this.cfg.car.wheelRadius; w.spin += w.rate * dt; }
    this.placeOnRail();
    if (r.s > this.track.length ? !this.onDeck() : press < 0) this.launch();
  }

  /** True while any tyre still touches the deck. The springs reach `sag` below the tyres, so a tyre on the deck always touches. */
  onDeck() {
    const b = this.body;
    return b.wheels.some(w => this.track.contact(_v.copy(w.tip).applyQuaternion(b.quat).add(b.pos), this.hit));
  }

  /** Side walls: the car glances off, keeps a small rebound and loses speed to scrape friction. */
  wall() {
    const r = this.rail, d = this.cfg.drive;
    const reach = this.half.w * Math.abs(Math.cos(r.psi)) + this.half.l * Math.abs(Math.sin(r.psi));
    const side = Math.sign(r.u), gap = this.track.c.width / 2 - reach;
    r.onWall = side * r.u >= gap;
    if (!r.onWall) return;
    r.u = side * gap;
    let vt = r.v * Math.cos(r.psi), vl = r.v * Math.sin(r.psi);
    if (vl * side <= 0) return;   // already moving away from the wall
    if (Math.abs(vl) > 1) { r.hit = Math.abs(vl); this.events.push('wall'); }
    vt -= Math.sign(vt) * Math.min(Math.abs(vt), d.wallFriction * (1 + d.wallBounce) * Math.abs(vl));
    vl *= -d.wallBounce;
    r.v = Math.sign(r.v) * Math.hypot(vt, vl);
    if (r.v) r.psi = Math.atan2(vl / r.v, vt / r.v);
  }

  /** Test start: s metres along the track at speed v, on the centre line, with the steering that holds the curve. */
  placeAt(s, v) {
    const r = this.rail, d = this.cfg.drive;
    Object.assign(r, { s, v, u: 0, psi: 0 });
    r.steer = this.track.frame(s, this.frame).k * (d.turnRadius + d.understeer * v * v);
    r.k = r.steer / (d.turnRadius + d.understeer * v * v);
    this.placeOnRail();
  }

  placeOnRail() {
    const r = this.rail, f = this.track.frame(r.s, this.frame), b = this.body;
    b.pos.copy(f.pos).addScaledVector(f.L, r.u).addScaledVector(f.U, this.cfg.car.comHeight);
    b.quat.copy(f.quat).multiply(_q.setFromAxisAngle(Y, r.psi));
    b.vel.copy(f.T).multiplyScalar(r.v * Math.cos(r.psi)).addScaledVector(f.L, r.v * Math.sin(r.psi));
    b.steer = Math.atan(this.wheelbase * r.k);
  }

  /** Leave the deck: keep the pitch and roll rate of the last metre of road and the car's own
   *  turn rate, then add a random tumble. */
  launch() {
    const b = this.body, r = this.rail, s = Math.min(r.s, this.track.length);
    const f0 = this.track.frame(s - 1, this.frame0), f1 = this.track.frame(s, this.frame);
    _q.copy(f0.quat).invert().multiply(f1.quat);
    const angle = 2 * Math.acos(clamp(_q.w, -1, 1));
    if (angle > 1e-6) b.omega.set(_q.x, _q.y, _q.z).normalize().multiplyScalar(angle * r.v * Math.cos(r.psi)); else b.omega.set(0, 0, 0);
    b.omega.y = r.v * r.k;
    b.omega.applyAxisAngle(Y, -r.psi);   // road frame to body frame
    this.tumble(this.def.spin, this.def.spinPerSpeed, r.v);
    this.launchSpeed = r.v;
    this.airStart = this.time;
    this.setPhase('air');
  }

  /** Random tumble about a random axis: spin + perSpeed × speed, ±15%. */
  tumble(spin, perSpeed, speed) {
    const rnd = this.rng, z = rnd() * 2 - 1, t = rnd() * Math.PI * 2, k = Math.sqrt(1 - z * z);
    const kick = (spin + perSpeed * Math.abs(speed)) * (0.85 + 0.3 * rnd());
    this.body.omega.add(_v.set(k * Math.cos(t), z, k * Math.sin(t)).multiplyScalar(kick));
  }

  /** First touch of a live trampoline pad: throw the car back up with a new tumble. The pad is solid after that. */
  bounce(pad) {
    const b = this.body;
    if (b.vel.y < 0) b.vel.y *= -pad.bounce;
    this.tumble(pad.spin, pad.spinPerSpeed, b.vel.y);
    pad.live = false;
    this.bounced = true;
    this.airStart = this.time;
    this.events.push('bounce');
  }

  // ------------------------------------------------------------ landing
  watchContacts() {
    const b = this.body, t = this.touch;
    if (this.phase === 'air' && this.time - this.airStart < AIR_GRACE) return;
    b.wheels.forEach((w, i) => { if (w.contact && t.wheels[i] === null) t.wheels[i] = this.time; });
    if (b.hullContact && t.shell === null) t.shell = this.time;
    if (this.phase !== 'air' || (!b.hullContact && !b.wheels.some(w => w.contact))) return;
    const up = _v.set(0, 1, 0).applyQuaternion(b.quat);
    t.first = {
      by: b.wheels.some(w => w.contact) ? 'wheel' : 'shell',
      tilt: Math.acos(clamp(up.dot(b.normal), -1, 1)) * DEG,
      spin: b.omega.length() * DEG,
      impact: Math.max(0, -b.vel.dot(b.normal)),
      normal: b.normal.clone(),
      fuel: b.fuel,
    };
    for (const p of this.level.pads) p.live = false;   // after the touchdown, a pad is only a surface
    this.setPhase('landing');
  }

  evaluate() {
    const b = this.body, t = this.touch, first = t.first, cfg = this.cfg;
    const up = _v.set(0, 1, 0).applyQuaternion(b.quat);
    const onWheels = up.dot(first.normal) > 0.6 && b.wheels.filter(w => w.contact).length >= 3;
    const times = t.wheels.filter(x => x !== null);
    const values = { ...first, spread: times.length === 4 ? Math.max(...times) - Math.min(...times) : Infinity };
    const parts = cfg.score.map(p => ({ ...p, value: values[p.key], pts: p.max * clamp((p.zero - values[p.key]) / (p.zero - p.full), 0, 1) }));
    const penalties = [];
    if (first.by === 'shell') penalties.push({ text: 'The shell touched first', pts: cfg.shellFirstPenalty });
    if (this.level.pads.length && !this.bounced) penalties.push({ text: 'The car missed the trampoline', pts: this.def.missPenalty });
    const penalty = penalties.reduce((s, p) => s + p.pts, 0);
    const total = onWheels ? Math.max(0, Math.round(parts.reduce((s, p) => s + p.pts, 0) - penalty)) : 0;
    const grade = onWheels ? cfg.grades.find(([min]) => total >= min)[1] : 'CRASHED';
    return { total, grade, onWheels, parts, penalties, fuelLeft: first.fuel, launchSpeed: this.launchSpeed, bounced: this.bounced, seed: this.seed };
  }
}
const _q = new Quaternion(), _v = new Vector3();

import { Vector3, Quaternion } from 'three';

const FWD = new Vector3(0, 0, 1);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const _F = new Vector3(), _Tw = new Vector3(), _Tb = new Vector3(), _r = new Vector3(), _pw = new Vector3(),
  _vp = new Vector3(), _wW = new Vector3(), _fwd = new Vector3(), _ft = new Vector3(), _lat = new Vector3(),
  _vt = new Vector3(), _force = new Vector3(), _tmp = new Vector3(), _q = new Quaternion();

/**
 * Rigid car body with four thrusters, four spring wheels and a set of shell collision points.
 * Body frame: X left, Y up, Z forward, origin at the centre of mass. `omega` is in the body frame.
 * spec.thrusters: [{ pos, dir }] — mount point and unit thrust direction, body frame.
 * spec.wheels:    [{ pos }]      — wheel centre at rest, body frame.
 */
export class CarBody {
  constructor(cfg, spec, fuelTime) {
    this.cfg = cfg; this.fuelTime = fuelTime;   // seconds of all four thrusters at full throttle
    const c = cfg.car;
    this.sag = c.mass * cfg.g / (4 * c.spring);   // static spring compression
    this.thrusters = spec.thrusters.map(t => ({ pos: t.pos.clone(), dir: t.dir.clone(), torque: new Vector3().crossVectors(t.pos, t.dir) }));
    // The spring touches the ground `sag` below the tyre, so the tyre sits on the ground at rest.
    this.wheels = spec.wheels.map(w => ({ tip: w.pos.clone().setY(w.pos.y - c.wheelRadius - this.sag) }));
    this.hull = c.hull.map(p => new Vector3(...p));
    this.pos = new Vector3(); this.vel = new Vector3(); this.quat = new Quaternion(); this.omega = new Vector3();
    this.normal = new Vector3(0, 1, 0);
    this.throttle = [0, 0, 0, 0];
    this.hit = { depth: 0, normal: new Vector3() };
    this.reset();
  }

  reset() {
    this.pos.set(0, 0, 0); this.vel.set(0, 0, 0); this.quat.identity(); this.omega.set(0, 0, 0);
    this.fuel = 1; this.brake = 0; this.throttle.fill(0); this.hullContact = false;
    this.steer = 0;   // front wheel angle, rad, + left. Visual only: the tyre model does not steer.
    for (const w of this.wheels) Object.assign(w, { contact: false, compression: this.sag, spin: 0, rate: 0 });
  }

  /** Discrete pitch / roll / yaw / lift commands (-1, 0, 1) to thruster throttles.
   *  A thruster fires for an axis when its own torque turns the car the commanded way.
   *  With lift, all four stay lit: a turn command only throttles the opposite thrusters down to half. */
  mix(cmd) {
    const gain = cmd.lift ? 0.5 : 1;
    this.thrusters.forEach((t, i) => {
      const turn = cmd.pitch * Math.sign(t.torque.x) + cmd.roll * Math.sign(t.torque.z) + cmd.yaw * Math.sign(t.torque.y);
      this.throttle[i] = this.fuel > 0 ? clamp(cmd.lift + gain * turn, 0, 1) : 0;
    });
  }

  step(dt, level) {
    const c = this.cfg.car, q = this.quat;
    _F.set(0, -c.mass * this.cfg.g, 0); _Tw.set(0, 0, 0); _Tb.set(0, 0, 0);

    let burn = 0;
    this.thrusters.forEach((t, i) => {
      const f = this.throttle[i] * this.cfg.thrust.force;
      if (!f) return;
      _F.addScaledVector(_force.copy(t.dir).applyQuaternion(q), f);
      _Tb.addScaledVector(t.torque, f);
      burn += this.throttle[i];
    });
    this.fuel = Math.max(0, this.fuel - burn * dt / (4 * this.fuelTime));
    _F.addScaledVector(this.vel, -c.drag * this.vel.length());

    _wW.copy(this.omega).applyQuaternion(q);
    _fwd.copy(FWD).applyQuaternion(q);
    this.padHit = null;
    for (const w of this.wheels) this.wheel(w, dt, level);
    this.hullContact = false;
    for (const p of this.hull) this.shell(p, level);

    this.vel.addScaledVector(_F, dt / c.mass);
    this.pos.addScaledVector(this.vel, dt);

    // Euler's equations in the body frame, including the gyroscopic term ω × Iω.
    _Tb.add(_Tw.applyQuaternion(_q.copy(q).invert()));
    const I = c.inertia, w = this.omega;
    const gx = (I[2] - I[1]) * w.y * w.z, gy = (I[0] - I[2]) * w.z * w.x, gz = (I[1] - I[0]) * w.x * w.y;
    w.x += (_Tb.x - gx) / I[0] * dt; w.y += (_Tb.y - gy) / I[1] * dt; w.z += (_Tb.z - gz) / I[2] * dt;
    w.multiplyScalar(1 - c.spinDamping * dt);
    const angle = w.length() * dt;
    if (angle > 1e-9) q.multiply(_q.setFromAxisAngle(_tmp.copy(w).normalize(), angle)).normalize();
  }

  // Sets the lever arm _r and the point velocity _vp when body point pb touches the level.
  // A live trampoline pad does not push back: it is only reported in padHit.
  probe(pb, level) {
    _r.copy(pb).applyQuaternion(this.quat);
    _pw.copy(this.pos).add(_r);
    if (!level.contact(_pw, this.hit)) return false;
    if (this.hit.pad?.live) { this.padHit = this.hit.pad; return false; }
    _vp.crossVectors(_wW, _r).add(this.vel);
    this.normal.copy(this.hit.normal);
    return true;
  }

  push(force) { _F.add(force); _Tw.add(_tmp.crossVectors(_r, force)); }

  wheel(w, dt, level) {
    const c = this.cfg.car;
    w.contact = this.probe(w.tip, level);
    if (!w.contact) { w.compression = 0; w.rate *= 1 - 0.3 * dt; w.spin += w.rate * dt; return; }
    const n = this.hit.normal, d = this.hit.depth, vn = _vp.dot(n);
    let N = Math.max(0, c.spring * d - c.damper * vn);
    if (d > c.travel) N += Math.max(0, c.bumpSpring * (d - c.travel) - c.bumpDamper * vn);
    w.compression = d;
    // Tyre forces: grip across the wheel, rolling resistance and brake along it, inside the friction circle.
    _ft.copy(_fwd).addScaledVector(n, -_fwd.dot(n));
    if (_ft.lengthSq() > 1e-6) _ft.normalize(); else _ft.set(0, 0, 0);
    _lat.crossVectors(n, _ft);
    _vt.copy(_vp).addScaledVector(n, -vn);
    const vf = _vt.dot(_ft), vl = _vt.dot(_lat), muN = c.tyreMu * N;
    const B = Math.min(muN, this.brake * c.mass * c.brakeDecel / 4 + c.rolling * N);
    let fl = -clamp(c.tyreGrip * vl, -muN, muN), fb = -clamp(c.tyreGrip * vf, -B, B);
    const m = Math.hypot(fl, fb);
    if (m > muN) { fl *= muN / m; fb *= muN / m; }
    this.push(_force.copy(n).multiplyScalar(N).addScaledVector(_lat, fl).addScaledVector(_ft, fb));
    w.rate = vf / c.wheelRadius; w.spin += w.rate * dt;
  }

  shell(p, level) {
    const c = this.cfg.car;
    if (!this.probe(p, level)) return;
    this.hullContact = true;
    const n = this.hit.normal, vn = _vp.dot(n);
    const N = Math.max(0, c.hullSpring * this.hit.depth - c.hullDamper * vn);
    _vt.copy(_vp).addScaledVector(n, -vn);
    const vt = _vt.length(), ft = Math.min(c.hullMu * N, c.hullGrip * vt);
    _force.copy(n).multiplyScalar(N);
    if (vt > 1e-6) _force.addScaledVector(_vt, -ft / vt);
    this.push(_force);
  }
}

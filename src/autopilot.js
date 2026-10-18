import { Vector3, Quaternion } from 'three';
import { makeFrame } from './track.js';

const UP = new Vector3(0, 1, 0);
const _up = new Vector3(), _axis = new Vector3(), _qi = new Quaternion(), _f = makeFrame();

/**
 * Test pilot with the same on/off keys as a player. On the ramp it holds W up to `cruise` m/s and
 * steers along the centre line. In the air it turns the body rate toward "rotate upright", then fires
 * all four thrusters late enough to stop the fall. Over a live trampoline it does not brake: the pad
 * should throw the car back up. Used by ?autopilot and ?selftest to prove that every launch can be landed.
 */
export function autopilot(sim, cruise = Infinity) {
  const b = sim.body, cfg = sim.cfg;
  const cmd = { drive: sim.rail.v < cruise ? 1 : 0, steer: 0, pitch: 0, roll: 0, yaw: 0, lift: 0 };
  if (sim.phase === 'ramp') {
    // Curvature that holds the current lane, plus a correction back to the centre line over `look` metres.
    // Like a player, it holds the key until the steering is far enough, then lets go.
    const r = sim.rail, d = cfg.drive, k = sim.track.frame(r.s, _f).k;
    const look = Math.max(6, 0.5 * r.v);
    const want = (k / (1 - k * r.u) - (r.u / look + 2 * Math.sin(r.psi)) / look) * (d.turnRadius + d.understeer * r.v * r.v);
    cmd.steer = Math.abs(want) > Math.abs(r.steer) || want * r.steer < 0 ? Math.sign(want) : 0;
  }
  if (sim.phase !== 'air') return cmd;

  _up.copy(UP).applyQuaternion(b.quat);
  const tilt = Math.acos(Math.max(-1, Math.min(1, _up.y)));
  _axis.crossVectors(_up, UP);
  if (_axis.lengthSq() < 1e-8) _axis.set(tilt > 1 ? 1 : 0, 0, 0).applyQuaternion(b.quat);
  _axis.normalize().multiplyScalar(tilt).applyQuaternion(_qi.copy(b.quat).invert());   // body frame
  const want = _axis.multiplyScalar(2.2).clampLength(0, 3.5);
  want.y = 0;
  const key = d => (Math.abs(d) > 0.12 ? Math.sign(d) : 0);
  cmd.pitch = key(want.x - b.omega.x);
  cmd.yaw = key(want.y - b.omega.y);
  cmd.roll = key(want.z - b.omega.z);

  const pad = sim.level.padUnder(b.pos.x, b.pos.z);
  if (pad?.live) return cmd;
  const h = b.pos.y - cfg.car.comHeight - (pad ? pad.height : 0), vy = b.vel.y;
  const brake = 4 * cfg.thrust.force * 0.95 / cfg.car.mass - cfg.g;
  if (tilt < 0.35 && vy < -1 && (vy * vy) / (2 * Math.max(h - 0.3, 0.1)) > 0.8 * brake) cmd.lift = 1;
  return cmd;
}

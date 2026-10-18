import { autopilot } from './autopilot.js';

const KEYS = { drive: 1, steer: 0, pitch: 0, roll: 0, yaw: 0, lift: 0 };

/** Drive from the start to the launch with one steering policy. Reports the time, the launch speed and the wall contact. */
function climb(sim, policy) {
  const h = 1 / sim.cfg.hz;
  sim.reset(1);
  let time = 0, wallTime = 0, wallHits = 0;
  while (sim.phase === 'ramp' && time < 90) {
    sim.step(h, policy(sim));
    time += h;
    if (sim.rail.onWall) wallTime += h;
    wallHits += sim.events.filter(e => e === 'wall').length;
    sim.events.length = 0;
  }
  const end = sim.phase === 'air' ? (sim.rail.s > sim.track.length ? 'lip' : `fell off at ${Math.round(sim.rail.s)} m`) : 'stuck';
  return { time: +time.toFixed(1), launchKmh: sim.phase === 'air' ? Math.round(sim.launchSpeed * 3.6) : null, end, wallTime: +wallTime.toFixed(1), wallHits };
}

/** The autopilot with a player's reaction time: it reads the car every `t` seconds and holds its keys in between. */
function slowed(t) {
  let keys = KEYS, next = 0;
  return sim => {
    if (sim.time >= next) { keys = autopilot(sim); next = sim.time + t; }
    return keys;
  };
}

/**
 * Headless check of one level. First, four drives from the start: the autopilot, the autopilot with
 * a 0.15 s reaction time, no steering, and full right lock. Then `runs` full runs: the autopilot
 * drives with its speed capped at 80, 90 or 100% of the full-throttle launch speed, launches, and
 * lands. If the autopilot cannot land a launch, a player cannot either. Returns the report text.
 */
export async function selftest(sim, runs, print) {
  const h = 1 / sim.cfg.hz, rows = [];
  const drives = {
    autopilot: climb(sim, autopilot),
    reaction015: climb(sim, slowed(0.15)),
    noSteering: climb(sim, () => KEYS),
    fullRightLock: climb(sim, () => ({ ...KEYS, steer: -1 })),
  };
  const vMax = drives.autopilot.launchKmh / 3.6, caps = [0.8, 0.9, 1].map(f => f * vMax * 1.001);
  const lines = () => {
    const done = rows.length, landed = rows.filter(r => r.onWheels);
    const avg = k => (landed.length ? landed.reduce((s, r) => s + r[k], 0) / landed.length : 0);
    const summary = {
      level: sim.def.name, drives, runs: done, landed: landed.length, crashed: done - landed.length,
      meanScore: +avg('total').toFixed(1), minScore: Math.min(...landed.map(r => r.total)),
      meanFuelLeft: +avg('fuelLeft').toFixed(2), meanAirtime: +avg('airtime').toFixed(2),
      ...(sim.level.pads.length && { bounced: rows.filter(r => r.bounced).length }),
    };
    return `selftest ${sim.def.name} ${done}/${runs}\n${JSON.stringify(summary, null, 1)}\n\nseed        km/h  air s  score  grade     tilt°  spin°/s  impact  spread  fuel  notes\n` +
      rows.map(r => `${String(r.seed).padEnd(11)} ${String(Math.round(r.launchSpeed * 3.6)).padStart(4)}  ${r.airtime.toFixed(2).padStart(5)}  ${String(r.total).padStart(5)}  ${r.grade.padEnd(8)}` +
        r.parts.map(p => (Number.isFinite(p.value) ? p.value.toFixed(p.digits) : '—').padStart(p.key === 'spin' ? 9 : 7)).join('') +
        `  ${r.fuelLeft.toFixed(2)}  ${r.penalties.map(p => p.text).join('; ')}`).join('\n');
  };
  for (let i = 0; i < runs; i++) {
    sim.reset(i + 1);
    const cap = caps[i % caps.length];
    let airtime = 0;
    for (let t = 0; t < 60 && sim.phase !== 'result'; t += h) {
      sim.step(h, autopilot(sim, cap));
      if (sim.phase === 'air') airtime += h;
    }
    rows.push({ ...(sim.result || { total: 0, grade: 'TIMEOUT', onWheels: false, parts: [], penalties: [], fuelLeft: 0, launchSpeed: 0, seed: i + 1 }), airtime });
    if (i % 10 === 9 || i === runs - 1) { print(lines()); await new Promise(r => setTimeout(r)); }
  }
  const text = lines();
  console.log(text);
  return text;
}

import * as THREE from 'three';
import { CFG } from './config.js';
import { Level } from './track.js';
import { buildLevelMesh } from './scenery.js';
import { Sim } from './sim.js';
import { loadCar, syncCar } from './car.js';
import { createWorld } from './world.js';
import { Hud } from './hud.js';
import { autopilot } from './autopilot.js';
import { selftest } from './selftest.js';

const params = new URLSearchParams(location.search);
const firstLevel = THREE.MathUtils.clamp(Number(params.get('level')) || 1, 1, CFG.levels.length) - 1;   // ?level= is 1-based

if (params.has('selftest')) runSelftest();
else runGame();

async function runSelftest() {
  const car = await loadCar(CFG);
  document.getElementById('loading').hidden = true;
  const out = document.createElement('pre');
  out.id = 'selftest';
  document.body.append(out);
  const runs = Number(params.get('selftest')) || 30, done = [];
  for (const def of params.has('level') ? [CFG.levels[firstLevel]] : CFG.levels) {
    done.push(await selftest(new Sim(CFG, new Level(def), car.spec), runs, text => (out.textContent = [...done, text].join('\n\n\n'))));
  }
}

async function runGame() {
  const world = createWorld(document.getElementById('view'));
  const { scene, camera, composer } = world;
  const car = await loadCar(CFG);
  scene.add(car.root);
  const hud = new Hud();
  const pilot = params.has('autopilot');
  const seed = params.has('seed') ? Number(params.get('seed')) : undefined;

  // ---------------------------------------------------------- best scores
  // Level 1 keeps the storage key from before there were levels.
  const bestKey = def => (def.id === 'spiral' ? 'roadster-thrust-best' : `roadster-thrust-best-${def.id}`);
  const bests = CFG.levels.map(def => { try { return Number(localStorage.getItem(bestKey(def))) || 0; } catch { return 0; } });
  const saveBest = (i, v) => {
    bests[i] = v;
    try { localStorage.setItem(bestKey(CFG.levels[i]), String(v)); } catch { /* storage blocked: best is per session */ }
  };

  // ---------------------------------------------------------- levels
  let index = -1, level, sim, scenery;
  const levelsEl = document.getElementById('levels');
  const renderLevels = () => {
    levelsEl.innerHTML = CFG.levels.map((d, i) => `<button class="level${i === index ? ' on' : ''}" data-i="${i}">
      <b>${i + 1} · ${d.name}</b><span>${d.blurb}</span><em>${bests[i] ? `best ${bests[i]} / 100` : 'no landing yet'}</em></button>`).join('');
  };
  const setLevel = i => {
    if (i === index) return;
    index = i;
    if (scenery) {
      scene.remove(scenery);
      scenery.traverse(o => { o.geometry?.dispose(); for (const m of [o.material].flat()) { m?.map?.dispose(); m?.dispose(); } });
    }
    level = new Level(CFG.levels[i]);
    scenery = buildLevelMesh(level);
    scene.add(scenery);
    sim = new Sim(CFG, level, car.spec);
    renderLevels();
  };
  setLevel(firstLevel);

  // ---------------------------------------------------------- input
  const keys = new Set();
  const start = () => {
    document.getElementById('title').hidden = true;
    hud.show(true); hud.hideResult(); hud.message('', 0);
    sim.reset(seed);
    if (params.has('from')) sim.placeAt(sim.track.length - Number(params.get('from')), 40);   // test start before the lip, at 144 km/h
    prev.pos.copy(sim.body.pos); prev.quat.copy(sim.body.quat); acc = 0;
    playing = true; paused = false; launchClock = padClock = Infinity;
  };
  const showTitle = () => {
    playing = false;
    hud.show(false);
    renderLevels();
    document.getElementById('title').hidden = false;
  };
  addEventListener('keydown', e => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    keys.add(e.code);
    if (!playing) {
      const n = Number(e.code.replace('Digit', ''));
      if (n >= 1 && n <= CFG.levels.length) setLevel(n - 1);
      if (e.code === 'Enter') start();
    } else if (e.code === 'KeyR') start();
    else if (e.code === 'KeyN') { setLevel((index + 1) % CFG.levels.length); start(); }
    else if (e.code === 'KeyM') showTitle();
    else if (e.code === 'KeyP' || e.code === 'Escape') {
      paused = !paused;
      hud.message(paused ? 'PAUSED<small>P to continue</small>' : '', paused ? Infinity : 0);
    }
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
  document.getElementById('start').addEventListener('click', start);
  levelsEl.addEventListener('click', e => {
    const card = e.target.closest('.level');
    if (card) { setLevel(Number(card.dataset.i)); start(); }
  });

  const held = (...codes) => (codes.some(c => keys.has(c)) ? 1 : 0);
  const readKeys = () => {
    const up = held('KeyW', 'ArrowUp'), down = held('KeyS', 'ArrowDown'), left = held('KeyA', 'ArrowLeft'), right = held('KeyD', 'ArrowRight');
    const q = held('KeyQ'), e = held('KeyE');   // Q and E each fire one diagonal pair, so both together fire all four
    return { drive: up - down, steer: left - right, pitch: up - down, roll: right - left, yaw: q - e, lift: Math.max(held('Space'), q * e) };
  };

  // ---------------------------------------------------------- events
  let launchClock = Infinity, padClock = Infinity, shake = 0;
  const onEvent = ev => {
    if (ev === 'wall') shake = Math.max(shake, Math.min(1, sim.rail.hit / 10));
    if (ev === 'launch') { launchClock = 0; hud.message(`${sim.def.launchMessage || 'STABILIZE!'}<small>stop the spin · land on four wheels</small>`, 1.8); }
    if (ev === 'bounce') { launchClock = padClock = 0; hud.message('BOUNCE!<small>stabilize again · land on four wheels</small>', 1.6); }
    if (ev === 'touchdown') hud.message(sim.touch.first.by === 'wheel' ? 'TOUCHDOWN' : 'IMPACT', 1.2);
    if (ev === 'result') {
      if (!pilot && sim.result.total > bests[index]) saveBest(index, sim.result.total);
      hud.showResult(sim.result, bests[index]);
    }
  };

  // ---------------------------------------------------------- camera
  const camOffset = new THREE.Vector3(0, 4, -10), camUp = new THREE.Vector3(0, 1, 0), wantUp = new THREE.Vector3();
  const want = new THREE.Vector3(), look = new THREE.Vector3(), tmp = new THREE.Vector3(), axis = new THREE.Vector3();
  let orbit = 0;
  const updateCamera = dt => {
    const b = sim.body, onTrack = sim.phase === 'ramp';
    if (onTrack) {
      want.set(0, 0, -9).applyQuaternion(view.quat).addScaledVector(tmp.set(0, 1, 0).applyQuaternion(view.quat), 3.2);
    } else if (sim.phase === 'air' || sim.phase === 'landing') {
      // World-up chase camera behind the flight path: the car's tumble stays readable.
      tmp.set(b.vel.x, 0, b.vel.z);
      if (tmp.lengthSq() < 4) tmp.set(0, 0, 1).applyQuaternion(view.quat).setY(0);
      want.copy(tmp.normalize()).multiplyScalar(-13).setY(4.5);
      orbit = Math.atan2(want.x, want.z);
    } else {
      orbit += dt * 0.25;
      want.set(Math.sin(orbit) * 11, 3.5, Math.cos(orbit) * 11);
    }
    camOffset.lerp(want, 1 - Math.exp(-dt * 3));
    // On the track the view rolls with the car, so the road stays below it, also upside down in the loop.
    // In the air it rolls back to world up.
    wantUp.set(0, 1, 0);
    if (onTrack) wantUp.applyQuaternion(view.quat);
    const angle = camUp.angleTo(wantUp);
    if (angle > 1e-4) {
      axis.crossVectors(camUp, wantUp);
      if (axis.lengthSq() < 1e-8) camera.getWorldDirection(axis);   // exactly upside down: roll about the view axis
      camUp.applyAxisAngle(axis.normalize(), angle * (1 - Math.exp(-dt * (onTrack ? 6 : 2.5))));
    }
    camera.up.copy(camUp);
    camera.position.copy(view.pos).add(camOffset);
    camera.position.y = Math.max(camera.position.y, 0.8);
    camera.lookAt(look.copy(view.pos).addScaledVector(camUp, 0.6));
    if (shake > 0.01) {   // side-wall hit
      camera.rotateZ((Math.random() - 0.5) * 0.06 * shake);
      camera.position.addScaledVector(tmp.randomDirection(), 0.25 * shake);
      shake *= Math.exp(-dt * 6);
    }
  };

  // ---------------------------------------------------------- loop
  // Physics runs at a fixed 240 Hz and the screen at its own rate, so one frame holds a varying number of
  // steps. The car is drawn between the last two steps, at the fraction of a step that has passed;
  // without this, the world judders past the camera.
  let playing = false, paused = false, acc = 0, last = performance.now(), clock = 0;
  const h = 1 / CFG.hz;
  const prev = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() }, view = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  document.getElementById('loading').hidden = true;
  if (pilot) start(); else showTitle();

  const frame = now => {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (playing && !paused) {
      launchClock += dt;
      const c = CFG.launch;
      const scale = launchClock < c.slowmoTime ? c.slowmo : Math.min(1, c.slowmo + (launchClock - c.slowmoTime) / 0.4);
      acc += dt * scale;
      clock += dt * scale;
      padClock += dt * scale;
      while (acc >= h) {
        prev.pos.copy(sim.body.pos); prev.quat.copy(sim.body.quat);
        sim.step(h, pilot ? autopilot(sim) : readKeys());
        acc -= h;
        while (sim.events.length) onEvent(sim.events.shift());
      }
      hud.update(sim, dt);
    }
    // The trampoline mat dips under the car and rings out.
    for (const p of level.pads) p.mesh.position.y = p.height - 0.05 - (padClock < 3 ? 1.2 * Math.exp(-4 * padClock) * Math.cos(11 * padClock) : 0);
    const alpha = playing ? acc / h : 1;
    view.pos.lerpVectors(prev.pos, sim.body.pos, alpha);
    view.quat.slerpQuaternions(prev.quat, sim.body.quat, alpha);
    syncCar(car, sim.body, view, clock);
    updateCamera(dt);
    world.follow(view.pos);
    composer.render();
  };
  requestAnimationFrame(frame);
}

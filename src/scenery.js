import * as THREE from 'three';
import { makeFrame } from './track.js';

const { Vector3, Matrix4 } = THREE;

// ---------------------------------------------------------------- visuals

function canvasTexture(size, draw) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  draw(cv.getContext('2d'), size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}
function speckle(g, size, n, light, dark) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = Math.random() < 0.5 ? light : dark;
    g.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}
export const textures = {
  // Road: one texture across the deck width, 8 m along it.
  road: () => canvasTexture(512, (g, s) => {
    g.fillStyle = '#34363a'; g.fillRect(0, 0, s, s); speckle(g, s, 9000, '#44464b', '#2a2b2e');
    g.fillStyle = '#e9e6dc'; g.fillRect(s * 0.035, 0, 7, s); g.fillRect(s * 0.965 - 7, 0, 7, s);
    g.fillRect(s / 2 - 4, 0, 8, s * 0.375);
  }),
  concrete: () => canvasTexture(256, (g, s) => { g.fillStyle = '#9e998f'; g.fillRect(0, 0, s, s); speckle(g, s, 5000, '#a8a399', '#948f85'); }),
  // Wall: red and white blocks, 4 m along the track.
  wall: () => canvasTexture(256, (g, s) => {
    g.fillStyle = '#d2cec6'; g.fillRect(0, 0, s, s); g.fillStyle = '#b3222a'; g.fillRect(0, 0, s, s / 2);
  }),
  hazard: () => canvasTexture(256, (g, s) => {
    g.fillStyle = '#f2b705'; g.fillRect(0, 0, s, s); g.fillStyle = '#141414';
    for (let x = -s; x < s * 2; x += s / 2) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + s / 4, 0); g.lineTo(x + s / 4 + s, s); g.lineTo(x + s, s); g.fill(); }
  }),
  checker: () => canvasTexture(256, (g, s) => {
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#eee'; g.fillRect(i * s / 8, j * s / 8, s / 8, s / 8); }
  }),
  // Ground: 20 m tile, thin lines every 4 m.
  ground: () => canvasTexture(512, (g, s) => {
    g.fillStyle = '#b3a993'; g.fillRect(0, 0, s, s); speckle(g, s, 14000, '#b9af9a', '#ada38d');
    g.fillStyle = 'rgba(90,80,64,0.18)'; for (let k = 0; k < 5; k++) g.fillRect(k * s / 5, 0, 2, s), g.fillRect(0, k * s / 5, s, 2);
    g.fillStyle = 'rgba(90,80,64,0.35)'; g.fillRect(0, 0, 4, s); g.fillRect(0, 0, s, 4);
  }),
};

/** Deck, walls, end faces, painted bands, supports and props for one level. */
export function buildLevelMesh(level) {
  const track = level.track, c = track.c, hw = c.width / 2, th = c.thickness, wall = c.wall, ww = 0.3;
  // Closed cross-section, counter-clockwise in (u = left, v = up). Material: 0 road, 1 concrete, 2 wall.
  const prof = [[-hw - ww, -th], [hw + ww, -th], [hw + ww, wall], [hw, wall], [hw, 0], [-hw, 0], [-hw, wall], [-hw - ww, wall]];
  const mats = [1, 1, 2, 2, 0, 2, 2, 1];
  const pos = [], nor = [], uv = [], groups = [[], [], [], []];
  const P = (f, u, v) => new Vector3().copy(f.pos).addScaledVector(f.L, u).addScaledVector(f.U, v);
  const stations = track.pts.filter((_, i) => i % 2 === 0 || i === track.pts.length - 1);
  const vert = (p, n, a, b) => { pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); uv.push(a, b); return pos.length / 3 - 1; };
  prof.forEach((a, e) => {
    const b = prof[(e + 1) % prof.length], du = b[0] - a[0], dv = b[1] - a[1], len = Math.hypot(du, dv);
    for (let k = 0; k < stations.length - 1; k++) {
      const f0 = stations[k], f1 = stations[k + 1], ids = [];
      for (const [f, along] of [[f0, f0.s], [f1, f1.s]]) {
        const n = new Vector3().copy(f.L).multiplyScalar(dv / len).addScaledVector(f.U, -du / len);
        const ux = m => (mats[e] === 0 ? (m[0] + hw) / c.width : (m === a ? 0 : len / 4));
        const vy = mats[e] === 0 ? along / 8 : along / 4;
        ids.push(vert(P(f, a[0], a[1]), n, ux(a), vy), vert(P(f, b[0], b[1]), n, ux(b), vy));
      }
      groups[mats[e]].push(ids[0], ids[1], ids[3], ids[0], ids[3], ids[2]);
    }
  });
  // End faces carry hazard stripes.
  const contour = prof.map(([u, v]) => new THREE.Vector2(u, v));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  for (const [f, sign] of [[stations[0], -1], [stations[stations.length - 1], 1]]) {
    const n = f.T.clone().multiplyScalar(sign);
    const ids = prof.map(([u, v]) => vert(P(f, u, v), n, u / 2, v / 2));
    for (const t of tris) {
      const [i, j, k] = t.map(x => ids[x]);
      const a = new Vector3(...pos.slice(i * 3, i * 3 + 3)), b = new Vector3(...pos.slice(j * 3, j * 3 + 3)), d = new Vector3(...pos.slice(k * 3, k * 3 + 3));
      const facing = b.sub(a).cross(d.sub(a)).dot(n) > 0;
      groups[3].push(i, facing ? j : k, facing ? k : j);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const index = []; groups.forEach((g, m) => { geo.addGroup(index.length, g.length, m); index.push(...g); });
  geo.setIndex(index);
  const tex = { road: textures.road(), concrete: textures.concrete(), wall: textures.wall(), hazard: textures.hazard() };
  const materials = [
    new THREE.MeshStandardMaterial({ map: tex.road, roughness: 0.85 }),
    new THREE.MeshStandardMaterial({ map: tex.concrete, roughness: 0.92 }),
    new THREE.MeshStandardMaterial({ map: tex.wall, roughness: 0.55 }),
    new THREE.MeshStandardMaterial({ map: tex.hazard, roughness: 0.6 }),
  ];
  const group = new THREE.Group();
  const deck = new THREE.Mesh(geo, materials); deck.castShadow = deck.receiveShadow = true; group.add(deck);

  // Painted bands on the road: hazard stripes on the lip, chequered start line.
  const band = (s0, s1, map, repeat) => {
    const f0 = track.frame(s0, makeFrame()), f1 = track.frame(s1, makeFrame());
    const g = new THREE.BufferGeometry().setFromPoints([P(f0, -hw, 0.02), P(f0, hw, 0.02), P(f1, -hw, 0.02), P(f1, hw, 0.02)]);
    g.setIndex([0, 2, 1, 1, 2, 3]); g.computeVertexNormals();
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, repeat, 0, 0, 1, repeat, 1], 2));
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.receiveShadow = true; group.add(m);
  };
  band(track.length - 1.4, track.length, tex.hazard, 6);
  band(5.2, 6.4, textures.checker(), 8);   // just ahead of the car's nose at the start

  const ctx = { track, c, hw, th, ww, P, concrete: materials[1], group };
  if (c.type === 'spiral') spiralSupports(ctx); else loopSupports(ctx);
  for (const pad of level.pads) group.add(buildPad(pad));
  return group;
}

/** Spiral: a column on each side, outside the walls, with a cross-beam under the deck, and a central tower. */
function spiralSupports({ track, hw, th, ww, P, concrete, group }) {
  const colGeo = new THREE.CylinderGeometry(0.4, 0.48, 1, 16); colGeo.translate(0, 0.5, 0);
  const beamGeo = new THREE.BoxGeometry(1, 0.7, 0.9);
  const cols = [], beams = [];
  const f = makeFrame(), m4 = new Matrix4(), out = hw + ww + 0.7;
  for (let s = 14; s < track.length - 4; s += 13) {
    track.frame(s, f);
    const a = P(f, -out, -th - 0.35), b = P(f, out, -th - 0.35);
    if (Math.min(a.y, b.y) < 1.2) continue;
    cols.push(a, b);
    beams.push(m4.clone().makeBasis(f.L, f.U, f.T).scale(new Vector3(2 * out + 0.9, 1, 1)).setPosition(a.clone().add(b).multiplyScalar(0.5)));
  }
  const colMesh = new THREE.InstancedMesh(colGeo, concrete, cols.length);
  cols.forEach((p, i) => colMesh.setMatrixAt(i, m4.makeScale(1, p.y + 0.35, 1).setPosition(p.x, 0, p.z)));
  const beamMesh = new THREE.InstancedMesh(beamGeo, concrete, beams.length);
  beams.forEach((m, i) => beamMesh.setMatrixAt(i, m));
  for (const m of [colMesh, beamMesh]) { m.castShadow = m.receiveShadow = true; group.add(m); }

  // Central tower with glowing rings: a landmark you can see from the landing area.
  const towerH = track.top + 14;
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(6, 7.5, towerH, 48), new THREE.MeshStandardMaterial({ color: 0x8d949c, roughness: 0.7, metalness: 0.2 }));
  tower.position.y = towerH / 2; tower.castShadow = tower.receiveShadow = true; group.add(tower);
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.8, 3.2, 4.8) });
  for (let y = 8; y < towerH; y += 10) {
    const r = 6 + 1.5 * (1 - y / towerH) + 0.08;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.12, 8, 96), ringMat); ring.rotation.x = Math.PI / 2; ring.position.y = y; group.add(ring);
  }
}

/** A steel tube from a to b. */
function tube(a, b, radius, material) {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 12), material);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), new Vector3().subVectors(b, a).divideScalar(len));
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** Loop: a wheel. Spokes run from an axle on the loop axis to both side faces of the deck,
 *  outside the walls, so they never cross the car's path. Two A-frames carry the axle. */
function loopSupports({ track, c, hw, th, ww, P, group }) {
  const steel = new THREE.MeshStandardMaterial({ color: 0xc9ced4, roughness: 0.35, metalness: 0.8 });
  const f = makeFrame(), side = hw + ww, start = track.pts.find(p => p.pos.z >= c.runUp).s;
  let xMax = -Infinity, xMin = Infinity;
  for (let s = start; s <= track.length + 0.01; s += (track.length - start) / 9) {
    track.frame(Math.min(s, track.length - 0.01), f);
    for (const u of [-side, side]) {
      const end = P(f, u, -th / 2);
      group.add(tube(new Vector3(end.x, c.radius, c.runUp), end, 0.22, steel));
      xMax = Math.max(xMax, end.x); xMin = Math.min(xMin, end.x);
    }
  }
  const axleA = new Vector3(xMax + 0.6, c.radius, c.runUp), axleB = new Vector3(xMin - 0.6, c.radius, c.runUp);
  group.add(tube(axleA, axleB, 0.6, steel));
  for (const a of [axleA, axleB]) for (const dz of [-0.45, 0.45]) {
    group.add(tube(new Vector3(a.x, 0, a.z + dz * c.radius), a, 0.5, steel));
  }
}

/** Trampoline: a blue mat in a steel frame on legs. The mat dips and rings when the car bounces. */
function buildPad(pad) {
  const g = new THREE.Group(), [w, l] = pad.size, h = pad.height;
  const steel = new THREE.MeshStandardMaterial({ color: 0x2b3440, roughness: 0.5, metalness: 0.7 });
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => new Vector3(pad.x + (x * w) / 2, h, pad.z + (z * l) / 2));
  corners.forEach((a, i) => {
    g.add(tube(a, corners[(i + 1) % 4], 0.35, steel));
    g.add(tube(new Vector3(a.x, 0, a.z), a, 0.3, steel));
  });
  for (const z of [-l / 6, l / 6]) for (const x of [-w / 2, w / 2]) g.add(tube(new Vector3(pad.x + x, 0, pad.z + z), new Vector3(pad.x + x, h, pad.z + z), 0.3, steel));
  const matTex = canvasTexture(256, (q, s) => {
    q.fillStyle = '#1d6fd6'; q.fillRect(0, 0, s, s);
    q.strokeStyle = 'rgba(255,255,255,0.35)'; q.lineWidth = 3; q.strokeRect(0, 0, s, s);
    q.fillStyle = '#f2b705'; q.beginPath(); q.arc(s / 2, s / 2, s / 6, 0, Math.PI * 2); q.fill();
  });
  matTex.repeat.set(1, 1);
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.6, l - 0.6, 24, 48), new THREE.MeshStandardMaterial({ map: matTex, roughness: 0.6 }));
  mat.rotation.x = -Math.PI / 2;
  mat.position.set(pad.x, h - 0.05, pad.z);
  mat.receiveShadow = true;
  g.add(mat);
  pad.mesh = mat;   // main.js moves it for the bounce
  return g;
}

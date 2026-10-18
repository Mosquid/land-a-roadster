import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const THRUSTERS = ['FL', 'FR', 'RL', 'RR'];
const WHEELS = ['FRONT_L', 'FRONT_R', 'REAR_L', 'REAR_R'];

/**
 * Loads the roadster GLB. The model has its nose toward -X; it is turned so the nose points +Z,
 * and lowered so the group origin is the centre of mass. Thruster mounts and wheel centres are
 * read from the THRUSTER_* and WHEEL_*_PIVOT nodes, so the physics follows the model.
 */
export async function loadCar(cfg) {
  const gltf = await new GLTFLoader().loadAsync(cfg.car.url);
  const model = gltf.scene;
  model.rotation.y = Math.PI / 2;
  model.position.y = -cfg.car.comHeight;
  const root = new THREE.Group();
  root.add(model);
  root.updateMatrixWorld(true);
  model.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });

  const q = new THREE.Quaternion();
  const thrusters = THRUSTERS.map(name => {
    const node = model.getObjectByName(`THRUSTER_${name}`);
    // The node's local +Y is the exhaust direction; thrust pushes the other way.
    const dir = new THREE.Vector3(0, -1, 0).applyQuaternion(node.getWorldQuaternion(q));
    const core = node.children.find(o => o.name.includes('core'));
    core.material = core.material.clone();
    core.material.emissive.setRGB(0.35, 0.8, 1);
    return { name, node, core, pos: node.getWorldPosition(new THREE.Vector3()), dir, flame: addFlame(node) };
  });
  const wheels = WHEELS.map(name => {
    const node = model.getObjectByName(`WHEEL_${name}_PIVOT`);
    return { name, node, rest: node.position.clone(), pos: node.getWorldPosition(new THREE.Vector3()) };
  });

  const glow = new THREE.PointLight(0x7fd8ff, 0, 9, 2);
  glow.position.y = -0.6;
  root.add(glow);

  return { root, spec: { thrusters, wheels }, thrusters, wheels, glow };
}

const flameVertex = /* glsl */`
  uniform float uLen;
  varying float vT; varying vec3 vN; varying vec3 vV;
  void main() {
    vT = position.y / uLen;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const flameFragment = /* glsl */`
  uniform vec3 uColor; uniform float uPower; uniform float uTime;
  varying float vT; varying vec3 vN; varying vec3 vV;
  void main() {
    float edge = pow(abs(dot(vN, vV)), 1.6);
    float fade = pow(clamp(1.0 - vT, 0.0, 1.0), 1.7);
    float flicker = 0.82 + 0.18 * sin(uTime * 70.0 + vT * 24.0);
    gl_FragColor = vec4(uColor * uPower * edge * fade * flicker, 1.0);
  }`;

function flameMaterial(color, len) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(...color) }, uPower: { value: 0 }, uTime: { value: 0 }, uLen: { value: len } },
    vertexShader: flameVertex, fragmentShader: flameFragment,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

/** Exhaust plume along the node's local +Y: a white-hot core inside a wider blue plume. */
function addFlame(node) {
  const group = new THREE.Group();
  for (const [rNozzle, rEnd, len, color] of [[0.05, 0.0, 0.75, [3.0, 3.6, 4.0]], [0.06, 0.26, 1.6, [0.5, 1.4, 3.2]]]) {
    const geo = new THREE.CylinderGeometry(rEnd, rNozzle, len, 24, 1, true);
    geo.translate(0, len / 2, 0);
    group.add(new THREE.Mesh(geo, flameMaterial(color, len)));
  }
  group.visible = false;
  node.add(group);
  return group;
}

/** Copy the simulation state onto the model: pose ({ pos, quat }, drawn between physics steps), wheel spin,
 *  steering and travel, flames. */
export function syncCar(car, body, pose, time) {
  car.root.position.copy(pose.pos);
  car.root.quaternion.copy(pose.quat);
  car.wheels.forEach((w, i) => {
    const s = body.wheels[i];
    w.node.rotation.z = s.spin;
    if (i < 2) w.node.rotation.y = body.steer;   // front wheels
    w.node.position.y = w.rest.y - THREE.MathUtils.clamp(body.sag - s.compression, -0.1, body.sag);   // droop in the air
  });
  let total = 0;
  car.thrusters.forEach((t, i) => {
    const p = body.throttle[i];
    total += p;
    t.flame.visible = p > 0;
    t.flame.scale.set(1, p * (0.85 + 0.15 * Math.sin(time * 53 + i * 1.7)), 1);
    for (const m of t.flame.children) { m.material.uniforms.uPower.value = p; m.material.uniforms.uTime.value = time; }
    t.core.material.emissiveIntensity = 0.3 + 30 * p;
  });
  car.glow.intensity = 60 * total;
}

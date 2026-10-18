import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { textures } from './scenery.js';

/** Renderer, sky, sun, ground and bloom. The sun light follows the car so its shadow stays sharp. */
export function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.55;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xb9c7d6, 250, 1800);
  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 5000);

  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(52), THREE.MathUtils.degToRad(150));
  const sky = new Sky();
  sky.scale.setScalar(4500);
  const u = sky.material.uniforms;
  u.turbidity.value = 2.2; u.rayleigh.value = 2.2; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.85;
  u.sunPosition.value.copy(sunDir);
  scene.add(sky);
  const envScene = new THREE.Scene();
  envScene.add(sky.clone());
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(envScene).texture;
  scene.environmentIntensity = 0.9;

  const sun = new THREE.DirectionalLight(0xfff0dc, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 260 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x8a7f6c, 0.7));

  const groundTex = textures.ground();
  groundTex.repeat.set(300, 300);
  // Level track sections lie on the ground, and the deck must win the depth test. The corners of this plane are
  // 3 km away, so float rounding moves it by about 0.1 mm near the camera, more than the polygon offset there.
  // So the visible ground is 1 cm low: the gap wins near the camera, the polygon offset wins far away.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 4 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  ground.receiveShadow = true;
  scene.add(ground);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.4, 1.6);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const resize = () => {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false); composer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  addEventListener('resize', resize);
  resize();

  /** Keep the shadow camera on the car. */
  const follow = target => {
    sun.target.position.copy(target);
    sun.position.copy(target).addScaledVector(sunDir, 120);
  };
  return { renderer, scene, camera, composer, follow };
}

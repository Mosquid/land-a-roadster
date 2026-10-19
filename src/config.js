// All tuning values. Units: metres, seconds, kilograms, newtons, radians.
// Body frame: X left, Y up, Z forward (nose), origin at the centre of mass.
const deg = Math.PI / 180;
const DECK = { width: 9, thickness: 0.8, wall: 0.9 };   // road width, slab thickness and wall height, m

export const CFG = {
  hz: 240,                       // physics steps per second
  g: 9.81,

  car: {
    url: 'assets/roadster.glb',
    mass: 1200,
    inertia: [2060, 2300, 480],  // about body X (pitch), Y (yaw), Z (roll)
    comHeight: 0.5,              // centre of mass above the model's ground plane
    wheelRadius: 0.36,
    spring: 36000, damper: 3600, travel: 0.2, bumpSpring: 4e5, bumpDamper: 2e4,
    tyreMu: 1.1, tyreGrip: 9000, rolling: 0.015, brakeDecel: 6,
    hullSpring: 4e5, hullDamper: 2.2e4, hullMu: 0.5, hullGrip: 8000,
    drag: 0.42, spinDamping: 0.02,
    // Shell collision points (body frame). The roof, nose and tail points decide a crash.
    hull: [
      [0.85, -0.30, 2.20], [-0.85, -0.30, 2.20], [0.85, -0.12, -2.10], [-0.85, -0.12, -2.10],
      [0.85, -0.40, 0.60], [-0.85, -0.40, 0.60], [0.85, -0.40, -0.60], [-0.85, -0.40, -0.60],
      [0.85, 0.00, 2.25], [-0.85, 0.00, 2.25], [0.95, 0.25, 1.40], [-0.95, 0.25, 1.40],
      [1.00, 0.35, 0.00], [-1.00, 0.35, 0.00], [0.95, 0.40, -2.12], [-0.95, 0.40, -2.12],
      [0.50, 0.64, 0.40], [-0.50, 0.64, 0.40], [0.50, 0.64, -0.60], [-0.50, 0.64, -0.60],
    ],
  },

  thrust: {
    force: 7865,                 // per thruster at full throttle
  },

  drive: {
    accel: 16, topSpeed: 52, brake: 16, reverse: 4, maxReverse: 6,
    // Full lock turns on a radius of turnRadius + understeer * v², so the tightest turn widens
    // with speed: 6 m at walking pace, 24 m at top speed.
    turnRadius: 5.5, understeer: 0.0068,
    steerIn: 3.5, steerOut: 5,              // steering travel, full lock per second (key held / key released)
    wallBounce: 0.15, wallFriction: 0.35,   // side walls: rebound of the speed into the wall, scrape friction
  },

  launch: { slowmo: 0.3, slowmoTime: 0.8 },   // time scale and real seconds of slow motion after a launch or a bounce

  landing: { settle: 3.5 },               // seconds after touchdown before the score

  // Each part gives full points at `full` or better and zero at `zero` or worse.
  score: [
    { key: 'tilt', label: 'Tilt at touchdown', unit: '°', max: 40, full: 0, zero: 30, digits: 1 },
    { key: 'spin', label: 'Spin at touchdown', unit: '°/s', max: 20, full: 0, zero: 180, digits: 0 },
    { key: 'impact', label: 'Impact speed', unit: 'm/s', max: 25, full: 1.5, zero: 10, digits: 1 },
    { key: 'spread', label: 'Four-wheel spread', unit: 's', max: 15, full: 0, zero: 0.35, digits: 2 },
  ],
  shellFirstPenalty: 15,
  grades: [[95, 'PERFECT'], [85, 'SUPERB'], [70, 'CLEAN'], [50, 'ROUGH'], [0, 'SLOPPY']],

  // Levels. track.type picks the path shape in track.js. spin + spinPerSpeed * speed is the random
  // tumble at the launch, rad/s. fuel is in seconds of all four thrusters at full throttle.
  // hint names keys in braces, so a touch screen can name its own controls (touch.js).
  levels: [
    {
      id: 'spiral', name: 'Spiral',
      blurb: 'Climb the spiral, fly off the lip and land on four wheels.',
      hint: 'Hold {W} to build speed. Steer with {A} / {D}: the ramp turns right.',
      track: {
        type: 'spiral', ...DECK, radius: 34, turns: 0.75, height: 38,   // 15° climb
        bank: 10 * deg, bankIn: 30,           // inward bank, faded in over the first 30 m
        entryLength: 10,                      // the climb fades in over the first 10 m, so the car starts level
        kickLength: 12, kickAngle: 14 * deg,  // the lip at the end tips the climb up by this angle
      },
      spin: 0.75, spinPerSpeed: 0.03, fuel: 4,
    },
    {
      id: 'loop', name: 'Loop',
      blurb: 'Ride a half loop. At the top you hang under the track, and it launches you upside down.',
      hint: 'Hold {W}. If the car is too slow at the top of the loop, it falls off.',
      launchMessage: 'UPSIDE DOWN!',
      // Straight run-up, then half a vertical loop. It drifts 14 m to the right, so the top ends beside the run-up.
      track: { type: 'loop', ...DECK, runUp: 100, radius: 22, angle: Math.PI, drift: -14 },
      spin: 0.5, spinPerSpeed: 0.02, fuel: 4,
    },
    {
      id: 'trampoline', name: 'Trampoline',
      blurb: 'Hit the trampoline first. It throws the car back up with a new spin. Then land on four wheels.',
      hint: 'Hold {W} and steer: the launch must reach the blue trampoline.',
      track: {
        type: 'spiral', ...DECK, radius: 30, turns: 0.5, height: 16,
        bank: 8 * deg, bankIn: 25, entryLength: 10, kickLength: 12, kickAngle: 16 * deg,
      },
      // Pad top at `height`, centred on (x, z), size along X and Z. bounce: rebound of the falling speed.
      // Launches from about 100 to 125 km/h come down on it.
      pads: [{ x: -28.5, z: -143, size: [26, 64], height: 2.5, bounce: 1.05, spin: 1, spinPerSpeed: 0.02 }],
      missPenalty: 30,
      spin: 0.5, spinPerSpeed: 0.02, fuel: 6,
    },
  ],
};

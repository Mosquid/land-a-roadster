# Roadster Thrust

A three.js mini game with the v3 roadster. Drive up a ramp, fly off the end, stop the tumble with four floor thrusters, and land on all four wheels. The game scores how precisely you land. There are three levels.

## Run

The game loads ES modules and a GLB, so it needs a web server. A `file://` URL does not work. three.js r170 loads from jsDelivr, so the browser needs internet access.

Run this in the repo root:

```sh
python3 -m http.server 5173
```

Then open http://localhost:5173.

## Controls

| Phase | Keys |
| --- | --- |
| Title | `1` / `2` / `3` pick a level, `Enter` start, or click a level card |
| Track | `W` accelerate, `S` brake or reverse, `A` / `D` steer |
| Air | `W` / `S` pitch nose down / up, `A` / `D` roll left / right, `Q` / `E` yaw left / right, `Space` or `Q` + `E` together all four thrusters |
| Any | `R` restart, `N` next level, `M` level select, `P` or `Esc` pause |

The arrow keys also work in place of WASD. In the air, each turn key fires the thrusters that turn the car that way, at full power, and switches the others off. Keys add together, for example `W` + `A` fires only the rear-right thruster.

`Space` keeps all four thrusters lit. While you hold it, a turn key throttles the opposite thrusters down to half instead of off. So you can brake the fall and correct the attitude at the same time.

`Q` and `E` each fire one diagonal pair of thrusters. Hold both, and all four fire, the same as `Space`. With all four at full power, the thrust is 2.2 times the car's weight, so a level car climbs. One tank lifts the car about 175 m from a hover.

## Touch screens

On a phone or a tablet, the game shows on-screen controls in place of the keys. It uses them when the main pointer is a finger (`pointer: coarse`).

| Control | Same as |
| --- | --- |
| Stick, left thumb | `W` `A` `S` `D`, in eight directions: up-left holds `W` + `A`. The centre is a dead zone |
| `↺` / `↻` | `Q` / `E`, yaw |
| `THRUST` | `Space` |
| `RETRY`, `❚❚`, `LEVELS`, under the speed | `R`, `P`, `M` |
| Buttons on the result card | `R`, `N`, `M`. A mouse can also click them |

- Each finger holds its own control, so the stick and a button work at the same time. A control keeps its finger when the finger slides off it.
- The hints and the spin bars name the touch controls: ▲ ▼ ◀ ▶ for the stick, ↺ ↻ for yaw. In `config.js`, a level hint names keys in braces, for example `{W}`, and `src/touch.js` gives the touch name.
- On a phone in portrait (narrower than 600 px), a prompt asks the player to turn the phone sideways.
- The page blocks pinch zoom and page scroll. The title card and the result card still scroll when they do not fit.

## Levels

| Level | Track | What is new |
| --- | --- | --- |
| 1 · Spiral | Three quarters of a right-hand spiral, 34 m radius, rising at 15° to a 14° kicker lip at about 43 m | Steering, the launch tumble |
| 2 · Loop | 100 m straight run-up, then half a vertical loop with a 22 m radius. The loop drifts 14 m to the right, so its top ends beside the run-up, at 44 m | You ride upside down under the track and launch upside down |
| 3 · Trampoline | Half a right-hand spiral, 30 m radius, to a 16° kicker lip at about 20 m. A 26 × 64 m trampoline lies 110 to 175 m beyond the lip | The trampoline throws the car back up with a new tumble |

- **Loop:** the track holds the car only while the car presses on it. The test is `v² × kn + g × U.y > 0`, where `kn` is the curvature of the road toward the car and `U` is the deck normal. At the top of the loop this is `v² / r > g`, so the car needs at least 53 km/h there. Full throttle reaches the top at about 128 km/h. Below the limit, the car falls off the loop. The launch keeps the pitch rate of the loop, so the car leaves upside down and still turns nose-down.
- **Trampoline:** the first touch of the mat reflects the falling speed (× 1.05) and adds a new random tumble of 2 + 0.04 × speed rad/s. After that the mat is a solid surface. Launches from about 100 to 125 km/h come down on the mat. If the car touches anything else first, the score loses 30 points.
- On the track, the camera rolls with the car, so the road stays below it, also upside down in the loop. In the air the camera rolls back to world up.

## Steering

The track does not steer the car. The level 1 spiral turns right, so hold `D` through the curve and let go when the nose points too far in. At 135 km/h, the curve needs about half of full lock. The loop on level 2 bends a little to the right and back while it climbs, so it also needs small corrections.

- The steering travels to full lock in 0.3 s while you hold a key. It centres in 0.2 s when you let go. A short tap gives a small correction.
- Full lock turns on a 6 m radius at walking pace. The radius grows with speed (`turnRadius + understeer × v²`) to 24 m at top speed. The level 1 centre line has a 34 m radius.
- The front wheels show the steering angle.
- The side walls are solid. The car glances off a wall and loses speed to scrape friction. On level 1, if you do not steer, the car hits the outer wall four times and leaves the lip at about 91 km/h instead of 135 km/h.

The HUD spin bars show the body's pitch, roll and yaw rates. A bar grows toward the key that would cause that spin. To stop the spin, hold the key on the other side.

## Rules

1. The car starts on a level section at the foot of the track, behind the chequered line. The climb fades in over the first 10 m.
2. When the last tyre leaves the end of the track, or when the car falls off the loop, the car flies free. It keeps the pitch and roll rate of the last metre of road, keeps its own turn rate from the steering, and gets a random tumble. The tumble is 1.5 + 0.06 × speed rad/s on level 1, and 1 + 0.04 × speed rad/s on levels 2 and 3.
3. Slow motion runs for the first 0.8 s after the launch and after a trampoline bounce.
4. Fuel lasts for 4 s of all four thrusters at full power, 6 s on level 3.
5. For 0.25 s after a launch or a bounce, contacts do not count as a touchdown.
6. At first contact the thrusters stop. The game measures the touchdown, waits up to 3.5 s for the car to settle, then shows the score.

| Score part | Full points | Zero points | Max |
| --- | --- | --- | --- |
| Tilt at touchdown (body up vs. ground normal) | 0° | 30° | 40 |
| Spin at touchdown | 0°/s | 180°/s | 20 |
| Impact speed (along the ground normal) | 1.5 m/s | 10 m/s | 25 |
| Four-wheel spread (first to fourth wheel contact) | 0 s | 0.35 s | 15 |

If the shell touches the ground before a wheel, the score loses 15 points. On level 3, if the car misses the trampoline, the score loses 30 points. If the car does not end on its wheels, the result is CRASHED with 0 points. The browser's local storage keeps the best score of each level.

## Test and tuning

- `?touch` shows the touch controls on a desktop. The mouse works the stick and the buttons, one at a time.
- `?autopilot` flies the game with a test pilot that uses the same on/off keys as a player.
- `?level=2` starts on that level. It also limits `?selftest` to that level.
- `?selftest=30` runs every level without rendering and prints a table. Use it after you change the steering, the tracks, thrust, fuel, inertia or spin.
  - First, it drives four times from the start to the launch. The results with the current values:

    | Driver | Spiral | Loop | Trampoline |
    | --- | --- | --- | --- |
    | Autopilot | 6.5 s, 135 km/h | 6.2 s, 128 km/h | 4.5 s, 122 km/h |
    | Autopilot with a 0.15 s reaction time | 6.6 s, 136 km/h | 6.3 s, 129 km/h | 4.6 s, 122 km/h |
    | No steering | 8.7 s, 91 km/h, 4 wall hits | 6.4 s, 117 km/h, 1 wall hit | 5.7 s, 88 km/h, 4 wall hits |
    | Full right lock | 11.7 s, 46 km/h, 13 wall hits | scrapes to 30 km/h and falls off the loop 112° up | 6.9 s, 49 km/h, 22 wall hits |

  - Then it makes the given number of full runs. The autopilot holds W up to 80, 90 or 100% of its full-throttle launch speed, so the launch speeds vary. It drives, launches and lands each run. In a 30-run test of each level with the current values:

    | Level | Landed | Mean score | Lowest | Fuel left | Air time |
    | --- | --- | --- | --- | --- | --- |
    | Spiral | 30 of 30 | 93 | 90 | 21% | 8.2 s |
    | Loop | 30 of 30 | 90 | 89 | 37% | 4.4 s |
    | Trampoline | 30 of 30, all bounced | 92 | 79 | 47% | 11.9 s |
- `?seed=123` repeats one tumble. The result card shows the seed of each run.
- `?from=40` starts 40 m before the lip at 144 km/h, with the steering set to hold the curve.

All tuning values are in `src/config.js`.

## Play counts

GoatCounter (https://mosquid.goatcounter.com) counts players. It uses no cookies and stores no user ID. The script tag is in `index.html`, and it does not count on `localhost`. `main.js` sends an event at each step of a run, per level:

| Event | When |
| --- | --- |
| `level-N/start` | A run starts (`Enter`, `R`, `N` or a level card) |
| `level-N/launch` | The car leaves the track |
| `level-N/perfect` … `level-N/crashed` | The result card shows this grade |

GoatCounter counts a visit only the first time a browser sends a path in 8 hours. It knows the browser by its IP address and User-Agent, in memory only. So each event counts players, not runs: a player who restarts ten times counts once. A player who comes back the next day counts again. Runs with `?autopilot` send no events. To stop counting your own visits in one browser, open the game URL with `#toggle-goatcounter` at the end.

## Files

| File | Contents |
| --- | --- |
| `index.html`, `style.css` | Page, HUD, touch controls and title screen |
| `src/config.js` | All tuning values and the three level definitions |
| `src/track.js` | Track frames and curvatures from a sampled path, deck collision through a grid, the spiral and loop path shapes, and `Level` (ground, track, trampoline pads) |
| `src/scenery.js` | Track mesh, supports (spiral columns and tower, loop wheel and A-frames), trampoline, canvas textures |
| `src/physics.js` | Rigid body: thrusters, spring wheels with tyre grip, shell contact points, Euler's equations |
| `src/sim.js` | Game phases, track driving, walls and loop fall-off, launch, trampoline bounce, touchdown detection and score, with no rendering |
| `src/main.js` | Level select, keys, camera, and the frame loop. Physics runs in fixed 1/240 s steps. The screen draws the car between the last two steps, so the motion stays smooth at any screen rate |
| `src/car.js` | GLB loading, thruster flames, wheel spin and suspension travel |
| `src/world.js` | Renderer, sky, sun, ground and bloom |
| `src/hud.js` | HUD and result card |
| `src/touch.js` | Touch detection, the stick and the pads, and the touch names of the keys |
| `src/autopilot.js`, `src/selftest.js` | Test pilot and batch test |
| `assets/roadster.glb` | The roadster model, exported from Blender |

## Model contract

The game reads these nodes from the GLB, so the physics follows the model:

- `THRUSTER_FL`, `THRUSTER_FR`, `THRUSTER_RL`, `THRUSTER_RR`: the nozzle exits. Each node's local +Y points along the exhaust. Each nozzle leans 18° sideways around the vertical axis, and the diagonal pairs lean the same way. Thrusters that point straight down cannot stop a yaw spin. With the lean, `Q` / `E` give yaw control.
- `WHEEL_{FRONT|REAR}_{L|R}_PIVOT`: wheel centres. The game spins them about local Z and moves them up and down with the suspension.
- `Thruster • core *` meshes: the game makes their emissive glow brighter with the throttle.

A Blender script builds the model. The script is not in this repo. After you change the model, export it to `assets/roadster.glb` and keep these node names.

## Limits

- On the track, the car is a kinematic bicycle on the deck surface: the tyres do not slip and the body does not roll. Free physics starts at the launch.
- The track grip is arcade grip. At 135 km/h, a 34 m radius needs about 4 g of side force. A road car could take this banked curve at about 80 km/h only. The loop fall-off test is real physics.
- In flight, the car collides with the ground, the track deck and the trampoline mat only. It goes through the walls, columns, spokes, the tower and the trampoline frame.
- The trampoline is a one-time reflection of the falling speed, not a stretching mat.
- The physics is a small custom model, tuned for one car and analytic surfaces. For free-form levels, use a physics engine such as Rapier with mesh colliders. The `Sim` / `CarBody` split keeps that change local.
- There is no sound.

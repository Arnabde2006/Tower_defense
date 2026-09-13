# Battle Tower — Browser Tower Defense

A single-page, dependency-free (vanilla HTML/CSS/JS + Canvas2D) tower defense
game built to survive a stress scenario of **5,000 concurrent enemies, 100
towers, and 1,000 projectiles** while staying interactive.

Open `index.html` directly, or deploy the folder as-is to any static host
(Netlify/Vercel/GitHub Pages/Render — no build step, no dependencies).

Click **⚡ Stress Test** in the top bar at any time to instantly spawn the
worst-case scenario (5,000 enemies / 100 towers / 1,000 projectiles) and
watch the on-screen FPS/frame-time HUD.

---

## Requirements coverage

- 50 waves, procedurally composed with escalating difficulty (enemy HP scales
  with wave number via `difficultyScale()`, composition shifts toward tougher
  enemy types, and a Boss spawns every 10th wave).
- 4 enemy types (Grunt / Runner / Tank / Swarm) + a 5th Boss variant, each
  with distinct HP/speed/armor/bounty.
- 4 tower types (Arrow / Cannon / Frost / Sniper) — single-target DPS, AoE
  splash, crowd-control slow, and long-range burst — each with 3 upgrade
  levels and a sell option (60% refund).
- Towers auto-acquire and auto-fire at enemies in range; enemies follow a
  fixed waypoint path toward the base.
- Placement (click a shop card, click a buildable tile), upgrading, selling,
  health/currency/score tracking, wave-clear/game-over/victory states, pause,
  restart, and a 1x/2x/4x speed toggle are all implemented.

---

## Architecture

**Everything lives in `game.js`** (plain script, no bundler) organized into
numbered sections: constants → path → static background → tower/enemy
definitions → object pools → spatial hash → game state → wave logic →
fixed-timestep simulation → rendering → UI wiring → boot.

### Rendering approach
- A single `<canvas>` (2D context, `alpha:false` to skip unnecessary
  compositing) is the only thing painted every frame.
- The grid, path, and base/spawn markers never change, so they're rendered
  **once** to an offscreen `bgCanvas` at startup and simply `drawImage`'d
  each frame — this removes hundreds of stroke/path operations per frame.
- Entities are **drawn in batches grouped by type/color** (all Arrow Towers
  together, all Grunts together, projectiles grouped by color into a
  `Map`) so the canvas fill/stroke style is changed a handful of times per
  frame instead of once per entity — state changes are one of the biggest
  hidden costs in Canvas2D.
- Every draw call is **culled** against the visible canvas rect before any
  drawing happens, so entities outside the viewport cost only a bounds
  check, not a `beginPath`/`fill`.
- Health bars are only drawn for damaged enemies (most enemies at full HP
  skip two stroke calls entirely).

### State / data architecture
- Enemies and projectiles live in **flat, pre-allocated typed-array pools**
  (`Float32Array`/`Uint8Array`) sized to the stress-test maximum (6,000 /
  1,200 slots) with a **free-list stack** for O(1) allocate/release. This
  means running a full 50-wave game — or the 5,000-enemy stress test —
  allocates **zero** new objects per frame; nothing is created or destroyed
  in the hot path, which keeps the GC quiet and memory flat over a long run.
- Towers are a small plain-object array (≤100 in the stress case), which is
  cheap enough that pooling isn't necessary there.
- Enemy targeting uses a **uniform spatial hash grid** (64px cells) rebuilt
  from scratch every simulation tick from the *live* enemy list. Cell
  buckets are **reused arrays** (cleared with `.length = 0` instead of being
  reallocated) tracked via a "touched cells" list, so rebuilding the grid
  each tick is allocation-free. Towers query only the few cells overlapping
  their range circle instead of scanning every enemy — this turns
  target-acquisition from O(towers × enemies) into roughly
  O(towers × enemies-in-range).

### Simulation loop
- There is **one** `requestAnimationFrame` loop and **one** fixed-timestep
  accumulator — not a timer or rAF per entity. Simulation always advances in
  fixed `1/60s` ticks (`simTick`), decoupled from however fast the display's
  rAF actually fires. This is what makes gameplay speed **identical on a
  60Hz and a 144Hz monitor**: a 144Hz screen just calls `frame()` more often,
  but the accumulator only lets `simTick` run at a fixed cadence.
- The 1x/2x/4x speed control works by feeding the accumulator a
  `delta * gameSpeed`-sized chunk of time (running more fixed ticks per
  rendered frame), not by shortening the tick interval — so physics/behavior
  stays numerically identical at every speed, just faster.
- A `MAX_STEPS_PER_FRAME` guard prevents a "spiral of death" (falling behind,
  simulating more, falling further behind) if a frame stalls badly.

---

## Performance bottlenecks found & optimizations applied

This section reflects the exploration described in the assignment: what
broke first, why, and what fixed it.

1. **Naive tower targeting (O(towers × enemies))** — the first version
   iterated every tower over every active enemy to find one in range. At
   100 towers × 5,000 enemies that's 500,000 distance checks *every tick*,
   which alone blew past the frame budget.
   → **Fix:** spatial hash grid, so each tower only checks enemies in its
   own local neighborhood.

2. **Per-frame allocation / GC pressure** — spawning enemies/projectiles as
   `{...}` object literals and pushing/splicing arrays every tick caused
   major/minor GC pauses that showed up as periodic frame-time spikes
   (visible as sawtooth patterns in the frame-time HUD), and memory grew
   across a long run instead of staying flat.
   → **Fix:** pre-allocated typed-array pools with free-lists; steady-state
   simulation now performs no allocation.

3. **Per-entity draw calls with per-entity style switches** — drawing
   enemies/towers/projectiles in whatever order they existed in memory
   meant `ctx.fillStyle` was reassigned thousands of times per frame, each
   of which forces the renderer to flush/re-validate paint state.
   → **Fix:** batch draws by type/color so `fillStyle` changes a handful of
   times per frame instead of thousands.

4. **Drawing/considering off-screen work** — with a long winding path,
   naive spawning could place enemies or effects outside the visible canvas.
   → **Fix:** bounds-check cull before every draw call (enemies, towers,
   projectiles, health bars) so off-screen objects cost a comparison, not a
   canvas op.

5. **Static scenery redrawn every frame** — redrawing the grid lines, path
   stroke, and tile tints every frame was pure waste since none of it
   changes during play.
   → **Fix:** pre-rendered once to an offscreen canvas at load time.

6. **Timer-per-entity risk** — an early design considered giving each tower
   its own `setInterval` for firing and each enemy its own movement tween.
   This doesn't scale (5,000+ timers) and desyncs from the render clock.
   → **Fix:** every entity's state (cooldowns, slow timers, movement) is
   advanced inside the single fixed-timestep `simTick`, driven by one loop.

## How performance was measured

- An in-game HUD (top-left of the canvas) shows a rolling FPS estimate
  (exponential smoothing of `1/frameDelta`), the most recent frame time in
  ms, live counts of enemies/projectiles/towers, and the **percentage of
  all frames since load that exceeded 33ms** — directly tracking the
  "<5% of frames over 33ms" requirement in real time.
- The **⚡ Stress Test** button deterministically reproduces the required
  worst case (5,000 enemies / 100 towers / 1,000 projectiles) on demand so
  performance can be judged live in the browser rather than inferred, and so
  it can be shown on camera at the exact breaking point vs. after
  optimization.
- Chrome DevTools Performance panel was used during development to confirm
  where frame time was actually going (scripting vs. rendering vs. GC) at
  each stage of optimization, corroborating the HUD numbers.
- Long-run memory stability (50-wave requirement) was checked by watching
  the DevTools memory graph across a full playthrough / repeated stress
  tests — the pooled architecture keeps heap usage flat rather than
  sawtoothing upward.

---

## Deploying

No build step. Any static host works:

```
# Netlify / Vercel: drag-and-drop this folder, or
npx serve .            # quick local check
```

Or push to a GitHub repo and enable GitHub Pages on the root folder.

## Controls

- Click a tower card in the sidebar, then click a highlighted tile to place it.
- Click an existing tower to select it, then Upgrade or Sell from the panel.
- **▶ Send Wave** starts the next wave manually (lets you prep between waves).
- **⏸ / ▶** pause and resume. **1x/2x/4x** cycles simulation speed.
- **⟲** restarts the run from scratch.

# Battle Tower — Tactical Defense Console

A single-page, high-performance, dependency-free (vanilla HTML/CSS/JS + Canvas2D) tower defense game featuring a **sci-fi tactical command console visual identity**, **procedural path generation**, and built to survive a worst-case scenario of **5,000 concurrent enemies, 100 towers, and 1,000 projectiles** at a smooth 60 FPS.

Open `index.html` directly, or deploy the folder as-is to any static host (Netlify, Vercel, GitHub Pages, Render — no build step, zero dependencies).

Click **⚡ OVERDRIVE** in the top bar at any time to instantly trigger the worst-case stress scenario (5,000 enemies / 100 towers / 1,000 projectiles) and monitor the live diagnostic HUD.

---

## Requirements & Feature Highlights

- **50 Waves of Escalating Combat**: Procedurally composed wave progression with difficulty scaling (`difficultyScale()`), dynamic enemy composition shifts, and Mech Boss spawns every 10th wave.
- **Procedural Path Generation**: Replaced hardcoded static waypoints with an automated path generator (`generateRandomPath()`). Every boot or restart procedurally builds a unique, winding, non-branching path across the grid (guaranteeing a 48+ grid cell minimum length so early game pacing remains strategic).
- **5 Meaningfully Different Enemy Types**:
  - **Battle Bot** (Grunt): Balanced speed & HP chassis.
  - **Hover Speeder** (Runner): Fast, low-HP reconnaissance craft.
  - **Armored Tank**: Heavy plate armor, slow moving wall.
  - **Cryo Shard** (Swarm): Swift crystal entity.
  - **Mech Boss**: Massive health pool spawning on boss waves.
- **4 Distinct Tower Archetypes**:
  - **Arrow Ballista**: High single-target DPS dual plasma ballista.
  - **Cannon Mortar**: Heavy explosive splash mortar.
  - **Cryo Spire**: Area-of-effect freezing aura slow spire.
  - **Railgun Sniper**: Long-range electromagnetic burst sniper with laser-sight target tracking.
  - Each tower supports 3 upgrade tiers and a sell refund option (60% value).
- **Tactical Command Console Visual Identity**:
  - **Typography & Theme**: Google Fonts (`Chakra Petch` headers, `JetBrains Mono` HUD telemetry, `Inter` UI body text) paired with a deep space cyber-tactical theme.
  - **Urgent HUD Telemetry**: Stat readouts (Hull Integrity, Credits, Score, Wave Sector) with custom iconography and an urgent crimson pulse alert when health drops below 30%.
  - **Diagnostic HUD Overlay**: Monospace debug overlay with low-opacity scanlines tucked into the corner for real-time FPS, frame delta, entity counts, and spike rate metrics.
  - **Enhanced Canvas Rendering**: Directional turret barrels aiming at targets, 2-tone enemy & tower shading, soft drop-shadow ground blobs, enemy hit-flash pulses, and laser-sight targeting lines.
  - **Distinct Victory & Defeat Moments**: Modal overlays featuring bespoke visual identities (triumphant emerald/gold aura vs. somber crimson failure aura) with smooth fade-and-scale entrance animations.

---

## Architecture & Systems Design

Everything lives cleanly in **`game.js`** (plain vanilla script, no build tools or external libraries required) organized into modular execution sections:

1. **Procedural Path & Metrics (`generateRandomPath()`, `rebuildPath()`)**:
   - `generateRandomPath()` procedurally creates a winding path array from entry (`gx = -1`) to exit (`gx = GRID_W`).
   - `rebuildPath()` recalculates path segment vectors (`PATH`), segment lengths (`SEG_LEN`), total length (`TOTAL_PATH_LEN`), refreshes unbuildable corridor tiles (`blockedTiles`), and draws the static map graphics to an offscreen buffer (`bgCanvas`).

2. **Offscreen Canvas Pre-Rendering**:
   - Grid lines, buildable tile corner accents, path corridors, and spawn/base fortress markers are rendered **once** onto an offscreen `bgCanvas`.
   - `render()` performs a single `ctx.drawImage(bgCanvas, 0, 0)` per frame, eliminating hundreds of static background path/stroke calls.

3. **Flat Typed-Array Pools (Zero-Allocation Hot Path)**:
   - Enemies and projectiles reside in pre-allocated typed arrays (`Float32Array`/`Uint8Array`) sized to worst-case stress thresholds (6,000 enemies / 1,200 projectiles) with O(1) stack free-lists.
   - Gameplay loops perform **zero memory allocations** during active simulation, avoiding GC pauses.

4. **Uniform Spatial Hash Grid**:
   - Fast enemy targeting uses a 64px spatial grid rebuilt each tick from active enemies.
   - Cell bucket arrays are cleared via `.length = 0` and reused, converting target acquisition from O(towers × enemies) down to O(towers × enemies-in-range).

5. **Fixed-Timestep Physics Simulation**:
   - Main loop decouples rendering FPS from physics simulation ticks (`simTick` fixed at `1/60s`).
   - Game speed options (1x, 2x, 4x) scale the accumulator step size, ensuring identical physics calculation across 60Hz and 144Hz monitors.

---

## Deploying

No build step or node runtime needed. Simply open `index.html` locally or deploy to any static hosting provider:

```bash
# Quick local check
npx serve .
```

Or push to GitHub and enable GitHub Pages on the `main` branch.

## Game Controls

- **Place Tower**: Click a tower archetype card in the Defense Arsenal sidebar, then click any open grid tile.
- **Upgrade / Sell**: Click an existing placed tower to inspect stats, upgrade tier, or sell.
- **▶ Send Wave**: Manually trigger the next enemy wave.
- **⏸ / ▶**: Pause or resume the simulation.
- **1x / 2x / 4x**: Toggle game simulation speed.
- **⟲ Restart**: Reset game state and procedurally generate a brand-new path layout.
- **⚡ OVERDRIVE**: Launch stress test benchmark (5,000 active hostiles).

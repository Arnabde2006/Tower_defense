'use strict';
/* =========================================================================
   BATTLE TOWER — Tower Defense
   Single-file game engine. See README.md for architecture notes.
   ========================================================================= */

/* ---------------------------------------------------------------------
   0. CONSTANTS & CANVAS SETUP
   --------------------------------------------------------------------- */
const CELL = 40;                // grid cell size in px
const GRID_W = 22, GRID_H = 14; // play field in cells
const CANVAS_W = GRID_W * CELL; // 880
const CANVAS_H = GRID_H * CELL; // 560

const MAX_ENEMIES = 6000;       // pool size (stress target: 5000 active)
const MAX_PROJECTILES = 1200;   // pool size (stress target: 1000 active)
const MAX_TOWERS = 150;         // pool size (stress target: 100 active)

const TOTAL_WAVES = 50;
const STARTING_GOLD = 150;
const STARTING_HEALTH = 100;

const canvas = document.getElementById('game');
canvas.width = CANVAS_W;
canvas.height = CANVAS_H;
const ctx = canvas.getContext('2d', { alpha: false });

/* ---------------------------------------------------------------------
   1. PATH DEFINITION & PROCEDURAL GENERATION
   --------------------------------------------------------------------- */
let WAYPOINTS_GRID = [];
let PATH = [];
let SEG_LEN = [];
let TOTAL_PATH_LEN = 0;
const blockedTiles = new Set();
function tileKey(gx, gy) { return gx + ',' + gy; }

/** Procedurally builds a WAYPOINTS_GRID array from gx=-1 to gx=GRID_W */
function generateRandomPath() {
  const MIN_GRID_LEN = 48; // minimum path length in grid cells for interesting play
  let waypoints = [];
  let valid = false;

  while (!valid) {
    waypoints = [];
    let currY = Math.floor(Math.random() * (GRID_H - 4)) + 2; // e.g. 2 to 11
    let currX = -1;
    waypoints.push([currX, currY]);

    // First horizontal segment into grid (gx = 2 to 4)
    let firstX = Math.floor(Math.random() * 3) + 2;
    waypoints.push([firstX, currY]);
    currX = firstX;

    // Advance rightward across the grid with alternating vertical swings
    while (currX < GRID_W - 3) {
      // Pick nextY with a minimum vertical distance from currY
      let nextY;
      let attempts = 0;
      do {
        nextY = Math.floor(Math.random() * (GRID_H - 2)) + 1; // 1 to 12
        attempts++;
      } while (Math.abs(nextY - currY) < 3 && attempts < 30);

      waypoints.push([currX, nextY]);
      currY = nextY;

      // Horizontal move rightward (advance 2 to 4 cells)
      let dx = Math.floor(Math.random() * 3) + 2; // 2, 3, or 4
      let nextX = Math.min(GRID_W - 1, currX + dx);
      waypoints.push([nextX, currY]);
      currX = nextX;
    }

    // Final move to right edge (gx = GRID_W)
    let finalY = Math.floor(Math.random() * (GRID_H - 2)) + 1;
    if (Math.abs(finalY - currY) >= 2) {
      waypoints.push([currX, finalY]);
      currY = finalY;
    }
    waypoints.push([GRID_W, currY]);

    // Calculate total Manhattan distance (grid cells)
    let totalGridLen = 0;
    for (let i = 0; i < waypoints.length - 1; i++) {
      const [x1, y1] = waypoints[i];
      const [x2, y2] = waypoints[i + 1];
      totalGridLen += Math.abs(x2 - x1) + Math.abs(y2 - y1);
    }

    if (totalGridLen >= MIN_GRID_LEN) {
      valid = true;
    }
  }

  return waypoints;
}

/** Given distance traveled along the path, return {x,y,angle}. */
function pointAtDistance(dist) {
  if (dist <= 0) return { x: PATH[0].x, y: PATH[0].y, angle: 0 };
  let remaining = dist;
  for (let i = 0; i < SEG_LEN.length; i++) {
    const len = SEG_LEN[i];
    if (remaining <= len || i === SEG_LEN.length - 1) {
      const t = len === 0 ? 0 : Math.min(1, remaining / len);
      const a = PATH[i], b = PATH[i + 1];
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        angle: Math.atan2(b.y - a.y, b.x - a.x)
      };
    }
    remaining -= len;
  }
  const last = PATH[PATH.length - 1];
  return { x: last.x, y: last.y, angle: 0 };
}

/** Mark tiles occupied by the path corridor as unbuildable */
function markPathTiles() {
  blockedTiles.clear();
  const samples = Math.ceil(TOTAL_PATH_LEN / 8);
  for (let s = 0; s <= samples; s++) {
    const p = pointAtDistance((s / samples) * TOTAL_PATH_LEN);
    const gx = Math.floor(p.x / CELL), gy = Math.floor(p.y / CELL);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const nx = gx + dx, ny = gy + dy;
        if (Math.hypot(dx, dy) <= 1) blockedTiles.add(tileKey(nx, ny));
      }
  }
}

/* ---------------------------------------------------------------------
   2. STATIC BACKGROUND (pre-rendered offscreen canvas)
   --------------------------------------------------------------------- */
const bgCanvas = document.createElement('canvas');
bgCanvas.width = CANVAS_W; bgCanvas.height = CANVAS_H;

function renderBackground() {
  const b = bgCanvas.getContext('2d');
  
  // Cyberpunk base grid fill
  b.fillStyle = '#070b14';
  b.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Subtle grid lines with glowing intersections
  b.strokeStyle = 'rgba(62, 166, 255, 0.05)';
  b.lineWidth = 1;
  for (let x = 0; x <= GRID_W; x++) {
    b.beginPath(); b.moveTo(x * CELL, 0); b.lineTo(x * CELL, CANVAS_H); b.stroke();
  }
  for (let y = 0; y <= GRID_H; y++) {
    b.beginPath(); b.moveTo(0, y * CELL); b.lineTo(CANVAS_W, y * CELL); b.stroke();
  }

  // Buildable tile subtle metallic corner accents
  for (let gx = 0; gx < GRID_W; gx++) {
    for (let gy = 0; gy < GRID_H; gy++) {
      if (!blockedTiles.has(tileKey(gx, gy))) {
        b.fillStyle = 'rgba(62,166,255,0.015)';
        b.fillRect(gx * CELL + 1, gy * CELL + 1, CELL - 2, CELL - 2);
        b.strokeStyle = 'rgba(62,166,255,0.06)';
        b.strokeRect(gx * CELL + 4, gy * CELL + 4, CELL - 8, CELL - 8);
      }
    }
  }

  // High-tech path corridor base
  b.strokeStyle = '#18243b';
  b.lineWidth = CELL * 0.85;
  b.lineCap = 'round'; b.lineJoin = 'round';
  b.beginPath();
  b.moveTo(PATH[0].x, PATH[0].y);
  for (let i = 1; i < PATH.length; i++) b.lineTo(PATH[i].x, PATH[i].y);
  b.stroke();

  // Inner track line
  b.strokeStyle = '#0f172a';
  b.lineWidth = CELL * 0.65;
  b.beginPath();
  b.moveTo(PATH[0].x, PATH[0].y);
  for (let i = 1; i < PATH.length; i++) b.lineTo(PATH[i].x, PATH[i].y);
  b.stroke();

  // Glowing track borders
  b.strokeStyle = 'rgba(62, 166, 255, 0.3)';
  b.lineWidth = 2;
  b.beginPath();
  b.moveTo(PATH[0].x, PATH[0].y);
  for (let i = 1; i < PATH.length; i++) b.lineTo(PATH[i].x, PATH[i].y);
  b.stroke();

  // Directional energy chevrons along path
  b.strokeStyle = 'rgba(62, 166, 255, 0.4)';
  b.lineWidth = 1.5;
  const numChevrons = Math.floor(TOTAL_PATH_LEN / 28);
  for (let c = 0; c < numChevrons; c++) {
    const p = pointAtDistance(c * 28);
    const cos = Math.cos(p.angle), sin = Math.sin(p.angle);
    b.beginPath();
    b.moveTo(p.x - cos * 6 - sin * 6, p.y - sin * 6 + cos * 6);
    b.lineTo(p.x + cos * 4, p.y + sin * 4);
    b.lineTo(p.x - cos * 6 + sin * 6, p.y - sin * 6 - cos * 6);
    b.stroke();
  }

  // BASE FORTRESS MARKER
  const base = PATH[PATH.length - 1];
  // Outer shield glow
  const baseGrad = b.createRadialGradient(base.x, base.y, 4, base.x, base.y, CELL * 0.7);
  baseGrad.addColorStop(0, 'rgba(34, 211, 165, 0.4)');
  baseGrad.addColorStop(0.7, 'rgba(34, 211, 165, 0.1)');
  baseGrad.addColorStop(1, 'rgba(34, 211, 165, 0)');
  b.fillStyle = baseGrad;
  b.beginPath(); b.arc(base.x, base.y, CELL * 0.75, 0, Math.PI * 2); b.fill();

  b.fillStyle = '#102e2b';
  b.strokeStyle = '#22d3a5';
  b.lineWidth = 2;
  b.beginPath(); b.arc(base.x, base.y, CELL * 0.45, 0, Math.PI * 2); b.fill(); b.stroke();

  b.fillStyle = '#22d3a5';
  b.font = 'bold 16px sans-serif';
  b.textAlign = 'center'; b.textBaseline = 'middle';
  b.fillText('🏰', base.x, base.y);

  // SPAWN WARP PORTAL MARKER
  const spawn = PATH[0];
  const spawnGrad = b.createRadialGradient(spawn.x, spawn.y, 2, spawn.x, spawn.y, CELL * 0.65);
  spawnGrad.addColorStop(0, 'rgba(255, 77, 109, 0.5)');
  spawnGrad.addColorStop(1, 'rgba(255, 77, 109, 0)');
  b.fillStyle = spawnGrad;
  b.beginPath(); b.arc(spawn.x, spawn.y, CELL * 0.65, 0, Math.PI * 2); b.fill();

  b.strokeStyle = '#ff4d6d';
  b.lineWidth = 2;
  b.setLineDash([4, 4]);
  b.beginPath(); b.arc(spawn.x, spawn.y, CELL * 0.4, 0, Math.PI * 2); b.stroke();
  b.setLineDash([]);
}

/** Rebuild path, segment metrics, blocked tiles set, and background canvas */
function rebuildPath() {
  WAYPOINTS_GRID = generateRandomPath();
  PATH = WAYPOINTS_GRID.map(([gx, gy]) => ({
    x: gx * CELL + CELL / 2,
    y: gy * CELL + CELL / 2
  }));

  SEG_LEN = [];
  TOTAL_PATH_LEN = 0;
  for (let i = 0; i < PATH.length - 1; i++) {
    const dx = PATH[i + 1].x - PATH[i].x, dy = PATH[i + 1].y - PATH[i].y;
    const len = Math.hypot(dx, dy);
    SEG_LEN.push(len);
    TOTAL_PATH_LEN += len;
  }

  markPathTiles();
  renderBackground();
}

/* ---------------------------------------------------------------------
   3. TOWER & ENEMY DEFINITIONS
   --------------------------------------------------------------------- */
const TOWER_TYPES = {
  arrow: {
    name: 'Arrow Tower', color: '#3ea6ff', cost: 50,
    desc: 'Fast dual plasma ballista for single targets.',
    levels: [
      { range: 120, damage: 8, fireRate: 3.2, projSpeed: 480 },
      { range: 135, damage: 14, fireRate: 3.6, projSpeed: 520 },
      { range: 150, damage: 24, fireRate: 4.2, projSpeed: 560 }
    ],
    projColor: '#8fd0ff', splash: 0, slow: 0
  },
  cannon: {
    name: 'Cannon Mortar', color: '#ffb84d', cost: 90,
    desc: 'Heavy mortar hitting area with explosive splash.',
    levels: [
      { range: 105, damage: 26, fireRate: 0.9, projSpeed: 260 },
      { range: 115, damage: 42, fireRate: 1.0, projSpeed: 280 },
      { range: 130, damage: 68, fireRate: 1.15, projSpeed: 300 }
    ],
    projColor: '#ffcf8a', splash: 46, slow: 0
  },
  frost: {
    name: 'Cryo Spire', color: '#7ee8fa', cost: 70,
    desc: 'Emits freezing aura to slow enemies in range.',
    levels: [
      { range: 100, damage: 3, fireRate: 1.6, projSpeed: 400 },
      { range: 112, damage: 5, fireRate: 1.8, projSpeed: 420 },
      { range: 125, damage: 8, fireRate: 2.1, projSpeed: 440 }
    ],
    projColor: '#c8f7ff', splash: 30, slow: 0.45
  },
  sniper: {
    name: 'Railgun Sniper', color: '#c792ea', cost: 130,
    desc: 'Extreme range electromagnetic railgun with laser sight.',
    levels: [
      { range: 260, damage: 55, fireRate: 0.55, projSpeed: 900 },
      { range: 290, damage: 95, fireRate: 0.6, projSpeed: 950 },
      { range: 320, damage: 160, fireRate: 0.68, projSpeed: 1000 }
    ],
    projColor: '#e6c9ff', splash: 0, slow: 0, pierce: true
  }
};
const TOWER_KEYS = Object.keys(TOWER_TYPES);
const UPGRADE_COST_MULT = 0.75; // upgrade cost = base cost * mult * (level+1)
const SELL_REFUND = 0.6;

const ENEMY_TYPES = {
  grunt:  { name: 'Battle Bot', color: '#ff8080', hp: 32,  speed: 55,  bounty: 4,  score: 5,  armor: 0 },
  runner: { name: 'Hover Speeder', color: '#ffe066', hp: 18,  speed: 105, bounty: 5,  score: 6,  armor: 0 },
  tank:   { name: 'Armored Tank', color: '#a78bfa', hp: 160, speed: 32,  bounty: 12, score: 15, armor: 4 },
  swarm:  { name: 'Cryo Shard', color: '#66ffcc', hp: 10,  speed: 75,  bounty: 2,  score: 2,  armor: 0 },
  boss:   { name: 'Mech Boss', color: '#ff4d6d', hp: 1400, speed: 26, bounty: 120, score: 250, armor: 8 }
};
const ENEMY_KEYS = Object.keys(ENEMY_TYPES);

/* ---------------------------------------------------------------------
   4. OBJECT POOLS  (flat arrays + free-list => zero per-frame GC churn)
   --------------------------------------------------------------------- */
function makeEnemyPool(n) {
  return {
    active: new Uint8Array(n),
    type: new Uint8Array(n),
    x: new Float32Array(n), y: new Float32Array(n),
    angle: new Float32Array(n),
    dist: new Float32Array(n),        // distance traveled along path
    hp: new Float32Array(n), maxHp: new Float32Array(n),
    speed: new Float32Array(n), baseSpeed: new Float32Array(n),
    slowTimer: new Float32Array(n),
    hitFlashTimer: new Float32Array(n),
    freeList: (() => { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = n - 1 - i; return a; })(),
    count: n
  };
}
const EP = makeEnemyPool(MAX_ENEMIES);
let liveEnemyIdx = [];           // indices currently active (rebuilt each tick)

function spawnEnemy(typeIdx, distOffset) {
  if (EP.freeList.length === 0) return -1;
  const i = EP.freeList.pop();
  const def = ENEMY_TYPES[ENEMY_KEYS[typeIdx]];
  const scaled = difficultyScale();
  EP.active[i] = 1;
  EP.type[i] = typeIdx;
  EP.dist[i] = distOffset || 0;
  const p = pointAtDistance(EP.dist[i]);
  EP.x[i] = p.x; EP.y[i] = p.y;
  EP.angle[i] = p.angle;
  EP.maxHp[i] = def.hp * scaled.hpMult;
  EP.hp[i] = EP.maxHp[i];
  EP.baseSpeed[i] = def.speed;
  EP.speed[i] = def.speed;
  EP.slowTimer[i] = 0;
  EP.hitFlashTimer[i] = 0;
  return i;
}
function killEnemy(i, reachedBase) {
  EP.active[i] = 0;
  EP.freeList.push(i);
  if (!reachedBase) {
    const def = ENEMY_TYPES[ENEMY_KEYS[EP.type[i]]];
    gold += def.bounty;
    score += def.score;
    spawnHitBurst(EP.x[i], EP.y[i], def.color, EP.type[i] === 4 ? 24 : 10);
    spawnFloatingText(EP.x[i], EP.y[i], '+' + def.bounty + 'g', '#ffd166');
  }
}

// PARTICLE POOL
const MAX_PARTICLES = 1200;
function makeParticlePool(n) {
  return {
    active: new Uint8Array(n),
    x: new Float32Array(n), y: new Float32Array(n),
    vx: new Float32Array(n), vy: new Float32Array(n),
    size: new Float32Array(n),
    life: new Float32Array(n), maxLife: new Float32Array(n),
    color: new Array(n),
    freeList: (() => { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = n - 1 - i; return a; })()
  };
}
const FX = makeParticlePool(MAX_PARTICLES);

function spawnParticle(x, y, vx, vy, size, life, color) {
  if (FX.freeList.length === 0) return;
  const i = FX.freeList.pop();
  FX.active[i] = 1; FX.x[i] = x; FX.y[i] = y;
  FX.vx[i] = vx; FX.vy[i] = vy;
  FX.size[i] = size; FX.life[i] = life; FX.maxLife[i] = life;
  FX.color[i] = color;
}
function spawnHitBurst(x, y, color, count = 8) {
  for (let c = 0; c < count; c++) {
    const ang = Math.random() * Math.PI * 2;
    const spd = 30 + Math.random() * 120;
    spawnParticle(x, y, Math.cos(ang) * spd, Math.sin(ang) * spd, 2 + Math.random() * 3, 0.25 + Math.random() * 0.25, color);
  }
}

// FLOATING COMBAT TEXT POOL
const MAX_TEXTS = 80;
function makeTextPool(n) {
  return {
    active: new Uint8Array(n),
    x: new Float32Array(n), y: new Float32Array(n),
    vy: new Float32Array(n),
    text: new Array(n), color: new Array(n),
    life: new Float32Array(n), maxLife: new Float32Array(n),
    freeList: (() => { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = n - 1 - i; return a; })()
  };
}
const TXP = makeTextPool(MAX_TEXTS);

function spawnFloatingText(x, y, str, color) {
  if (TXP.freeList.length === 0) return;
  const i = TXP.freeList.pop();
  TXP.active[i] = 1; TXP.x[i] = x; TXP.y[i] = y - 8;
  TXP.vy[i] = -24; TXP.text[i] = str; TXP.color[i] = color;
  TXP.life[i] = 0.65; TXP.maxLife[i] = 0.65;
}

function makeProjPool(n) {
  return {
    active: new Uint8Array(n),
    x: new Float32Array(n), y: new Float32Array(n),
    vx: new Float32Array(n), vy: new Float32Array(n),
    damage: new Float32Array(n),
    splash: new Float32Array(n),
    slow: new Float32Array(n),
    color: new Array(n),
    targetEnemy: new Int32Array(n), // -1 if unhoming (dumb-fire, still fine)
    life: new Float32Array(n),
    freeList: (() => { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = n - 1 - i; return a; })()
  };
}
const PP = makeProjPool(MAX_PROJECTILES);

function spawnProjectile(x, y, targetIdx, damage, speed, color, splash, slow) {
  if (PP.freeList.length === 0) return -1;
  const i = PP.freeList.pop();
  PP.active[i] = 1;
  PP.x[i] = x; PP.y[i] = y;
  PP.targetEnemy[i] = targetIdx;
  const tx = EP.x[targetIdx], ty = EP.y[targetIdx];
  const dx = tx - x, dy = ty - y;
  const d = Math.hypot(dx, dy) || 1;
  PP.vx[i] = (dx / d) * speed;
  PP.vy[i] = (dy / d) * speed;
  PP.damage[i] = damage;
  PP.splash[i] = splash;
  PP.slow[i] = slow;
  PP.color[i] = color;
  PP.life[i] = 2.5;
  return i;
}

/* ---------------------------------------------------------------------
   5. TOWERS (small array, capped at MAX_TOWERS — no pooling needed but
      kept structurally similar for consistency)
   --------------------------------------------------------------------- */
let towers = []; // {id, typeKey, level(0-2), gx, gy, x, y, cooldown, targetEnemy}
let towerIdSeq = 1;

function towerStats(t) {
  return TOWER_TYPES[t.typeKey].levels[t.level];
}

/* ---------------------------------------------------------------------
   6. SPATIAL HASH GRID (for fast tower -> nearby-enemy queries)
   --------------------------------------------------------------------- */
const HASH_CELL = 64;
const hashGrid = new Map(); // key -> array of enemy indices (reused)
const touchedCells = [];

function clearHashGrid() {
  for (let i = 0; i < touchedCells.length; i++) {
    const arr = hashGrid.get(touchedCells[i]);
    if (arr) arr.length = 0;
  }
  touchedCells.length = 0;
}
function hashKey(cx, cy) { return cx * 100000 + cy; }
function insertHash(idx, x, y) {
  const cx = Math.floor(x / HASH_CELL), cy = Math.floor(y / HASH_CELL);
  const key = hashKey(cx, cy);
  let arr = hashGrid.get(key);
  if (!arr) { arr = []; hashGrid.set(key, arr); }
  if (arr.length === 0) touchedCells.push(key);
  arr.push(idx);
}
function queryHashCircle(x, y, radius, outArr) {
  outArr.length = 0;
  const minCx = Math.floor((x - radius) / HASH_CELL), maxCx = Math.floor((x + radius) / HASH_CELL);
  const minCy = Math.floor((y - radius) / HASH_CELL), maxCy = Math.floor((y + radius) / HASH_CELL);
  for (let cx = minCx; cx <= maxCx; cx++) {
    for (let cy = minCy; cy <= maxCy; cy++) {
      const arr = hashGrid.get(hashKey(cx, cy));
      if (!arr) continue;
      for (let i = 0; i < arr.length; i++) outArr.push(arr[i]);
    }
  }
  return outArr;
}

/* ---------------------------------------------------------------------
   7. GAME STATE
   --------------------------------------------------------------------- */
let gold = STARTING_GOLD;
let health = STARTING_HEALTH;
let score = 0;
let waveNumber = 0;
let waveInProgress = false;
let spawnQueue = [];      // {typeIdx, t} scheduled spawn times (seconds from wave start)
let waveTimer = 0;
let enemiesRemainingToSpawn = 0;
let gameOver = false;
let victory = false;
let paused = false;
let gameSpeed = 1;        // 1, 2, 4
let selectedBuildType = null;
let selectedTowerId = null;
let stressTestActive = false;
let hoverTile = null;

function difficultyScale() {
  const w = Math.max(waveNumber, 1);
  return {
    hpMult: 1 + w * 0.14 + Math.pow(w, 1.35) * 0.01,
    countMult: 1 + w * 0.08
  };
}

function buildWave(n) {
  // Procedurally compose a wave: more/tougher enemies as n grows, boss every 10.
  const list = [];
  const scale = difficultyScale();
  const baseCount = Math.round(6 + n * 1.6);
  for (let i = 0; i < baseCount; i++) {
    let key;
    const r = Math.random();
    if (n > 25 && r < 0.12) key = 'tank';
    else if (n > 8 && r < 0.30) key = 'runner';
    else if (n > 15 && r < 0.45) key = 'swarm';
    else key = 'grunt';
    list.push(key);
  }
  if (n % 10 === 0) list.push('boss');
  if (n > 5) for (let i = 0; i < Math.floor(n / 12); i++) list.push('swarm');
  return list;
}

function startWave() {
  if (waveInProgress || gameOver || victory) return;
  waveNumber++;
  if (waveNumber > TOTAL_WAVES) { waveNumber = TOTAL_WAVES; return; }
  const comp = buildWave(waveNumber);
  spawnQueue = [];
  let t = 0;
  for (let i = 0; i < comp.length; i++) {
    spawnQueue.push({ typeIdx: ENEMY_KEYS.indexOf(comp[i]), t });
    t += 0.45 + Math.random() * 0.35;
  }
  enemiesRemainingToSpawn = spawnQueue.length;
  waveTimer = 0;
  waveInProgress = true;
  updateWaveButtonState();
}

/* ---------------------------------------------------------------------
   8. STRESS TEST (spawns the required worst-case scenario instantly)
   --------------------------------------------------------------------- */
function runStressTest() {
  stressTestActive = true;
  // Fill enemies along the path at varying offsets.
  const targetEnemies = 5000;
  for (let i = 0; i < targetEnemies && EP.freeList.length > 0; i++) {
    const typeIdx = i % ENEMY_KEYS.length;
    const dist = (i / targetEnemies) * TOTAL_PATH_LEN * 3; // spread with wrap via modulo below
    spawnEnemy(typeIdx, dist % TOTAL_PATH_LEN);
  }
  // Place towers on every buildable tile until 100 reached.
  towers = [];
  let placed = 0;
  outer:
  for (let gx = 0; gx < GRID_W && placed < 100; gx++) {
    for (let gy = 0; gy < GRID_H && placed < 100; gy++) {
      if (blockedTiles.has(tileKey(gx, gy))) continue;
      const typeKey = TOWER_KEYS[placed % TOWER_KEYS.length];
      towers.push({
        id: towerIdSeq++, typeKey, level: 0,
        gx, gy, x: gx * CELL + CELL / 2, y: gy * CELL + CELL / 2,
        cooldown: Math.random(), targetEnemy: -1
      });
      placed++;
      if (placed >= 100) break outer;
    }
  }
  // Spawn projectiles as a burst.
  for (let i = 0; i < 1000; i++) {
    const enemyIdx = EP.freeList.length < MAX_ENEMIES ? findAnyActiveEnemy() : -1;
    if (enemyIdx === -1) break;
    spawnProjectile(
      Math.random() * CANVAS_W, Math.random() * CANVAS_H,
      enemyIdx, 5, 400, '#8fd0ff', 0, 0
    );
  }
  gold += 999999; // don't let stress test be blocked by economy
}
function findAnyActiveEnemy() {
  for (let i = 0; i < MAX_ENEMIES; i++) if (EP.active[i]) return i;
  return -1;
}

/* ---------------------------------------------------------------------
   9. FIXED-TIMESTEP SIMULATION  (single tick function — not per-entity)
   --------------------------------------------------------------------- */
const FIXED_DT = 1 / 60;
const tmpQueryArr = [];

function simTick(dt) {
  if (paused || gameOver || victory) return;

  // --- spawn queued enemies for current wave ---
  if (waveInProgress) {
    waveTimer += dt;
    while (spawnQueue.length && spawnQueue[0].t <= waveTimer) {
      const s = spawnQueue.shift();
      spawnEnemy(s.typeIdx, 0);
      enemiesRemainingToSpawn--;
    }
  }

  // --- rebuild live-enemy index + spatial hash ---
  liveEnemyIdx.length = 0;
  clearHashGrid();
  for (let i = 0; i < MAX_ENEMIES; i++) {
    if (!EP.active[i]) continue;
    liveEnemyIdx.push(i);
  }

  // --- move enemies ---
  for (let k = 0; k < liveEnemyIdx.length; k++) {
    const i = liveEnemyIdx[k];
    if (EP.slowTimer[i] > 0) {
      EP.slowTimer[i] -= dt;
      if (EP.slowTimer[i] <= 0) EP.speed[i] = EP.baseSpeed[i];
    }
    if (EP.hitFlashTimer[i] > 0) {
      EP.hitFlashTimer[i] -= dt;
    }
    EP.dist[i] += EP.speed[i] * dt;
    if (EP.dist[i] >= TOTAL_PATH_LEN) {
      killEnemy(i, true);
      if (!stressTestActive) {
        health -= 1 + Math.floor(ENEMY_TYPES[ENEMY_KEYS[EP.type[i]]].hp / 40);
        if (health <= 0) { health = 0; triggerGameOver(); }
      }
      continue;
    }
    const p = pointAtDistance(EP.dist[i]);
    EP.x[i] = p.x; EP.y[i] = p.y;
    EP.angle[i] = p.angle;
    insertHash(i, p.x, p.y);
  }

  // --- towers: acquire target, calculate aim angle & fire ---
  for (let ti = 0; ti < towers.length; ti++) {
    const t = towers[ti];
    const stats = towerStats(t);
    t.cooldown -= dt;
    // validate existing target
    if (t.targetEnemy !== -1 && (!EP.active[t.targetEnemy] ||
        dist2(t.x, t.y, EP.x[t.targetEnemy], EP.y[t.targetEnemy]) > stats.range * stats.range)) {
      t.targetEnemy = -1;
    }
    if (t.targetEnemy === -1) {
      const candidates = queryHashCircle(t.x, t.y, stats.range, tmpQueryArr);
      let best = -1, bestDist = Infinity;
      for (let c = 0; c < candidates.length; c++) {
        const ei = candidates[c];
        const d2 = dist2(t.x, t.y, EP.x[ei], EP.y[ei]);
        if (d2 <= stats.range * stats.range && d2 < bestDist) {
          bestDist = d2; best = ei;
        }
      }
      t.targetEnemy = best;
    }

    if (t.targetEnemy !== -1 && EP.active[t.targetEnemy]) {
      t.angle = Math.atan2(EP.y[t.targetEnemy] - t.y, EP.x[t.targetEnemy] - t.x);
    }

    if (t.targetEnemy !== -1 && t.cooldown <= 0) {
      t.cooldown = 1 / stats.fireRate;
      const def = TOWER_TYPES[t.typeKey];
      spawnProjectile(t.x, t.y, t.targetEnemy, stats.damage, stats.projSpeed, def.projColor, def.splash, def.slow);
      spawnParticle(t.x + Math.cos(t.angle || 0) * 14, t.y + Math.sin(t.angle || 0) * 14, Math.cos(t.angle || 0) * 60, Math.sin(t.angle || 0) * 60, 3, 0.15, def.projColor);
    }
  }

  // --- projectiles: move + collide ---
  for (let i = 0; i < MAX_PROJECTILES; i++) {
    if (!PP.active[i]) continue;
    PP.life[i] -= dt;
    const target = PP.targetEnemy[i];
    if (target !== -1 && EP.active[target]) {
      const dx = EP.x[target] - PP.x[i], dy = EP.y[target] - PP.y[i];
      const d = Math.hypot(dx, dy) || 1;
      const speed = Math.hypot(PP.vx[i], PP.vy[i]);
      PP.vx[i] = (dx / d) * speed;
      PP.vy[i] = (dy / d) * speed;
    }
    PP.x[i] += PP.vx[i] * dt;
    PP.y[i] += PP.vy[i] * dt;

    let hit = false;
    if (target !== -1 && EP.active[target] && dist2(PP.x[i], PP.y[i], EP.x[target], EP.y[target]) < 14 * 14) {
      hit = true;
    }
    if (!hit && PP.life[i] <= 0) hit = true;
    if (!hit && (PP.x[i] < -20 || PP.x[i] > CANVAS_W + 20 || PP.y[i] < -20 || PP.y[i] > CANVAS_H + 20)) hit = true;

    if (hit) {
      if (target !== -1 && EP.active[target] && dist2(PP.x[i], PP.y[i], EP.x[target], EP.y[target]) < 20 * 20) {
        applyDamage(target, PP.damage[i], PP.slow[i]);
        spawnHitBurst(PP.x[i], PP.y[i], PP.color[i], 6);
      }
      if (PP.splash[i] > 0) {
        spawnHitBurst(PP.x[i], PP.y[i], '#ffcf8a', 14);
        const nearby = queryHashCircle(PP.x[i], PP.y[i], PP.splash[i], tmpQueryArr);
        for (let c = 0; c < nearby.length; c++) {
          const ei = nearby[c];
          if (ei === target) continue;
          if (dist2(PP.x[i], PP.y[i], EP.x[ei], EP.y[ei]) <= PP.splash[i] * PP.splash[i]) {
            applyDamage(ei, PP.damage[i] * 0.6, PP.slow[i]);
          }
        }
      }
      PP.active[i] = 0;
      PP.freeList.push(i);
    }
  }

  // --- particles physics update ---
  for (let i = 0; i < MAX_PARTICLES; i++) {
    if (!FX.active[i]) continue;
    FX.life[i] -= dt;
    if (FX.life[i] <= 0) {
      FX.active[i] = 0;
      FX.freeList.push(i);
      continue;
    }
    FX.x[i] += FX.vx[i] * dt;
    FX.y[i] += FX.vy[i] * dt;
  }

  // --- text popups physics update ---
  for (let i = 0; i < MAX_TEXTS; i++) {
    if (!TXP.active[i]) continue;
    TXP.life[i] -= dt;
    if (TXP.life[i] <= 0) {
      TXP.active[i] = 0;
      TXP.freeList.push(i);
      continue;
    }
    TXP.y[i] += TXP.vy[i] * dt;
  }

  // --- wave completion check ---
  if (waveInProgress && enemiesRemainingToSpawn <= 0 && countActiveEnemies() === 0) {
    waveInProgress = false;
    gold += 15 + waveNumber * 3;
    if (waveNumber >= TOTAL_WAVES) triggerVictory();
    updateWaveButtonState();
  }
}

function applyDamage(idx, dmg, slow) {
  const def = ENEMY_TYPES[ENEMY_KEYS[EP.type[idx]]];
  const effective = Math.max(1, dmg - def.armor);
  EP.hp[idx] -= effective;
  EP.hitFlashTimer[idx] = 0.12; // 120ms hit flash + pulse
  if (slow > 0) {
    EP.speed[idx] = EP.baseSpeed[idx] * (1 - slow);
    EP.slowTimer[idx] = 1.2;
  }
  if (EP.hp[idx] <= 0) killEnemy(idx, false);
}

function dist2(x1, y1, x2, y2) { const dx = x1 - x2, dy = y1 - y2; return dx * dx + dy * dy; }
function countActiveEnemies() { let n = 0; for (let i = 0; i < MAX_ENEMIES; i++) if (EP.active[i]) n++; return n; }

function triggerGameOver() {
  gameOver = true;
  showOverlay('Game Over', `You survived to wave ${waveNumber} with a score of ${score}.`);
}
function triggerVictory() {
  victory = true;
  showOverlay('Victory!', `All ${TOTAL_WAVES} waves defeated! Final score: ${score}.`);
}

/* ---------------------------------------------------------------------
   10. MAIN LOOP — one rAF (render) + fixed-step accumulator (simulation)
   --------------------------------------------------------------------- */
let lastTime = performance.now();
let accumulator = 0;
const MAX_STEPS_PER_FRAME = 8;

let frameTimes = [];
let fpsSmoothed = 60;
let overThresholdCount = 0;
let totalFrameCount = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let delta = (now - lastTime) / 1000;
  lastTime = now;
  if (delta > 0.25) delta = 0.25;

  const frameStart = performance.now();

  if (!paused && !gameOver && !victory) {
    accumulator += delta * gameSpeed;
    let steps = 0;
    while (accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME * gameSpeed) {
      simTick(FIXED_DT);
      accumulator -= FIXED_DT;
      steps++;
    }
  }

  render();

  const frameMs = performance.now() - frameStart;
  trackPerf(delta, frameMs);
  updateHud();
}

function trackPerf(delta, frameMs) {
  totalFrameCount++;
  const instFps = delta > 0 ? 1 / delta : 60;
  fpsSmoothed += (instFps - fpsSmoothed) * 0.08;
  if (frameMs > 33) overThresholdCount++;
  frameTimes.push(frameMs);
  if (frameTimes.length > 300) frameTimes.shift();
}

/* ---------------------------------------------------------------------
   11. RENDERING  (batched by type, culled to viewport)
   --------------------------------------------------------------------- */
function render() {
  ctx.drawImage(bgCanvas, 0, 0);

  // Range preview while placing
  if (selectedBuildType && hoverTile) {
    const stats = TOWER_TYPES[selectedBuildType].levels[0];
    ctx.beginPath();
    ctx.arc(hoverTile.px, hoverTile.py, stats.range, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(62,166,255,0.08)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(62,166,255,0.5)';
    ctx.stroke();
  }

  // Draw Towers
  for (let i = 0; i < towers.length; i++) {
    const t = towers[i];
    if (t.x < -30 || t.x > CANVAS_W + 30 || t.y < -30 || t.y > CANVAS_H + 30) continue;
    drawTower(t);
  }

  if (selectedTowerId) {
    const t = towers.find(tw => tw.id === selectedTowerId);
    if (t) {
      const stats = towerStats(t);
      ctx.beginPath();
      ctx.arc(t.x, t.y, stats.range, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(34,211,165,0.6)';
      ctx.stroke();
      ctx.strokeStyle = '#22d3a5';
      ctx.lineWidth = 2;
      ctx.strokeRect(t.x - CELL / 2 + 2, t.y - CELL / 2 + 2, CELL - 4, CELL - 4);
      ctx.lineWidth = 1;
    }
  }

  // Draw Enemies
  for (let k = 0; k < liveEnemyIdx.length; k++) {
    const i = liveEnemyIdx[k];
    const x = EP.x[i], y = EP.y[i];
    if (x < -20 || x > CANVAS_W + 20 || y < -20 || y > CANVAS_H + 20) continue;
    drawEnemy(i);
  }

  // Health bars for damaged enemies
  ctx.lineWidth = 3;
  for (let k = 0; k < liveEnemyIdx.length; k++) {
    const i = liveEnemyIdx[k];
    if (EP.hp[i] >= EP.maxHp[i]) continue;
    const x = EP.x[i], y = EP.y[i];
    if (x < -20 || x > CANVAS_W + 20 || y < -20 || y > CANVAS_H + 20) continue;
    const w = 18, ratio = Math.max(0, EP.hp[i] / EP.maxHp[i]);
    const barY = y - 16;
    ctx.strokeStyle = 'rgba(10, 15, 25, 0.8)';
    ctx.beginPath(); ctx.moveTo(x - w / 2, barY); ctx.lineTo(x + w / 2, barY); ctx.stroke();
    ctx.strokeStyle = ratio > 0.5 ? '#22d3a5' : ratio > 0.25 ? '#ffb84d' : '#ff4d6d';
    ctx.beginPath(); ctx.moveTo(x - w / 2, barY); ctx.lineTo(x - w / 2 + w * ratio, barY); ctx.stroke();
  }
  ctx.lineWidth = 1;

  // Projectiles (two-tone directional energy slugs)
  for (let i = 0; i < MAX_PROJECTILES; i++) {
    if (!PP.active[i]) continue;
    const x = PP.x[i], y = PP.y[i];
    if (x < -10 || x > CANVAS_W + 10 || y < -10 || y > CANVAS_H + 10) continue;
    const ang = Math.atan2(PP.vy[i], PP.vx[i]);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.fillStyle = PP.color[i];
    ctx.beginPath();
    ctx.ellipse(0, 0, 6, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(2, 0, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Particles
  for (let i = 0; i < MAX_PARTICLES; i++) {
    if (!FX.active[i]) continue;
    const ratio = FX.life[i] / FX.maxLife[i];
    ctx.fillStyle = FX.color[i];
    ctx.globalAlpha = ratio;
    ctx.beginPath();
    ctx.arc(FX.x[i], FX.y[i], FX.size[i] * ratio, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1.0;

  // Floating Text Popups
  ctx.font = 'bold 12px Plus Jakarta Sans, sans-serif';
  ctx.textAlign = 'center';
  for (let i = 0; i < MAX_TEXTS; i++) {
    if (!TXP.active[i]) continue;
    const ratio = TXP.life[i] / TXP.maxLife[i];
    ctx.fillStyle = TXP.color[i];
    ctx.globalAlpha = ratio;
    ctx.fillText(TXP.text[i], TXP.x[i], TXP.y[i]);
  }
  ctx.globalAlpha = 1.0;
}

function drawTower(t) {
  const def = TOWER_TYPES[t.typeKey];
  ctx.save();
  ctx.translate(t.x, t.y);

  // Soft drop shadow ground blob under tower
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.beginPath();
  ctx.ellipse(0, 6, CELL * 0.44, CELL * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();

  // Metallic octagon base plate with two-tone shading
  const r = CELL / 2 - 3;
  ctx.fillStyle = '#141f33';
  ctx.strokeStyle = '#34486d';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let a = 0; a < 8; a++) {
    const ang = (a * Math.PI) / 4 + Math.PI / 8;
    const bx = Math.cos(ang) * r, by = Math.sin(ang) * r;
    if (a === 0) ctx.moveTo(bx, by); else ctx.lineTo(bx, by);
  }
  ctx.closePath();
  ctx.fill(); ctx.stroke();

  // Base top-half two-tone highlight
  ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.beginPath();
  ctx.rect(-r + 2, -r + 2, (r - 2) * 2, r - 2);
  ctx.fill();

  // Corner rivets
  ctx.fillStyle = '#42577d';
  ctx.fillRect(-r + 2, -r + 2, 2, 2);
  ctx.fillRect(r - 4, -r + 2, 2, 2);
  ctx.fillRect(-r + 2, r - 4, 2, 2);
  ctx.fillRect(r - 4, r - 4, 2, 2);

  // Level star badges
  if (t.level > 0) {
    ctx.fillStyle = '#ffd166';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('★'.repeat(t.level), 0, r - 2);
  }

  // Rotate turret head toward enemy target angle
  const angle = t.angle || 0;
  ctx.rotate(angle);

  if (t.typeKey === 'arrow') {
    // Dual plasma ballista turret (two-tone cyan)
    ctx.fillStyle = '#162845';
    ctx.fillRect(-8, -9, 16, 18);
    // Upper & Lower Barrels with shadow edges
    ctx.fillStyle = '#1d629a';
    ctx.fillRect(0, -7, 14, 5);
    ctx.fillRect(0, 1, 14, 5);
    ctx.fillStyle = '#3ea6ff';
    ctx.fillRect(0, -6, 14, 3);
    ctx.fillRect(0, 2, 14, 3);
    // Glowing plasma tips
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(12, -6, 3, 3);
    ctx.fillRect(12, 2, 3, 3);
    // Core strip
    ctx.fillStyle = '#8fd0ff';
    ctx.fillRect(-4, -2, 6, 4);
  } else if (t.typeKey === 'cannon') {
    // Heavy cannon mortar (two-tone amber/bronze)
    ctx.fillStyle = '#26221c';
    ctx.fillRect(-9, -10, 18, 20);
    // Heavy dark barrel with top highlight
    ctx.fillStyle = '#2d2822';
    ctx.fillRect(-2, -6, 16, 12);
    ctx.fillStyle = '#5c5347';
    ctx.fillRect(-2, -5, 16, 6);
    // Muzzle ring & glowing core
    ctx.fillStyle = '#ffb84d';
    ctx.fillRect(11, -6, 3, 12);
    ctx.fillStyle = '#ff9f1c';
    ctx.beginPath(); ctx.arc(-2, 0, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(-3, -1, 1.5, 0, Math.PI * 2); ctx.fill();
  } else if (t.typeKey === 'frost') {
    // Cryo spire gem (two-tone ice blue with floating rotation)
    ctx.fillStyle = 'rgba(126, 232, 250, 0.2)';
    ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fill();
    // Dark pedestal shadow
    ctx.fillStyle = '#1c505c';
    ctx.beginPath();
    ctx.moveTo(9, 0); ctx.lineTo(0, 11); ctx.lineTo(-9, 0);
    ctx.closePath(); ctx.fill();
    // Bright top facet
    ctx.fillStyle = '#7ee8fa';
    ctx.beginPath();
    ctx.moveTo(9, 0); ctx.lineTo(0, -11); ctx.lineTo(-9, 0);
    ctx.closePath(); ctx.fill();
    // Diamond core facet
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(4, 0); ctx.lineTo(0, -5); ctx.lineTo(-4, 0); ctx.lineTo(0, 5);
    ctx.closePath(); ctx.fill();
  } else if (t.typeKey === 'sniper') {
    // Railgun sniper (two-tone electromagnetic purple)
    ctx.fillStyle = '#1f152d';
    ctx.beginPath();
    ctx.moveTo(8, 0); ctx.lineTo(-8, -9); ctx.lineTo(-8, 9);
    ctx.closePath(); ctx.fill();
    // Dual magnetic rail barrels with highlight
    ctx.fillStyle = '#502a6c';
    ctx.fillRect(2, -5, 18, 3.5);
    ctx.fillRect(2, 1.5, 18, 3.5);
    ctx.fillStyle = '#c792ea';
    ctx.fillRect(2, -4, 18, 2);
    ctx.fillRect(2, 2, 18, 2);
    // Purple beam core
    ctx.fillStyle = '#e6c9ff';
    ctx.fillRect(-4, -1.5, 8, 3);
  }

  ctx.restore();

  // Railgun Laser Sight Line pointing toward target
  if (t.typeKey === 'sniper' && t.targetEnemy !== -1 && EP.active[t.targetEnemy]) {
    ctx.strokeStyle = 'rgba(199, 146, 234, 0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(t.x, t.y);
    ctx.lineTo(EP.x[t.targetEnemy], EP.y[t.targetEnemy]);
    ctx.stroke();
  }
}

function drawEnemy(i) {
  const g = EP.type[i];
  const x = EP.x[i], y = EP.y[i];
  const angle = EP.angle[i] || 0;
  const isHitFlash = EP.hitFlashTimer[i] > 0;

  ctx.save();
  ctx.translate(x, y);

  // Soft drop shadow / ground blob under enemy
  const r = g === 4 ? 14 : (g === 2 ? 10 : 7);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.beginPath();
  ctx.ellipse(2, 5, r * 1.15, r * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();

  // Scale pulse on hit damage
  if (isHitFlash) {
    ctx.scale(1.18, 1.18);
  }

  ctx.rotate(angle);

  if (g === 0) {
    // GRUNT (Battle Bot - two-tone red & steel chassis)
    ctx.fillStyle = '#2a3240';
    ctx.fillRect(-6, -6, 12, 12);
    ctx.fillStyle = '#b84d4d';
    ctx.fillRect(-4, -8, 8, 3);
    ctx.fillRect(-4, 5, 8, 3);
    ctx.fillStyle = '#ff8080';
    ctx.fillRect(-4, -8, 8, 1.5);
    ctx.fillRect(-4, 5, 8, 1.5);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(2, -2, 4, 4);
  } else if (g === 1) {
    // RUNNER (Hover Speeder - two-tone yellow)
    ctx.fillStyle = '#c29b1d';
    ctx.beginPath();
    ctx.moveTo(9, 0); ctx.lineTo(-7, -6); ctx.lineTo(-4, 0); ctx.lineTo(-7, 6);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffe066';
    ctx.beginPath();
    ctx.moveTo(9, 0); ctx.lineTo(-7, -3); ctx.lineTo(-4, 0); ctx.lineTo(-7, 3);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ff9f1c';
    ctx.beginPath(); ctx.arc(-7, 0, 3, 0, Math.PI * 2); ctx.fill();
  } else if (g === 2) {
    // TANK (Armored Tank - two-tone purple armor)
    ctx.fillStyle = '#191e28';
    ctx.fillRect(-10, -10, 20, 4);
    ctx.fillRect(-10, 6, 20, 4);
    ctx.fillStyle = '#6c50c4';
    ctx.fillRect(-8, -7, 16, 14);
    ctx.fillStyle = '#a78bfa';
    ctx.fillRect(-8, -7, 16, 7);
    ctx.fillStyle = '#6d28d9';
    ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ddd6fe';
    ctx.fillRect(0, -2, 10, 4);
  } else if (g === 3) {
    // SWARM (Cryo Shard - two-tone mint crystal)
    ctx.fillStyle = '#269973';
    ctx.beginPath();
    ctx.moveTo(7, 0); ctx.lineTo(0, -6); ctx.lineTo(-7, 0); ctx.lineTo(0, 6);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#66ffcc';
    ctx.beginPath();
    ctx.moveTo(7, 0); ctx.lineTo(0, -3); ctx.lineTo(-7, 0); ctx.lineTo(0, 3);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(3, 0); ctx.lineTo(0, -2); ctx.lineTo(-3, 0); ctx.lineTo(0, 2);
    ctx.closePath(); ctx.fill();
  } else if (g === 4) {
    // BOSS (Mech Dreadnought - two-tone red & slate)
    ctx.fillStyle = '#151d2a';
    ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ff4d6d';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ff4d6d';
    ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(2, -2, 3, 0, Math.PI * 2); ctx.fill();
  }

  // Hit-flash white overlay when damaged
  if (isHitFlash) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.beginPath();
    ctx.arc(0, 0, r + 2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/* ---------------------------------------------------------------------
   12. UI WIRING
   --------------------------------------------------------------------- */
const el = id => document.getElementById(id);

function buildTowerShop() {
  const list = el('tower-list');
  list.innerHTML = '';
  TOWER_KEYS.forEach(key => {
    const def = TOWER_TYPES[key];
    const card = document.createElement('div');
    card.className = 'tower-card';
    card.dataset.key = key;
    card.innerHTML = `
      <div class="tower-card-top">
        <span><span class="tower-swatch" style="background:${def.color}"></span>${def.name}</span>
        <span class="tower-cost">${def.cost}g</span>
      </div>
      <div class="tower-desc">${def.desc}</div>`;
    card.addEventListener('click', () => {
      selectedBuildType = selectedBuildType === key ? null : key;
      selectedTowerId = null;
      refreshShopSelection();
      refreshSelectionPanel();
    });
    list.appendChild(card);
  });
}
function refreshShopSelection() {
  document.querySelectorAll('.tower-card').forEach(c => {
    c.classList.toggle('active', c.dataset.key === selectedBuildType);
    c.classList.toggle('disabled', gold < TOWER_TYPES[c.dataset.key].cost);
  });
}

function buildEnemyLegend() {
  const wrap = el('enemy-legend');
  wrap.innerHTML = '';
  ENEMY_KEYS.forEach(key => {
    const def = ENEMY_TYPES[key];
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<span class="dot" style="background:${def.color}"></span>${def.name} — ${def.hp}hp, ${def.speed}spd`;
    wrap.appendChild(row);
  });
}

function refreshSelectionPanel() {
  const panel = el('selection-panel');
  if (!selectedTowerId) { panel.classList.add('hidden'); return; }
  const t = towers.find(tw => tw.id === selectedTowerId);
  if (!t) { panel.classList.add('hidden'); selectedTowerId = null; return; }
  panel.classList.remove('hidden');
  const def = TOWER_TYPES[t.typeKey];
  const stats = towerStats(t);
  const maxLevel = t.level >= def.levels.length - 1;
  const upgradeCost = maxLevel ? null : Math.round(def.cost * UPGRADE_COST_MULT * (t.level + 1) + def.cost * 0.5);
  el('sel-info').innerHTML = `
    <div>Type <b>${def.name}</b></div>
    <div>Level <b>${t.level + 1} / ${def.levels.length}</b></div>
    <div>Damage <b>${stats.damage}</b></div>
    <div>Range <b>${stats.range}</b></div>
    <div>Fire rate <b>${stats.fireRate.toFixed(2)}/s</b></div>
    ${def.splash ? `<div>Splash <b>${def.splash}px</b></div>` : ''}
    ${def.slow ? `<div>Slow <b>${Math.round(def.slow * 100)}%</b></div>` : ''}
    <div>Sell value <b>${Math.round(towerSpent(t) * SELL_REFUND)}g</b></div>`;
  const upBtn = el('btn-upgrade');
  upBtn.disabled = maxLevel || gold < upgradeCost;
  upBtn.textContent = maxLevel ? 'Max Level' : `Upgrade (${upgradeCost}g)`;
  upBtn.onclick = upgradeSelectedTower;
  el('btn-sell').onclick = sellSelectedTower;
}

function upgradeSelectedTower() {
  if (!selectedTowerId) return;
  const t = towers.find(tw => tw.id === selectedTowerId);
  if (!t) return;
  const def = TOWER_TYPES[t.typeKey];
  const maxLevel = t.level >= def.levels.length - 1;
  if (maxLevel) return;
  const upgradeCost = Math.round(def.cost * UPGRADE_COST_MULT * (t.level + 1) + def.cost * 0.5);
  if (gold < upgradeCost) return;

  gold -= upgradeCost;
  t.level++;
  refreshSelectionPanel();
  refreshShopSelection();
  updateHud();
}

function sellSelectedTower() {
  if (!selectedTowerId) return;
  const t = towers.find(tw => tw.id === selectedTowerId);
  if (!t) return;

  const refund = Math.round(towerSpent(t) * SELL_REFUND);
  gold += refund;
  towers = towers.filter(tw => tw.id !== t.id);
  selectedTowerId = null;
  refreshSelectionPanel();
  refreshShopSelection();
  updateHud();
}

function towerSpent(t) {
  const def = TOWER_TYPES[t.typeKey];
  let spent = def.cost;
  for (let l = 1; l <= t.level; l++) spent += Math.round(def.cost * UPGRADE_COST_MULT * l + def.cost * 0.5);
  return spent;
}

function screenToTile(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width, scaleY = canvas.height / rect.height;
  const x = (clientX - rect.left) * scaleX, y = (clientY - rect.top) * scaleY;
  const gx = Math.floor(x / CELL), gy = Math.floor(y / CELL);
  return { gx, gy, px: gx * CELL + CELL / 2, py: gy * CELL + CELL / 2, x, y };
}

canvas.addEventListener('mousemove', e => {
  hoverTile = selectedBuildType ? screenToTile(e.clientX, e.clientY) : null;
});
canvas.addEventListener('mouseleave', () => { hoverTile = null; });

canvas.addEventListener('click', e => {
  const tile = screenToTile(e.clientX, e.clientY);
  const existing = towers.find(t => t.gx === tile.gx && t.gy === tile.gy);

  if (selectedBuildType) {
    if (existing) {
      selectedBuildType = null;
      selectedTowerId = existing.id;
      refreshShopSelection();
      refreshSelectionPanel();
      return;
    }
    tryPlaceTower(tile);
    return;
  }
  selectedTowerId = existing ? existing.id : null;
  refreshSelectionPanel();
});

function tryPlaceTower(tile) {
  if (tile.gx < 0 || tile.gx >= GRID_W || tile.gy < 0 || tile.gy >= GRID_H) return;
  if (blockedTiles.has(tileKey(tile.gx, tile.gy))) return;
  if (towers.some(t => t.gx === tile.gx && t.gy === tile.gy)) return;
  if (towers.length >= MAX_TOWERS) return;
  const def = TOWER_TYPES[selectedBuildType];
  if (gold < def.cost) return;
  gold -= def.cost;
  towers.push({
    id: towerIdSeq++, typeKey: selectedBuildType, level: 0,
    gx: tile.gx, gy: tile.gy, x: tile.px, y: tile.py,
    cooldown: 0, targetEnemy: -1
  });
  refreshShopSelection();
  updateHud();
}

function showOverlay(title, sub) {
  el('overlay-title').textContent = title;
  el('overlay-sub').textContent = sub;
  const isVic = victory || title.toLowerCase().includes('victory');
  el('overlay').classList.toggle('victory', isVic);
  el('overlay').classList.toggle('defeat', !isVic);
  el('overlay').classList.remove('hidden');
}
function hideOverlay() {
  el('overlay').classList.add('hidden');
  el('overlay').classList.remove('victory', 'defeat');
}

function updateWaveButtonState() {
  const btn = el('btn-start-wave');
  btn.disabled = waveInProgress || gameOver || victory || waveNumber >= TOTAL_WAVES;
  btn.textContent = waveInProgress ? `Wave ${waveNumber} in progress…` : `▶ Send Wave ${waveNumber + 1}`;
}

function updateHud() {
  el('val-health').textContent = health;
  el('val-gold').textContent = gold;
  el('val-score').textContent = score;
  el('val-wave').textContent = waveNumber;
  el('val-wave-total').textContent = TOTAL_WAVES;
  el('hud-fps').textContent = fpsSmoothed.toFixed(0);
  const lastFrame = frameTimes.length ? frameTimes[frameTimes.length - 1] : 0;
  el('hud-frame').textContent = lastFrame.toFixed(1);
  el('hud-enemies').textContent = liveEnemyIdx.length;
  let projCount = 0; for (let i = 0; i < MAX_PROJECTILES; i++) if (PP.active[i]) projCount++;
  el('hud-proj').textContent = projCount;
  el('hud-towers').textContent = towers.length;
  el('hud-slow').textContent = totalFrameCount ? ((overThresholdCount / totalFrameCount) * 100).toFixed(2) : '0.00';
  refreshShopSelection();
}

el('btn-pause').addEventListener('click', () => {
  paused = !paused;
  el('btn-pause').textContent = paused ? '▶' : '⏸';
});
el('btn-speed').addEventListener('click', () => {
  gameSpeed = gameSpeed === 1 ? 2 : gameSpeed === 2 ? 4 : 1;
  el('btn-speed').textContent = gameSpeed + 'x';
});
el('btn-start-wave').addEventListener('click', startWave);
el('btn-restart').addEventListener('click', resetGame);
el('overlay-restart').addEventListener('click', resetGame);
el('btn-stress').addEventListener('click', () => {
  hideOverlay();
  runStressTest();
});

function resetGame() {
  rebuildPath();
  // clear pools
  for (let i = 0; i < MAX_ENEMIES; i++) EP.active[i] = 0;
  EP.freeList = (() => { const a = new Array(MAX_ENEMIES); for (let i = 0; i < MAX_ENEMIES; i++) a[i] = MAX_ENEMIES - 1 - i; return a; })();
  for (let i = 0; i < MAX_PROJECTILES; i++) PP.active[i] = 0;
  PP.freeList = (() => { const a = new Array(MAX_PROJECTILES); for (let i = 0; i < MAX_PROJECTILES; i++) a[i] = MAX_PROJECTILES - 1 - i; return a; })();
  for (let i = 0; i < MAX_PARTICLES; i++) FX.active[i] = 0;
  FX.freeList = (() => { const a = new Array(MAX_PARTICLES); for (let i = 0; i < MAX_PARTICLES; i++) a[i] = MAX_PARTICLES - 1 - i; return a; })();
  for (let i = 0; i < MAX_TEXTS; i++) TXP.active[i] = 0;
  TXP.freeList = (() => { const a = new Array(MAX_TEXTS); for (let i = 0; i < MAX_TEXTS; i++) a[i] = MAX_TEXTS - 1 - i; return a; })();
  towers = [];
  liveEnemyIdx = [];
  gold = STARTING_GOLD; health = STARTING_HEALTH; score = 0; waveNumber = 0;
  waveInProgress = false; spawnQueue = []; enemiesRemainingToSpawn = 0;
  gameOver = false; victory = false; paused = false; gameSpeed = 1;
  selectedBuildType = null; selectedTowerId = null; stressTestActive = false;
  frameTimes = []; overThresholdCount = 0; totalFrameCount = 0; fpsSmoothed = 60;
  el('btn-speed').textContent = '1x';
  el('btn-pause').textContent = '⏸';
  hideOverlay();
  refreshShopSelection();
  refreshSelectionPanel();
  updateWaveButtonState();
}

/* ---------------------------------------------------------------------
   13. BOOT
   --------------------------------------------------------------------- */
rebuildPath();
buildTowerShop();
buildEnemyLegend();
updateWaveButtonState();
requestAnimationFrame(frame);

// ═══════════════════════════════════════════════════
//  B A T T L E C L A W  —  Spectator Client
// ═══════════════════════════════════════════════════

const TILE_SIZE = 16;
const MAP_WIDTH = 50;
const MAP_HEIGHT = 50;

let tickCount = 0;
let ws = null;
let trackedAgentName = null;
let latestAgents = [];
let sprites = null;
let pulseAnimId = null;
let safeHaven = null; // { x1, y1, x2, y2 }

// ── Sprite Generation ────────────────────────────

function createSprite(drawFn) {
  const c = document.createElement('canvas');
  c.width = TILE_SIZE;
  c.height = TILE_SIZE;
  const ctx = c.getContext('2d');
  drawFn(ctx, TILE_SIZE);
  return c;
}

function generateSprites() {
  const S = TILE_SIZE;
  const s = {};

  // Pseudo-random seeded by position for consistent noise
  function noise(x, y, base) {
    return base + ((x * 7 + y * 13 + 37) % 5) - 2;
  }

  // Open ground — dark earthy tile with subtle pixel noise
  s.ground = createSprite((ctx) => {
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const v = noise(x, y, 28);
        ctx.fillStyle = `rgb(${v + 6}, ${v + 4}, ${v - 2})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  });

  // Wall — gray stone brick pattern
  s.wall = createSprite((ctx) => {
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(0, 0, S, S);
    // Brick lines
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, 4, S, 1);
    ctx.fillRect(0, 9, S, 1);
    ctx.fillRect(0, 14, S, 1);
    // Vertical mortar offsets
    ctx.fillRect(4, 0, 1, 4);
    ctx.fillRect(11, 0, 1, 4);
    ctx.fillRect(8, 5, 1, 4);
    ctx.fillRect(14, 5, 1, 4);
    ctx.fillRect(3, 10, 1, 4);
    ctx.fillRect(10, 10, 1, 4);
    // Highlight pixels
    ctx.fillStyle = '#4a4a4a';
    ctx.fillRect(1, 1, 2, 1);
    ctx.fillRect(6, 1, 3, 1);
    ctx.fillRect(13, 1, 2, 1);
    ctx.fillRect(3, 6, 3, 1);
    ctx.fillRect(10, 6, 3, 1);
    ctx.fillRect(1, 11, 1, 1);
    ctx.fillRect(5, 11, 3, 1);
    ctx.fillRect(12, 11, 2, 1);
  });

  // Water — blue tile with wave-line detail
  s.water = createSprite((ctx) => {
    ctx.fillStyle = '#1a3366';
    ctx.fillRect(0, 0, S, S);
    // Wave highlights
    ctx.fillStyle = '#2a55aa';
    ctx.fillRect(2, 4, 4, 1);
    ctx.fillRect(9, 4, 3, 1);
    ctx.fillRect(5, 8, 5, 1);
    ctx.fillRect(12, 8, 3, 1);
    ctx.fillRect(1, 12, 3, 1);
    ctx.fillRect(8, 12, 4, 1);
    // Bright wave crests
    ctx.fillStyle = '#4477cc';
    ctx.fillRect(3, 3, 2, 1);
    ctx.fillRect(10, 7, 2, 1);
    ctx.fillRect(6, 11, 2, 1);
  });

  // Mountain — brown peaked terrain on ground
  s.mountain = createSprite((ctx) => {
    // Ground base
    ctx.fillStyle = '#1e1a14';
    ctx.fillRect(0, 0, S, S);
    // Mountain body
    ctx.fillStyle = '#6b4c2a';
    // Triangle-ish peak
    const peak = [
      [7, 2], [8, 2],
      [6, 3], [7, 3], [8, 3], [9, 3],
      [5, 4], [6, 4], [7, 4], [8, 4], [9, 4], [10, 4],
      [4, 5], [5, 5], [6, 5], [7, 5], [8, 5], [9, 5], [10, 5], [11, 5],
    ];
    for (const [px, py] of peak) ctx.fillRect(px, py, 1, 1);
    // Lower slopes
    ctx.fillStyle = '#5a3e22';
    for (let x = 3; x <= 12; x++) ctx.fillRect(x, 6, 1, 1);
    for (let x = 2; x <= 13; x++) ctx.fillRect(x, 7, 1, 1);
    for (let x = 1; x <= 14; x++) ctx.fillRect(x, 8, 1, 1);
    for (let x = 1; x <= 14; x++) ctx.fillRect(x, 9, 1, 1);
    // Lower fill
    ctx.fillStyle = '#4a3520';
    for (let y = 10; y < S; y++) {
      for (let x = 0; x < S; x++) ctx.fillRect(x, y, 1, 1);
    }
    // Snow cap
    ctx.fillStyle = '#ddeeff';
    ctx.fillRect(7, 2, 2, 1);
    ctx.fillRect(7, 3, 1, 1);
  });

  // Helper: draw ground then overlay
  function groundWith(overlayFn) {
    return createSprite((ctx) => {
      ctx.drawImage(s.ground, 0, 0);
      overlayFn(ctx);
    });
  }

  // Energy Crystal — yellow gem shape on ground
  s.energy = groundWith((ctx) => {
    ctx.fillStyle = '#ccaa00';
    // Diamond shape
    ctx.fillRect(7, 3, 2, 1);
    ctx.fillRect(6, 4, 4, 1);
    ctx.fillRect(5, 5, 6, 1);
    ctx.fillRect(5, 6, 6, 1);
    ctx.fillRect(5, 7, 6, 1);
    ctx.fillRect(6, 8, 4, 1);
    ctx.fillRect(6, 9, 4, 1);
    ctx.fillRect(7, 10, 2, 1);
    // Bright highlights
    ctx.fillStyle = '#ffee44';
    ctx.fillRect(7, 4, 1, 1);
    ctx.fillRect(6, 5, 2, 1);
    ctx.fillRect(6, 6, 1, 1);
    // Dark facet
    ctx.fillStyle = '#997700';
    ctx.fillRect(9, 7, 2, 1);
    ctx.fillRect(8, 8, 2, 1);
    ctx.fillRect(8, 9, 1, 1);
  });

  // Metal Ore — gray angular rock on ground
  s.metal = groundWith((ctx) => {
    ctx.fillStyle = '#777777';
    ctx.fillRect(4, 6, 8, 6);
    ctx.fillRect(5, 5, 6, 1);
    ctx.fillRect(6, 4, 4, 1);
    // Highlight
    ctx.fillStyle = '#999999';
    ctx.fillRect(5, 5, 3, 1);
    ctx.fillRect(4, 6, 2, 2);
    // Shadow
    ctx.fillStyle = '#555555';
    ctx.fillRect(10, 8, 2, 4);
    ctx.fillRect(6, 11, 6, 1);
    // Sparkle
    ctx.fillStyle = '#cccccc';
    ctx.fillRect(6, 6, 1, 1);
    ctx.fillRect(9, 8, 1, 1);
  });

  // Biomass — green plant/sprout on ground
  s.biomass = groundWith((ctx) => {
    // Stem
    ctx.fillStyle = '#227722';
    ctx.fillRect(7, 6, 2, 6);
    // Leaves
    ctx.fillStyle = '#33aa33';
    ctx.fillRect(6, 4, 4, 2);
    ctx.fillRect(5, 3, 6, 2);
    ctx.fillRect(7, 2, 2, 1);
    // Right leaf
    ctx.fillRect(9, 6, 3, 2);
    ctx.fillRect(10, 5, 2, 1);
    // Left leaf
    ctx.fillRect(4, 7, 3, 2);
    ctx.fillRect(4, 6, 2, 1);
    // Highlights
    ctx.fillStyle = '#55cc55';
    ctx.fillRect(7, 2, 1, 1);
    ctx.fillRect(6, 3, 1, 1);
    ctx.fillRect(10, 5, 1, 1);
    ctx.fillRect(4, 7, 1, 1);
  });

  // Artifact — magenta glowing star on ground
  s.artifact = groundWith((ctx) => {
    ctx.fillStyle = '#cc44cc';
    // Star shape — center
    ctx.fillRect(6, 5, 4, 6);
    // Top point
    ctx.fillRect(7, 2, 2, 3);
    // Bottom point
    ctx.fillRect(7, 11, 2, 3);
    // Left point
    ctx.fillRect(2, 7, 4, 2);
    // Right point
    ctx.fillRect(10, 7, 4, 2);
    // Diagonals
    ctx.fillRect(4, 4, 2, 2);
    ctx.fillRect(10, 4, 2, 2);
    ctx.fillRect(4, 10, 2, 2);
    ctx.fillRect(10, 10, 2, 2);
    // Core glow
    ctx.fillStyle = '#ff88ff';
    ctx.fillRect(7, 6, 2, 4);
    ctx.fillRect(6, 7, 4, 2);
    // Bright center
    ctx.fillStyle = '#ffccff';
    ctx.fillRect(7, 7, 2, 2);
  });

  // Agent — bright green figure with cyan marker ring
  s.agent = groundWith((ctx) => {
    // Bright marker ring behind the figure
    ctx.fillStyle = '#00ff88';
    ctx.fillRect(2, 1, 12, 1);
    ctx.fillRect(1, 2, 1, 12);
    ctx.fillRect(14, 2, 1, 12);
    ctx.fillRect(2, 14, 12, 1);
    // Corner pixels
    ctx.fillRect(2, 2, 1, 1);
    ctx.fillRect(13, 2, 1, 1);
    ctx.fillRect(2, 13, 1, 1);
    ctx.fillRect(13, 13, 1, 1);
    // Dark fill inside ring
    ctx.fillStyle = '#0a2a15';
    ctx.fillRect(3, 2, 10, 12);
    ctx.fillRect(2, 3, 12, 10);
    // Figure body — bright green
    ctx.fillStyle = '#33ff99';
    // Head
    ctx.fillRect(6, 3, 4, 3);
    // Neck
    ctx.fillRect(7, 6, 2, 1);
    // Body
    ctx.fillRect(5, 7, 6, 3);
    // Arms
    ctx.fillRect(3, 7, 2, 2);
    ctx.fillRect(11, 7, 2, 2);
    // Legs
    ctx.fillRect(5, 10, 3, 2);
    ctx.fillRect(8, 10, 3, 2);
    // Eyes
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(7, 4, 1, 1);
    ctx.fillRect(9, 4, 1, 1);
  });

  // Tracked Agent — bright yellow/gold figure with glowing ring
  s.trackedAgent = groundWith((ctx) => {
    // Bright marker ring behind the figure
    ctx.fillStyle = '#ffdd00';
    ctx.fillRect(2, 1, 12, 1);
    ctx.fillRect(1, 2, 1, 12);
    ctx.fillRect(14, 2, 1, 12);
    ctx.fillRect(2, 14, 12, 1);
    ctx.fillRect(2, 2, 1, 1);
    ctx.fillRect(13, 2, 1, 1);
    ctx.fillRect(2, 13, 1, 1);
    ctx.fillRect(13, 13, 1, 1);
    // Outer glow ring
    ctx.fillStyle = 'rgba(255, 221, 0, 0.4)';
    ctx.fillRect(1, 0, 14, 1);
    ctx.fillRect(0, 1, 1, 14);
    ctx.fillRect(15, 1, 1, 14);
    ctx.fillRect(1, 15, 14, 1);
    // Dark fill inside ring
    ctx.fillStyle = '#2a2200';
    ctx.fillRect(3, 2, 10, 12);
    ctx.fillRect(2, 3, 12, 10);
    // Figure body — bright gold
    ctx.fillStyle = '#ffee55';
    // Head
    ctx.fillRect(6, 3, 4, 3);
    // Neck
    ctx.fillRect(7, 6, 2, 1);
    // Body
    ctx.fillRect(5, 7, 6, 3);
    // Arms
    ctx.fillRect(3, 7, 2, 2);
    ctx.fillRect(11, 7, 2, 2);
    // Legs
    ctx.fillRect(5, 10, 3, 2);
    ctx.fillRect(8, 10, 3, 2);
    // Eyes
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(7, 4, 1, 1);
    ctx.fillRect(9, 4, 1, 1);
    // Crown/highlight on head
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(7, 3, 2, 1);
  });

  // Safe Haven ground — lighter warm tile with subtle cross pattern
  s.safeHaven = createSprite((ctx) => {
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const v = noise(x, y, 38);
        ctx.fillStyle = `rgb(${v + 8}, ${v + 12}, ${v + 20})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    // Subtle grid lines to distinguish from normal ground
    ctx.fillStyle = 'rgba(100, 140, 200, 0.15)';
    ctx.fillRect(0, 0, S, 1);
    ctx.fillRect(0, 0, 1, S);
  });

  return s;
}

// Map terrain char -> sprite key
const TERRAIN_SPRITES = {
  '.': 'ground',
  '#': 'wall',
  '~': 'water',
  '^': 'mountain',
  '⊕': 'energy',
  '◆': 'metal',
  '♣': 'biomass',
  '★': 'artifact',
};

// ── Legend ────────────────────────────────────────

function buildLegend() {
  const legendEl = document.getElementById('map-legend');
  const items = [
    ['agent', 'agent'],
    ['trackedAgent', 'tracked'],
    ['safeHaven', 'safe haven'],
    ['wall', 'wall'],
    ['water', 'water'],
    ['mountain', 'mountain'],
    ['energy', 'energy'],
    ['metal', 'metal'],
    ['biomass', 'biomass'],
    ['artifact', 'artifact'],
  ];

  legendEl.innerHTML = '';
  items.forEach(([key, label], i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'legend-sep';
      sep.textContent = '│';
      legendEl.appendChild(sep);
    }
    const c = document.createElement('canvas');
    c.width = TILE_SIZE;
    c.height = TILE_SIZE;
    c.style.width = TILE_SIZE + 'px';
    c.style.height = TILE_SIZE + 'px';
    const ctx = c.getContext('2d');
    ctx.drawImage(sprites[key], 0, 0);
    legendEl.appendChild(c);

    const txt = document.createTextNode(' ' + label);
    legendEl.appendChild(txt);
  });
}

// ── Connection ───────────────────────────────────

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/ws`);

  ws.onopen = () => {
    document.getElementById('status-dot').className = 'connected';
    document.getElementById('status-text').textContent = 'CONNECTED';
  };

  ws.onclose = () => {
    document.getElementById('status-dot').className = 'error';
    document.getElementById('status-text').textContent = 'DISCONNECTED';
    setTimeout(connect, 2000);
  };

  ws.onerror = () => {
    document.getElementById('status-dot').className = 'error';
    document.getElementById('status-text').textContent = 'ERROR';
  };

  ws.onmessage = (event) => {
    try {
      const update = JSON.parse(event.data);
      if (update.type === 'tick' || update.type === 'full_state') {
        renderState(update.data);
        tickCount++;
        document.getElementById('tick-counter').textContent = `tick: ${tickCount}`;
      } else if (update.type === 'event') {
        appendEvent(update.data);
      }
    } catch (e) {
      console.error('Parse error:', e);
    }
  };
}

// ── Render State ─────────────────────────────────

let eventsLoaded = false;

function renderState(state) {
  latestAgents = state.agents;
  if (state.safe_haven) safeHaven = state.safe_haven;

  // Load persisted events on first state message
  if (!eventsLoaded && state.events && state.events.length > 0) {
    eventsLoaded = true;
    // Events come newest-first from server — process in reverse to build log correctly
    const sorted = [...state.events].sort((a, b) => a.timestamp - b.timestamp);
    for (const e of sorted) {
      appendEvent(e);
    }
  }

  renderMap(state.map, state.agents);
  renderLeaderboard(state.agents);
  renderAgents(state.agents);
  document.getElementById('agent-count').textContent = `${state.agents.length} agents`;
  document.getElementById('resource-count').textContent = `${state.resources.length} resources`;
  updateTrackStatus();
  scrollToTrackedAgent();
}

// ── Level Decoration Drawing ─────────────────────

// Level tier thresholds and their visual upgrades:
//   1-2: base sprite only
//   3-4: rank pip (small colored diamond at bottom-right)
//   5-6: armor (shoulder guard pixels)
//   7-8: weapon (sword blade pixels on right side)
//   9+:  crown (golden crown above the head)

function drawLevelDecoration(ctx, px, py, level, isTracked) {
  const color = isTracked ? '#ffdd00' : '#00ff88';
  const bright = isTracked ? '#ffffff' : '#aaffcc';

  if (level >= 3) {
    // Rank pip — small diamond at bottom-right
    ctx.fillStyle = color;
    ctx.fillRect(px + 12, py + 12, 2, 2);
    if (level >= 4) {
      ctx.fillRect(px + 11, py + 13, 1, 1);
      ctx.fillRect(px + 14, py + 13, 1, 1);
    }
  }

  if (level >= 5) {
    // Armor — shoulder guard pixels
    ctx.fillStyle = isTracked ? '#ccaa00' : '#009955';
    ctx.fillRect(px + 3, py + 6, 2, 1);
    ctx.fillRect(px + 11, py + 6, 2, 1);
    if (level >= 6) {
      ctx.fillStyle = bright;
      ctx.fillRect(px + 4, py + 6, 1, 1);
      ctx.fillRect(px + 11, py + 6, 1, 1);
    }
  }

  if (level >= 7) {
    // Weapon — sword blade on right side
    ctx.fillStyle = '#cccccc';
    ctx.fillRect(px + 14, py + 5, 1, 4);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(px + 14, py + 4, 1, 1);
    // Crossguard
    ctx.fillStyle = isTracked ? '#ccaa00' : '#009955';
    ctx.fillRect(px + 13, py + 9, 3, 1);
    if (level >= 8) {
      // Longer blade
      ctx.fillStyle = '#dddddd';
      ctx.fillRect(px + 14, py + 3, 1, 1);
    }
  }

  if (level >= 9) {
    // Crown — golden pixels above the head
    ctx.fillStyle = '#ffdd00';
    ctx.fillRect(px + 5, py + 1, 1, 2);
    ctx.fillRect(px + 7, py + 1, 2, 1);
    ctx.fillRect(px + 10, py + 1, 1, 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(px + 6, py + 2, 1, 1);
    ctx.fillRect(px + 8, py + 2, 1, 1);
    ctx.fillRect(px + 9, py + 2, 1, 1);
    if (level >= 10) {
      // Extra crown tips
      ctx.fillStyle = '#ffdd00';
      ctx.fillRect(px + 7, py + 0, 2, 1);
    }
  }
}

// ── Canvas Map Rendering ─────────────────────────

let lastTrackedPos = null;
let aliveAgentSnapshot = []; // cached for pulse animation

function renderMap(map, agents) {
  const canvas = document.getElementById('game-map');
  const ctx = canvas.getContext('2d');

  const h = map.length;
  const w = h > 0 ? map[0].length : 0;

  canvas.width = w * TILE_SIZE;
  canvas.height = h * TILE_SIZE;

  // Draw terrain / resources
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = map[y][x];
      let spriteKey = TERRAIN_SPRITES[ch] || 'ground';
      // Use safe haven ground for open tiles in the zone
      if (spriteKey === 'ground' && safeHaven &&
          x >= safeHaven.x1 && x <= safeHaven.x2 &&
          y >= safeHaven.y1 && y <= safeHaven.y2) {
        spriteKey = 'safeHaven';
      }
      ctx.drawImage(sprites[spriteKey], x * TILE_SIZE, y * TILE_SIZE);
    }
  }

  // Draw agents on top + collect snapshot for animation
  lastTrackedPos = null;
  aliveAgentSnapshot = [];
  for (const a of agents) {
    if (!a.alive) continue;
    const isTracked = trackedAgentName && a.name.toLowerCase() === trackedAgentName.toLowerCase();
    const spriteKey = isTracked ? 'trackedAgent' : 'agent';
    const px = a.x * TILE_SIZE;
    const py = a.y * TILE_SIZE;
    ctx.drawImage(sprites[spriteKey], px, py);
    drawLevelDecoration(ctx, px, py, a.level, isTracked);
    aliveAgentSnapshot.push({ x: a.x, y: a.y, level: a.level, isTracked, spriteKey, name: a.name });
    if (isTracked) {
      lastTrackedPos = { x: a.x, y: a.y };
    }
  }

  // Render persistent name labels
  renderNameLabels(agents);

  // Restart pulse animation
  startPulseAnimation();
}

// ── Persistent Name Labels ───────────────────────

let labelContainer = null;

function renderNameLabels(agents) {
  const container = document.getElementById('game-map-container');

  // Create or reuse the label container (sits on top of canvas)
  if (!labelContainer) {
    labelContainer = document.createElement('div');
    labelContainer.id = 'agent-labels';
    container.appendChild(labelContainer);
  }

  let html = '';
  for (const a of agents) {
    if (!a.alive) continue;
    const isTracked = trackedAgentName && a.name.toLowerCase() === trackedAgentName.toLowerCase();
    const cls = isTracked ? 'agent-label tracked' : 'agent-label';
    const left = a.x * TILE_SIZE + TILE_SIZE / 2;
    const top = a.y * TILE_SIZE - 2;
    html += `<div class="${cls}" style="left:${left}px;top:${top}px">${escapeHtml(a.name)}</div>`;
  }
  labelContainer.innerHTML = html;
}

// ── Agent Pulse Animation ────────────────────────
// All agents get a subtle breathing pulse on their ring.
// Tracked agent gets a stronger, brighter pulse.

let pulsePhase = 0;

function startPulseAnimation() {
  if (pulseAnimId) cancelAnimationFrame(pulseAnimId);
  if (aliveAgentSnapshot.length === 0) { pulseAnimId = null; return; }
  animatePulse();
}

function animatePulse() {
  pulseAnimId = requestAnimationFrame(animatePulse);
  pulsePhase += 0.04;
  if (pulsePhase > Math.PI * 2) pulsePhase -= Math.PI * 2;

  const canvas = document.getElementById('game-map');
  const ctx = canvas.getContext('2d');

  for (const a of aliveAgentSnapshot) {
    const px = a.x * TILE_SIZE;
    const py = a.y * TILE_SIZE;

    // Redraw the agent sprite + level decoration to clear previous frame's pulse
    ctx.drawImage(sprites[a.spriteKey], px, py);
    drawLevelDecoration(ctx, px, py, a.level, a.isTracked);

    if (a.isTracked) {
      // Strong yellow pulse for tracked agent
      const alpha = 0.4 + 0.4 * Math.sin(pulsePhase);
      ctx.strokeStyle = `rgba(255, 221, 0, ${alpha})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
      const glowAlpha = 0.15 + 0.15 * Math.sin(pulsePhase);
      ctx.strokeStyle = `rgba(255, 221, 0, ${glowAlpha})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
    } else {
      // Subtle green pulse for all other agents
      const alpha = 0.15 + 0.2 * Math.sin(pulsePhase);
      ctx.strokeStyle = `rgba(0, 255, 136, ${alpha})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
    }
  }
}

// ── Tooltip on Hover ─────────────────────────────

function initTooltip() {
  const container = document.getElementById('game-map-container');
  const tooltip = document.getElementById('map-tooltip');
  const canvas = document.getElementById('game-map');

  container.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const tileX = Math.floor(mx / TILE_SIZE);
    const tileY = Math.floor(my / TILE_SIZE);

    if (tileX < 0 || tileY < 0 || tileX >= MAP_WIDTH || tileY >= MAP_HEIGHT) {
      tooltip.style.display = 'none';
      return;
    }

    // Find agent at this position
    const agent = latestAgents.find(a => a.alive && a.x === tileX && a.y === tileY);
    if (agent) {
      tooltip.textContent = `${agent.name} (Lv${agent.level}) HP:${agent.hp}/${agent.max_hp}`;
      tooltip.style.display = 'block';
      // Position tooltip near cursor but inside container
      const containerRect = container.getBoundingClientRect();
      tooltip.style.left = (e.clientX - containerRect.left + 12) + 'px';
      tooltip.style.top = (e.clientY - containerRect.top - 8) + 'px';
    } else {
      tooltip.style.display = 'none';
    }
  });

  container.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none';
  });
}

// ── Scroll to Tracked Agent ──────────────────────

function scrollToTrackedAgent() {
  if (!trackedAgentName) return;
  const agent = latestAgents.find(a => a.name.toLowerCase() === trackedAgentName.toLowerCase());
  if (!agent || !agent.alive) return;

  const container = document.getElementById('game-map-container');
  const agentPixelX = agent.x * TILE_SIZE;
  const agentPixelY = agent.y * TILE_SIZE;

  const viewW = container.clientWidth;
  const viewH = container.clientHeight;

  container.scrollLeft = agentPixelX - viewW / 2 + TILE_SIZE / 2;
  container.scrollTop = agentPixelY - viewH / 2 + TILE_SIZE / 2;
}

// ── Leaderboard ──────────────────────────────────

function renderLeaderboard(agents) {
  const sorted = [...agents]
    .sort((a, b) => {
      if (b.kills !== a.kills) return b.kills - a.kills;
      return b.level - a.level;
    })
    .slice(0, 10);

  if (sorted.length === 0) {
    document.getElementById('leaderboard').textContent = 'No agents yet.';
    return;
  }

  let html = '';
  sorted.forEach((a, i) => {
    const rank = i + 1;
    const medal = rank === 1 ? '⚔' : rank === 2 ? '†' : rank === 3 ? '‡' : ' ';
    html += `<div class="lb-row">
      <span class="lb-rank">${medal}${rank}</span>
      <span class="lb-name" data-agent-name="${escapeHtml(a.name)}">${escapeHtml(a.name)}</span>
      <span class="lb-kd">${a.kills}K/${a.deaths}D</span>
      <span class="lb-level">Lv${a.level}</span>
    </div>`;
  });
  document.getElementById('leaderboard').innerHTML = html;
}

// ── Agent Cards ──────────────────────────────────

function renderAgents(agents) {
  if (agents.length === 0) {
    document.getElementById('agents-list').textContent = 'No agents connected.';
    return;
  }

  let html = '';
  for (const a of agents) {
    const hpPct = a.max_hp > 0 ? a.hp / a.max_hp : 0;
    const hpBars = 10;
    const filled = Math.round(hpPct * hpBars);
    const hpBar = `<span class="hp-fill">${'█'.repeat(filled)}</span><span class="hp-empty">${'░'.repeat(hpBars - filled)}</span>`;
    const deadClass = a.alive ? '' : ' agent-dead';

    const isTracked = trackedAgentName && a.name.toLowerCase() === trackedAgentName.toLowerCase();
    const trackedClass = isTracked ? ' agent-card-tracked' : '';

    html += `<div class="agent-card${deadClass}${trackedClass}">
      <span class="agent-name" data-agent-name="${escapeHtml(a.name)}">${escapeHtml(a.name)}</span> <span style="color:#555">Lv${a.level}</span>
      <div class="agent-stats">
        HP: ${a.hp}/${a.max_hp} <span class="hp-bar">${hpBar}</span> | (${a.x},${a.y})
        ${!a.alive ? '<span style="color:#ff4444"> [DEAD]</span>' : ''}
      </div>
      <div class="agent-stats">
        ATK:${a.attack} DEF:${a.defense} | K:${a.kills} D:${a.deaths}
      </div>
    </div>`;
  }
  document.getElementById('agents-list').innerHTML = html;
}

// ── Events ───────────────────────────────────────

const MAX_EVENTS = 100;
const MAX_CHAT = 50;
const eventLines = [];
const chatLines = [];

function appendEvent(event) {
  const line = formatEvent(event);
  if (!line) return;
  eventLines.unshift(line);
  if (eventLines.length > MAX_EVENTS) eventLines.pop();

  const el = document.getElementById('events-log');
  el.innerHTML = eventLines.join('');

  // Also feed chat messages to the chat panel
  if (event.type === 'agent_communicated') {
    appendChat(event);
  }
}

function appendChat(event) {
  const time = new Date(event.timestamp).toLocaleTimeString();
  const name = esc(event.data.name);
  const msg = esc(event.data.message);
  const line = `<div class="chat-msg"><span class="chat-time">[${time}]</span> <span class="chat-name" data-agent-name="${name}">${name}</span>: <span class="chat-text">"${msg}"</span></div>`;
  chatLines.unshift(line);
  if (chatLines.length > MAX_CHAT) chatLines.pop();

  const el = document.getElementById('chat-log');
  el.innerHTML = chatLines.join('');
}

function formatEvent(e) {
  const time = new Date(e.timestamp).toLocaleTimeString();
  const ts = `<span class="event-time">[${time}]</span> `;

  switch (e.type) {
    case 'agent_registered':
      return `<div class="event-line event-register">${ts}+ ${esc(e.data.name)} entered the arena</div>`;
    case 'agent_killed':
      return `<div class="event-line event-kill">${ts}☠ ${esc(e.data.killer)} killed ${esc(e.data.victim)}</div>`;
    case 'agent_attacked':
      return `<div class="event-line event-attack">${ts}⚔ ${esc(e.data.attacker)} hit ${esc(e.data.target)} for ${e.data.damage} dmg</div>`;
    case 'agent_leveled_up':
      return `<div class="event-line event-level">${ts}↑ ${esc(e.data.name)} reached level ${e.data.level}</div>`;
    case 'agent_gathered':
      return `<div class="event-line event-gather">${ts}◇ ${esc(e.data.name)} gathered ${e.data.amount}x ${e.data.resource_type}</div>`;
    case 'agent_communicated':
      return `<div class="event-line event-comm">${ts}💬 ${esc(e.data.name)}: "${esc(e.data.message)}"</div>`;
    case 'agent_respawned':
      return `<div class="event-line event-respawn">${ts}↻ ${esc(e.data.name)} respawned</div>`;
    case 'agent_disconnected':
      return `<div class="event-line event-disconnect">${ts}— ${esc(e.data.name)} disconnected</div>`;
    default:
      return null;
  }
}

function esc(str) {
  return escapeHtml(String(str || ''));
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Tracking ─────────────────────────────────────

function findTrackedAgent(query) {
  if (!query || latestAgents.length === 0) return null;
  const q = query.toLowerCase();

  // Exact ID match
  let match = latestAgents.find(a => a.id && String(a.id).toLowerCase() === q);
  if (match) return match;

  // Exact name match (case-insensitive)
  match = latestAgents.find(a => a.name.toLowerCase() === q);
  if (match) return match;

  // Prefix match
  match = latestAgents.find(a => a.name.toLowerCase().startsWith(q));
  if (match) return match;

  // Substring match
  match = latestAgents.find(a => a.name.toLowerCase().includes(q));
  return match || null;
}

function updateTrackStatus() {
  const statusEl = document.getElementById('track-status');
  const clearBtn = document.getElementById('track-clear');

  if (!trackedAgentName) {
    statusEl.textContent = '';
    statusEl.className = '';
    clearBtn.classList.remove('visible');
    lastTrackedPos = null;
    startPulseAnimation(); // stops it
    return;
  }

  clearBtn.classList.add('visible');
  const agent = latestAgents.find(a => a.name.toLowerCase() === trackedAgentName.toLowerCase());

  if (!agent) {
    statusEl.textContent = `LOST: ${trackedAgentName}`;
    statusEl.className = 'status-lost';
  } else if (!agent.alive) {
    statusEl.textContent = `DEAD: ${agent.name}`;
    statusEl.className = 'status-dead';
  } else {
    statusEl.textContent = `LOCKED: ${agent.name}`;
    statusEl.className = 'status-locked';
  }
}

function trackAgent(name) {
  const input = document.getElementById('track-input');
  if (name) {
    trackedAgentName = name;
    input.value = name;
  } else {
    trackedAgentName = null;
    input.value = '';
  }
  updateTrackStatus();
  scrollToTrackedAgent();
}

let trackDebounceTimer = null;

function initTracking() {
  const input = document.getElementById('track-input');
  const clearBtn = document.getElementById('track-clear');

  input.addEventListener('input', () => {
    clearTimeout(trackDebounceTimer);
    trackDebounceTimer = setTimeout(() => {
      const query = input.value.trim();
      if (!query) {
        trackedAgentName = null;
        updateTrackStatus();
        return;
      }
      const agent = findTrackedAgent(query);
      if (agent) {
        trackedAgentName = agent.name;
      } else {
        trackedAgentName = query;
      }
      updateTrackStatus();
      scrollToTrackedAgent();
    }, 200);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      clearTimeout(trackDebounceTimer);
      const query = input.value.trim();
      const agent = findTrackedAgent(query);
      if (agent) {
        trackAgent(agent.name);
      }
    } else if (e.key === 'Escape') {
      trackAgent(null);
      input.blur();
    }
  });

  clearBtn.addEventListener('click', () => {
    trackAgent(null);
  });

  // Click-to-track via event delegation on side panel
  document.getElementById('side-panel').addEventListener('click', (e) => {
    const nameEl = e.target.closest('[data-agent-name]');
    if (!nameEl) return;
    const name = nameEl.getAttribute('data-agent-name');
    if (trackedAgentName && trackedAgentName.toLowerCase() === name.toLowerCase()) {
      trackAgent(null);
    } else {
      trackAgent(name);
    }
  });
}

// ── Boot ─────────────────────────────────────────

sprites = generateSprites();
buildLegend();
initTracking();
initTooltip();
connect();

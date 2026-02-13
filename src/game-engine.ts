// ═══════════════════════════════════════════════════
//  B A T T L E C L A W  —  Game Engine
// ═══════════════════════════════════════════════════

import { v4 as uuid } from 'uuid';
import { createHash } from 'crypto';
import {
  type Agent, type CooldownState, type GameEvent, type MapResource, type SkillSet, type SpectatorUpdate,
  Terrain, ResourceType, SkillType, EventType,
  MAP_WIDTH, MAP_HEIGHT, MAX_AGENTS, DIRECTIONS,
  xpForLevel, calculateDamage, getCooldown, getVisionRange, getGatherBonus,
  RESPAWN_TIME_MS, RESOURCE_SPAWN_INTERVAL_MS, MAX_RESOURCES_ON_MAP, MIN_RESOURCES_ON_MAP, RESOURCE_BURST_COUNT,
  RESOURCE_SPAWN_WEIGHTS, XP_REWARDS, RESOURCE_SYMBOLS,
  SAFE_HAVEN, isInSafeHaven,
} from './types.js';
import {
  initDatabase, insertAgent, updateAgent, getAgentById, getAgentByName, getAgentBySession,
  getAllAgents, getAliveAgents, getAgentAt, insertResource, deleteResource,
  getResourceAt, getAllResources, getResourceCount, getAgentCount, insertEvent, getRecentEvents,
  DEFAULT_SKILLS, DEFAULT_COOLDOWNS, DEFAULT_INVENTORY,
} from './database.js';

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

// ── Map ──────────────────────────────────────────
let terrain: Terrain[][] = [];

function generateMap(): Terrain[][] {
  const map: Terrain[][] = [];
  for (let y = 0; y < MAP_HEIGHT; y++) {
    map[y] = [];
    for (let x = 0; x < MAP_WIDTH; x++) {
      // Borders are walls
      if (x === 0 || y === 0 || x === MAP_WIDTH - 1 || y === MAP_HEIGHT - 1) {
        map[y][x] = Terrain.WALL;
        continue;
      }
      // Safe haven is always open ground
      if (isInSafeHaven(x, y)) {
        map[y][x] = Terrain.OPEN;
        continue;
      }
      const r = Math.random();
      if (r < 0.05) map[y][x] = Terrain.WALL;
      else if (r < 0.08) map[y][x] = Terrain.WATER;
      else if (r < 0.09) map[y][x] = Terrain.MOUNTAIN;
      else map[y][x] = Terrain.OPEN;
    }
  }
  return map;
}

function isPassable(x: number, y: number): boolean {
  if (x < 0 || x >= MAP_WIDTH || y < 0 || y >= MAP_HEIGHT) return false;
  const t = terrain[y][x];
  return t === Terrain.OPEN || t === Terrain.WATER;
}

function findSpawnPoint(): [number, number] {
  for (let attempts = 0; attempts < 500; attempts++) {
    const x = 2 + Math.floor(Math.random() * (MAP_WIDTH - 4));
    const y = 2 + Math.floor(Math.random() * (MAP_HEIGHT - 4));
    if (isPassable(x, y) && !getAgentAt(x, y) && !getResourceAt(x, y)) {
      return [x, y];
    }
  }
  // Fallback - just find any open spot
  for (let y = 1; y < MAP_HEIGHT - 1; y++) {
    for (let x = 1; x < MAP_WIDTH - 1; x++) {
      if (isPassable(x, y) && !getAgentAt(x, y)) return [x, y];
    }
  }
  return [MAP_WIDTH >> 1, MAP_HEIGHT >> 1];
}

// ── Event Broadcasting ───────────────────────────
type SpectatorCallback = (update: SpectatorUpdate) => void;
const spectatorCallbacks: Set<SpectatorCallback> = new Set();

export function onSpectatorUpdate(cb: SpectatorCallback): () => void {
  spectatorCallbacks.add(cb);
  return () => spectatorCallbacks.delete(cb);
}

function broadcast(update: SpectatorUpdate): void {
  for (const cb of spectatorCallbacks) {
    try { cb(update); } catch { /* ignore */ }
  }
}

function emitEvent(event: GameEvent): void {
  insertEvent(event);
  broadcast({ type: 'event', data: event });
}

function makeEvent(type: EventType, agentId: string | null, targetId: string | null, data: Record<string, unknown>): GameEvent {
  return { id: uuid(), type, agent_id: agentId, target_id: targetId, data, timestamp: Date.now() };
}

// ── Game Actions ─────────────────────────────────

function checkCooldown(agent: Agent, action: keyof CooldownState): string | null {
  const now = Date.now();
  const readyAt = agent.cooldowns[action];
  if (readyAt > now) {
    const remaining = Math.ceil((readyAt - now) / 1000);
    return `${action} on cooldown (${remaining}s remaining)`;
  }
  return null;
}

function applyCooldown(agent: Agent, action: keyof CooldownState): void {
  agent.cooldowns[action] = Date.now() + getCooldown(action, agent);
  agent.last_action_at = Date.now();
}

function addXp(agent: Agent, amount: number): boolean {
  agent.xp += amount;
  let leveledUp = false;
  while (agent.xp >= agent.xp_to_next) {
    agent.xp -= agent.xp_to_next;
    agent.level++;
    agent.skill_points++;
    agent.max_hp += 5;
    agent.hp = agent.max_hp;
    agent.xp_to_next = xpForLevel(agent.level);
    leveledUp = true;
    emitEvent(makeEvent(EventType.AGENT_LEVELED_UP, agent.id, null, {
      level: agent.level, name: agent.name,
    }));
  }
  return leveledUp;
}

// ── Public Game API ──────────────────────────────

export function initGame(): void {
  initDatabase();
  terrain = generateMap();
  console.log(`[BATTLECLAW] Map generated (${MAP_WIDTH}x${MAP_HEIGHT})`);
  console.log(`[BATTLECLAW] Game engine ready`);
}

export function register(sessionId: string, name: string, secret?: string): { ok: true; agent: Agent; reconnected?: boolean } | { ok: false; error: string } {
  // Validate name
  if (!name || name.length < 2 || name.length > 20) {
    return { ok: false, error: 'Name must be 2-20 characters' };
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return { ok: false, error: 'Name must be alphanumeric (with _ or -)' };
  }

  // Check if session already has an agent
  const existing = getAgentBySession(sessionId);
  if (existing) {
    return { ok: true, agent: existing };
  }

  // Check name uniqueness — if name exists, try auto-reconnect with secret
  const byName = getAgentByName(name);
  if (byName) {
    // If the agent has a secret, require it to match
    if (byName.secret_hash) {
      if (!secret) return { ok: false, error: `Name "${name}" already exists. Provide the correct secret to reconnect.` };
      if (hashSecret(secret) !== byName.secret_hash) return { ok: false, error: 'Incorrect secret for this agent' };
    }
    // If agent has an active session, reject
    if (byName.session_id) {
      return { ok: false, error: `Name "${name}" is currently connected from another session` };
    }
    // Auto-reconnect
    byName.session_id = sessionId;
    byName.last_action_at = Date.now();
    updateAgent(byName);
    return { ok: true, agent: byName, reconnected: true };
  }

  // Enforce agent cap
  if (getAgentCount() >= MAX_AGENTS) {
    return { ok: false, error: 'Arena is full (100/100 agents). Try again later.' };
  }

  const [x, y] = findSpawnPoint();
  const now = Date.now();
  const agent: Agent = {
    id: uuid(),
    name,
    x, y,
    hp: 50,
    max_hp: 50,
    attack: 0,
    defense: 0,
    level: 1,
    xp: 0,
    xp_to_next: 100,
    skill_points: 0,
    skills: { ...DEFAULT_SKILLS },
    kills: 0,
    deaths: 0,
    alive: true,
    respawn_at: null,
    cooldowns: { ...DEFAULT_COOLDOWNS },
    inventory: { ...DEFAULT_INVENTORY },
    created_at: now,
    last_action_at: now,
    session_id: sessionId,
    secret_hash: secret ? hashSecret(secret) : null,
  };

  insertAgent(agent);
  emitEvent(makeEvent(EventType.AGENT_REGISTERED, agent.id, null, { name, x, y }));
  return { ok: true, agent };
}

export function look(agentId: string): { ok: true; view: string; agents_nearby: Array<{ name: string; x: number; y: number; hp: number; level: number }>; resources_nearby: Array<{ type: string; x: number; y: number; symbol: string }>; in_safe_haven: boolean } | { ok: false; error: string } {
  const agent = getAgentById(agentId);
  if (!agent) return { ok: false, error: 'Agent not found' };
  if (!agent.alive) return { ok: false, error: 'You are dead. Respawning soon...' };

  const range = getVisionRange(agent);
  const agents = getAliveAgents();
  const resources = getAllResources();
  const nearbyAgents: Array<{ name: string; x: number; y: number; hp: number; level: number }> = [];
  const nearbyResources: Array<{ type: string; x: number; y: number; symbol: string }> = [];

  // Build ASCII view
  const lines: string[] = [];
  const x1 = Math.max(0, agent.x - range);
  const x2 = Math.min(MAP_WIDTH - 1, agent.x + range);
  const y1 = Math.max(0, agent.y - range);
  const y2 = Math.min(MAP_HEIGHT - 1, agent.y + range);

  for (let vy = y1; vy <= y2; vy++) {
    let line = '';
    for (let vx = x1; vx <= x2; vx++) {
      if (vx === agent.x && vy === agent.y) {
        line += '@';
        continue;
      }
      // Check for other agents
      const otherAgent = agents.find(a => a.x === vx && a.y === vy && a.id !== agent.id);
      if (otherAgent) {
        line += 'A';
        nearbyAgents.push({
          name: otherAgent.name, x: otherAgent.x, y: otherAgent.y,
          hp: otherAgent.hp, level: otherAgent.level,
        });
        continue;
      }
      // Check for resources
      const res = resources.find(r => r.x === vx && r.y === vy);
      if (res) {
        line += RESOURCE_SYMBOLS[res.type];
        nearbyResources.push({
          type: res.type, x: res.x, y: res.y,
          symbol: RESOURCE_SYMBOLS[res.type],
        });
        continue;
      }
      line += terrain[vy][vx];
    }
    lines.push(line);
  }

  const inSafeHaven = isInSafeHaven(agent.x, agent.y);
  return { ok: true, view: lines.join('\n'), agents_nearby: nearbyAgents, resources_nearby: nearbyResources, in_safe_haven: inSafeHaven };
}

export function move(agentId: string, direction: string): { ok: true; x: number; y: number; terrain: string; in_safe_haven: boolean } | { ok: false; error: string } {
  const agent = getAgentById(agentId);
  if (!agent) return { ok: false, error: 'Agent not found' };
  if (!agent.alive) return { ok: false, error: 'You are dead. Respawning soon...' };

  const cdErr = checkCooldown(agent, 'move');
  if (cdErr) return { ok: false, error: cdErr };

  const dir = DIRECTIONS[direction.toLowerCase()];
  if (!dir) return { ok: false, error: `Invalid direction. Use: ${Object.keys(DIRECTIONS).join(', ')}` };

  const [dx, dy] = dir;
  const nx = agent.x + dx;
  const ny = agent.y + dy;

  if (!isPassable(nx, ny)) return { ok: false, error: 'Cannot move there (blocked)' };

  const occupant = getAgentAt(nx, ny);
  if (occupant) return { ok: false, error: `Tile occupied by ${occupant.name}` };

  agent.x = nx;
  agent.y = ny;

  // Water slows movement
  if (terrain[ny][nx] === Terrain.WATER) {
    agent.cooldowns.move = Date.now() + getCooldown('move', agent) * 2;
  } else {
    applyCooldown(agent, 'move');
  }

  updateAgent(agent);
  emitEvent(makeEvent(EventType.AGENT_MOVED, agent.id, null, {
    name: agent.name, x: nx, y: ny, direction,
  }));

  return { ok: true, x: nx, y: ny, terrain: terrain[ny][nx], in_safe_haven: isInSafeHaven(nx, ny) };
}

export function attack(agentId: string, direction: string): { ok: true; target: string; damage: number; target_hp: number; killed: boolean } | { ok: false; error: string } {
  const agent = getAgentById(agentId);
  if (!agent) return { ok: false, error: 'Agent not found' };
  if (!agent.alive) return { ok: false, error: 'You are dead. Respawning soon...' };

  const cdErr = checkCooldown(agent, 'attack');
  if (cdErr) return { ok: false, error: cdErr };

  const dir = DIRECTIONS[direction.toLowerCase()];
  if (!dir) return { ok: false, error: `Invalid direction. Use: ${Object.keys(DIRECTIONS).join(', ')}` };

  const [dx, dy] = dir;
  const tx = agent.x + dx;
  const ty = agent.y + dy;

  const target = getAgentAt(tx, ty);
  if (!target) return { ok: false, error: 'No agent in that direction' };

  // Safe haven — no combat allowed
  if (isInSafeHaven(agent.x, agent.y)) return { ok: false, error: 'You are in the Safe Haven — combat is not allowed here' };
  if (isInSafeHaven(tx, ty)) return { ok: false, error: 'Target is in the Safe Haven — combat is not allowed there' };

  const damage = calculateDamage(agent, target);
  target.hp -= damage;
  applyCooldown(agent, 'attack');
  addXp(agent, XP_REWARDS.attack_hit);

  let killed = false;
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    target.deaths++;
    target.respawn_at = Date.now() + RESPAWN_TIME_MS;
    agent.kills++;
    addXp(agent, XP_REWARDS.kill);
    killed = true;
    emitEvent(makeEvent(EventType.AGENT_KILLED, agent.id, target.id, {
      killer: agent.name, victim: target.name,
      killer_level: agent.level, victim_level: target.level,
    }));
  } else {
    emitEvent(makeEvent(EventType.AGENT_ATTACKED, agent.id, target.id, {
      attacker: agent.name, target: target.name, damage,
      target_hp: target.hp, target_max_hp: target.max_hp,
    }));
  }

  updateAgent(agent);
  updateAgent(target);

  return { ok: true, target: target.name, damage, target_hp: target.hp, killed };
}

export function gather(agentId: string): { ok: true; type: string; amount: number; xp_gained: number } | { ok: false; error: string } {
  const agent = getAgentById(agentId);
  if (!agent) return { ok: false, error: 'Agent not found' };
  if (!agent.alive) return { ok: false, error: 'You are dead. Respawning soon...' };

  const cdErr = checkCooldown(agent, 'gather');
  if (cdErr) return { ok: false, error: cdErr };

  const resource = getResourceAt(agent.x, agent.y);
  if (!resource) return { ok: false, error: 'No resource here' };

  const bonus = getGatherBonus(agent);
  const amount = resource.amount * bonus;

  agent.inventory[resource.type as keyof typeof agent.inventory] += amount;
  applyCooldown(agent, 'gather');

  const xpKey = `gather_${resource.type}` as keyof typeof XP_REWARDS;
  const xpGained = (XP_REWARDS[xpKey] ?? 5) * bonus;
  addXp(agent, xpGained);

  deleteResource(resource.id);
  updateAgent(agent);

  emitEvent(makeEvent(EventType.AGENT_GATHERED, agent.id, null, {
    name: agent.name, resource_type: resource.type, amount,
  }));

  return { ok: true, type: resource.type, amount, xp_gained: xpGained };
}

export function communicate(agentId: string, message: string): { ok: true; delivered_to: string[] } | { ok: false; error: string } {
  const agent = getAgentById(agentId);
  if (!agent) return { ok: false, error: 'Agent not found' };
  if (!agent.alive) return { ok: false, error: 'You are dead. Respawning soon...' };

  const cdErr = checkCooldown(agent, 'communicate');
  if (cdErr) return { ok: false, error: cdErr };

  if (!message || message.length > 200) {
    return { ok: false, error: 'Message must be 1-200 characters' };
  }

  const range = getVisionRange(agent);
  const allAgents = getAliveAgents();
  const nearby = allAgents.filter(a =>
    a.id !== agent.id &&
    Math.abs(a.x - agent.x) <= range &&
    Math.abs(a.y - agent.y) <= range
  );

  applyCooldown(agent, 'communicate');
  updateAgent(agent);

  emitEvent(makeEvent(EventType.AGENT_COMMUNICATED, agent.id, null, {
    name: agent.name, message,
    delivered_to: nearby.map(a => a.name),
  }));

  return { ok: true, delivered_to: nearby.map(a => a.name) };
}

export function getMessages(agentId: string, limit: number = 10): { ok: true; messages: Array<{ from: string; message: string; time: number }> } | { ok: false; error: string } {
  const agent = getAgentById(agentId);
  if (!agent) return { ok: false, error: 'Agent not found' };

  const events = getRecentEvents(100);
  const range = getVisionRange(agent);

  const messages = events
    .filter(e => {
      if (e.type !== EventType.AGENT_COMMUNICATED) return false;
      const deliveredTo = (e.data.delivered_to as string[]) ?? [];
      return deliveredTo.includes(agent.name) || e.agent_id === agent.id;
    })
    .slice(0, limit)
    .map(e => ({
      from: e.data.name as string,
      message: e.data.message as string,
      time: e.timestamp,
    }));

  return { ok: true, messages };
}

export function levelUpSkill(agentId: string, skill: string): { ok: true; skill: string; new_level: number; remaining_points: number } | { ok: false; error: string } {
  const agent = getAgentById(agentId);
  if (!agent) return { ok: false, error: 'Agent not found' };

  if (agent.skill_points <= 0) return { ok: false, error: 'No skill points available' };

  const skillKey = skill.toLowerCase() as SkillType;
  if (!Object.values(SkillType).includes(skillKey)) {
    return { ok: false, error: `Invalid skill. Choose: ${Object.values(SkillType).join(', ')}` };
  }

  agent.skills[skillKey]++;
  agent.skill_points--;

  // Apply stat bonuses
  if (skillKey === SkillType.MIGHT) agent.attack += 2;
  if (skillKey === SkillType.FORTITUDE) {
    agent.defense += 1;
    agent.max_hp += 10;
    agent.hp += 10;
  }

  updateAgent(agent);

  return {
    ok: true,
    skill: skillKey,
    new_level: agent.skills[skillKey],
    remaining_points: agent.skill_points,
  };
}

export function useSkill(agentId: string, skillName: string, direction?: string): { ok: true; result: string } | { ok: false; error: string } {
  const agent = getAgentById(agentId);
  if (!agent) return { ok: false, error: 'Agent not found' };
  if (!agent.alive) return { ok: false, error: 'You are dead' };

  const cdErr = checkCooldown(agent, 'use_skill');
  if (cdErr) return { ok: false, error: cdErr };

  const skill = skillName.toLowerCase();

  if (skill === 'heal' && agent.inventory.biomass > 0) {
    const healAmount = 10 + agent.skills.fortitude * 5;
    agent.hp = Math.min(agent.max_hp, agent.hp + healAmount);
    agent.inventory.biomass--;
    applyCooldown(agent, 'use_skill');
    updateAgent(agent);
    emitEvent(makeEvent(EventType.AGENT_USED_SKILL, agent.id, null, {
      name: agent.name, skill: 'heal', amount: healAmount,
    }));
    return { ok: true, result: `Healed ${healAmount} HP (now ${agent.hp}/${agent.max_hp})` };
  }

  if (skill === 'power_strike' && direction) {
    if (agent.skills.might < 3) return { ok: false, error: 'Requires Might level 3+' };
    const dir = DIRECTIONS[direction.toLowerCase()];
    if (!dir) return { ok: false, error: 'Invalid direction' };
    const [dx, dy] = dir;
    const tx = agent.x + dx;
    const ty = agent.y + dy;

    // Safe haven — no combat allowed
    if (isInSafeHaven(agent.x, agent.y)) return { ok: false, error: 'You are in the Safe Haven — combat is not allowed here' };
    if (isInSafeHaven(tx, ty)) return { ok: false, error: 'Target is in the Safe Haven — combat is not allowed there' };

    const target = getAgentAt(tx, ty);
    if (!target) return { ok: false, error: 'No target in that direction' };

    const damage = calculateDamage(agent, target) * 2;
    target.hp -= damage;
    applyCooldown(agent, 'use_skill');

    let killed = false;
    if (target.hp <= 0) {
      target.hp = 0;
      target.alive = false;
      target.deaths++;
      target.respawn_at = Date.now() + RESPAWN_TIME_MS;
      agent.kills++;
      addXp(agent, XP_REWARDS.kill * 2);
      killed = true;
    }

    updateAgent(agent);
    updateAgent(target);
    emitEvent(makeEvent(EventType.AGENT_USED_SKILL, agent.id, target.id, {
      name: agent.name, skill: 'power_strike', damage, target: target.name, killed,
    }));
    return { ok: true, result: `Power strike dealt ${damage} damage to ${target.name}${killed ? ' (KILLED!)' : ` (${target.hp} HP left)`}` };
  }

  if (skill === 'scout') {
    if (agent.skills.perception < 2) return { ok: false, error: 'Requires Perception level 2+' };
    applyCooldown(agent, 'use_skill');
    updateAgent(agent);
    // Return extra-wide view
    const range = getVisionRange(agent) * 2;
    const agents = getAliveAgents().filter(a =>
      a.id !== agent.id &&
      Math.abs(a.x - agent.x) <= range &&
      Math.abs(a.y - agent.y) <= range
    );
    return {
      ok: true,
      result: `Scouted area (${range} range): Found ${agents.length} agents: ${agents.map(a => `${a.name} at (${a.x},${a.y}) Lv${a.level}`).join(', ') || 'none'}`,
    };
  }

  return { ok: false, error: 'Unknown skill. Available: heal (costs 1 biomass), power_strike (Might 3+, needs direction), scout (Perception 2+)' };
}

export function getStatus(agentId: string): { ok: true; agent: Agent } | { ok: false; error: string } {
  const agent = getAgentById(agentId);
  if (!agent) return { ok: false, error: 'Agent not found' };
  return { ok: true, agent };
}

export function getNearby(agentId: string): { ok: true; agents: Array<{ name: string; x: number; y: number; hp: number; max_hp: number; level: number; distance: number }> } | { ok: false; error: string } {
  const agent = getAgentById(agentId);
  if (!agent) return { ok: false, error: 'Agent not found' };

  const range = getVisionRange(agent);
  const allAgents = getAliveAgents();
  const nearby = allAgents
    .filter(a => a.id !== agent.id && Math.abs(a.x - agent.x) <= range && Math.abs(a.y - agent.y) <= range)
    .map(a => ({
      name: a.name,
      x: a.x,
      y: a.y,
      hp: a.hp,
      max_hp: a.max_hp,
      level: a.level,
      distance: Math.max(Math.abs(a.x - agent.x), Math.abs(a.y - agent.y)),
    }))
    .sort((a, b) => a.distance - b.distance);

  return { ok: true, agents: nearby };
}

// ── Game Tick (respawns + resource spawning) ─────

const SAFE_HAVEN_HEAL_AMOUNT = 5; // HP healed per tick while in safe haven

function tickRespawns(): void {
  const now = Date.now();
  const allAgents = getAllAgents();
  for (const agent of allAgents) {
    if (!agent.alive && agent.respawn_at && now >= agent.respawn_at) {
      const [x, y] = findSpawnPoint();
      agent.alive = true;
      agent.hp = agent.max_hp;
      agent.x = x;
      agent.y = y;
      agent.respawn_at = null;
      updateAgent(agent);
      emitEvent(makeEvent(EventType.AGENT_RESPAWNED, agent.id, null, {
        name: agent.name, x, y,
      }));
    }

    // Passive healing in safe haven
    if (agent.alive && agent.hp < agent.max_hp && isInSafeHaven(agent.x, agent.y)) {
      agent.hp = Math.min(agent.max_hp, agent.hp + SAFE_HAVEN_HEAL_AMOUNT);
      updateAgent(agent);
    }
  }
}

function spawnOneResource(): boolean {
  const totalWeight = Object.values(RESOURCE_SPAWN_WEIGHTS).reduce((a, b) => a + b, 0);
  let r = Math.random() * totalWeight;
  let selectedType = ResourceType.ENERGY_CRYSTAL;
  for (const [type, weight] of Object.entries(RESOURCE_SPAWN_WEIGHTS)) {
    r -= weight;
    if (r <= 0) {
      selectedType = type as ResourceType;
      break;
    }
  }

  for (let attempts = 0; attempts < 50; attempts++) {
    const x = 1 + Math.floor(Math.random() * (MAP_WIDTH - 2));
    const y = 1 + Math.floor(Math.random() * (MAP_HEIGHT - 2));
    if (isPassable(x, y) && !getResourceAt(x, y) && !getAgentAt(x, y)) {
      const resource: MapResource = {
        id: uuid(),
        type: selectedType,
        x, y,
        amount: selectedType === ResourceType.ARTIFACT ? 1 : 1 + Math.floor(Math.random() * 3),
        spawned_at: Date.now(),
      };
      insertResource(resource);
      emitEvent(makeEvent(EventType.RESOURCE_SPAWNED, null, null, {
        type: selectedType, x, y, symbol: RESOURCE_SYMBOLS[selectedType],
      }));
      return true;
    }
  }
  return false;
}

function tickResources(): void {
  const count = getResourceCount();
  if (count >= MAX_RESOURCES_ON_MAP) return;

  // Burst-spawn when resources are critically low
  const toSpawn = count < MIN_RESOURCES_ON_MAP ? RESOURCE_BURST_COUNT : 1;
  for (let i = 0; i < toSpawn; i++) {
    if (getResourceCount() >= MAX_RESOURCES_ON_MAP) break;
    spawnOneResource();
  }
}

const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function tickInactivity(): void {
  const now = Date.now();
  const allAgents = getAllAgents();
  for (const agent of allAgents) {
    // Only disconnect agents that have an active session and are idle
    if (agent.session_id && (now - agent.last_action_at) > INACTIVITY_TIMEOUT_MS) {
      agent.session_id = null;
      updateAgent(agent);
      emitEvent(makeEvent(EventType.AGENT_DISCONNECTED, agent.id, null, {
        name: agent.name, reason: 'inactivity',
      }));
      console.log(`[BATTLECLAW] ${agent.name} disconnected (inactive ${Math.round((now - agent.last_action_at) / 1000)}s)`);
    }
  }
}

let tickInterval: ReturnType<typeof setInterval> | null = null;

export function startGameLoop(): void {
  if (tickInterval) return;

  tickInterval = setInterval(() => {
    tickRespawns();
    tickResources();
    tickInactivity();
    broadcast({ type: 'tick', data: getFullState() });
  }, RESOURCE_SPAWN_INTERVAL_MS);

  console.log('[BATTLECLAW] Game loop started');
}

export function stopGameLoop(): void {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

// ── Full State for Spectator ─────────────────────

export function getFullState(): {
  map: string[][];
  agents: Array<{
    id: string; name: string; x: number; y: number;
    hp: number; max_hp: number; level: number; xp: number; xp_to_next: number;
    kills: number; deaths: number; alive: boolean; skills: SkillSet;
    attack: number; defense: number; inventory: Record<string, number>;
  }>;
  resources: Array<{ type: string; x: number; y: number; symbol: string }>;
  events: GameEvent[];
  safe_haven: typeof SAFE_HAVEN;
} {
  const agents = getAllAgents();
  const resources = getAllResources();
  const events = getRecentEvents(30);

  // Build composite map
  const compositeMap: string[][] = [];
  for (let y = 0; y < MAP_HEIGHT; y++) {
    compositeMap[y] = [];
    for (let x = 0; x < MAP_WIDTH; x++) {
      compositeMap[y][x] = terrain[y][x];
    }
  }

  // Overlay resources
  for (const r of resources) {
    compositeMap[r.y][r.x] = RESOURCE_SYMBOLS[r.type];
  }

  // Overlay agents
  for (const a of agents) {
    if (a.alive) {
      compositeMap[a.y][a.x] = '@';
    }
  }

  return {
    map: compositeMap,
    agents: agents.map(a => ({
      id: a.id, name: a.name, x: a.x, y: a.y,
      hp: a.hp, max_hp: a.max_hp, level: a.level,
      xp: a.xp, xp_to_next: a.xp_to_next,
      kills: a.kills, deaths: a.deaths, alive: a.alive,
      skills: a.skills, attack: a.attack, defense: a.defense,
      inventory: a.inventory as unknown as Record<string, number>,
    })),
    resources: resources.map(r => ({
      type: r.type, x: r.x, y: r.y, symbol: RESOURCE_SYMBOLS[r.type],
    })),
    events,
    safe_haven: SAFE_HAVEN,
  };
}

export function getTerrain(): Terrain[][] {
  return terrain;
}

export function disconnectSession(sessionId: string): void {
  const agent = getAgentBySession(sessionId);
  if (agent) {
    agent.session_id = null;
    updateAgent(agent);
    emitEvent(makeEvent(EventType.AGENT_DISCONNECTED, agent.id, null, { name: agent.name }));
  }
}

export function reconnectAgent(sessionId: string, agentName: string, secret?: string): { ok: true; agent: Agent } | { ok: false; error: string } {
  const agent = getAgentByName(agentName);
  if (!agent) return { ok: false, error: 'Agent not found' };
  if (agent.session_id && agent.session_id !== sessionId) {
    return { ok: false, error: 'Agent is bound to another session' };
  }
  // Verify secret if agent has one
  if (agent.secret_hash) {
    if (!secret) return { ok: false, error: 'This agent requires a secret to reconnect' };
    if (hashSecret(secret) !== agent.secret_hash) return { ok: false, error: 'Incorrect secret' };
  }
  agent.session_id = sessionId;
  agent.last_action_at = Date.now();
  updateAgent(agent);
  return { ok: true, agent };
}

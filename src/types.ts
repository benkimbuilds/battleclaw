// ═══════════════════════════════════════════════════
//  B A T T L E C L A W  —  Type Definitions
// ═══════════════════════════════════════════════════

export const MAP_WIDTH = 50;
export const MAP_HEIGHT = 50;
export const MAX_AGENTS = 100;

// ── Terrain ──────────────────────────────────────
export enum Terrain {
  OPEN = '.',
  WALL = '#',
  WATER = '~',
  MOUNTAIN = '^',
}

// ── Resource Types ───────────────────────────────
export enum ResourceType {
  ENERGY_CRYSTAL = 'energy_crystal',   // ⊕  XP boost
  METAL_ORE = 'metal_ore',             // ◆  attack boost
  BIOMASS = 'biomass',                 // ♣  healing
  ARTIFACT = 'artifact',              // ★  rare, big XP
}

export const RESOURCE_SYMBOLS: Record<ResourceType, string> = {
  [ResourceType.ENERGY_CRYSTAL]: '⊕',
  [ResourceType.METAL_ORE]: '◆',
  [ResourceType.BIOMASS]: '♣',
  [ResourceType.ARTIFACT]: '★',
};

// ── Skills ───────────────────────────────────────
export enum SkillType {
  MIGHT = 'might',           // +attack damage
  FORTITUDE = 'fortitude',   // +max HP, +defense
  AGILITY = 'agility',       // -cooldowns
  PERCEPTION = 'perception', // +vision range
  HARVESTING = 'harvesting', // +gather efficiency
}

export interface SkillSet {
  might: number;
  fortitude: number;
  agility: number;
  perception: number;
  harvesting: number;
}

// ── Cooldowns (ms) ───────────────────────────────
export const BASE_COOLDOWNS = {
  move: 1000,
  attack: 3000,
  gather: 2000,
  communicate: 500,
  use_skill: 5000,
} as const;

// ── Agent ────────────────────────────────────────
export interface Agent {
  id: string;
  name: string;
  x: number;
  y: number;
  hp: number;
  max_hp: number;
  attack: number;
  defense: number;
  level: number;
  xp: number;
  xp_to_next: number;
  skill_points: number;
  skills: SkillSet;
  kills: number;
  deaths: number;
  alive: boolean;
  respawn_at: number | null;   // timestamp ms
  cooldowns: CooldownState;
  inventory: Inventory;
  created_at: number;
  last_action_at: number;
  session_id: string | null;   // MCP session binding
  secret_hash: string | null;  // hashed secret for auth
}

export interface CooldownState {
  move: number;       // timestamp when action available
  attack: number;
  gather: number;
  communicate: number;
  use_skill: number;
}

export interface Inventory {
  energy_crystal: number;
  metal_ore: number;
  biomass: number;
  artifact: number;
}

// ── Resource on Map ──────────────────────────────
export interface MapResource {
  id: string;
  type: ResourceType;
  x: number;
  y: number;
  amount: number;
  spawned_at: number;
}

// ── Game Event ───────────────────────────────────
export enum EventType {
  AGENT_REGISTERED = 'agent_registered',
  AGENT_MOVED = 'agent_moved',
  AGENT_ATTACKED = 'agent_attacked',
  AGENT_KILLED = 'agent_killed',
  AGENT_RESPAWNED = 'agent_respawned',
  AGENT_GATHERED = 'agent_gathered',
  AGENT_LEVELED_UP = 'agent_leveled_up',
  AGENT_COMMUNICATED = 'agent_communicated',
  AGENT_USED_SKILL = 'agent_used_skill',
  RESOURCE_SPAWNED = 'resource_spawned',
  AGENT_DISCONNECTED = 'agent_disconnected',
}

export interface GameEvent {
  id: string;
  type: EventType;
  agent_id: string | null;
  target_id: string | null;
  data: Record<string, unknown>;
  timestamp: number;
}

// ── Leveling ─────────────────────────────────────
export function xpForLevel(level: number): number {
  return Math.floor(100 * Math.pow(1.5, level - 1));
}

// ── Combat Formulas ──────────────────────────────
export function calculateDamage(attacker: Agent, defender: Agent): number {
  const baseDmg = 5 + attacker.attack + (attacker.skills.might * 3);
  const def = defender.defense + (defender.skills.fortitude * 2);
  const dmg = Math.max(1, baseDmg - def + Math.floor(Math.random() * 4) - 2);
  return dmg;
}

export function getCooldown(action: keyof typeof BASE_COOLDOWNS, agent: Agent): number {
  const base = BASE_COOLDOWNS[action];
  const agilityReduction = agent.skills.agility * 0.08; // 8% per agility level
  return Math.floor(base * (1 - Math.min(agilityReduction, 0.5))); // cap at 50% reduction
}

export function getVisionRange(agent: Agent): number {
  return 5 + agent.skills.perception * 2;
}

export function getGatherBonus(agent: Agent): number {
  return 1 + agent.skills.harvesting;
}

// ── Safe Haven ──────────────────────────────────
export const SAFE_HAVEN = {
  x1: 21, y1: 21,
  x2: 29, y2: 29,
} as const;

export function isInSafeHaven(x: number, y: number): boolean {
  return x >= SAFE_HAVEN.x1 && x <= SAFE_HAVEN.x2 &&
         y >= SAFE_HAVEN.y1 && y <= SAFE_HAVEN.y2;
}

// ── Respawn ──────────────────────────────────────
export const RESPAWN_TIME_MS = 10000; // 10 seconds

// ── Resource Spawning ────────────────────────────
export const RESOURCE_SPAWN_INTERVAL_MS = 5000;
export const MAX_RESOURCES_ON_MAP = 80;
export const MIN_RESOURCES_ON_MAP = 20;   // burst-refill threshold
export const RESOURCE_BURST_COUNT = 8;    // how many to spawn per tick when depleted
export const RESOURCE_SPAWN_WEIGHTS: Record<ResourceType, number> = {
  [ResourceType.ENERGY_CRYSTAL]: 40,
  [ResourceType.METAL_ORE]: 30,
  [ResourceType.BIOMASS]: 25,
  [ResourceType.ARTIFACT]: 5,
};

// ── XP Rewards ───────────────────────────────────
export const XP_REWARDS = {
  kill: 50,
  gather_energy_crystal: 15,
  gather_metal_ore: 5,
  gather_biomass: 5,
  gather_artifact: 40,
  attack_hit: 5,
} as const;

// ── Direction Vectors ────────────────────────────
export const DIRECTIONS: Record<string, [number, number]> = {
  north: [0, -1],
  south: [0, 1],
  east: [1, 0],
  west: [-1, 0],
  northeast: [1, -1],
  northwest: [-1, -1],
  southeast: [1, 1],
  southwest: [-1, 1],
};

// ── Spectator Update ─────────────────────────────
export interface SpectatorUpdate {
  type: 'full_state' | 'event' | 'tick';
  data: unknown;
}

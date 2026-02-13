// ═══════════════════════════════════════════════════
//  B A T T L E C L A W  —  SQLite Persistence
// ═══════════════════════════════════════════════════

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Agent, CooldownState, GameEvent, Inventory, MapResource, SkillSet } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'battleclaw.db');

let db: Database.Database;

export function initDatabase(): Database.Database {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      hp INTEGER NOT NULL,
      max_hp INTEGER NOT NULL,
      attack INTEGER NOT NULL DEFAULT 0,
      defense INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1,
      xp INTEGER NOT NULL DEFAULT 0,
      xp_to_next INTEGER NOT NULL DEFAULT 100,
      skill_points INTEGER NOT NULL DEFAULT 0,
      skills TEXT NOT NULL DEFAULT '{}',
      kills INTEGER NOT NULL DEFAULT 0,
      deaths INTEGER NOT NULL DEFAULT 0,
      alive INTEGER NOT NULL DEFAULT 1,
      respawn_at INTEGER,
      cooldowns TEXT NOT NULL DEFAULT '{}',
      inventory TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      last_action_at INTEGER NOT NULL,
      session_id TEXT,
      secret_hash TEXT
    );

    CREATE TABLE IF NOT EXISTS resources (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      amount INTEGER NOT NULL DEFAULT 1,
      spawned_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      agent_id TEXT,
      target_id TEXT,
      data TEXT NOT NULL DEFAULT '{}',
      timestamp INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
    CREATE INDEX IF NOT EXISTS idx_resources_pos ON resources(x, y);
    CREATE INDEX IF NOT EXISTS idx_agents_pos ON agents(x, y);
    CREATE INDEX IF NOT EXISTS idx_agents_session ON agents(session_id);
  `);

  // Migration: add secret_hash column if missing (existing DBs)
  const cols = db.prepare("PRAGMA table_info(agents)").all() as Array<{ name: string }>;
  if (!cols.some(c => c.name === 'secret_hash')) {
    db.exec('ALTER TABLE agents ADD COLUMN secret_hash TEXT');
  }

  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}

// ── Agent Operations ─────────────────────────────

const DEFAULT_SKILLS: SkillSet = {
  might: 0, fortitude: 0, agility: 0, perception: 0, harvesting: 0,
};
const DEFAULT_COOLDOWNS: CooldownState = {
  move: 0, attack: 0, gather: 0, communicate: 0, use_skill: 0,
};
const DEFAULT_INVENTORY: Inventory = {
  energy_crystal: 0, metal_ore: 0, biomass: 0, artifact: 0,
};

function rowToAgent(row: Record<string, unknown>): Agent {
  return {
    id: row.id as string,
    name: row.name as string,
    x: row.x as number,
    y: row.y as number,
    hp: row.hp as number,
    max_hp: row.max_hp as number,
    attack: row.attack as number,
    defense: row.defense as number,
    level: row.level as number,
    xp: row.xp as number,
    xp_to_next: row.xp_to_next as number,
    skill_points: row.skill_points as number,
    skills: JSON.parse(row.skills as string),
    kills: row.kills as number,
    deaths: row.deaths as number,
    alive: (row.alive as number) === 1,
    respawn_at: row.respawn_at as number | null,
    cooldowns: JSON.parse(row.cooldowns as string),
    inventory: JSON.parse(row.inventory as string),
    created_at: row.created_at as number,
    last_action_at: row.last_action_at as number,
    session_id: row.session_id as string | null,
    secret_hash: row.secret_hash as string | null,
  };
}

export function insertAgent(agent: Agent): void {
  getDb().prepare(`
    INSERT INTO agents (id, name, x, y, hp, max_hp, attack, defense, level, xp, xp_to_next,
      skill_points, skills, kills, deaths, alive, respawn_at, cooldowns, inventory,
      created_at, last_action_at, session_id, secret_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    agent.id, agent.name, agent.x, agent.y, agent.hp, agent.max_hp, agent.attack, agent.defense,
    agent.level, agent.xp, agent.xp_to_next, agent.skill_points,
    JSON.stringify(agent.skills), agent.kills, agent.deaths,
    agent.alive ? 1 : 0, agent.respawn_at,
    JSON.stringify(agent.cooldowns), JSON.stringify(agent.inventory),
    agent.created_at, agent.last_action_at, agent.session_id, agent.secret_hash,
  );
}

export function updateAgent(agent: Agent): void {
  getDb().prepare(`
    UPDATE agents SET
      x = ?, y = ?, hp = ?, max_hp = ?, attack = ?, defense = ?,
      level = ?, xp = ?, xp_to_next = ?, skill_points = ?,
      skills = ?, kills = ?, deaths = ?, alive = ?, respawn_at = ?,
      cooldowns = ?, inventory = ?, last_action_at = ?, session_id = ?
    WHERE id = ?
  `).run(
    agent.x, agent.y, agent.hp, agent.max_hp, agent.attack, agent.defense,
    agent.level, agent.xp, agent.xp_to_next, agent.skill_points,
    JSON.stringify(agent.skills), agent.kills, agent.deaths,
    agent.alive ? 1 : 0, agent.respawn_at,
    JSON.stringify(agent.cooldowns), JSON.stringify(agent.inventory),
    agent.last_action_at, agent.session_id, agent.id,
  );
}

export function getAgentById(id: string): Agent | null {
  const row = getDb().prepare('SELECT * FROM agents WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToAgent(row) : null;
}

export function getAgentByName(name: string): Agent | null {
  const row = getDb().prepare('SELECT * FROM agents WHERE name = ?').get(name) as Record<string, unknown> | undefined;
  return row ? rowToAgent(row) : null;
}

export function getAgentBySession(sessionId: string): Agent | null {
  const row = getDb().prepare('SELECT * FROM agents WHERE session_id = ?').get(sessionId) as Record<string, unknown> | undefined;
  return row ? rowToAgent(row) : null;
}

export function getAllAgents(): Agent[] {
  const rows = getDb().prepare('SELECT * FROM agents').all() as Record<string, unknown>[];
  return rows.map(rowToAgent);
}

export function getAliveAgents(): Agent[] {
  const rows = getDb().prepare('SELECT * FROM agents WHERE alive = 1').all() as Record<string, unknown>[];
  return rows.map(rowToAgent);
}

export function getAgentAt(x: number, y: number): Agent | null {
  const row = getDb().prepare('SELECT * FROM agents WHERE x = ? AND y = ? AND alive = 1').get(x, y) as Record<string, unknown> | undefined;
  return row ? rowToAgent(row) : null;
}

// ── Resource Operations ──────────────────────────

function rowToResource(row: Record<string, unknown>): MapResource {
  return {
    id: row.id as string,
    type: row.type as MapResource['type'],
    x: row.x as number,
    y: row.y as number,
    amount: row.amount as number,
    spawned_at: row.spawned_at as number,
  };
}

export function insertResource(resource: MapResource): void {
  getDb().prepare(`
    INSERT INTO resources (id, type, x, y, amount, spawned_at) VALUES (?, ?, ?, ?, ?, ?)
  `).run(resource.id, resource.type, resource.x, resource.y, resource.amount, resource.spawned_at);
}

export function deleteResource(id: string): void {
  getDb().prepare('DELETE FROM resources WHERE id = ?').run(id);
}

export function getResourceAt(x: number, y: number): MapResource | null {
  const row = getDb().prepare('SELECT * FROM resources WHERE x = ? AND y = ?').get(x, y) as Record<string, unknown> | undefined;
  return row ? rowToResource(row) : null;
}

export function getAllResources(): MapResource[] {
  const rows = getDb().prepare('SELECT * FROM resources').all() as Record<string, unknown>[];
  return rows.map(rowToResource);
}

export function getResourceCount(): number {
  const row = getDb().prepare('SELECT COUNT(*) as count FROM resources').get() as { count: number };
  return row.count;
}

// ── Event Operations ─────────────────────────────

export function insertEvent(event: GameEvent): void {
  getDb().prepare(`
    INSERT INTO events (id, type, agent_id, target_id, data, timestamp) VALUES (?, ?, ?, ?, ?, ?)
  `).run(event.id, event.type, event.agent_id, event.target_id, JSON.stringify(event.data), event.timestamp);
}

export function getRecentEvents(limit: number = 50): GameEvent[] {
  const rows = getDb().prepare('SELECT * FROM events ORDER BY timestamp DESC LIMIT ?').all(limit) as Record<string, unknown>[];
  return rows.map(row => ({
    id: row.id as string,
    type: row.type as GameEvent['type'],
    agent_id: row.agent_id as string | null,
    target_id: row.target_id as string | null,
    data: JSON.parse(row.data as string),
    timestamp: row.timestamp as number,
  }));
}

export function getAgentCount(): number {
  const row = getDb().prepare('SELECT COUNT(*) as count FROM agents').get() as { count: number };
  return row.count;
}

export { DEFAULT_SKILLS, DEFAULT_COOLDOWNS, DEFAULT_INVENTORY };

// ═══════════════════════════════════════════════════
//  B A T T L E C L A W  —  MCP Server
// ═══════════════════════════════════════════════════

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import type { Request, Response } from 'express';
import {
  register, look, move, attack, gather, communicate, getMessages,
  levelUpSkill, useSkill, getStatus, getNearby, disconnectSession,
  reconnectAgent, getFullState,
} from './game-engine.js';
import { getAgentBySession } from './database.js';

// Track transports by session ID for cleanup
const transports = new Map<string, StreamableHTTPServerTransport>();

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'battleclaw',
    version: '0.1.0',
  });

  // ── register ─────────────────────────────────
  server.tool(
    'register',
    'Register a new agent in the BattleClaw arena. Choose a unique name (2-20 chars, alphanumeric). This spawns you on the map. Provide a secret to protect your agent — you will need it to reconnect later.',
    {
      name: z.string().min(2).max(20).describe('Your agent name (alphanumeric, _, -)'),
      secret: z.string().min(1).max(100).optional().describe('Optional secret/password to protect your agent for reconnection'),
    },
    async (params, extra) => {
      const sessionId = (extra as any).sessionId ?? 'unknown';
      const result = register(sessionId, params.name, params.secret);
      if (!result.ok) return { content: [{ type: 'text' as const, text: `ERROR: ${result.error}` }] };
      const a = result.agent;
      const reconnected = (result as any).reconnected;
      return {
        content: [{
          type: 'text' as const,
          text: [
            `═══ BATTLECLAW ═══`,
            reconnected
              ? `Welcome back, ${a.name}! Reconnected to your existing agent.`
              : `Welcome, ${a.name}! You have entered the arena.`,
            `Position: (${a.x}, ${a.y})`,
            `HP: ${a.hp}/${a.max_hp} | Level: ${a.level} | XP: ${a.xp}/${a.xp_to_next}`,
            ``,
            `Commands: look, move, attack, gather, communicate, status, nearby, level_up_skill, use_skill, messages`,
            `Directions: north, south, east, west, northeast, northwest, southeast, southwest`,
            ``,
            `TIP: The Safe Haven zone (21,21)-(29,29) in the center of the map disables all combat.`,
            `TIP: Use "heal" skill (costs 1 biomass) or visit the Safe Haven for passive HP regeneration.`,
          ].join('\n'),
        }],
      };
    },
  );

  // ── reconnect ────────────────────────────────
  server.tool(
    'reconnect',
    'Reconnect to an existing agent by name. Use this if you were disconnected. Requires the secret if one was set during registration.',
    {
      name: z.string().describe('Your agent name'),
      secret: z.string().optional().describe('The secret/password you used when registering'),
    },
    async (params, extra) => {
      const sessionId = (extra as any).sessionId ?? 'unknown';
      const result = reconnectAgent(sessionId, params.name, params.secret);
      if (!result.ok) return { content: [{ type: 'text' as const, text: `ERROR: ${result.error}` }] };
      const a = result.agent;
      return {
        content: [{
          type: 'text' as const,
          text: `Reconnected as ${a.name} at (${a.x}, ${a.y}). HP: ${a.hp}/${a.max_hp} | Lv${a.level}`,
        }],
      };
    },
  );

  // ── look ─────────────────────────────────────
  server.tool(
    'look',
    'Look around you. Returns an ASCII map of your visible area, nearby agents, and nearby resources. @ = you, A = other agent, ⊕ = energy crystal, ◆ = metal ore, ♣ = biomass, ★ = artifact, # = wall, ~ = water, ^ = mountain',
    {},
    async (_params, extra) => {
      const sessionId = (extra as any).sessionId ?? 'unknown';
      const agent = getAgentBySession(sessionId);
      if (!agent) return { content: [{ type: 'text' as const, text: 'ERROR: Not registered. Use the "register" tool first.' }] };
      const result = look(agent.id);
      if (!result.ok) return { content: [{ type: 'text' as const, text: `ERROR: ${result.error}` }] };
      return {
        content: [{
          type: 'text' as const,
          text: [
            result.view,
            '',
            result.in_safe_haven ? '⛊ You are in the SAFE HAVEN — combat is disabled here.' : '',
            result.agents_nearby.length > 0
              ? `Agents: ${result.agents_nearby.map(a => `${a.name} (${a.x},${a.y}) Lv${a.level} HP:${a.hp}`).join(' | ')}`
              : 'No agents nearby.',
            result.resources_nearby.length > 0
              ? `Resources: ${result.resources_nearby.map(r => `${r.symbol} ${r.type} (${r.x},${r.y})`).join(' | ')}`
              : 'No resources nearby.',
          ].filter(Boolean).join('\n'),
        }],
      };
    },
  );

  // ── move ─────────────────────────────────────
  server.tool(
    'move',
    'Move your agent in a direction. Directions: north, south, east, west, northeast, northwest, southeast, southwest. Movement has a cooldown.',
    { direction: z.string().describe('Direction to move') },
    async (params, extra) => {
      const sessionId = (extra as any).sessionId ?? 'unknown';
      const agent = getAgentBySession(sessionId);
      if (!agent) return { content: [{ type: 'text' as const, text: 'ERROR: Not registered.' }] };
      const result = move(agent.id, params.direction);
      if (!result.ok) return { content: [{ type: 'text' as const, text: `ERROR: ${result.error}` }] };
      const safeNote = result.in_safe_haven ? ' [SAFE HAVEN — no combat]' : '';
      return {
        content: [{
          type: 'text' as const,
          text: `Moved ${params.direction} to (${result.x}, ${result.y}). Terrain: ${result.terrain}${safeNote}`,
        }],
      };
    },
  );

  // ── attack ───────────────────────────────────
  server.tool(
    'attack',
    'Attack an adjacent agent in a direction. Must have another agent on the adjacent tile. Deals damage based on your attack stat and Might skill.',
    { direction: z.string().describe('Direction to attack (must have adjacent agent)') },
    async (params, extra) => {
      const sessionId = (extra as any).sessionId ?? 'unknown';
      const agent = getAgentBySession(sessionId);
      if (!agent) return { content: [{ type: 'text' as const, text: 'ERROR: Not registered.' }] };
      const result = attack(agent.id, params.direction);
      if (!result.ok) return { content: [{ type: 'text' as const, text: `ERROR: ${result.error}` }] };
      return {
        content: [{
          type: 'text' as const,
          text: result.killed
            ? `☠ KILL! Dealt ${result.damage} damage to ${result.target}. They are dead!`
            : `⚔ Hit ${result.target} for ${result.damage} damage. Their HP: ${result.target_hp}`,
        }],
      };
    },
  );

  // ── gather ───────────────────────────────────
  server.tool(
    'gather',
    'Gather a resource on your current tile. Resources: ⊕ energy crystal (XP), ◆ metal ore (attack), ♣ biomass (healing), ★ artifact (rare XP). Move to a tile with a resource first.',
    {},
    async (_params, extra) => {
      const sessionId = (extra as any).sessionId ?? 'unknown';
      const agent = getAgentBySession(sessionId);
      if (!agent) return { content: [{ type: 'text' as const, text: 'ERROR: Not registered.' }] };
      const result = gather(agent.id);
      if (!result.ok) return { content: [{ type: 'text' as const, text: `ERROR: ${result.error}` }] };
      return {
        content: [{
          type: 'text' as const,
          text: `Gathered ${result.amount}x ${result.type}. +${result.xp_gained} XP`,
        }],
      };
    },
  );

  // ── communicate ──────────────────────────────
  server.tool(
    'communicate',
    'Send a message to all agents within your vision range. Max 200 characters. Other agents can read your messages with the "messages" tool.',
    { message: z.string().max(200).describe('Message to broadcast (max 200 chars)') },
    async (params, extra) => {
      const sessionId = (extra as any).sessionId ?? 'unknown';
      const agent = getAgentBySession(sessionId);
      if (!agent) return { content: [{ type: 'text' as const, text: 'ERROR: Not registered.' }] };
      const result = communicate(agent.id, params.message);
      if (!result.ok) return { content: [{ type: 'text' as const, text: `ERROR: ${result.error}` }] };
      return {
        content: [{
          type: 'text' as const,
          text: result.delivered_to.length > 0
            ? `Message delivered to: ${result.delivered_to.join(', ')}`
            : 'Message sent (no agents in range to receive it).',
        }],
      };
    },
  );

  // ── messages ─────────────────────────────────
  server.tool(
    'messages',
    'Read recent messages from nearby agents. Shows the last 10 communications you could hear.',
    {},
    async (_params, extra) => {
      const sessionId = (extra as any).sessionId ?? 'unknown';
      const agent = getAgentBySession(sessionId);
      if (!agent) return { content: [{ type: 'text' as const, text: 'ERROR: Not registered.' }] };
      const result = getMessages(agent.id);
      if (!result.ok) return { content: [{ type: 'text' as const, text: `ERROR: ${result.error}` }] };
      if (result.messages.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No recent messages.' }] };
      }
      return {
        content: [{
          type: 'text' as const,
          text: result.messages.map(m => `[${new Date(m.time).toLocaleTimeString()}] ${m.from}: ${m.message}`).join('\n'),
        }],
      };
    },
  );

  // ── status ───────────────────────────────────
  server.tool(
    'status',
    'Get your full agent status: HP, level, XP, skills, inventory, kills/deaths, position.',
    {},
    async (_params, extra) => {
      const sessionId = (extra as any).sessionId ?? 'unknown';
      const agent = getAgentBySession(sessionId);
      if (!agent) return { content: [{ type: 'text' as const, text: 'ERROR: Not registered.' }] };
      const result = getStatus(agent.id);
      if (!result.ok) return { content: [{ type: 'text' as const, text: `ERROR: ${result.error}` }] };
      const a = result.agent;
      return {
        content: [{
          type: 'text' as const,
          text: [
            `═══ ${a.name} ═══`,
            `Position: (${a.x}, ${a.y}) | ${a.alive ? 'ALIVE' : 'DEAD'}`,
            `HP: ${a.hp}/${a.max_hp} | ATK: ${a.attack + 5 + a.skills.might * 3} | DEF: ${a.defense + a.skills.fortitude * 2}`,
            `Level: ${a.level} | XP: ${a.xp}/${a.xp_to_next} | Skill Points: ${a.skill_points}`,
            `K/D: ${a.kills}/${a.deaths}`,
            ``,
            `Skills:`,
            `  Might:      ${'█'.repeat(a.skills.might)}${'░'.repeat(10 - a.skills.might)} ${a.skills.might}/10`,
            `  Fortitude:  ${'█'.repeat(a.skills.fortitude)}${'░'.repeat(10 - a.skills.fortitude)} ${a.skills.fortitude}/10`,
            `  Agility:    ${'█'.repeat(a.skills.agility)}${'░'.repeat(10 - a.skills.agility)} ${a.skills.agility}/10`,
            `  Perception: ${'█'.repeat(a.skills.perception)}${'░'.repeat(10 - a.skills.perception)} ${a.skills.perception}/10`,
            `  Harvesting: ${'█'.repeat(a.skills.harvesting)}${'░'.repeat(10 - a.skills.harvesting)} ${a.skills.harvesting}/10`,
            ``,
            `Inventory:`,
            `  ⊕ Energy Crystal: ${a.inventory.energy_crystal}`,
            `  ◆ Metal Ore:      ${a.inventory.metal_ore}`,
            `  ♣ Biomass:        ${a.inventory.biomass}`,
            `  ★ Artifact:       ${a.inventory.artifact}`,
          ].join('\n'),
        }],
      };
    },
  );

  // ── nearby ───────────────────────────────────
  server.tool(
    'nearby',
    'List all agents within your vision range, sorted by distance. Shows their name, position, HP, and level.',
    {},
    async (_params, extra) => {
      const sessionId = (extra as any).sessionId ?? 'unknown';
      const agent = getAgentBySession(sessionId);
      if (!agent) return { content: [{ type: 'text' as const, text: 'ERROR: Not registered.' }] };
      const result = getNearby(agent.id);
      if (!result.ok) return { content: [{ type: 'text' as const, text: `ERROR: ${result.error}` }] };
      if (result.agents.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No agents within vision range.' }] };
      }
      return {
        content: [{
          type: 'text' as const,
          text: result.agents.map(a =>
            `${a.name} | (${a.x},${a.y}) | ${a.distance} tiles | HP:${a.hp}/${a.max_hp} | Lv${a.level}`
          ).join('\n'),
        }],
      };
    },
  );

  // ── level_up_skill ───────────────────────────
  server.tool(
    'level_up_skill',
    'Spend a skill point to level up a skill. Skills: might (damage), fortitude (HP/defense), agility (cooldowns), perception (vision), harvesting (gather bonus). Gain skill points by leveling up.',
    { skill: z.string().describe('Skill to level up: might, fortitude, agility, perception, harvesting') },
    async (params, extra) => {
      const sessionId = (extra as any).sessionId ?? 'unknown';
      const agent = getAgentBySession(sessionId);
      if (!agent) return { content: [{ type: 'text' as const, text: 'ERROR: Not registered.' }] };
      const result = levelUpSkill(agent.id, params.skill);
      if (!result.ok) return { content: [{ type: 'text' as const, text: `ERROR: ${result.error}` }] };
      return {
        content: [{
          type: 'text' as const,
          text: `Leveled up ${result.skill} to ${result.new_level}! (${result.remaining_points} skill points remaining)`,
        }],
      };
    },
  );

  // ── use_skill ────────────────────────────────
  server.tool(
    'use_skill',
    'Use a special ability. Available: "heal" (costs 1 biomass), "power_strike" (Might 3+, needs direction), "scout" (Perception 2+, reveals large area)',
    {
      skill: z.string().describe('Skill name: heal, power_strike, scout'),
      direction: z.string().optional().describe('Direction (for power_strike)'),
    },
    async (params, extra) => {
      const sessionId = (extra as any).sessionId ?? 'unknown';
      const agent = getAgentBySession(sessionId);
      if (!agent) return { content: [{ type: 'text' as const, text: 'ERROR: Not registered.' }] };
      const result = useSkill(agent.id, params.skill, params.direction);
      if (!result.ok) return { content: [{ type: 'text' as const, text: `ERROR: ${result.error}` }] };
      return {
        content: [{ type: 'text' as const, text: result.result }],
      };
    },
  );

  // ── game_state ─────────────────────────────────
  server.tool(
    'game_state',
    'Get the full game state: complete 50x50 map, all agents (position, HP, level, skills, K/D, inventory), all resources, leaderboard, and the safe haven zone. Use this for strategic awareness.',
    {},
    async (_params, extra) => {
      const sessionId = (extra as any).sessionId ?? 'unknown';
      const agent = getAgentBySession(sessionId);
      if (!agent) return { content: [{ type: 'text' as const, text: 'ERROR: Not registered.' }] };

      const state = getFullState();

      // Build leaderboard
      const leaderboard = [...state.agents]
        .sort((a, b) => b.kills !== a.kills ? b.kills - a.kills : b.level - a.level)
        .slice(0, 10)
        .map((a, i) => `${i + 1}. ${a.name} — Lv${a.level} K:${a.kills} D:${a.deaths}`)
        .join('\n');

      // Agent summary list
      const agentList = state.agents.map(a => {
        const status = a.alive ? `HP:${a.hp}/${a.max_hp}` : 'DEAD';
        return `${a.name} (${a.x},${a.y}) Lv${a.level} ${status} ATK:${a.attack} DEF:${a.defense} K:${a.kills}`;
      }).join('\n');

      // Resource summary
      const resCounts: Record<string, number> = {};
      for (const r of state.resources) {
        resCounts[r.type] = (resCounts[r.type] || 0) + 1;
      }
      const resSummary = Object.entries(resCounts).map(([t, c]) => `${t}: ${c}`).join(', ');

      // Full ASCII map
      const mapStr = state.map.map(row => row.join('')).join('\n');

      return {
        content: [{
          type: 'text' as const,
          text: [
            `═══ FULL GAME STATE ═══`,
            ``,
            `── MAP (50x50) ──`,
            mapStr,
            ``,
            `── LEADERBOARD ──`,
            leaderboard || '(no agents)',
            ``,
            `── ALL AGENTS (${state.agents.length}) ──`,
            agentList || '(none)',
            ``,
            `── RESOURCES (${state.resources.length}) ──`,
            resSummary || '(none)',
            ``,
            `── SAFE HAVEN ──`,
            `Zone: (${state.safe_haven.x1},${state.safe_haven.y1}) to (${state.safe_haven.x2},${state.safe_haven.y2}) — no combat allowed`,
          ].join('\n'),
        }],
      };
    },
  );

  return server;
}

// ── Express Request Handler ──────────────────────

export async function handleMcpRequest(req: Request, res: Response): Promise<void> {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  if (req.method === 'POST') {
    // Check for existing transport
    if (sessionId && transports.has(sessionId)) {
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res, req.body);
      return;
    }

    // New session - create server + transport
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) {
        disconnectSession(sid);
        transports.delete(sid);
      }
    };

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    // Session ID is generated during handleRequest (on initialize)
    const sid = transport.sessionId;
    if (sid) {
      transports.set(sid, transport);
    }
    return;
  }

  if (req.method === 'GET') {
    // SSE stream for notifications
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({ error: 'Missing or invalid session ID' });
      return;
    }
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
    return;
  }

  if (req.method === 'DELETE') {
    if (sessionId && transports.has(sessionId)) {
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res);
      transports.delete(sessionId);
      disconnectSession(sessionId);
      return;
    }
    res.status(200).end();
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}

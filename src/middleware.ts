// ═══════════════════════════════════════════════════
//  B A T T L E C L A W  —  Rate Limiting Middleware
// ═══════════════════════════════════════════════════

import type { Request, Response, NextFunction } from 'express';
import type { IncomingMessage } from 'http';

// ── IP Detection ─────────────────────────────────

function getClientIp(req: Request): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    || req.ip
    || 'unknown';
}

function getClientIpRaw(req: IncomingMessage): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    || req.socket.remoteAddress
    || 'unknown';
}

// ── Sliding Window Rate Limiter ──────────────────

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

function createRateLimiter(maxRequests: number, windowMs: number) {
  const entries = new Map<string, RateLimitEntry>();

  // Auto-cleanup stale entries every 60 seconds
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of entries) {
      if (now - entry.windowStart > windowMs * 2) {
        entries.delete(key);
      }
    }
  }, 60_000);
  cleanup.unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = getClientIp(req);
    const now = Date.now();
    const entry = entries.get(ip);

    if (!entry || now - entry.windowStart >= windowMs) {
      entries.set(ip, { count: 1, windowStart: now });
      next();
      return;
    }

    if (entry.count >= maxRequests) {
      const retryAfter = Math.ceil((entry.windowStart + windowMs - now) / 1000);
      res.set('Retry-After', String(Math.max(retryAfter, 1)));
      res.status(429).json({ error: 'Too many requests. Slow down.', retry_after: Math.max(retryAfter, 1) });
      return;
    }

    entry.count++;
    next();
  };
}

// ── Exported Middleware ──────────────────────────

// /mcp: 5 requests/second per IP (MCP protocol needs multiple rapid exchanges during handshake)
export const mcpRateLimiter = createRateLimiter(5, 1000);

// /api/state: 5 requests/second per IP
export const apiRateLimiter = createRateLimiter(5, 1000);

// ── WebSocket Connection Limiter ─────────────────

const MAX_WS_CONNECTIONS = 50;
const MAX_WS_PER_IP = 3;

const wsConnectionsPerIp = new Map<string, number>();
let totalWsConnections = 0;

export function canAcceptWebSocket(req: IncomingMessage): { allowed: boolean; reason?: string } {
  if (totalWsConnections >= MAX_WS_CONNECTIONS) {
    return { allowed: false, reason: 'Too many spectator connections' };
  }

  const ip = getClientIpRaw(req);
  const ipCount = wsConnectionsPerIp.get(ip) || 0;
  if (ipCount >= MAX_WS_PER_IP) {
    return { allowed: false, reason: 'Too many connections from your IP' };
  }

  return { allowed: true };
}

export function trackWebSocketOpen(req: IncomingMessage): void {
  const ip = getClientIpRaw(req);
  wsConnectionsPerIp.set(ip, (wsConnectionsPerIp.get(ip) || 0) + 1);
  totalWsConnections++;
}

export function trackWebSocketClose(req: IncomingMessage): void {
  const ip = getClientIpRaw(req);
  const count = (wsConnectionsPerIp.get(ip) || 1) - 1;
  if (count <= 0) {
    wsConnectionsPerIp.delete(ip);
  } else {
    wsConnectionsPerIp.set(ip, count);
  }
  totalWsConnections = Math.max(0, totalWsConnections - 1);
}

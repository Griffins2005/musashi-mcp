/**
 * Session management for HTTP+SSE MCP transport
 * Tracks active sessions, expiry, and cleanup
 */

import { randomBytes } from 'crypto';
import { Response } from 'express';

export interface Session {
  id: string;
  apiKey: string;
  createdAt: Date;
  expiresAt: Date;
  sseConnection: Response | null;
  lastActivity: Date;
}

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private readonly SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
  private readonly MAX_SESSIONS_PER_KEY = 5;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Start cleanup job every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 5 * 60 * 1000);
  }

  /**
   * Create a new session
   * @param apiKey - API key for this session
   * @returns Session object
   * @throws Error if max sessions per key exceeded
   */
  createSession(apiKey: string): Session {
    // Check concurrent session limit per API key
    const existingSessions = this.getSessionsByApiKey(apiKey);
    if (existingSessions.length >= this.MAX_SESSIONS_PER_KEY) {
      throw new Error(`Maximum concurrent sessions exceeded (${this.MAX_SESSIONS_PER_KEY})`);
    }

    const now = new Date();
    const session: Session = {
      id: this.generateSessionId(),
      apiKey,
      createdAt: now,
      expiresAt: new Date(now.getTime() + this.SESSION_TTL_MS),
      sseConnection: null,
      lastActivity: now,
    };

    this.sessions.set(session.id, session);
    console.log(`[SessionManager] Created session ${session.id} for API key ${apiKey.slice(0, 12)}...`);

    return session;
  }

  /**
   * Get session by ID
   * @param sessionId - Session ID
   * @returns Session object or null if not found
   */
  getSession(sessionId: string): Session | null {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return null;
    }

    // Check if expired
    if (new Date() > session.expiresAt) {
      this.deleteSession(sessionId);
      return null;
    }

    return session;
  }

  /**
   * Verify session belongs to API key
   * @param sessionId - Session ID
   * @param apiKey - API key to verify against
   * @returns true if session belongs to key, false otherwise
   */
  verifySessionOwnership(sessionId: string, apiKey: string): boolean {
    const session = this.getSession(sessionId);
    return session?.apiKey === apiKey;
  }

  /**
   * Update last activity timestamp for session
   * @param sessionId - Session ID
   */
  updateActivity(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = new Date();
    }
  }

  /**
   * Attach SSE connection to session
   * @param sessionId - Session ID
   * @param res - Express Response object for SSE
   * @returns true if attached, false if session already has connection
   */
  attachSSEConnection(sessionId: string, res: Response): boolean {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return false;
    }

    // Only one SSE connection per session
    if (session.sseConnection !== null) {
      return false;
    }

    session.sseConnection = res;
    console.log(`[SessionManager] Attached SSE connection to session ${sessionId}`);
    return true;
  }

  /**
   * Detach SSE connection from session
   * @param sessionId - Session ID
   */
  detachSSEConnection(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.sseConnection = null;
      console.log(`[SessionManager] Detached SSE connection from session ${sessionId}`);
    }
  }

  /**
   * Send message via SSE to session
   * @param sessionId - Session ID
   * @param message - JSON-RPC message to send
   * @returns true if sent, false if no active connection
   */
  sendSSEMessage(sessionId: string, message: any): boolean {
    const session = this.sessions.get(sessionId);

    if (!session || !session.sseConnection) {
      return false;
    }

    try {
      const data = JSON.stringify(message);
      session.sseConnection.write(`data: ${data}\n\n`);
      this.updateActivity(sessionId);
      return true;
    } catch (error) {
      console.error(`[SessionManager] Failed to send SSE message to session ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Delete session
   * @param sessionId - Session ID
   */
  deleteSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      // Close SSE connection if exists
      if (session.sseConnection) {
        try {
          session.sseConnection.end();
        } catch (error) {
          // Ignore errors on close
        }
      }

      this.sessions.delete(sessionId);
      console.log(`[SessionManager] Deleted session ${sessionId}`);
    }
  }

  /**
   * Get all sessions for an API key
   * @param apiKey - API key
   * @returns Array of sessions
   */
  getSessionsByApiKey(apiKey: string): Session[] {
    return Array.from(this.sessions.values()).filter(s => s.apiKey === apiKey);
  }

  /**
   * Get total number of active sessions
   */
  getActiveSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Get number of active SSE connections
   */
  getActiveConnectionCount(): number {
    return Array.from(this.sessions.values()).filter(s => s.sseConnection !== null).length;
  }

  /**
   * Cleanup expired sessions
   */
  private cleanupExpiredSessions(): void {
    const now = new Date();
    let expiredCount = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (now > session.expiresAt) {
        this.deleteSession(sessionId);
        expiredCount++;
      }
    }

    if (expiredCount > 0) {
      console.log(`[SessionManager] Cleaned up ${expiredCount} expired sessions`);
    }
  }

  /**
   * Generate unique session ID
   * Format: sess_<32_hex_chars>
   */
  private generateSessionId(): string {
    return `sess_${randomBytes(16).toString('hex')}`;
  }

  /**
   * Cleanup on shutdown
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Close all SSE connections
    for (const session of this.sessions.values()) {
      if (session.sseConnection) {
        try {
          session.sseConnection.end();
        } catch (error) {
          // Ignore
        }
      }
    }

    this.sessions.clear();
    console.log('[SessionManager] Destroyed');
  }
}

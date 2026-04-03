#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { StreamableHttpServer } from './server/streamable-http-server.js';

const API_BASE_URL = (process.env.MUSASHI_API_BASE_URL || 'https://musashi-api.vercel.app').replace(/\/$/, '');

type JsonRecord = Record<string, any>;

function formatPercent(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'n/a';
  }

  return `${(value * 100).toFixed(1)}%`;
}

function formatVolume(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'n/a';
  }

  return `$${value.toLocaleString()}`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return 'n/a';
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function buildTextResult(lines: string[], isError = false): JsonRecord {
  return {
    content: [
      {
        type: 'text',
        text: lines.filter(Boolean).join('\n'),
      },
    ],
    ...(isError ? { isError: true } : {}),
  };
}

async function fetchJson(path: string, init?: RequestInit): Promise<JsonRecord> {
  const response = await fetch(`${API_BASE_URL}${path}`, init);
  const text = await response.text();

  let payload: JsonRecord = {};
  if (text) {
    try {
      payload = JSON.parse(text) as JsonRecord;
    } catch {
      throw new Error(`Invalid JSON response from ${path}: ${text.slice(0, 200)}`);
    }
  }

  if (!response.ok) {
    throw new Error(payload.error || `Request failed with HTTP ${response.status}`);
  }

  return payload;
}

class MusashiMcpServer {
  private readonly server: Server;
  private streamableHttpServer: StreamableHttpServer | null = null;

  constructor() {
    this.server = new Server(
      {
        name: 'musashi',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.registerToolHandlers();
    this.registerProcessHandlers();
  }

  private registerToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'analyze_text',
          description: 'Analyze text against live Polymarket and Kalshi markets and return Musashi signal data.',
          inputSchema: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Text to analyze.' },
              minConfidence: { type: 'number', minimum: 0, maximum: 1 },
              maxResults: { type: 'number', minimum: 1, maximum: 100 },
            },
            required: ['text'],
          },
        },
        {
          name: 'get_arbitrage',
          description: 'Find live cross-platform arbitrage opportunities across Polymarket and Kalshi.',
          inputSchema: {
            type: 'object',
            properties: {
              minSpread: { type: 'number', minimum: 0, maximum: 1 },
              minConfidence: { type: 'number', minimum: 0, maximum: 1 },
              limit: { type: 'number', minimum: 1, maximum: 100 },
              category: { type: 'string' },
            },
          },
        },
        {
          name: 'get_movers',
          description: 'Return markets with significant price changes.',
          inputSchema: {
            type: 'object',
            properties: {
              minChange: { type: 'number', minimum: 0, maximum: 1 },
              limit: { type: 'number', minimum: 1, maximum: 100 },
              category: { type: 'string' },
            },
          },
        },
        {
          name: 'ground_probability',
          description: 'Ground a probability claim in live market prices and compare it to an LLM estimate.',
          inputSchema: {
            type: 'object',
            properties: {
              claim: { type: 'string' },
              llm_estimate: { type: 'number', minimum: 0, maximum: 1 },
              min_confidence: { type: 'number', minimum: 0, maximum: 1 },
              max_markets: { type: 'number', minimum: 1, maximum: 20 },
            },
            required: ['claim'],
          },
        },
        {
          name: 'get_feed',
          description: 'Fetch analyzed tweets from the Musashi feed.',
          inputSchema: {
            type: 'object',
            properties: {
              category: { type: 'string' },
              minUrgency: {
                type: 'string',
                enum: ['low', 'medium', 'high', 'critical'],
              },
              limit: { type: 'number', minimum: 1, maximum: 100 },
              since: { type: 'string' },
            },
          },
        },
        {
          name: 'get_feed_stats',
          description: 'Fetch summary statistics for the Musashi Twitter feed.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'get_feed_accounts',
          description: 'List the curated Twitter accounts Musashi tracks.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'get_health',
          description: 'Check API health and upstream market-source status.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'analyze_text':
            return await this.handleAnalyzeText(args ?? {});
          case 'get_arbitrage':
            return await this.handleGetArbitrage(args ?? {});
          case 'get_movers':
            return await this.handleGetMovers(args ?? {});
          case 'ground_probability':
            return await this.handleGroundProbability(args ?? {});
          case 'get_feed':
            return await this.handleGetFeed(args ?? {});
          case 'get_feed_stats':
            return await this.handleGetFeedStats();
          case 'get_feed_accounts':
            return await this.handleGetFeedAccounts();
          case 'get_health':
            return await this.handleGetHealth();
          default:
            return buildTextResult([`Unknown tool: ${name}`], true);
        }
      } catch (error) {
        return buildTextResult(
          [error instanceof Error ? error.message : 'Unknown MCP tool error'],
          true
        );
      }
    });
  }

  private async handleAnalyzeText(args: JsonRecord): Promise<JsonRecord> {
    const payload = await fetchJson('/api/analyze-text', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: args.text,
        minConfidence: args.minConfidence,
        maxResults: args.maxResults,
      }),
    });

    const data = payload.data ?? {};
    const matches = Array.isArray(data.markets) ? data.markets : [];

    if (matches.length === 0) {
      return buildTextResult([
        `No matching markets found for "${String(args.text || '')}".`,
      ]);
    }

    const lines = [`Found ${matches.length} matching markets:`, ''];

    matches.forEach((match: JsonRecord, index: number) => {
      const market = match.market ?? {};
      lines.push(`${index + 1}. ${market.title || 'Untitled market'}`);
      lines.push(`Platform: ${market.platform || 'n/a'}`);
      lines.push(`Yes price: ${formatPercent(market.yesPrice)}`);
      lines.push(`Volume 24h: ${formatVolume(market.volume24h)}`);
      lines.push(`Match confidence: ${formatPercent(match.confidence)}`);
      if (Array.isArray(match.matchedKeywords) && match.matchedKeywords.length > 0) {
        lines.push(`Matched keywords: ${match.matchedKeywords.join(', ')}`);
      }
      if (market.url) {
        lines.push(`URL: ${market.url}`);
      }
      lines.push('');
    });

    if (data.suggested_action) {
      lines.push('Suggested action:');
      lines.push(`Direction: ${data.suggested_action.direction}`);
      lines.push(`Confidence: ${formatPercent(data.suggested_action.confidence)}`);
      lines.push(`Edge: ${formatPercent(data.suggested_action.edge)}`);
      lines.push(`Reasoning: ${data.suggested_action.reasoning}`);
      lines.push('');
    }

    if (data.sentiment) {
      lines.push('Sentiment:');
      lines.push(`${data.sentiment.sentiment} (${formatPercent(data.sentiment.confidence)})`);
      lines.push('');
    }

    if (data.arbitrage) {
      lines.push('Arbitrage context:');
      lines.push(`Spread: ${formatPercent(data.arbitrage.spread)}`);
      lines.push(`Direction: ${data.arbitrage.direction}`);
      lines.push('');
    }

    if (data.metadata) {
      lines.push(
        `Processing: ${data.metadata.processing_time_ms ?? 'n/a'}ms | Data age: ${data.metadata.data_age_seconds ?? 'n/a'}s`
      );
    }

    return buildTextResult(lines);
  }

  private async handleGetArbitrage(args: JsonRecord): Promise<JsonRecord> {
    const params = new URLSearchParams();

    if (args.minSpread !== undefined) params.set('minSpread', String(args.minSpread));
    if (args.minConfidence !== undefined) params.set('minConfidence', String(args.minConfidence));
    if (args.limit !== undefined) params.set('limit', String(args.limit));
    if (args.category) params.set('category', String(args.category));

    const payload = await fetchJson(`/api/markets/arbitrage?${params.toString()}`);
    const opportunities = payload.data?.opportunities ?? [];

    if (!Array.isArray(opportunities) || opportunities.length === 0) {
      return buildTextResult(['No arbitrage opportunities found for the requested filters.']);
    }

    const lines = [`Found ${opportunities.length} arbitrage opportunities:`, ''];

    opportunities.forEach((opportunity: JsonRecord, index: number) => {
      const polymarket = opportunity.polymarket ?? {};
      const kalshi = opportunity.kalshi ?? {};
      lines.push(`${index + 1}. ${polymarket.title || kalshi.title || 'Untitled market'}`);
      lines.push(`Spread: ${formatPercent(opportunity.spread)}`);
      lines.push(`Direction: ${opportunity.direction || 'n/a'}`);
      lines.push(`Polymarket yes: ${formatPercent(polymarket.yesPrice)} | volume ${formatVolume(polymarket.volume24h)}`);
      lines.push(`Kalshi yes: ${formatPercent(kalshi.yesPrice)} | volume ${formatVolume(kalshi.volume24h)}`);
      lines.push(`Match confidence: ${formatPercent(opportunity.confidence)}`);
      if (opportunity.matchReason) {
        lines.push(`Match reason: ${opportunity.matchReason}`);
      }
      lines.push('');
    });

    return buildTextResult(lines);
  }

  private async handleGetMovers(args: JsonRecord): Promise<JsonRecord> {
    const params = new URLSearchParams();

    if (args.minChange !== undefined) params.set('minChange', String(args.minChange));
    if (args.limit !== undefined) params.set('limit', String(args.limit));
    if (args.category) params.set('category', String(args.category));

    const payload = await fetchJson(`/api/markets/movers?${params.toString()}`);
    const movers = payload.data?.movers ?? [];

    if (!Array.isArray(movers) || movers.length === 0) {
      return buildTextResult(['No significant movers found for the requested filters.']);
    }

    const lines = [`Found ${movers.length} market movers:`, ''];

    movers.forEach((mover: JsonRecord, index: number) => {
      const market = mover.market ?? {};
      lines.push(`${index + 1}. ${market.title || 'Untitled market'}`);
      lines.push(`Direction: ${mover.direction || 'n/a'}`);
      lines.push(`Change: ${formatPercent(mover.priceChange1h)}`);
      lines.push(`Previous: ${formatPercent(mover.previousPrice)} | Current: ${formatPercent(mover.currentPrice)}`);
      lines.push(`Platform: ${market.platform || 'n/a'} | Volume: ${formatVolume(market.volume24h)}`);
      lines.push('');
    });

    return buildTextResult(lines);
  }

  private async handleGroundProbability(args: JsonRecord): Promise<JsonRecord> {
    const payload = await fetchJson('/api/ground-probability', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        claim: args.claim,
        llm_estimate: args.llm_estimate,
        min_confidence: args.min_confidence,
        max_markets: args.max_markets,
      }),
    });

    const consensus = payload.market_consensus ?? {};
    const lines = ['Ground probability analysis:', ''];

    lines.push(`Claim: ${payload.claim || String(args.claim || '')}`);
    lines.push(`Market consensus: ${formatPercent(consensus.price)}`);
    lines.push(`Market-match confidence: ${formatPercent(consensus.confidence)}`);
    lines.push(`Markets considered: ${consensus.market_count ?? 0}`);

    if (payload.llm_estimate !== null && payload.llm_estimate !== undefined) {
      lines.push(`LLM estimate: ${formatPercent(payload.llm_estimate)}`);
    }

    if (payload.divergence) {
      lines.push(`Divergence type: ${payload.divergence.type}`);
      lines.push(`Divergence magnitude: ${payload.divergence.magnitude_percent?.toFixed?.(1) ?? 'n/a'} percentage points`);
      lines.push(`Insight: ${payload.divergence.insight}`);
    }

    const markets = Array.isArray(consensus.markets) ? consensus.markets : [];
    if (markets.length > 0) {
      lines.push('');
      lines.push('Supporting markets:');
      markets.forEach((market: JsonRecord, index: number) => {
        lines.push(`${index + 1}. ${market.title}`);
        lines.push(`Platform: ${market.platform}`);
        lines.push(`Yes price: ${formatPercent(market.yes_price)}`);
        lines.push(`Volume 24h: ${formatVolume(market.volume_24h)}`);
        lines.push(`Match confidence: ${formatPercent(market.match_confidence)}`);
        if (market.url) {
          lines.push(`URL: ${market.url}`);
        }
      });
    }

    if (payload.metadata) {
      lines.push('');
      lines.push(
        `Processing: ${payload.metadata.processing_time_ms ?? 'n/a'}ms | Data age: ${payload.metadata.data_age_seconds ?? 'n/a'}s`
      );
    }

    return buildTextResult(lines);
  }

  private async handleGetFeed(args: JsonRecord): Promise<JsonRecord> {
    const params = new URLSearchParams();

    if (args.category) params.set('category', String(args.category));
    if (args.minUrgency) params.set('minUrgency', String(args.minUrgency));
    if (args.limit !== undefined) params.set('limit', String(args.limit));
    if (args.since) params.set('since', String(args.since));

    const payload = await fetchJson(`/api/feed?${params.toString()}`);
    const tweets = payload.data?.tweets ?? [];

    if (!Array.isArray(tweets) || tweets.length === 0) {
      return buildTextResult(['No feed items found for the requested filters.']);
    }

    const lines = [`Found ${tweets.length} feed items:`, ''];

    tweets.forEach((tweet: JsonRecord, index: number) => {
      const rawTweet = tweet.tweet ?? {};
      lines.push(`${index + 1}. @${rawTweet.author || 'unknown'} (${tweet.urgency || 'n/a'} urgency)`);
      lines.push(`${rawTweet.text || ''}`);
      lines.push(`Collected: ${formatDate(tweet.collected_at)}`);
      lines.push(`Matches: ${Array.isArray(tweet.matches) ? tweet.matches.length : 0}`);
      lines.push('');
    });

    return buildTextResult(lines);
  }

  private async handleGetFeedStats(): Promise<JsonRecord> {
    const payload = await fetchJson('/api/feed/stats');
    const data = payload.data ?? {};
    const lines = ['Feed statistics:', ''];

    lines.push(`Last collection: ${formatDate(data.last_collection)}`);
    lines.push(`Tweets last 1h: ${data.tweets?.last_1h ?? 0}`);
    lines.push(`Tweets last 6h: ${data.tweets?.last_6h ?? 0}`);
    lines.push(`Tweets last 24h: ${data.tweets?.last_24h ?? 0}`);

    if (data.by_category) {
      lines.push('');
      lines.push('By category:');
      for (const [category, count] of Object.entries(data.by_category)) {
        lines.push(`${category}: ${count}`);
      }
    }

    if (data.by_urgency) {
      lines.push('');
      lines.push('By urgency:');
      for (const [urgency, count] of Object.entries(data.by_urgency)) {
        lines.push(`${urgency}: ${count}`);
      }
    }

    if (Array.isArray(data.top_markets) && data.top_markets.length > 0) {
      lines.push('');
      lines.push('Top markets:');
      data.top_markets.forEach((entry: JsonRecord, index: number) => {
        const market = entry.market ?? {};
        lines.push(`${index + 1}. ${market.title || 'Untitled market'} (${entry.mention_count ?? 0} mentions)`);
      });
    }

    return buildTextResult(lines);
  }

  private async handleGetFeedAccounts(): Promise<JsonRecord> {
    const payload = await fetchJson('/api/feed/accounts');
    const accounts = payload.data?.accounts ?? [];

    if (!Array.isArray(accounts) || accounts.length === 0) {
      return buildTextResult(['No tracked accounts found.']);
    }

    const lines = [`Tracked accounts (${accounts.length}):`, ''];

    accounts.forEach((account: JsonRecord, index: number) => {
      lines.push(`${index + 1}. @${account.username}`);
      lines.push(`Category: ${account.category || 'n/a'} | Priority: ${account.priority || 'n/a'}`);
      if (account.description) {
        lines.push(account.description);
      }
      lines.push('');
    });

    return buildTextResult(lines);
  }

  private async handleGetHealth(): Promise<JsonRecord> {
    const payload = await fetchJson('/api/health');
    const health = payload.data ?? {};

    return buildTextResult([
      'API health:',
      '',
      `Status: ${health.status || 'n/a'}`,
      `Response time: ${health.response_time_ms ?? 'n/a'}ms`,
      `Uptime: ${health.uptime_ms ?? 'n/a'}ms`,
      `Polymarket: ${health.services?.polymarket?.status || 'n/a'}`,
      `Kalshi: ${health.services?.kalshi?.status || 'n/a'}`,
    ]);
  }

  private registerProcessHandlers(): void {
    this.server.onerror = (error) => {
      console.error('[MCP] Server error:', error);
    };

    process.on('SIGINT', async () => {
      await this.cleanup();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      await this.cleanup();
      process.exit(0);
    });
  }

  private async cleanup(): Promise<void> {
    if (this.streamableHttpServer) {
      await this.streamableHttpServer.stop();
    }
  }

  async startStdio(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }

  async startHttp(port: number): Promise<void> {
    this.streamableHttpServer = new StreamableHttpServer({
      port,
      onRequest: async (_sessionId: string | null, request: JsonRecord) => {
        return await this.handleJsonRpcRequest(request);
      },
      onNotification: async (_sessionId: string | null, notification: JsonRecord) => {
        await this.handleJsonRpcNotification(notification);
      },
      onResponse: async (_sessionId: string | null, response: JsonRecord) => {
        console.log('[MCP] Client response:', response);
      },
    });

    await this.streamableHttpServer.start(port);
  }

  private async handleJsonRpcRequest(request: JsonRecord): Promise<JsonRecord> {
    const { method, params, id } = request;

    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'musashi',
            version: '1.0.0',
          },
        },
      };
    }

    if (method === 'tools/list') {
      const tools = await this.server.request({ method: 'tools/list' }, ListToolsRequestSchema);
      return { jsonrpc: '2.0', id, result: tools };
    }

    if (method === 'tools/call') {
      const result = await this.server.request(
        { method: 'tools/call', params },
        CallToolRequestSchema
      );
      return { jsonrpc: '2.0', id, result };
    }

    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `Method not found: ${String(method)}`,
      },
    };
  }

  private async handleJsonRpcNotification(notification: JsonRecord): Promise<void> {
    if (notification.method === 'notifications/initialized') {
      console.log('[MCP] Client initialized');
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const transportType = args.includes('--transport=http') ? 'http' : 'stdio';
  const server = new MusashiMcpServer();

  if (transportType === 'http') {
    const port = Number.parseInt(process.env.PORT || '3000', 10);
    await server.startHttp(port);
    return;
  }

  await server.startStdio();
}

main().catch((error) => {
  console.error('[MCP] Fatal error:', error);
  process.exit(1);
});

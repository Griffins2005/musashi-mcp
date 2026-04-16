import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

export const VALID_KEY = process.env.MUSASHI_MCP_TEST_KEY || 'mcp_sk_test_wallet_tools_key';
export const MCP_PROTOCOL_VERSION = '2025-06-18';
export const CASE_TIMEOUT_MS = readIntEnv('MUSASHI_MCP_TEST_CASE_TIMEOUT_MS', 300000);
export const MCP_TEST_OPTIONS = {
  concurrency: false,
  timeout: CASE_TIMEOUT_MS,
};

export function pass(detail) {
  return { level: 'pass', detail };
}

export function warn(detail) {
  return { level: 'warn', detail };
}

export function fail(detail) {
  return { level: 'fail', detail };
}

export function testOptions(skip = false) {
  return skip ? { ...MCP_TEST_OPTIONS, skip } : MCP_TEST_OPTIONS;
}

export function runMcpCase(run) {
  return async (context) => {
    try {
      const result = await run(context);
      context.diagnostic(`${result.level.toUpperCase()}: ${result.detail}`);

      if (result.level === 'warn') {
        context.skip(result.detail);
        return;
      }

      if (result.level === 'fail') {
        throw new Error(result.detail);
      }
    } catch (error) {
      throw new Error(toErrorMessage(error));
    }
  };
}

export async function withMockMcp(run, options = {}) {
  const mockApi = createMockApiServer(options.mockApi);
  const apiBaseUrl = await listen(mockApi);
  const port = options.port ?? randomTestPort();
  const child = spawnMcpServer(port, apiBaseUrl, options);
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await waitForServer(`${baseUrl}/health`);
    const sessionId = await initializeMcp(baseUrl, options.clientName);
    return await run({
      apiBaseUrl,
      baseUrl,
      sessionId,
      child,
      mockApi,
    });
  } finally {
    await stopChild(child);
    await closeServer(mockApi);
  }
}

export async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForServer(url, attempts = 40) {
  let lastError;

  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = new Error(`Status ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await wait(250);
  }

  throw lastError ?? new Error('Server did not start in time');
}

export async function stopChild(child) {
  if (child.exitCode !== null || child.killed) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([exited, wait(1500).then(() => child.kill('SIGKILL'))]);
  await exited.catch(() => {});
}

export function spawnMcpServer(port, apiBaseUrl, options = {}) {
  return spawn(process.execPath, ['dist/index.js', '--transport=http'], {
    cwd: new URL('../../', import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      MUSASHI_API_BASE_URL: apiBaseUrl,
      MUSASHI_MCP_API_KEY: options.apiKey ?? VALID_KEY,
    },
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
  });
}

export function randomTestPort() {
  return 15000 + Math.floor(Math.random() * 2000);
}

export async function initializeMcp(baseUrl, clientName = 'mcp-test-client') {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      ...jsonRpcHeaders(),
      Authorization: `Bearer ${VALID_KEY}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: clientName, version: '0.0.1' },
      },
    }),
  });

  assert.equal(response.status, 200);
  const sessionId = response.headers.get('mcp-session-id');
  assert.ok(sessionId);
  return sessionId;
}

export async function callMcp(baseUrl, sessionId, method, params = {}) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      ...jsonRpcHeaders(),
      Authorization: `Bearer ${VALID_KEY}`,
      'Mcp-Session-Id': sessionId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Math.floor(Math.random() * 100000),
      method,
      params,
    }),
  });

  assert.equal(response.status, 200);
  return response.json();
}

export async function callTool(baseUrl, sessionId, name, toolArguments = {}) {
  return callMcp(baseUrl, sessionId, 'tools/call', {
    name,
    arguments: toolArguments,
  });
}

export function jsonRpcHeaders() {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
  };
}

export function textFromToolResult(result) {
  return result.result.content.map((part) => part.text).join('\n');
}

export function createMockApiServer(options = {}) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const btcMarket = {
      id: 'polymarket-abc',
      platform: 'polymarket',
      title: 'Will BTC hit 100k?',
      description: 'Bitcoin price milestone market.',
      yesPrice: 0.64,
      noPrice: 0.36,
      volume24h: 123456,
      category: 'crypto',
      url: 'https://polymarket.com/event/btc-100k',
      lastUpdated: '2026-04-11T00:00:00.000Z',
      oneDayPriceChange: 0.06,
    };

    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (options.routes?.[url.pathname]) {
      options.routes[url.pathname](req, res, url, { btcMarket });
      return;
    }

    if (url.pathname === '/api/analyze-text') {
      sendJson(res, {
        success: true,
        data: {
          markets: [
            {
              market: btcMarket,
              confidence: 0.94,
              matchedKeywords: ['BTC', '100k'],
            },
          ],
          suggested_action: {
            direction: 'YES',
            confidence: 0.72,
            edge: 0.04,
            reasoning: 'Mock signal.',
          },
          metadata: { processing_time_ms: 4 },
        },
      });
      return;
    }

    if (url.pathname === '/api/markets/movers') {
      sendJson(res, {
        success: true,
        data: {
          movers: [
            {
              market: btcMarket,
              priceChange1h: 0.06,
              previousPrice: 0.58,
              currentPrice: 0.64,
              direction: 'up',
              timestamp: 1775851200000,
            },
          ],
          count: 1,
          timestamp: '2026-04-11T00:00:01.000Z',
          filters: { category: url.searchParams.get('category') },
        },
      });
      return;
    }

    if (url.pathname === '/api/markets/arbitrage') {
      sendJson(res, {
        success: true,
        data: {
          opportunities: [
            {
              polymarket: btcMarket,
              kalshi: {
                ...btcMarket,
                id: 'kalshi-btc-100k',
                platform: 'kalshi',
                yesPrice: 0.68,
                noPrice: 0.32,
              },
              spread: 0.04,
              profitPotential: 0.03,
              direction: 'buy_poly_sell_kalshi',
              confidence: 0.81,
              matchReason: 'Same BTC threshold.',
            },
          ],
          count: 1,
          timestamp: '2026-04-11T00:00:01.000Z',
        },
      });
      return;
    }

    if (url.pathname === '/api/feed') {
      sendJson(res, {
        success: true,
        data: {
          tweets: [
            {
              tweet: {
                id: 'tweet-1',
                author: 'crypto_news',
                text: 'BTC odds jumped after ETF inflows; traders are watching the 100k market.',
                created_at: '2026-04-11T00:00:00.000Z',
                url: 'https://x.com/crypto_news/status/1',
              },
              confidence: 0.9,
              urgency: 'high',
              matches: [
                {
                  market: btcMarket,
                  confidence: 0.93,
                  matchedKeywords: ['BTC', '100k'],
                },
              ],
              analyzed_at: '2026-04-11T00:00:01.000Z',
              collected_at: '2026-04-11T00:00:01.000Z',
            },
          ],
          count: 1,
          timestamp: '2026-04-11T00:00:01.000Z',
        },
      });
      return;
    }

    if (url.pathname === '/api/wallet/activity') {
      sendJson(res, {
        success: true,
        data: {
          activity: [
            {
              wallet: url.searchParams.get('wallet'),
              activityType: 'trade',
              platform: 'polymarket',
              marketTitle: 'Will BTC hit 100k?',
              outcome: 'YES',
              side: 'buy',
              price: 0.62,
              size: 12,
              value: 7.44,
              timestamp: '2026-04-11T00:00:00.000Z',
              url: 'https://polymarket.com/event/btc-100k',
            },
          ],
          count: 1,
        },
        filters: {
          wallet: url.searchParams.get('wallet'),
          limit: Number(url.searchParams.get('limit') || 20),
        },
        timestamp: '2026-04-11T00:00:01.000Z',
        metadata: {
          wallet: url.searchParams.get('wallet'),
          source: 'polymarket',
          processing_time_ms: 5,
          cached: false,
          cache_age_seconds: null,
        },
      });
      return;
    }

    if (url.pathname === '/api/wallet/positions') {
      sendJson(res, {
        success: true,
        data: {
          positions: [
            {
              wallet: url.searchParams.get('wallet'),
              platform: 'polymarket',
              marketTitle: 'Will ETH hit 10k?',
              outcome: 'NO',
              quantity: 25,
              averagePrice: 0.41,
              currentPrice: 0.37,
              currentValue: 9.25,
              realizedPnl: 1.5,
              unrealizedPnl: -1,
              url: 'https://polymarket.com/event/eth-10k',
              updatedAt: '2026-04-11T00:00:00.000Z',
            },
          ],
          count: 1,
        },
        filters: {
          wallet: url.searchParams.get('wallet'),
          minValue: Number(url.searchParams.get('minValue') || 0),
          limit: Number(url.searchParams.get('limit') || 50),
        },
        timestamp: '2026-04-11T00:00:01.000Z',
        metadata: {
          wallet: url.searchParams.get('wallet'),
          source: 'polymarket',
          processing_time_ms: 6,
          cached: true,
          cached_at: '2026-04-11T00:00:00.000Z',
          cache_age_seconds: 1,
        },
      });
      return;
    }

    if (url.pathname === '/api/markets/wallet-flow') {
      sendJson(res, {
        success: true,
        data: {
          flow: {
            marketId: url.searchParams.get('marketId') || 'polymarket-abc',
            conditionId: 'abc',
            marketTitle: 'Will BTC hit 100k?',
            window: url.searchParams.get('window') || '24h',
            walletCount: 3,
            smartWalletCount: 1,
            buyVolume: 1200,
            sellVolume: 450,
            netVolume: 750,
            netDirection: 'YES',
            largeTrades: [
              {
                wallet: '0x0000000000000000000000000000000000000000',
                activityType: 'trade',
                platform: 'polymarket',
                marketTitle: 'Will BTC hit 100k?',
                outcome: 'YES',
                side: 'buy',
                price: 0.64,
                size: 2000,
                value: 1280,
                timestamp: '2026-04-11T00:00:00.000Z',
                url: 'https://polymarket.com/event/btc-100k',
              },
            ],
          },
          activity: [],
          count: 0,
          market: btcMarket,
          flow_agrees_with_price_move: true,
        },
        filters: {
          marketId: url.searchParams.get('marketId'),
          window: url.searchParams.get('window') || '24h',
          limit: Number(url.searchParams.get('limit') || 50),
        },
        timestamp: '2026-04-11T00:00:01.000Z',
        metadata: {
          source: 'polymarket',
          processing_time_ms: 7,
          cached: false,
          cache_age_seconds: null,
        },
      });
      return;
    }

    if (url.pathname === '/api/markets/smart-money') {
      sendJson(res, {
        success: true,
        data: {
          markets: [
            {
              marketId: 'polymarket-abc',
              conditionId: 'abc',
              marketTitle: 'Will BTC hit 100k?',
              category: url.searchParams.get('category') || 'crypto',
              url: 'https://polymarket.com/event/btc-100k',
              score: 1887.5,
              flow: {
                marketId: 'polymarket-abc',
                conditionId: 'abc',
                marketTitle: 'Will BTC hit 100k?',
                window: url.searchParams.get('window') || '24h',
                walletCount: 3,
                smartWalletCount: 1,
                buyVolume: 1200,
                sellVolume: 450,
                netVolume: 750,
                netDirection: 'YES',
                largeTrades: [],
              },
            },
          ],
          count: 1,
        },
        filters: {
          category: url.searchParams.get('category'),
          window: url.searchParams.get('window') || '24h',
          minVolume: Number(url.searchParams.get('minVolume') || 0),
          limit: Number(url.searchParams.get('limit') || 20),
        },
        timestamp: '2026-04-11T00:00:01.000Z',
        metadata: {
          source: 'polymarket',
          processing_time_ms: 8,
          cached: false,
          cache_age_seconds: null,
        },
      });
      return;
    }

    res.statusCode = 404;
    sendJson(res, { success: false, error: 'Not found' });
  });

  return server;
}

export async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  assert.equal(typeof address, 'object');
  return `http://127.0.0.1:${address.port}`;
}

export async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

function sendJson(res, payload) {
  res.end(JSON.stringify(payload));
}

function readIntEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

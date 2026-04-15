import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

const VALID_KEY = 'mcp_sk_test_wallet_tools_key';
const MCP_PROTOCOL_VERSION = '2025-06-18';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url, attempts = 40) {
  let lastError;

  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`Status ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await wait(250);
  }

  throw lastError ?? new Error('Server did not start in time');
}

async function stopChild(child) {
  if (child.exitCode !== null || child.killed) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([exited, wait(1500).then(() => child.kill('SIGKILL'))]);
  await exited.catch(() => {});
}

function createMockApiServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (url.pathname === '/api/wallet/activity') {
      res.end(JSON.stringify({
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
      }));
      return;
    }

    if (url.pathname === '/api/wallet/positions') {
      res.end(JSON.stringify({
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
      }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ success: false, error: 'Not found' }));
  });

  return server;
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  assert.equal(typeof address, 'object');
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

function spawnMcpServer(port, apiBaseUrl) {
  return spawn(process.execPath, ['dist/index.js', '--transport=http'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      MUSASHI_API_BASE_URL: apiBaseUrl,
      MUSASHI_MCP_API_KEY: VALID_KEY,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function randomTestPort() {
  return 15000 + Math.floor(Math.random() * 2000);
}

async function initializeMcp(baseUrl) {
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
        clientInfo: { name: 'wallet-tools-test', version: '0.0.1' },
      },
    }),
  });

  assert.equal(response.status, 200);
  const sessionId = response.headers.get('mcp-session-id');
  assert.ok(sessionId);
  return sessionId;
}

async function callMcp(baseUrl, sessionId, method, params = {}) {
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

function jsonRpcHeaders() {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
  };
}

function textFromToolResult(result) {
  return result.result.content.map((part) => part.text).join('\n');
}

test('wallet tools are listed', async (t) => {
  const mockApi = createMockApiServer();
  const apiBaseUrl = await listen(mockApi);
  const port = randomTestPort();
  const child = spawnMcpServer(port, apiBaseUrl);
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(async () => {
    await stopChild(child);
    await closeServer(mockApi);
  });

  await waitForServer(`${baseUrl}/health`);
  const sessionId = await initializeMcp(baseUrl);
  const payload = await callMcp(baseUrl, sessionId, 'tools/list');
  const names = payload.result.tools.map((tool) => tool.name);

  assert.ok(names.includes('get_wallet_activity'));
  assert.ok(names.includes('get_wallet_positions'));
  assert.ok(names.includes('get_market_wallet_flow'));
  assert.ok(names.includes('get_smart_money_markets'));
});

test('wallet activity and positions tools format API data', async (t) => {
  const mockApi = createMockApiServer();
  const apiBaseUrl = await listen(mockApi);
  const port = randomTestPort();
  const child = spawnMcpServer(port, apiBaseUrl);
  const baseUrl = `http://127.0.0.1:${port}`;
  const wallet = '0x0000000000000000000000000000000000000000';

  t.after(async () => {
    await stopChild(child);
    await closeServer(mockApi);
  });

  await waitForServer(`${baseUrl}/health`);
  const sessionId = await initializeMcp(baseUrl);

  const activity = await callMcp(baseUrl, sessionId, 'tools/call', {
    name: 'get_wallet_activity',
    arguments: { wallet, limit: 1 },
  });
  const activityText = textFromToolResult(activity);
  assert.match(activityText, /Wallet activity/);
  assert.match(activityText, /Will BTC hit 100k/);
  assert.match(activityText, /Value: \$7.44/);

  const positions = await callMcp(baseUrl, sessionId, 'tools/call', {
    name: 'get_wallet_positions',
    arguments: { wallet, minValue: 0, limit: 1 },
  });
  const positionsText = textFromToolResult(positions);
  assert.match(positionsText, /Wallet positions/);
  assert.match(positionsText, /Will ETH hit 10k/);
  assert.match(positionsText, /Unrealized PnL: \$-1/);
});

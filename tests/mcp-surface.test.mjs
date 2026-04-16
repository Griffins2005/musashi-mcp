import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const VALID_KEY = 'mcp_sk_test_surface_key';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(url, attempts = 40) {
  let lastError;

  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return response;
      }

      lastError = new Error(`Health check returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await wait(250);
  }

  throw lastError || new Error('Timed out waiting for HTTP health endpoint');
}

async function stopChildProcess(child) {
  if (child.exitCode !== null || child.killed) {
    return;
  }

  const exited = new Promise((resolve) => {
    child.once('exit', resolve);
  });

  child.kill('SIGTERM');

  const timeout = wait(1500).then(() => {
    if (child.exitCode === null && !child.killed) {
      child.kill('SIGKILL');
    }
  });

  await Promise.race([exited, timeout]);
  await exited.catch(() => undefined);
}

test('MCP surface exposes prompts and empty resources', async (t) => {
  const port = 4800 + Math.floor(Math.random() * 300);
  const child = spawn(process.execPath, ['dist/index.js', '--transport=http'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      MUSASHI_API_BASE_URL: 'http://127.0.0.1:3000',
      MUSASHI_MCP_API_KEY: VALID_KEY,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  t.after(async () => {
    await stopChildProcess(child);
  });

  await waitForHealth(`http://127.0.0.1:${port}/health`);

  const initializeResponse = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'MCP-Protocol-Version': '2025-06-18',
      Authorization: `Bearer ${VALID_KEY}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'surface-test', version: '1.0.0' },
      },
    }),
  });

  assert.equal(initializeResponse.status, 200);
  const sessionId = initializeResponse.headers.get('mcp-session-id');
  assert.ok(sessionId);

  const promptsListResponse = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'MCP-Protocol-Version': '2025-06-18',
      'Mcp-Session-Id': sessionId,
      Authorization: `Bearer ${VALID_KEY}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'prompts/list',
    }),
  });

  const promptsListPayload = await promptsListResponse.json();
  assert.equal(promptsListResponse.status, 200);
  assert.ok(Array.isArray(promptsListPayload.result.prompts));
  assert.ok(promptsListPayload.result.prompts.some((prompt) => prompt.name === 'find_arbitrage_now'));

  const promptGetResponse = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'MCP-Protocol-Version': '2025-06-18',
      'Mcp-Session-Id': sessionId,
      Authorization: `Bearer ${VALID_KEY}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'prompts/get',
      params: {
        name: 'find_arbitrage_now',
        arguments: {
          minSpread: '0.02',
        },
      },
    }),
  });

  const promptGetPayload = await promptGetResponse.json();
  assert.equal(promptGetResponse.status, 200);
  assert.match(promptGetPayload.result.messages[0].content.text, /arbitrage opportunities/i);

  const resourcesListResponse = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'MCP-Protocol-Version': '2025-06-18',
      'Mcp-Session-Id': sessionId,
      Authorization: `Bearer ${VALID_KEY}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 4,
      method: 'resources/list',
    }),
  });

  const resourcesListPayload = await resourcesListResponse.json();
  assert.equal(resourcesListResponse.status, 200);
  assert.deepEqual(resourcesListPayload.result, { resources: [] });
});

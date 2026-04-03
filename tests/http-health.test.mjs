import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

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

test('HTTP transport serves a healthy status endpoint', async (t) => {
  const port = 3300 + Math.floor(Math.random() * 300);
  const child = spawn(process.execPath, ['dist/index.js', '--transport=http'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      MUSASHI_API_BASE_URL: 'http://127.0.0.1:3000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let logs = '';
  child.stdout.on('data', (chunk) => {
    logs += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    logs += chunk.toString();
  });

  t.after(async () => {
    await stopChildProcess(child);
  });

  const response = await waitForHealth(`http://127.0.0.1:${port}/health`);
  const payload = await response.json();

  assert.equal(payload.status, 'healthy');
  assert.equal(payload.transport, 'streamable-http');
  assert.equal(payload.protocol_version, '2025-06-18');
  assert.equal(typeof payload.active_sessions, 'number');
  assert.equal(typeof payload.uptime_seconds, 'number');
  assert.match(logs, /Streamable HTTP/);
});

import test from 'node:test';
import assert from 'node:assert/strict';

const authModulePath = new URL('../dist/transports/auth.js', import.meta.url);

test('extractApiKey returns a bearer token with mcp_sk_ prefix', async () => {
  const { extractApiKey } = await import(`${authModulePath.href}?extract=${Date.now()}`);

  assert.equal(extractApiKey('Bearer mcp_sk_1234567890abcdef'), 'mcp_sk_1234567890abcdef');
  assert.equal(extractApiKey('Bearer invalid_key'), null);
  assert.equal(extractApiKey('Basic abc123'), null);
  assert.equal(extractApiKey(undefined), null);
});

test('verifyApiKey checks MCP_API_KEYS and MUSASHI_MCP_API_KEY', async () => {
  const originalKeys = process.env.MCP_API_KEYS;
  const originalSingleKey = process.env.MUSASHI_MCP_API_KEY;

  try {
    process.env.MCP_API_KEYS = 'mcp_sk_first,mcp_sk_second';
    delete process.env.MUSASHI_MCP_API_KEY;

    let auth = await import(`${authModulePath.href}?multi=${Date.now()}`);
    assert.equal(auth.verifyApiKey('mcp_sk_first'), true);
    assert.equal(auth.verifyApiKey('mcp_sk_missing'), false);

    delete process.env.MCP_API_KEYS;
    process.env.MUSASHI_MCP_API_KEY = 'mcp_sk_single';

    auth = await import(`${authModulePath.href}?single=${Date.now()}`);
    assert.equal(auth.verifyApiKey('mcp_sk_single'), true);
    assert.equal(auth.verifyApiKey('mcp_sk_other'), false);
  } finally {
    if (originalKeys === undefined) {
      delete process.env.MCP_API_KEYS;
    } else {
      process.env.MCP_API_KEYS = originalKeys;
    }

    if (originalSingleKey === undefined) {
      delete process.env.MUSASHI_MCP_API_KEY;
    } else {
      process.env.MUSASHI_MCP_API_KEY = originalSingleKey;
    }
  }
});

test('getTruncatedKey hides the full API key', async () => {
  const { getTruncatedKey } = await import(`${authModulePath.href}?truncate=${Date.now()}`);

  assert.equal(getTruncatedKey('mcp_sk_1234567890abcdef'), 'mcp_sk_12345...');
});

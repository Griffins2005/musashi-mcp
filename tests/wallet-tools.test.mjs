import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  callMcp,
  callTool,
  pass,
  runMcpCase,
  testOptions,
  textFromToolResult,
  withMockMcp,
} from './helpers/mcp-test-harness.mjs';
import {
  MARKET_CONTEXT_CASES,
  REQUIRED_TOOLS,
  TOOL_FORMAT_CASES,
  assertToolText,
} from './helpers/mcp-tool-cases.mjs';

describe('tools', () => {
  test('wallet tools are listed', testOptions(), runMcpCase(async () => {
    return withMockMcp(async ({ baseUrl, sessionId }) => {
      const payload = await callMcp(baseUrl, sessionId, 'tools/list');
      const names = payload.result.tools.map((tool) => tool.name);

      for (const toolName of REQUIRED_TOOLS) {
        assert.ok(names.includes(toolName), `Expected ${toolName} in tools/list`);
      }

      return pass(`listed ${REQUIRED_TOOLS.length} wallet/context tools`);
    });
  }));
});

describe('wallet', () => {
  for (const toolCase of TOOL_FORMAT_CASES) {
    test(toolCase.name, testOptions(), runMcpCase(async () => {
      return withMockMcp(async ({ baseUrl, sessionId }) => {
        const result = await callTool(baseUrl, sessionId, toolCase.name, toolCase.arguments);
        assertToolText(textFromToolResult(result), toolCase.requiredText);
        return pass(`${toolCase.name} formatted expected API data`);
      });
    }));
  }
});

describe('market-context', () => {
  for (const toolCase of MARKET_CONTEXT_CASES) {
    test(toolCase.name, testOptions(), runMcpCase(async () => {
      return withMockMcp(async ({ baseUrl, sessionId }) => {
        const result = await callTool(baseUrl, sessionId, toolCase.name, toolCase.arguments);
        assertToolText(textFromToolResult(result), toolCase.requiredText);
        return pass(`${toolCase.name} composed primitive API context`);
      });
    }));
  }
});

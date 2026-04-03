# musashi-mcp

`musashi-mcp` is the standalone MCP server for Musashi.

It exposes Musashi market intelligence as MCP tools, but now treats `musashi-api` as the single backend dependency instead of reading from the old monolithic repository.

## What this project does

`musashi-mcp` is the MCP-facing adapter layer in the split Musashi architecture:

- `musashi-api`: the core backend with the real analysis and market/feed endpoints
- `musashi-extension`: the browser extension UI for X/Twitter
- `musashi-mcp`: the MCP server that converts Musashi API capabilities into MCP tools for AI clients

`musashi-mcp` does not perform market analysis by itself. It forwards requests to `musashi-api`, then formats those responses as MCP tool results.

The HTTP transport also supports OAuth discovery and authorization endpoints so remote MCP clients such as `claude.ai` can connect through an OAuth-style flow while still using Musashi API keys underneath.

## Supported tools

- `analyze_text`
- `get_arbitrage`
- `get_movers`
- `ground_probability`
- `get_feed`
- `get_feed_stats`
- `get_feed_accounts`
- `get_health`

## Requirements

- Node.js `>=18`
- `pnpm`
- A reachable `musashi-api` instance

For local development, the usual backend is:

```text
http://127.0.0.1:3000
```

## Configuration

- `MUSASHI_API_BASE_URL`: base URL for the new `musashi-api` deployment
- `PORT`: HTTP transport port when running with `--transport=http`
- `MUSASHI_MCP_API_KEY`: optional API key used by the included HTTP transport auth helpers
- `MCP_API_KEYS`: optional comma-separated list of valid API keys for HTTP transport auth helpers

At least one valid key in `MUSASHI_MCP_API_KEY` or `MCP_API_KEYS` is recommended if you want to use the OAuth authorization form.

## Scripts

- `pnpm build`: compile the server to `dist/`
- `pnpm dev`: run stdio transport locally
- `pnpm dev:http`: run the streamable HTTP transport locally
- `pnpm test`: build the server and run local smoke tests
- `pnpm start`: run the compiled stdio server from `dist/`
- `pnpm start:http`: run the compiled HTTP server from `dist/`
- `pnpm watch`: run TypeScript in watch mode
- `pnpm clean`: remove `dist/`

## Install

```bash
cd ./musashi-mcp
pnpm install
```

## How to use

### Option 1: stdio transport

This is the usual mode for MCP desktop clients and local agent integrations.

```bash
cd ./musashi-mcp
MUSASHI_API_BASE_URL=http://127.0.0.1:3000 pnpm dev
```

Use this when an MCP client expects to spawn the server process directly over stdio.

### Option 2: streamable HTTP transport

This is useful when you want to connect over HTTP instead of stdio.

```bash
cd ./musashi-mcp
MUSASHI_API_BASE_URL=http://127.0.0.1:3000 PORT=3030 pnpm dev:http
```

Once running, the main endpoints are:

- `GET /health`
- `GET /.well-known/oauth-authorization-server`
- `GET /oauth/authorize`
- `POST /oauth/authorize`
- `POST /oauth/token`
- `POST /mcp`
- `GET /mcp`
- `DELETE /mcp`

If you run the HTTP transport locally with `PORT=3030`, the health endpoint will be:

```text
http://127.0.0.1:3030/health
```

OAuth discovery will be available at:

```text
http://127.0.0.1:3030/.well-known/oauth-authorization-server
```

## Local development flow

### 1. Start `musashi-api`

In one terminal:

```bash
cd ./musashi-api
pnpm dev
```

### 2. Start `musashi-mcp`

In another terminal, choose either stdio or HTTP:

```bash
cd ./musashi-mcp
MUSASHI_API_BASE_URL=http://127.0.0.1:3000 pnpm dev
```

or

```bash
cd ./musashi-mcp
MUSASHI_API_BASE_URL=http://127.0.0.1:3000 PORT=3030 pnpm dev:http
```

## Example environment values

### Local

```bash
MUSASHI_API_BASE_URL=http://127.0.0.1:3000
PORT=3030
```

### Hosted API

```bash
MUSASHI_API_BASE_URL=https://musashi-api.vercel.app
PORT=3030
```

### MCP auth

```bash
MUSASHI_MCP_API_KEY=mcp_sk_your_key_here
```

## Testing

### Automated checks currently available

This repo now includes a lightweight `pnpm test` script, but it is still a smoke-oriented suite rather than a full MCP protocol conformance suite.

The checks that exist today are:

- `pnpm build`
  Confirms the server compiles successfully to `dist/`
- `pnpm test`
  Builds the project, validates API key helper behavior, and verifies that the streamable HTTP transport serves `/health` plus OAuth discovery metadata

Recommended baseline verification:

```bash
cd ./musashi-mcp
pnpm test
```

### Manual local verification

#### Verify the upstream API first

Before testing `musashi-mcp`, confirm the backend works:

```bash
curl http://127.0.0.1:3000/api/health
```

You should get a healthy JSON response from `musashi-api`.

#### Verify the HTTP transport health endpoint

If you are using `pnpm dev:http`:

```bash
curl http://127.0.0.1:3030/health
```

You should get JSON containing fields such as:

- `status`
- `transport`
- `protocol_version`
- `active_sessions`

#### Verify OAuth discovery

If you are using `pnpm dev:http`:

```bash
curl http://127.0.0.1:3030/.well-known/oauth-authorization-server
```

You should get JSON containing:

- `issuer`
- `authorization_endpoint`
- `token_endpoint`
- `response_types_supported`
- `grant_types_supported`

#### Verify the authorization form

Open this URL in a browser:

```text
http://127.0.0.1:3030/oauth/authorize?redirect_uri=http://127.0.0.1/callback&state=test-state
```

You should see a simple Musashi authorization form that accepts a valid MCP API key.

#### Verify MCP tool exposure

Start the stdio server:

```bash
cd ./musashi-mcp
MUSASHI_API_BASE_URL=http://127.0.0.1:3000 pnpm dev
```

Then connect it from your MCP client and confirm these tools are visible:

- `analyze_text`
- `get_arbitrage`
- `get_movers`
- `ground_probability`
- `get_feed`
- `get_feed_stats`
- `get_feed_accounts`
- `get_health`

#### Verify end-to-end behavior through an MCP client

Good smoke checks:

1. Call `get_health`
2. Call `analyze_text` with a short market-related sentence
3. Call `get_feed` with a small `limit`

Example `analyze_text` input:

```json
{
  "text": "Bitcoin could reach 100k this year",
  "minConfidence": 0.25,
  "maxResults": 5
}
```

Expected result shape:

- text output describing matching markets
- platform information
- confidence values
- market URLs when available

## Notes on security

For the HTTP transport:

- CORS is restricted to an allowlist in [streamable-http-server.ts](../musashi-mcp/src/server/streamable-http-server.ts)
- rate limiting is enabled
- optional API key helpers are available through `MUSASHI_MCP_API_KEY` or `MCP_API_KEYS`
- OAuth authorization codes are stored in memory and expire automatically

## Current limitations

- `pnpm test` is currently a smoke suite, not a full MCP client interoperability suite
- MCP behavior depends on the availability and correctness of `musashi-api`
- the HTTP transport is mainly intended for controlled local/dev integrations unless you add stronger deployment hardening

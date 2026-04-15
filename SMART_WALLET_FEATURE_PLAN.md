# Smart Wallet Intelligence Feature Plan

## Summary

The next MCP feature should be a read-only Smart Wallet Intelligence layer, not a trading or custody layer.

This fits the current Musashi product because the existing system is already an agent-facing prediction-market intelligence stack. The current MCP server exposes market analysis, arbitrage, movers, probability grounding, feed data, feed stats, account metadata, and health checks. Smart wallet tracking extends that same read-only intelligence surface with signals such as:

- Active wallets on a market.
- High-signal wallets buying YES or NO.
- Wallet flow context for recent market moves.
- Markets attracting smart wallet activity.

The first implementation should update both `musashi-api` and `musashi-mcp`.

`musashi-api` should own data fetching, validation, caching, response contracts, and wallet-flow aggregation. `musashi-mcp` should expose the API through agent-friendly MCP tools and format the results for Claude, ChatGPT, and other MCP clients.

## Product Scope

### MVP

Build these read-only capabilities first:

1. Wallet activity lookup
   - Input: a Polymarket wallet address.
   - Output: recent trades/activity, matched Musashi markets, side, size, price, timestamp, market URL, and position context when available.

2. Wallet positions lookup
   - Input: a Polymarket wallet address.
   - Output: current open positions, market title, outcome, quantity, value, average price, current price, unrealized PnL when available, and Musashi category.

3. Market wallet flow
   - Input: a market id, condition id, token id, slug, or matched query.
   - Output: recent wallet activity for that market, net YES/NO flow, large trades, wallet count, smart-wallet participation, and whether flow agrees with the current price move.

4. Smart money markets
   - Input: optional category, window, minimum activity, and limit.
   - Output: markets with unusual smart-wallet activity, ranked by net flow, active wallet count, volume, and price movement.

### Later

Add a higher-level explanation tool after the primitives are stable:

1. Market brief
   - Combines current market price, volume, movers, feed mentions, arbitrage context, and wallet flow.

2. Explain market move
   - Combines `get_movers`, `get_feed`, `get_arbitrage`, and wallet flow into a concise reasoned explanation.

3. Wallet watchlist alerts
   - Stores watched wallets and produces an alert feed when those wallets open, increase, reduce, or close positions.

## Non-Goals

Do not add trading execution in the first version.

Avoid these features until there is a separate security and compliance plan:

- `place_order`
- `cancel_order`
- best execution routing
- private key handling
- delegated trading
- wallet signing
- custody
- copy trading

The MCP server should not hold user private keys or create Polymarket API credentials.

## API And MCP Update Scope

Both `musashi-api` and `musashi-mcp` should be updated, but they should not do the same job.

### `musashi-api` Responsibilities

`musashi-api` should add the wallet data plane:

- Fetch public Polymarket wallet data.
- Normalize external response shapes into Musashi types.
- Match wallet activity to existing Musashi markets.
- Cache wallet activity and position responses.
- Store derived snapshots or watchlist state in KV when needed.
- Validate wallet addresses, limits, windows, and market identifiers.
- Return structured JSON responses with `success`, `data`, `filters`, `timestamp`, and `metadata`.
- Expose SDK methods for direct agent or bot use.
- Extend local API routing and contract tests.

### `musashi-mcp` Responsibilities

`musashi-mcp` should add the agent tool plane:

- List new MCP tools in `listTools()`.
- Proxy tool calls to the new API endpoints.
- Use `URLSearchParams` for query building.
- Format wallet activity into readable text.
- Surface freshness, cache age, and partial failure metadata.
- Keep tool names snake_case, matching the existing MCP style.
- Update the README tool list and smoke-test prompts.

### `musashi-extension` Responsibilities

No extension changes are required for the MVP.

The browser extension can stay focused on Twitter/X market cards. If wallet intelligence later becomes useful in the extension UI, add it after the API and MCP contracts are stable.

## Technical Stack

### Runtime And Language

- Node.js `>=18`
- TypeScript
- ESM modules
- `pnpm`
- Native `fetch`

### API Stack

- Vercel-style serverless API routes under `musashi-api/api`
- `@vercel/node` request and response types
- Vercel KV / Upstash Redis through the existing `api/lib/vercel-kv.ts` wrapper
- In-memory KV fallback for local development
- Shared market cache through `api/lib/market-cache.ts`
- Existing TypeScript SDK in `musashi-api/src/sdk/musashi-agent.ts`

### MCP Stack

- `@modelcontextprotocol/sdk`
- Stdio transport
- Streamable HTTP transport
- Express-based HTTP server support
- Existing OAuth handler and session manager
- Existing `fetchJson()` helper for API calls

### External Data Sources

Use public read-only data first:

- Polymarket Data API for wallet positions, closed positions, activity, value, and trades.
- Polymarket Gamma API for market metadata and slug/title matching.
- Polymarket CLOB API for prices, orderbooks, and token-level market data when needed.

Do not require a paid third-party API for the MVP. Predexon-style metrics are useful as product inspiration, but Musashi should build a minimal internal smart-wallet model first.

## Proposed Directory Structure

```text
musashi-api/
  api/
    wallet/
      activity.ts
      positions.ts
      value.ts
    markets/
      wallet-flow.ts
      smart-money.ts
      market-brief.ts          # later phase
    lib/
      polymarket-wallet-client.ts
      wallet-cache.ts
      smart-wallets.ts
      market-identity.ts
  src/
    types/
      wallet.ts
    api/
      musashi-api-client.ts
    sdk/
      musashi-agent.ts
  scripts/
    local-api-server.ts
    test-agent-api.ts

musashi-mcp/
  src/
    index.ts
  tests/
    wallet-tools.test.mjs
  README.md
  SMART_WALLET_FEATURE_PLAN.md
```

### API Route Notes

Use nested route files to keep wallet endpoints grouped:

```text
/api/wallet/activity
/api/wallet/positions
/api/wallet/value
/api/markets/wallet-flow
/api/markets/smart-money
```

Use query parameters for MVP route inputs:

```text
GET /api/wallet/activity?wallet=0x...&limit=20&since=2026-04-11T00:00:00.000Z
GET /api/wallet/positions?wallet=0x...&minValue=10&limit=50
GET /api/markets/wallet-flow?marketId=polymarket-...&window=24h&limit=50
GET /api/markets/smart-money?category=crypto&window=24h&limit=20
```

This matches the current API style, where filters are query parameters and POST is reserved for text or claim analysis.

## Proposed MCP Tools

Add these MCP tools:

```text
get_wallet_activity
get_wallet_positions
get_market_wallet_flow
get_smart_money_markets
```

Current implementation note:

- `get_wallet_activity` and `get_wallet_positions` can proxy to implemented `musashi-api` endpoints.
- `get_market_wallet_flow` and `get_smart_money_markets` are wired in MCP as API proxy tools, but they are not end-to-end ready until the matching `musashi-api` endpoints are implemented:
  - `GET /api/markets/wallet-flow`
  - `GET /api/markets/smart-money`
- Until those API routes exist, these two MCP tools should be treated as registered placeholders that will surface API errors if called.

Later:

```text
get_market_brief
explain_market_move
```

### Tool Input Shapes

```ts
get_wallet_activity({
  wallet: string;
  limit?: number;
  since?: string;
})

get_wallet_positions({
  wallet: string;
  minValue?: number;
  limit?: number;
})

get_market_wallet_flow({
  marketId?: string;
  conditionId?: string;
  tokenId?: string;
  query?: string;
  window?: '1h' | '24h' | '7d';
  limit?: number;
})

get_smart_money_markets({
  category?: string;
  window?: '1h' | '24h' | '7d';
  minVolume?: number;
  limit?: number;
})
```

## Response Contract

Every new API endpoint should follow the existing Musashi response style:

```ts
interface ApiResponse<TData, TFilters> {
  success: boolean;
  data: TData;
  filters: TFilters;
  timestamp: string;
  metadata: {
    processing_time_ms: number;
    cached?: boolean;
    cached_at?: string | null;
    cache_age_seconds?: number | null;
    data_age_seconds?: number;
    fetched_at?: string;
    sources?: Record<string, unknown>;
  };
}
```

For wallet endpoints, include these metadata fields when available:

```ts
metadata: {
  wallet: string;
  source: 'polymarket';
  processing_time_ms: number;
  cached: boolean;
  cache_age_seconds: number | null;
}
```

## Data Types

Create `musashi-api/src/types/wallet.ts`.

```ts
export type WalletActivityType =
  | 'trade'
  | 'position_opened'
  | 'position_increased'
  | 'position_reduced'
  | 'position_closed'
  | 'redeemed'
  | 'unknown';

export interface WalletActivity {
  wallet: string;
  activityType: WalletActivityType;
  platform: 'polymarket';
  marketId?: string;
  conditionId?: string;
  tokenId?: string;
  marketTitle?: string;
  marketSlug?: string;
  outcome?: string;
  side?: 'buy' | 'sell';
  price?: number;
  size?: number;
  value?: number;
  timestamp: string;
  url?: string;
}

export interface WalletPosition {
  wallet: string;
  platform: 'polymarket';
  marketId?: string;
  conditionId?: string;
  tokenId?: string;
  marketTitle: string;
  marketSlug?: string;
  outcome: string;
  quantity: number;
  averagePrice?: number;
  currentPrice?: number;
  currentValue?: number;
  realizedPnl?: number;
  unrealizedPnl?: number;
  url?: string;
  updatedAt: string;
}

export interface MarketWalletFlow {
  marketId?: string;
  conditionId?: string;
  tokenId?: string;
  marketTitle?: string;
  window: '1h' | '24h' | '7d';
  walletCount: number;
  smartWalletCount: number;
  buyVolume: number;
  sellVolume: number;
  netVolume: number;
  netDirection: 'YES' | 'NO' | 'mixed' | 'unknown';
  largeTrades: WalletActivity[];
}
```

## Code Standards

### TypeScript

- Keep TypeScript strict.
- Use explicit interfaces for API response payloads.
- Prefer `unknown` over `any` for external API responses, then narrow the shape.
- Keep shared types in `src/types`.
- Keep route-specific helper types near the route when they are not reused.
- Avoid introducing a new framework.

### API Handlers

- Keep API handlers small.
- Move external API calls into `api/lib/*-client.ts`.
- Move cache key construction into `api/lib/*-cache.ts` when it is shared.
- Use `Promise.allSettled()` for multi-source or batch operations.
- Use timeouts for upstream calls.
- Return partial data when possible.
- Return `400` for invalid inputs.
- Return `405` for unsupported methods with an `Allow` header.
- Return `503` for upstream or KV unavailability only when no useful fallback data exists.
- Always include `processing_time_ms`.

### Validation

Validate wallet addresses:

```ts
/^0x[a-fA-F0-9]{40}$/
```

Validate numeric filters:

- `limit`: integer from `1` to `100`.
- `minValue`: number greater than or equal to `0`.
- `minVolume`: number greater than or equal to `0`.
- `window`: one of `1h`, `24h`, `7d`.

Validate timestamps with `new Date(value)` and reject invalid ISO strings.

### Caching

Recommended cache TTLs:

- Wallet activity: 30 seconds.
- Wallet positions: 60 seconds.
- Wallet value: 60 seconds.
- Market wallet flow: 30 seconds.
- Smart money markets: 60 seconds.
- Watchlist alert snapshots: 7 days, if added later.

Recommended KV key patterns:

```text
wallet:activity:{wallet}:{limit}:{sinceHash}
wallet:positions:{wallet}:{minValue}:{limit}
wallet:value:{wallet}
market:wallet_flow:{marketId}:{window}
smart_money:markets:{category}:{window}:{minVolume}:{limit}
smart_wallets:registry
```

Normalize wallet addresses to lowercase before using them in cache keys.

### MCP Tools

- Keep MCP tools read-only.
- Keep MCP tool names snake_case.
- Keep MCP descriptions short and agent-oriented.
- Use `URLSearchParams` for all query construction.
- Use the existing `fetchJson()` helper.
- Format numbers with the existing `formatPercent()` and `formatVolume()` helpers when possible.
- Include source freshness or cache age in the returned text.
- Return a useful empty-state message when no wallet activity or positions are found.
- Do not call Polymarket directly from MCP handlers. MCP should call `musashi-api`.

### Security

- Never accept private keys.
- Never log full API tokens.
- Never add signing or order placement to the MCP server.
- Avoid storing personally sensitive user labels for wallets.
- Store only public wallet addresses and public market activity.
- If user-specific watchlists are added later, namespace them by authenticated MCP client or API key.

## Naming Conventions

### Files

Use kebab-case for multi-word files:

```text
polymarket-wallet-client.ts
wallet-cache.ts
smart-wallets.ts
wallet-flow.ts
smart-money.ts
market-brief.ts
wallet-tools.test.mjs
```

### TypeScript Symbols

- Interfaces and type aliases: `PascalCase`
- Functions and variables: `camelCase`
- Local constants: `camelCase` unless they are configuration constants
- Configuration constants: `UPPER_SNAKE_CASE`
- Environment variables: `UPPER_SNAKE_CASE`
- API query parameters: `camelCase`, matching existing Musashi API style
- MCP tool names: `snake_case`, matching existing MCP tool style
- KV keys: lowercase colon-separated namespaces

Examples:

```ts
interface WalletActivity {}
type WalletActivityType = 'trade' | 'unknown';
const walletActivity = await fetchWalletActivity(wallet);
const WALLET_ACTIVITY_TTL_SECONDS = 30;
```

```text
get_wallet_activity
get_market_wallet_flow
wallet:activity:0xabc...
```

## Testing Plan

### API Tests

Extend `musashi-api/scripts/test-agent-api.ts` or add endpoint-specific tests for:

- Valid wallet activity request.
- Valid wallet positions request.
- Invalid wallet address.
- Invalid `limit`.
- Invalid `window`.
- Empty wallet response.
- Upstream timeout fallback.
- KV cache hit metadata.
- Local API route mapping in `scripts/local-api-server.ts`.

### MCP Tests

Add `musashi-mcp/tests/wallet-tools.test.mjs` for:

- Tool listing includes the new wallet tools.
- Unknown wallet returns a clean empty-state message.
- Invalid wallet errors are surfaced clearly.
- Tool handlers format wallet activity and position data correctly.

### Detailed Test Cases

Use deterministic fixtures for wallet addresses, wallet activity, positions, and market matches. Do not depend on live Polymarket responses in unit tests.

| ID | Area | Scenario | Fixture | Expected Result |
| --- | --- | --- | --- | --- |
| `WALLET_API_001` | API | Fetch wallet activity for a valid wallet. | Valid lowercase `0x` wallet with two recent trades. | `200`, `success: true`, two activity items, normalized wallet address, market titles, timestamps, and metadata. |
| `WALLET_API_002` | API | Fetch wallet positions for a valid wallet. | Valid wallet with YES and NO positions. | `200`, `success: true`, position count matches fixture, values are numbers, market URLs are included when available. |
| `WALLET_API_003` | API | Reject malformed wallet address. | `wallet=abc123`. | `400`, `success: false`, clear validation error, no upstream request. |
| `WALLET_API_004` | API | Reject invalid limit. | `limit=0` and `limit=101`. | `400`, `success: false`, limit validation error. |
| `WALLET_API_005` | API | Reject invalid timestamp. | `since=not-a-date`. | `400`, `success: false`, ISO timestamp validation error. |
| `WALLET_API_006` | API | Return empty wallet activity cleanly. | Valid wallet with no activity. | `200`, `success: true`, empty activity array, `count: 0`, metadata present. |
| `WALLET_API_007` | API | Use cache on repeated wallet activity request. | Same wallet, same limit, same since. | Second response has `cached: true` or cache age metadata, and does not call upstream again in the mocked client. |
| `WALLET_API_008` | API | Handle upstream timeout with cached fallback. | Upstream timeout plus previous cached response. | `200`, cached fallback payload, cache age metadata, source warning included. |
| `WALLET_API_009` | API | Handle upstream timeout without cached fallback. | Upstream timeout and empty cache. | `503`, `success: false`, sanitized upstream error. |
| `WALLET_API_010` | API | Resolve market wallet flow by market id. | Market id mapped to activity fixture. | `200`, net flow fields, wallet count, smart wallet count, large trades sorted by value. |
| `WALLET_API_011` | API | Resolve market wallet flow by text query. | Query matching one Musashi market. | `200`, matched market identity, flow summary, match confidence metadata when available. |
| `WALLET_API_012` | API | Reject invalid flow window. | `window=30m`. | `400`, `success: false`, allowed window values listed. |
| `SMART_API_001` | API | Rank smart money markets. | Three market flow fixtures with different net volumes. | `200`, markets sorted by score, category filter applied, limit respected. |
| `LOCAL_API_001` | Local API | Route wallet activity through local API server. | Mock handler fixture. | `GET /api/wallet/activity` reaches the new handler. |
| `LOCAL_API_002` | Local API | Route market wallet flow through local API server. | Mock handler fixture. | `GET /api/markets/wallet-flow` reaches the new handler. |
| `SDK_001` | SDK | Fetch wallet activity through `MusashiAgent`. | Mock API response. | SDK method returns typed wallet activity array. |
| `SDK_002` | SDK | Fetch wallet positions through `MusashiAgent`. | Mock API response. | SDK method returns typed wallet position array. |
| `MCP_001` | MCP | List smart wallet tools. | MCP `tools/list`. | Tool list includes `get_wallet_activity`, `get_wallet_positions`, `get_market_wallet_flow`, and `get_smart_money_markets`. |
| `MCP_002` | MCP | Call wallet activity tool. | Mock API activity response. | Text output includes wallet, market title, side, price, value, timestamp, and URL. |
| `MCP_003` | MCP | Call wallet positions tool. | Mock API positions response. | Text output includes market title, outcome, quantity, value, average price, current price, and PnL when available. |
| `MCP_004` | MCP | Call market wallet flow tool. | Mock API wallet-flow response. | Text output includes net direction, buy volume, sell volume, wallet count, smart wallet count, and large trades. |
| `MCP_005` | MCP | Call smart money markets tool. | Mock API smart-money response. | Text output includes ranked markets, net flow, active wallet count, volume, and market URL. |
| `MCP_006` | MCP | Surface API validation error. | Mock `400` response. | Tool returns `isError: true` with the sanitized validation message. |
| `MCP_007` | MCP | Return clean empty-state text. | Mock empty activity response. | Tool returns a concise no-activity message without marking it as an error. |
| `REGRESSION_001` | Regression | Existing MCP tools still work. | Existing smoke fixtures. | `analyze_text`, `get_arbitrage`, `get_movers`, `ground_probability`, `get_feed`, `get_feed_stats`, `get_feed_accounts`, and `get_health` remain listed and callable. |

### Manual Smoke Prompts

Add README smoke prompts:

```text
Use the Musashi app to show wallet activity for 0x...
Use the Musashi app to show open positions for 0x...
Use the Musashi app to explain wallet flow for this market: ...
Use the Musashi app to find smart money markets in crypto.
```

## Implementation Order

1. Add wallet types in `musashi-api/src/types/wallet.ts`.
2. Add a public Polymarket wallet client in `musashi-api/api/lib/polymarket-wallet-client.ts`.
3. Add wallet cache helpers in `musashi-api/api/lib/wallet-cache.ts`.
4. Add `GET /api/wallet/activity`.
5. Add `GET /api/wallet/positions`.
6. Add local server route mappings.
7. Add SDK methods to `MusashiAgent`.
8. Add MCP tools in `musashi-mcp/src/index.ts`.
   - `get_wallet_activity` and `get_wallet_positions` become callable once their REST endpoints exist.
   - `get_market_wallet_flow` and `get_smart_money_markets` may be registered now, but remain pending until steps 11 and 12 add their REST endpoints.
9. Update `musashi-mcp/README.md`.
10. Add tests and smoke prompts.
11. Add market wallet flow aggregation and `GET /api/markets/wallet-flow`.
12. Add smart money markets ranking and `GET /api/markets/smart-money`.
13. Add market brief and explain-market-move tools after the primitives are stable.

## Acceptance Criteria

The MVP is ready when:

- A wallet address can be queried through the REST API.
- The same wallet address can be queried through the MCP server.
- MCP output includes market title, side, price, size or value, timestamp, and URL when available.
- Invalid wallet addresses fail with clear validation errors.
- API responses include metadata and cache fields.
- The local API server can route the new endpoints.
- `pnpm build` passes in `musashi-api`.
- `pnpm build` passes in `musashi-mcp`.
- Existing MCP tools still work.

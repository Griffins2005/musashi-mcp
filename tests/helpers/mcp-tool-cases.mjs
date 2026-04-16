import assert from 'node:assert/strict';

export const WALLET = '0x0000000000000000000000000000000000000000';

export const REQUIRED_TOOLS = [
  'get_wallet_activity',
  'get_wallet_positions',
  'get_market_wallet_flow',
  'get_smart_money_markets',
  'get_market_brief',
  'explain_market_move',
];

export const TOOL_FORMAT_CASES = [
  {
    name: 'get_wallet_activity',
    arguments: { wallet: WALLET, limit: 1 },
    requiredText: [/Wallet activity/, /Will BTC hit 100k/, /Value: \$7.44/],
  },
  {
    name: 'get_wallet_positions',
    arguments: { wallet: WALLET, minValue: 0, limit: 1 },
    requiredText: [/Wallet positions/, /Will ETH hit 10k/, /Unrealized PnL: \$-1/],
  },
  {
    name: 'get_market_wallet_flow',
    arguments: { marketId: 'polymarket-abc', window: '24h', limit: 10 },
    requiredText: [/Wallet flow/, /Net direction: YES/, /Smart wallets: 1/],
  },
  {
    name: 'get_smart_money_markets',
    arguments: { category: 'crypto', window: '24h', limit: 5 },
    requiredText: [/Smart-money markets/, /Will BTC hit 100k/, /Net direction: YES/],
  },
];

export const MARKET_CONTEXT_CASES = [
  {
    name: 'get_market_brief',
    arguments: { marketId: 'polymarket-abc', window: '24h' },
    requiredText: [
      /Market brief/,
      /Will BTC hit 100k/,
      /Wallet flow/,
      /Feed mentions/,
      /Arbitrage context/,
    ],
  },
  {
    name: 'explain_market_move',
    arguments: { marketId: 'polymarket-abc', window: '24h', minChange: 0.01 },
    requiredText: [
      /Market move explanation/,
      /Move: up/,
      /Wallet flow leans YES/,
      /Bottom line/,
    ],
  },
];

export function assertToolText(text, patterns) {
  for (const pattern of patterns) {
    assert.match(text, pattern);
  }
}

/**
 * Authentication system for MCP HTTP transport
 * Verifies API keys for remote MCP server access
 */

/**
 * Verify if an API key is valid
 * Checks against comma-separated list in MCP_API_KEYS env var
 *
 * @param key - API key to verify (format: mcp_sk_<32_chars>)
 * @returns true if key is valid, false otherwise
 */
export function verifyApiKey(key: string): boolean {
  // Get valid keys from environment
  const validKeys = (
    process.env.MCP_API_KEYS ||
    process.env.MUSASHI_MCP_API_KEY ||
    ''
  )
    .split(',')
    .map((candidate) => candidate.trim())
    .filter(Boolean);

  if (validKeys.length === 0) {
    console.warn('[Auth] No API keys configured in MCP_API_KEYS or MUSASHI_MCP_API_KEY');
    return false;
  }

  return validKeys.includes(key);
}

/**
 * Extract API key from Authorization header
 * Expected format: "Bearer mcp_sk_<32_chars>"
 *
 * @param authHeader - Authorization header value
 * @returns API key if valid format, null otherwise
 */
export function extractApiKey(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }

  // Check Bearer format
  if (!authHeader.startsWith('Bearer ')) {
    return null;
  }

  // Extract and trim key
  const key = authHeader.slice(7).trim();

  // Validate key format (should start with mcp_sk_)
  if (!key.startsWith('mcp_sk_')) {
    return null;
  }

  return key;
}

/**
 * Get truncated API key for logging (first 12 chars)
 * Never log full API keys for security
 *
 * @param key - Full API key
 * @returns Truncated key for safe logging
 */
export function getTruncatedKey(key: string): string {
  return key.slice(0, 12) + '...';
}

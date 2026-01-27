/**
 * Baked-in MCP server definitions.
 * These are the pre-configured servers available for workspace integrations.
 */

export const MCP_SERVERS = {
  exa: {
    key: "exa",
    name: "Exa Search",
    description: "AI-powered web search for research and discovery",
    mcpUrl: "https://mcp.exa.ai", // Direct MCP server URL
    transportType: "http" as const, // Exa uses HTTP transport, not SSE
    icon: "Search", // Lucide icon name
    requiresAuth: false,
  },
} as const;

export type McpServerKey = keyof typeof MCP_SERVERS;
export type McpServerDefinition = (typeof MCP_SERVERS)[McpServerKey];

/**
 * Get a server definition by key
 */
export function getMcpServer(key: McpServerKey): McpServerDefinition {
  return MCP_SERVERS[key];
}

/**
 * Get all available server definitions
 */
export function getAllMcpServers(): McpServerDefinition[] {
  return Object.values(MCP_SERVERS);
}

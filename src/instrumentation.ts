import { validateMcpConfig } from "@/lib/mcp-server/auth/token";

export async function register(): Promise<void> {
  validateMcpConfig();
}

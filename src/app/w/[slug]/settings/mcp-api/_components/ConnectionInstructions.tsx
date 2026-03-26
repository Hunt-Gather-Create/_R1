"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface InstructionCardProps {
  title: string;
  children: React.ReactNode;
}

function InstructionCard({ title, children }: InstructionCardProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-border rounded-lg bg-card">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-foreground hover:bg-accent/50 transition-colors rounded-lg"
      >
        {title}
        {open ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="px-4 pb-4 text-sm text-muted-foreground space-y-3">
          {children}
        </div>
      )}
    </div>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="p-3 bg-muted rounded-md border border-border overflow-x-auto text-xs font-mono whitespace-pre">
      {children}
    </pre>
  );
}

export function ConnectionInstructions({ mcpUrl }: { mcpUrl: string }) {
  const authorizeUrl = mcpUrl.replace("/api/mcp", "/api/mcp/authorize");

  return (
    <div>
      <h2 className="text-lg font-semibold text-foreground mb-4">
        Setup Instructions
      </h2>
      <div className="space-y-3">
        <InstructionCard title="Claude Desktop">
          <p>
            Add this to your{" "}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">
              claude_desktop_config.json
            </code>
            :
          </p>
          <CodeBlock>
            {JSON.stringify(
              {
                mcpServers: {
                  insight: {
                    url: mcpUrl,
                    transport: "streamable-http",
                  },
                },
              },
              null,
              2
            )}
          </CodeBlock>
          <p>
            On first use, Claude Desktop will open a browser for OAuth
            authentication.
          </p>
        </InstructionCard>

        <InstructionCard title="Cursor">
          <p>
            Add this to your Cursor MCP settings (
            <code className="text-xs bg-muted px-1 py-0.5 rounded">
              .cursor/mcp.json
            </code>
            ):
          </p>
          <CodeBlock>
            {JSON.stringify(
              {
                mcpServers: {
                  insight: {
                    url: mcpUrl,
                    transport: "streamable-http",
                  },
                },
              },
              null,
              2
            )}
          </CodeBlock>
        </InstructionCard>

        <InstructionCard title="MCP Inspector">
          <p>Test your connection with the MCP Inspector:</p>
          <CodeBlock>{`npx @modelcontextprotocol/inspector --url ${mcpUrl}`}</CodeBlock>
        </InstructionCard>

        <InstructionCard title="Custom Client (TypeScript)">
          <p>Connect programmatically using the MCP SDK:</p>
          <CodeBlock>
            {`import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

const transport = new StreamableHTTPClientTransport(
  new URL("${mcpUrl}"),
  { headers: { Authorization: \`Bearer \${accessToken}\` } }
);
const client = new Client({ name: "my-app", version: "1.0.0" });
await client.connect(transport);`}
          </CodeBlock>
        </InstructionCard>

        <InstructionCard title="OAuth Flow">
          <p>MCP clients authenticate via OAuth 2.0 with PKCE:</p>
          <ol className="list-decimal list-inside space-y-1.5">
            <li>
              Client opens:{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded break-all">
                GET {authorizeUrl}?response_type=code&client_id=...&redirect_uri=...&state=...&code_challenge=...&code_challenge_method=S256
              </code>
            </li>
            <li>User logs in and selects a workspace</li>
            <li>Callback returns an authorization code</li>
            <li>
              Client exchanges the code for tokens via{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">
                POST /api/mcp/token
              </code>
            </li>
            <li>
              Use the access token:{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">
                Authorization: Bearer &lt;token&gt;
              </code>
            </li>
          </ol>
          <p>
            Access tokens expire after 1 hour. Use the refresh token to get a
            new one.
          </p>
        </InstructionCard>
      </div>
    </div>
  );
}

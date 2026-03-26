# MCP Server

Insight exposes its capabilities via a [Model Context Protocol](https://modelcontextprotocol.io/) server. External AI clients — Claude Desktop, Cursor, MCP Inspector, or custom apps — can connect to manage issues, search knowledge, and view board state.

Each MCP connection is scoped to **one workspace** via OAuth. The workspace is implicit in every tool call — no `workspaceId` parameter needed.

## Quick Start

### MCP Inspector

```bash
npx @modelcontextprotocol/inspector --url http://localhost:3000/api/mcp
```

### Programmatic (TypeScript)

```typescript
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

const transport = new StreamableHTTPClientTransport(
  new URL("http://localhost:3000/api/mcp"),
  { headers: { Authorization: `Bearer ${accessToken}` } }
);
const client = new Client({ name: "my-app", version: "1.0.0" });
await client.connect(transport);
```

## Tools

| Tool | Description | Min Role |
|------|-------------|----------|
| `get-board-overview` | Board with columns, issues, labels, cycles | viewer+ |
| `list-issues` | Filter by status, priority, label, cycle, assignee, search | viewer+ |
| `create-issue` | Create issue with all fields | member+ |
| `update-issue` | Update any fields; auto-moves column on status change | member+ |
| `create-subtask` | Create subtask under parent issue | member+ |
| `add-comment` | Comment on an issue | member+ |
| `search-knowledge` | Search docs by query, tag, folder | viewer+ |
| `list-cycles` | List sprints with status and issue counts | viewer+ |

## Resources

| URI | Description |
|-----|-------------|
| `insight://workspace` | Workspace name, slug, purpose, columns, labels, member count |
| `insight://issue/{issueId}` | Full issue with labels, comments, activities, subtasks |

## OAuth Flow

Authentication uses OAuth 2.0 Authorization Code with PKCE (S256).

```
Client                          Insight                        WorkOS
  │                                │                              │
  │─ GET /api/mcp/authorize ──────>│                              │
  │                                │── redirect to WorkOS ──────>│
  │                                │                              │── user logs in
  │                                │<── callback + session ──────│
  │  (workspace picker if needed)  │                              │
  │<── redirect with code ─────────│                              │
  │                                │                              │
  │─ POST /api/mcp/token ─────────>│                              │
  │<── { access_token, refresh } ──│                              │
  │                                │                              │
  │─ POST /api/mcp (Bearer) ──────>│── validate JWT + workspace  │
  │<── MCP response ───────────────│                              │
```

### Steps

1. Open browser to:
   ```
   GET /api/mcp/authorize?response_type=code&client_id=my-app&redirect_uri=http://localhost:8080/callback&state=RANDOM&code_challenge=BASE64URL(SHA256(verifier))&code_challenge_method=S256
   ```
2. User logs in via WorkOS. If multiple workspaces, user selects one.
3. Redirects to `redirect_uri?code=AUTH_CODE&state=RANDOM`
4. Exchange code for tokens:
   ```bash
   curl -X POST http://localhost:3000/api/mcp/token \
     -d "grant_type=authorization_code&code=AUTH_CODE&client_id=my-app&redirect_uri=http://localhost:8080/callback&code_verifier=ORIGINAL_VERIFIER"
   ```
5. Use access token: `Authorization: Bearer <access_token>`
6. Refresh when expired:
   ```bash
   curl -X POST http://localhost:3000/api/mcp/token \
     -d "grant_type=refresh_token&refresh_token=REFRESH_TOKEN&client_id=my-app"
   ```

### Token Details

- **Access token**: JWT (HS256), 1-hour expiry, payload `{ sub: userId, wid: workspaceId | null }`
- **Refresh token**: Opaque string stored in DB, 30-day expiry, rotated on use

## Environment Variables

```bash
# Required (new)
MCP_JWT_SECRET=<random 32+ character string for signing JWTs>

# Already required by the app
WORKOS_CLIENT_ID=client_...
WORKOS_API_KEY=sk_test_...
WORKOS_COOKIE_PASSWORD=<32+ char password>
```

## Error Responses

Tool errors follow this format:

```json
{
  "content": [{ "type": "text", "text": "Error: Issue not found (id: iss_999)" }],
  "isError": true
}
```

Common errors:
- **Unauthorized** — missing or invalid Bearer token
- **Forbidden** — insufficient role for the operation
- **Not found** — entity doesn't exist or doesn't belong to connected workspace
- **Invalid input** — schema validation failure

## Architecture

```
src/lib/mcp-server/
├── index.ts                    # createMCPServer() factory
├── config.ts                   # Server name and version
├── errors.ts                   # McpToolError + formatToolError()
├── schemas.ts                  # Zod schemas for tool inputs
├── auth/
│   ├── token.ts                # JWT create/verify (jose)
│   ├── oauth-provider.ts       # Auth code + refresh token DB ops
│   └── middleware.ts           # authenticateMCPRequest()
├── services/
│   ├── auth-context.ts         # MCPAuthContext type
│   ├── issues.ts               # Issue CRUD + subtasks
│   ├── comments.ts             # Add comment
│   ├── board.ts                # Board overview
│   ├── knowledge.ts            # Knowledge search
│   └── cycles.ts               # Cycle listing
├── tools/
│   ├── index.ts                # registerAllTools()
│   ├── issues.ts               # list-issues, create-issue, update-issue, create-subtask
│   ├── comments.ts             # add-comment
│   ├── board.ts                # get-board-overview
│   ├── knowledge.ts            # search-knowledge
│   └── cycles.ts               # list-cycles
└── resources/
    ├── index.ts                # registerAllResources()
    ├── workspace.ts            # insight://workspace
    └── issue.ts                # insight://issue/{id}

src/app/api/mcp/
├── route.ts                    # Streamable HTTP transport (POST/GET/DELETE)
├── authorize/route.ts          # OAuth authorization endpoint
├── callback/route.ts           # OAuth callback from WorkOS
├── token/route.ts              # Token exchange endpoint
└── .well-known/
    └── oauth-authorization-server/
        └── route.ts            # RFC 8414 server metadata
```

## Settings Page

Workspace admins can manage MCP connections at **Settings > MCP API**:
- View the endpoint URL
- Setup instructions for each client
- Tool and resource reference
- Revoke active sessions

## Design Decisions

- **Single workspace per connection**: Keeps tool calls simple (no workspace parameter). Connect multiple times for multiple workspaces.
- **Service layer duplication**: Services duplicate query patterns from server actions to avoid `cookies()` / `revalidatePath()` unavailable in API routes.
- **Stateless transport**: Each POST creates a fresh server instance. No server-side session state.
- **No MCP prompts in v1**: Tools + resources cover the use cases.

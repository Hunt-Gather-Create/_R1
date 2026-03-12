---
name: connect-platforms
description: |
  Guides users to connect their social media accounts for accessing post and profile data.
  MANDATORY TRIGGERS: connect instagram, connect linkedin, connect twitter, connect facebook, social media accounts, platform connections, publish to social, social media data, post analytics, social profiles
  Use when users want to access social media data, connect accounts, or when the AI detects an unconnected platform is needed for the current task.
purposes:
  - marketing
---

# Connect Social Media Platforms

You help users connect their social media accounts to access post and profile data directly from the workspace.

## Workflow

1. **Check Connections** - Use `get_platform_connections` to see which platforms the user has connected
2. **Guide Connection** - If the needed platform is not connected, use `connect_platform` to initiate OAuth
3. **Wait for Auth** - The user will authorize in a popup window. Once complete, the platform tools become available
4. **Use Platform Tools** - After connecting, use the platform's MCP tools to access post/profile data

## Available Platforms

- **Instagram** - Business/Creator accounts: view posts, stories, engagement metrics, profile data
- **LinkedIn** - Professional profiles, company pages, post analytics, articles
- **X (Twitter)** - Tweets, threads, mentions, follower data, engagement metrics
- **Facebook** - Page posts, comments, albums, page insights

## Guidelines

- Always check connection status before attempting to use platform tools
- If a user asks about data from an unconnected platform, explain what connecting enables and offer to start the connection
- Authentication is handled securely via OAuth — you never see or handle passwords
- Each user connects their own accounts. Connections are per-user, not shared across the workspace
- If authorization fails or times out, suggest the user try again or check Settings > Integrations

interface AISearchHit {
  id: string;
  content: string;
  score: number;
  source: string;
  title?: string;
}

interface AISearchResponse {
  success: boolean;
  result?: {
    data?: Array<{
      id?: string;
      content?: string;
      score?: number;
      filename?: string;
      metadata?: Record<string, string>;
      attributes?: Record<string, string>;
      title?: string;
    }>;
  };
  errors?: Array<{ message?: string }>;
}

const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CLOUDFLARE_AI_SEARCH_ID = process.env.CLOUDFLARE_AI_SEARCH_ID;
const CLOUDFLARE_AI_SEARCH_API_TOKEN = process.env.CLOUDFLARE_AI_SEARCH_API_TOKEN;

function getBaseUrl(): string {
  if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_AI_SEARCH_ID) {
    throw new Error(
      "Cloudflare AI Search not configured. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_SEARCH_ID."
    );
  }
  return `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/autorag/rags/${CLOUDFLARE_AI_SEARCH_ID}`;
}

function getToken(): string {
  if (!CLOUDFLARE_AI_SEARCH_API_TOKEN) {
    throw new Error(
      "Cloudflare AI Search token not configured. Set CLOUDFLARE_AI_SEARCH_API_TOKEN."
    );
  }
  return CLOUDFLARE_AI_SEARCH_API_TOKEN;
}

export function isAISearchConfigured(): boolean {
  return Boolean(
    CLOUDFLARE_ACCOUNT_ID &&
      CLOUDFLARE_AI_SEARCH_ID &&
      CLOUDFLARE_AI_SEARCH_API_TOKEN
  );
}

export async function queryWorkspaceKnowledge(input: {
  workspaceId: string;
  query: string;
  maxResults?: number;
}): Promise<AISearchHit[]> {
  if (!isAISearchConfigured()) {
    return [];
  }

  const workspacePrefix = `kb/${input.workspaceId}/`;
  const response = await fetch(`${getBaseUrl()}/ai-search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: input.query,
      max_num_results: input.maxResults ?? 6,
      ranking_options: {
        score_threshold: 0,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Cloudflare AI Search failed: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as AISearchResponse;
  if (!data.success) {
    throw new Error(data.errors?.[0]?.message ?? "Cloudflare AI Search request failed");
  }

  const rows = data.result?.data ?? [];
  return rows
    .filter((row) => (row.filename ?? "").startsWith(workspacePrefix))
    .map((row, idx) => ({
      id: row.id ?? `${idx}`,
      content: row.content ?? "",
      score: row.score ?? 0,
      source: row.filename ?? "unknown",
      title: row.title ?? row.metadata?.title ?? row.attributes?.title,
    }))
    .filter((row) => row.content.trim().length > 0);
}

export async function syncWorkspaceKnowledge(workspaceId: string): Promise<void> {
  if (!isAISearchConfigured()) {
    return;
  }

  const workspacePrefix = `kb/${workspaceId}/`;
  const response = await fetch(`${getBaseUrl()}/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      paths: [workspacePrefix],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Cloudflare AI Search sync failed: ${response.status} ${errorText}`);
  }
}

# Knowledge Base + AI Search

This workspace now supports a markdown Knowledge Base backed by Cloudflare R2 and optional Cloudflare AI Search retrieval.

## What is implemented

- Workspace-scoped folder + document metadata in SQLite.
- Markdown document content stored in R2 (`kb/{workspaceId}/...`).
- Original uploaded documents stored in R2 and kept downloadable.
- View-only previews:
  - Native preview for `.pdf`, `.csv`, `.txt`
  - Office files (`.doc/.docx/.xls/.xlsx/.ppt/.pptx`) converted to PDF for preview
- Image assets uploaded to R2 (`kb-assets/{workspaceId}/...`) and served through authenticated API routes.
- Wiki-link parsing (`[[Document Title]]`) and backlink graph persistence.
- `#tag` extraction for filtering and autocomplete.
- Explicit issue-to-document linking from issue details.
- Ticket AI prompt enrichment with:
  - Always-included explicitly linked docs.
  - Additional semantic docs from Cloudflare AI Search.
- Manual index sync endpoint: `POST /api/knowledge/sync`.

## Environment variables

Existing R2 variables are required:

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`

Cloudflare document conversion is required for Office previews:

- `CLOUDFLARE_DOC_CONVERTER_URL` (absolute URL to your conversion endpoint)
- `CLOUDFLARE_DOC_CONVERTER_API_TOKEN` (optional bearer token)
- `CLOUDFLARE_DOC_CONVERTER_TIMEOUT_MS` (optional, default `120000`)
- `CLOUDFLARE_DOC_CONVERTER_FILE_FIELD` (optional, default `file`)

You can deploy the included container service in:

- `cloudflare/doc-converter`

Cloudflare AI Search is optional, but required for semantic retrieval/sync:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_AI_SEARCH_ID`
- `CLOUDFLARE_AI_SEARCH_API_TOKEN`

## Notes

- Multi-tenancy isolation is enforced by workspace path prefix (`kb/{workspaceId}/`) and client-side filtering of AI Search hits to that prefix.
- If AI Search is not configured, the Knowledge Base still works and linked documents still provide context to ticket AI.
- Preview conversion endpoint contract: `POST` multipart form-data with a file field and return `application/pdf`.

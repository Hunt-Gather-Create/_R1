# KB Doc Converter (Cloudflare Containers)

This service converts uploaded Office files to PDF for previewing in the Knowledge Base.

It exposes:
- `POST /convert` (multipart form upload)
- `GET /health`

Internally it runs [Gotenberg](https://gotenberg.dev/) in a Cloudflare Container and forwards requests to LibreOffice conversion.

## 1) Deploy

From this directory:

```bash
pnpm install
pnpm wrangler login
pnpm wrangler deploy
```

After deploy, note your Worker URL, for example:
- `https://kb-doc-converter.<your-subdomain>.workers.dev`

## 2) (Recommended) Set auth token

Use the same bearer token in both places:

```bash
pnpm wrangler secret put DOC_CONVERTER_API_TOKEN
```

And in your app env (`.env.local`):

```bash
CLOUDFLARE_DOC_CONVERTER_URL=https://kb-doc-converter.<your-subdomain>.workers.dev/convert
CLOUDFLARE_DOC_CONVERTER_API_TOKEN=<same-token>
```

If you skip the secret, the endpoint is open and `CLOUDFLARE_DOC_CONVERTER_API_TOKEN` should be left unset in the app.

## 3) Test it

```bash
curl -X POST \
  -H "Authorization: Bearer <same-token>" \
  -F "file=@/absolute/path/to/sample.docx" \
  "https://kb-doc-converter.<your-subdomain>.workers.dev/convert" \
  --output output.pdf
```

Notes:
- The endpoint accepts common file field names; it normalizes to Gotenberg's `files` field.
- The output is always `application/pdf`.
- Keep your app upload limit aligned with what your Worker plan can handle.

## Troubleshooting

If deploy fails with `\"undefined\" is not valid JSON` during container application creation:

1. Use this repo's minimal `wrangler.jsonc` (already applied).
2. Upgrade wrangler and retry:

```bash
pnpm dlx wrangler@latest deploy
```

If deploy fails with `DURABLE_OBJECT_ALREADY_HAS_APPLICATION`, it means the DO class is
already linked to a container app. Keep the container `name` in `wrangler.jsonc` set to that
existing app name (for example `kb-doc-converter-docconvertercontainer`) so Wrangler updates it
instead of trying to create a second application.

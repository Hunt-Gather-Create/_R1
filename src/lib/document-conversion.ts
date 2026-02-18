const DOC_CONVERTER_URL = process.env.CLOUDFLARE_DOC_CONVERTER_URL?.trim();
const DOC_CONVERTER_API_TOKEN = process.env.CLOUDFLARE_DOC_CONVERTER_API_TOKEN?.trim();
const DOC_CONVERTER_FILE_FIELD =
  process.env.CLOUDFLARE_DOC_CONVERTER_FILE_FIELD?.trim() || "file";

function getTimeoutMs(): number {
  const raw = process.env.CLOUDFLARE_DOC_CONVERTER_TIMEOUT_MS;
  if (!raw) return 120000;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 120000;
  }

  return parsed;
}

function getConverterUrl(): string {
  if (!DOC_CONVERTER_URL) {
    throw new Error(
      "Document converter not configured. Set CLOUDFLARE_DOC_CONVERTER_URL."
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(DOC_CONVERTER_URL);
  } catch {
    throw new Error("CLOUDFLARE_DOC_CONVERTER_URL must be an absolute URL");
  }

  return parsed.toString();
}

export function isDocumentConverterConfigured(): boolean {
  if (!DOC_CONVERTER_URL) return false;

  try {
    new URL(DOC_CONVERTER_URL);
    return true;
  } catch {
    return false;
  }
}

export async function convertDocumentToPdf(input: {
  filename: string;
  mimeType: string;
  content: Uint8Array;
}): Promise<Uint8Array> {
  const converterUrl = getConverterUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getTimeoutMs());

  try {
    const headers = new Headers({
      Accept: "application/pdf",
    });

    if (DOC_CONVERTER_API_TOKEN) {
      headers.set("Authorization", `Bearer ${DOC_CONVERTER_API_TOKEN}`);
    }

    const arrayBuffer = new ArrayBuffer(input.content.byteLength);
    new Uint8Array(arrayBuffer).set(input.content);

    const form = new FormData();
    form.set(
      DOC_CONVERTER_FILE_FIELD,
      new Blob([arrayBuffer], {
        type: input.mimeType || "application/octet-stream",
      }),
      input.filename || "document"
    );

    const response = await fetch(converterUrl, {
      method: "POST",
      headers,
      body: form,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Document conversion failed: ${response.status} ${errorText.slice(0, 400)}`
      );
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("application/pdf")) {
      throw new Error(
        `Document converter returned unsupported content type: ${contentType || "unknown"}`
      );
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) {
      throw new Error("Document converter returned an empty PDF");
    }

    return bytes;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Document conversion timed out");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

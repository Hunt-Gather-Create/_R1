import { Container, getContainer } from "@cloudflare/containers";

export class DocConverterContainer extends Container {
  defaultPort = 3000;
  sleepAfter = "5m";
}

type Env = {
  DOC_CONVERTER: DurableObjectNamespace<DocConverterContainer>;
  DOC_CONVERTER_API_TOKEN?: string;
};

function unauthorizedResponse() {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

function isAuthorized(request: Request, env: Env): boolean {
  const expectedToken = env.DOC_CONVERTER_API_TOKEN?.trim();
  if (!expectedToken) {
    return true;
  }

  const actualAuthorization = request.headers.get("authorization")?.trim();
  return actualAuthorization === `Bearer ${expectedToken}`;
}

async function toGotenbergPayload(request: Request): Promise<FormData> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("multipart/form-data")) {
    throw new Error("Expected multipart/form-data upload");
  }

  const incoming = await request.formData();
  const outgoing = new FormData();

  let fileCount = 0;
  incoming.forEach((value) => {
    if (value instanceof File) {
      outgoing.append("files", value, value.name || "document");
      fileCount += 1;
    }
  });

  if (fileCount === 0) {
    throw new Error("No file found in multipart form data");
  }

  return outgoing;
}

const handler: ExportedHandler<Env> = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "kb-doc-converter" });
    }

    if (url.pathname !== "/convert") {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    if (request.method !== "POST") {
      return Response.json(
        { error: "Method not allowed. Use POST /convert" },
        {
          status: 405,
          headers: {
            Allow: "POST",
          },
        }
      );
    }

    if (!isAuthorized(request, env)) {
      return unauthorizedResponse();
    }

    let gotenbergPayload: FormData;
    try {
      gotenbergPayload = await toGotenbergPayload(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Bad request";
      return Response.json({ error: message }, { status: 400 });
    }

    const container = getContainer(env.DOC_CONVERTER, "office-pdf");
    const gotenbergUrl = new URL(request.url);
    gotenbergUrl.pathname = "/forms/libreoffice/convert";
    gotenbergUrl.search = "";

    const upstream = await container.fetch(
      new Request(gotenbergUrl.toString(), {
        method: "POST",
        body: gotenbergPayload,
        headers: {
          Accept: "application/pdf",
        },
      })
    );

    if (!upstream.ok) {
      const errorText = await upstream.text();
      return Response.json(
        {
          error: "Conversion failed",
          details: errorText.slice(0, 1000),
        },
        { status: upstream.status }
      );
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "cache-control": "no-store",
      },
    });
  },
};

export default handler;

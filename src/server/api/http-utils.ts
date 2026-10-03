import type { ProxyRequestInput } from "../../core/types.ts";
import type { RuntimeStatus } from "./runtime-api.ts";
import type { Context } from "hono";

/**
 * Loose JSON body shape accepted by local HTTP handlers.
 */
export type JsonRequestBody = {
  input?: unknown;
  values?: Record<string, unknown>;
  clientId?: unknown;
  clientSecret?: unknown;
  requestedScopes?: unknown;
  extra?: unknown;
  [key: string]: unknown;
};

const hopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/** Strip transport, reconstructed-body, and gateway-only headers in either direction. */
export function filterPassthroughHeaders(headers: Headers, direction: "request" | "response"): Headers {
  const blocked = new Set(hopByHopHeaders);
  for (const name of (headers.get("connection") ?? "").split(",")) blocked.add(name.trim().toLowerCase());
  blocked.add("content-length");
  blocked.add("content-encoding");
  if (direction === "request") {
    for (const name of ["authorization", "cookie", "host", "expect", "forwarded", "x-real-ip"]) blocked.add(name);
  } else {
    for (const name of [
      "set-cookie",
      "set-cookie2",
      "refresh",
      "cloudflare-cdn-cache-control",
      "cdn-cache-control",
      "surrogate-control",
      "clear-site-data",
      "strict-transport-security",
      "alt-svc",
      "report-to",
      "reporting-endpoints",
      "nel",
      "service-worker-allowed",
    ])
      blocked.add(name);
  }
  const filtered = new Headers();
  for (const [name, value] of headers) {
    if (
      !blocked.has(name) &&
      !name.startsWith("x-oo-connector-") &&
      !(direction === "request" && name.startsWith("x-forwarded-")) &&
      !(direction === "response" && name.startsWith("access-control-"))
    ) {
      filtered.set(name, value);
    }
  }
  return filtered;
}

/** Adapt a native UTF-8 request without parsing its body or query. */
export async function readPassthroughRequest(context: Context): Promise<ProxyRequestInput> {
  const method = context.req.method;
  const headers = context.req.raw.headers;
  if (headers.has("upgrade") || /(?:^|,)\s*upgrade\s*(?:,|$)/i.test(headers.get("connection") ?? "")) {
    throw new HttpRequestError("unsupported_transport", "Protocol upgrades are not supported.", 501);
  }
  if ((headers.get("accept") ?? "").toLowerCase().includes("text/event-stream")) {
    throw new HttpRequestError("unsupported_transport", "Streaming event responses are not supported.", 501);
  }
  const encoding = headers.get("content-encoding")?.trim().toLowerCase();
  if (encoding && encoding !== "identity") {
    throw new HttpRequestError("unsupported_media_type", "Compressed request bodies are not supported.", 415);
  }
  const contentType = (headers.get("content-type") ?? "").toLowerCase();
  const mediaType = contentType.split(";", 1)[0]!.trim();
  if (mediaType === "text/event-stream") {
    throw new HttpRequestError("unsupported_transport", "Streaming requests are not supported.", 501);
  }
  const endpoint = context.req.path.replace(/^\/v1\/passthrough\/[^/]+/, "") || "/";
  const request: ProxyRequestInput = {
    endpoint: endpoint + new URL(context.req.url).search,
    method,
    headers: Object.fromEntries(filterPassthroughHeaders(headers, "request")),
  };
  const body = await readRequestText(context, undefined, true);
  if (context.req.raw.body) {
    request.body = body;
  }
  return request;
}

async function readRequestText(context: Context, maxBytes?: number, requireUtf8 = false): Promise<string> {
  const contentLength = Number(context.req.header("content-length"));
  if (maxBytes !== undefined && Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new HttpRequestError("payload_too_large", `Request body must not exceed ${maxBytes} bytes.`, 413);
  }
  if (maxBytes === undefined && !requireUtf8) return context.req.raw.text();
  if (!context.req.raw.body) return "";
  const reader = context.req.raw.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: requireUtf8, ignoreBOM: requireUtf8 });
  let byteLength = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (maxBytes !== undefined) {
        byteLength += value.byteLength;
        if (byteLength > maxBytes) {
          throw new HttpRequestError("payload_too_large", `Request body must not exceed ${maxBytes} bytes.`, 413);
        }
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof TypeError && requireUtf8) {
      throw new HttpRequestError("unsupported_media_type", "Request bodies must contain valid UTF-8.", 415);
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Read an optional JSON object request body.
 *
 * Empty bodies and non-JSON requests resolve to an empty object. Malformed
 * JSON is rejected before route handlers can accidentally execute actions with
 * a damaged request body.
 */
export async function readJsonBody(context: Context, maxBytes?: number): Promise<JsonRequestBody> {
  const contentType = context.req.header("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return {};
  }

  try {
    const text = await readRequestText(context, maxBytes);
    const body = text ? (JSON.parse(text) as unknown) : {};
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpRequestError("invalid_json", "Request body must be a JSON object.");
    }
    return body as JsonRequestBody;
  } catch (error) {
    if (error instanceof HttpRequestError) {
      throw error;
    }
    throw new HttpRequestError("invalid_json", "Request body must be valid JSON.");
  }
}

/**
 * Write the standard JSON error envelope used by local HTTP routes.
 */
export function jsonError(context: Context, status: RuntimeStatus, code: string, message: string): Response {
  return context.json(
    {
      error: {
        code,
        message,
      },
    },
    status,
  );
}

/**
 * Write the standard not-found response.
 */
export function notFound(context: Context): Response {
  return jsonError(context, 404, "not_found", "Not found.");
}

/**
 * Write an unexpected server error without exposing stack traces.
 */
export function internalError(context: Context, _error: unknown): Response {
  return jsonError(context, 500, "internal_error", "Internal server error.");
}

export class HttpRequestError extends Error {
  readonly code: string;
  readonly status: RuntimeStatus;

  constructor(code: string, message: string, status: RuntimeStatus = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

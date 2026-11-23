import type {
  AssetsBinding,
  D1DatabaseBinding,
  D1PreparedStatementBinding,
  KVNamespaceBinding,
  R2BucketBinding,
  R2ObjectBinding,
} from "./cloudflare/cloudflare-bindings.ts";
import type { CloudflareEnv } from "./cloudflare/cloudflare-env.ts";

import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./cloudflare.ts";
import { createWorkerSecretCodec } from "./secrets/worker-secret-codec.ts";
import { D1RuntimeDatabase } from "./storage/d1/runtime-store.ts";
import { SqliteD1Database } from "./storage/d1/test-database.ts";
import { RuntimeTokenService } from "./storage/runtime-token-service.ts";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {} }));

const provider = {
  service: "example",
  displayName: "Example",
  categories: ["Developer Tools"],
  authTypes: ["no_auth"],
  auth: [{ type: "no_auth" }],
  actions: [],
};

describe("cloudflare worker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("allows Access administrators only on the console origin and preserves runtime bearer authentication", async () => {
    const consoleOrigin = "https://console.example.com";
    const apiOrigin = "https://connector.example.workers.dev";
    const team = "worker-test.cloudflareaccess.com";
    const audience = "test-audience";
    const issuer = `https://${team}`;
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const key = { ...(await exportJWK(publicKey)), kid: "access-signing-key" };
    const fetchJwks = vi.fn(async () => Response.json({ keys: [key] }));
    vi.stubGlobal("fetch", fetchJwks);
    const sign = (aud = audience, iss = issuer, expires = "5m", email = "admin@example.com") =>
      new SignJWT({ email })
        .setProtectedHeader({ alg: "RS256", kid: key.kid })
        .setIssuer(iss)
        .setAudience(aud)
        .setSubject("access-user")
        .setExpirationTime(expires)
        .sign(privateKey);
    const env = {
      ...createEnv(),
      ASSETS: memoryAssets({ ...chunkedCatalog(), "/": "console", "/assets/index.js": "console JS" }),
      OPEN_CONNECTOR_ACCESS_CONSOLE_ORIGIN: consoleOrigin,
      OPEN_CONNECTOR_ACCESS_TEAM_DOMAIN: team,
      OPEN_CONNECTOR_ACCESS_AUDIENCE: audience,
      OOMOL_CONNECT_ADMIN_TOKEN: "old-password",
      OOMOL_CONNECT_RUNTIME_TOKEN: "runtime-token",
    };
    const request = (origin: string, path: string, init?: RequestInit) =>
      worker.fetch(new Request(`${origin}${path}`, init), env, createExecutionContext());
    const authenticated = { "Cf-Access-Jwt-Assertion": await sign() };

    await expect(request(consoleOrigin, "/")).resolves.toMatchObject({ status: 401 });
    await expect(request(consoleOrigin, "/assets/index.js")).resolves.toMatchObject({ status: 401 });
    await expect(request(consoleOrigin, "/", { headers: authenticated })).resolves.toMatchObject({ status: 200 });
    await expect(request(apiOrigin, "/", { headers: authenticated })).resolves.toMatchObject({ status: 401 });
    await expect(request(apiOrigin, "/health")).resolves.toMatchObject({ status: 200 });
    const session = await request(consoleOrigin, "/api/auth/session", { headers: authenticated });
    await expect(session.json()).resolves.toEqual({ adminAuthConfigured: false, authenticated: true });
    expect(session.headers.get("set-cookie")).toBeNull();

    for (const token of [
      "forged",
      await sign("other-audience"),
      await sign(audience, "https://other.example"),
      await sign(audience, issuer, "-5m"),
      await sign(audience, issuer, "5m", ""),
    ]) {
      await expect(
        request(consoleOrigin, "/openapi.json", {
          headers: { "Cf-Access-Jwt-Assertion": token, authorization: "Bearer old-password" },
        }),
      ).resolves.toMatchObject({ status: 401 });
    }
    await expect(
      request(apiOrigin, "/openapi.json", { headers: { authorization: "Bearer runtime-token" } }),
    ).resolves.toMatchObject({ status: 401 });
    await expect(request(apiOrigin, "/v1/health", { headers: authenticated })).resolves.toMatchObject({ status: 401 });
    await expect(
      request(apiOrigin, "/v1/health", { headers: { authorization: "Bearer runtime-token" } }),
    ).resolves.toMatchObject({ status: 200 });
    expect(fetchJwks).toHaveBeenCalledWith(`${issuer}/cdn-cgi/access/certs`, expect.anything());

    const put = (origin: string) =>
      request(consoleOrigin, "/api/connections/example", {
        method: "PUT",
        headers: { ...authenticated, "content-type": "application/json", origin },
        body: JSON.stringify({ authType: "no_auth", connectionName: "work", values: {} }),
      });
    await expect(put("https://other.example")).resolves.toMatchObject({ status: 401 });
    await expect(put(consoleOrigin)).resolves.toMatchObject({ status: 200 });

    const { OPEN_CONNECTOR_ACCESS_AUDIENCE: _audience, ...incomplete } = env;
    const missingAudience = await worker.fetch(
      new Request(`${consoleOrigin}/openapi.json`, { headers: { authorization: "Bearer old-password" } }),
      incomplete,
      createExecutionContext(),
    );
    expect(missingAudience.status).toBe(401);
  });

  it("exposes OAuth machine routes publicly and limits browser consent to signed Access on the API origin", async () => {
    const origin = "https://mcp-api.example.com";
    const legacyOrigin = "https://connector.example.workers.dev";
    const team = "mcp-test.cloudflareaccess.com";
    const issuer = `https://${team}`;
    const audience = "mcp-test-audience";
    const redirectUri = "https://client.example.com/callback";
    const clientDocument = "https://client.example.com/oauth-client.json";
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const signingHeader = { alg: "RS256", kid: "consent-key" };
    const jwk = { ...(await exportJWK(publicKey)), kid: signingHeader.kid };
    const sign = (aud = audience, iss = issuer, expiry = "5m", subject = "access-user", key = privateKey) =>
      new SignJWT({ email: "operator@example.com" })
        .setProtectedHeader(signingHeader)
        .setIssuer(iss)
        .setAudience(aud)
        .setSubject(subject)
        .setExpirationTime(expiry)
        .sign(key);
    const assertion = await sign();
    const clientMetadata = {
      client_name: "Test OAuth Client",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "mcp:access offline_access",
    };
    const fetchNetwork = vi.fn<typeof fetch>(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === `${issuer}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
      if (url === clientDocument) return Response.json({ ...clientMetadata, client_id: clientDocument });
      throw new Error(`Unexpected network request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchNetwork);
    vi.stubGlobal("Cloudflare", { compatibilityFlags: { global_fetch_strictly_public: true } });
    const db = new SqliteD1Database();
    const kv = new MemoryKVNamespace();
    const env = {
      ...createEnv(),
      DB: db,
      OAUTH_KV: kv,
      OPEN_CONNECTOR_MCP_OAUTH_ORIGIN: origin,
      OPEN_CONNECTOR_ACCESS_TEAM_DOMAIN: team,
      OPEN_CONNECTOR_ACCESS_AUDIENCE: audience,
      OPEN_CONNECTOR_ACCESS_CONSOLE_ORIGIN: "https://mcp-console.example.com",
      OOMOL_CONNECT_ORIGIN: legacyOrigin,
      OOMOL_CONNECT_ENCRYPTION_KEY: "test-encryption-key",
      OOMOL_CONNECT_ADMIN_TOKEN: "old-password",
      OOMOL_CONNECT_RUNTIME_TOKEN: "legacy-key",
    };
    const request = (path: string, init?: RequestInit, requestOrigin = origin) =>
      worker.fetch(new Request(`${requestOrigin}${path}`, init), env, createExecutionContext());
    const rpc = (token?: string, requestOrigin = origin) =>
      request(
        "/mcp",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } },
          }),
        },
        requestOrigin,
      );
    const form = (path: string, values: Record<string, string>, headers: HeadersInit = {}) =>
      request(path, { method: "POST", headers, body: new URLSearchParams(values) });
    const authorizePath = "/oauth/mcp/authorize";
    const tokenPath = "/oauth/mcp/token";
    const accessHeader = { "Cf-Access-Jwt-Assertion": assertion };
    try {
      const challenge = await rpc();
      expect(challenge.status).toBe(401);
      expect(challenge.headers.get("www-authenticate")).toContain(`${origin}/.well-known/oauth-protected-resource/mcp`);
      for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
        const metadata = await request(path);
        expect(metadata.status).toBe(200);
        expect(await metadata.json()).toMatchObject({ resource: `${origin}/mcp`, authorization_servers: [origin] });
      }
      const discovery = await request("/.well-known/oauth-authorization-server");
      expect(discovery.status).toBe(200);
      expect(await discovery.json()).toMatchObject({
        issuer: origin,
        authorization_endpoint: `${origin}${authorizePath}`,
        token_endpoint: `${origin}${tokenPath}`,
        registration_endpoint: `${origin}/oauth/mcp/register`,
        client_id_metadata_document_supported: true,
        code_challenge_methods_supported: ["S256"],
      });
      const registration = await request("/oauth/mcp/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(clientMetadata),
      });
      expect(registration.status).toBe(201);
      const { client_id: registeredId } = await registration.json();
      expect(registeredId).toEqual(expect.any(String));

      await expect(request(authorizePath, { headers: accessHeader }, legacyOrigin)).resolves.toMatchObject({
        status: 404,
      });
      await expect(
        request(authorizePath, { method: "POST", headers: accessHeader }, legacyOrigin),
      ).resolves.toMatchObject({ status: 404 });
      await expect(request(authorizePath, { method: "HEAD", headers: accessHeader })).resolves.toMatchObject({
        status: 405,
      });
      const otherKey = (await generateKeyPair("RS256")).privateKey;
      for (const badToken of [
        await sign(audience, issuer, "5m", "access-user", otherKey),
        await sign("wrong-audience"),
        await sign(audience, "https://wrong.example"),
        await sign(audience, issuer, "-1m"),
        await sign(audience, issuer, "5m", ""),
      ]) {
        await expect(
          request(authorizePath, { headers: { "Cf-Access-Jwt-Assertion": badToken } }),
        ).resolves.toMatchObject({ status: 401 });
      }
      const fakeCredentials = { authorization: `Bearer ${assertion}`, cookie: `CF_Authorization=${assertion}` };
      await expect(request(authorizePath, { headers: fakeCredentials })).resolves.toMatchObject({ status: 401 });
      await expect(
        form(authorizePath, { decision: "approve", admin_token: "old-password" }, { ...fakeCredentials, origin }),
      ).resolves.toMatchObject({ status: 401 });
      await expect(rpc("legacy-key", legacyOrigin)).resolves.toMatchObject({ status: 200 });
      await expect(
        request("/v1/health", { headers: { authorization: "Bearer legacy-key" } }, legacyOrigin),
      ).resolves.toMatchObject({ status: 200 });
      await expect(request("/v1/health", { headers: accessHeader }, legacyOrigin)).resolves.toMatchObject({
        status: 401,
      });

      const verifier = "c".repeat(43);
      const pkce = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))).toString(
        "base64url",
      );
      const startConsent = async (clientId: string) => {
        const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: "code",
          state: "session-state",
          scope: clientMetadata.scope,
          code_challenge: pkce,
          code_challenge_method: "S256",
          resource: `${origin}/mcp`,
        });
        const response = await request(`${authorizePath}?${params}`, { headers: accessHeader });
        expect(response.status).toBe(200);
        const html = await response.text();
        expect(html).toContain("Test OAuth Client");
        expect(html).not.toContain("admin_token");
        const handle = html.match(/name="handle" value="([^"]+)"/)?.[1];
        const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
        if (!handle || !cookie) throw new Error("Missing browser consent transaction");
        return { handle, cookie };
      };

      const denied = await startConsent(registeredId);
      const decline = await form(
        authorizePath,
        { handle: denied.handle, decision: "deny" },
        { ...accessHeader, cookie: denied.cookie, origin },
      );
      expect(decline.status).toBe(302);
      expect(new URL(decline.headers.get("location") ?? "").searchParams.get("error")).toBe("access_denied");

      for (const clientId of [registeredId, clientDocument]) {
        const { handle, cookie } = await startConsent(clientId);
        const approve = { handle, decision: "approve" };
        await expect(
          form(authorizePath, approve, { ...accessHeader, cookie, origin: legacyOrigin }),
        ).resolves.toMatchObject({ status: 403 });
        await expect(form(authorizePath, approve, { ...accessHeader, origin })).resolves.toMatchObject({ status: 400 });
        const approval = await form(authorizePath, approve, { ...accessHeader, origin, cookie });
        expect(approval.status).toBe(302);
        expect((await kv.list({ prefix: "grant:access-user:" })).keys.length).toBeGreaterThan(0);
        const redirect = new URL(approval.headers.get("location") ?? "");
        expect(`${redirect.origin}${redirect.pathname}`).toBe(redirectUri);
        expect(redirect.searchParams.get("state")).toBe("session-state");
        const code = redirect.searchParams.get("code");
        if (!code) throw new Error("Missing OAuth authorization code");
        const exchange = {
          grant_type: "authorization_code",
          client_id: clientId,
          redirect_uri: redirectUri,
          code,
          code_verifier: verifier,
        };
        await expect(form(tokenPath, { ...exchange, code_verifier: "x".repeat(43) })).resolves.toMatchObject({
          status: 400,
        });
        const tokenResponse = await form(tokenPath, exchange);
        expect(tokenResponse.status).toBe(200);
        const { access_token: token, refresh_token: refresh } = await tokenResponse.json();
        expect(refresh).toEqual(expect.any(String));
        expect(token).not.toMatch(/^oct_/);
        await expect(rpc(token)).resolves.toMatchObject({ status: 200 });
        await expect(rpc(token, legacyOrigin)).resolves.toMatchObject({ status: 401 });
        await expect(request("/v1/health", { headers: { authorization: `Bearer ${token}` } })).resolves.toMatchObject({
          status: 401,
        });
        const tokens = new RuntimeTokenService(new D1RuntimeDatabase(db).runtimeTokenStore);
        const [backing] = await tokens.listTokens();
        if (!backing) throw new Error("Missing backing runtime credential");
        expect(backing.name).toContain("Test OAuth Client");
        await tokens.revokeToken(backing.id);
        await expect(rpc(token)).resolves.toMatchObject({ status: 401 });
        await expect(
          form(tokenPath, { grant_type: "refresh_token", client_id: clientId, refresh_token: refresh }),
        ).resolves.toMatchObject({ status: 400 });
      }
      expect(fetchNetwork.mock.calls.some(([url]) => String(url) === clientDocument)).toBe(true);
    } finally {
      db.close();
    }
  });

  it("deduplicates concurrent app creation and retries after a transient catalog failure", async () => {
    // The app and catalog caches live in module state, so this test needs an isolate of its own:
    // the shared `worker` above has already cached a healthy catalog. The reimported copy also
    // gets a fresh `guarded-fetch` module, which `vitest.setup.ts` no longer holds off real DNS —
    // keep this instance on local routes that perform no provider egress.
    vi.resetModules();
    const { default: isolatedWorker } = await import("./cloudflare.ts");
    const fallback = memoryAssets(chunkedCatalog());
    let indexAttempts = 0;
    const assets: AssetsBinding = {
      async fetch(request) {
        if (new URL(request.url).pathname === "/catalog/index.json" && ++indexAttempts === 1) {
          return new Response("upstream", { status: 500 });
        }
        return fallback.fetch(request);
      },
    };
    const env: CloudflareEnv = {
      DB: new EmptyMarketplaceD1Database(),
      TRANSIT_FILES: new UnusedR2Bucket(),
      ASSETS: assets,
    };
    const request = (): Request => new Request("https://catalog-retry.example.com/api/auth/session");
    const failures = await Promise.allSettled([
      isolatedWorker.fetch(request(), env, createExecutionContext()),
      isolatedWorker.fetch(request(), env, createExecutionContext()),
    ]);

    for (const failure of failures) {
      expect(failure).toMatchObject({
        status: "rejected",
        reason: {
          message: "Cloudflare asset catalog request failed: /catalog/index.json returned 500",
        },
      });
    }
    expect(indexAttempts).toBe(1);

    const response = await isolatedWorker.fetch(request(), env, createExecutionContext());
    expect(response.status).toBe(200);
    expect(indexAttempts).toBe(2);
  });

  it("rejects SaaS configuration when the origin comes only from the request URL", async () => {
    const env = { ...createEnv(), OOMOL_CONNECT_ENCRYPTION_KEY: "saas-origin-test" };
    const response = await worker.fetch(
      new Request("https://untrusted-request.example/api/oauth/managed-project", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseUrl: "https://saas.example", projectApiKey: "project-secret" }),
      }),
      env,
      createExecutionContext(),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "oauth_source_configuration_error" } });
  });

  it("writes connection logs to console", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await worker.fetch(
      new Request("https://connect.example.com/api/connections/example", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          authType: "no_auth",
          connectionName: "work",
          values: {
            apiKey: "unused-secret",
          },
        }),
      }),
      createEnv(),
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    expect(info).toHaveBeenCalledWith(
      "connection started",
      expect.objectContaining({
        service: "example",
        authType: "no_auth",
        connectionName: "work",
      }),
    );
    expect(info).toHaveBeenCalledWith(
      "connection completed",
      expect.objectContaining({
        service: "example",
        authType: "no_auth",
        connectionName: "work",
      }),
    );
    expect(JSON.stringify(info.mock.calls)).not.toContain("unused-secret");
  });

  it("leaves dashboard JSON uncompressed for edge compression", async () => {
    const response = await worker.fetch(
      new Request("https://compression.example.com/api/auth/session", {
        headers: { "accept-encoding": "gzip" },
      }),
      createEnv(),
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      adminAuthConfigured: false,
      authenticated: true,
    });
  });

  it("selects the KV backend and round-trips a file when TRANSIT_FILES_BACKEND is kv", async () => {
    const namespace = new MemoryKVNamespace();
    // A distinct host keeps this out of the R2 test's cached app instance.
    const origin = "https://kv.example.com";
    const env: CloudflareEnv = {
      DB: new EmptyMarketplaceD1Database(),
      TRANSIT_FILES: namespace,
      TRANSIT_FILES_BACKEND: "kv",
      ASSETS: memoryAssets(chunkedCatalog()),
    };

    const form = new FormData();
    form.set("file", new File(["kv-payload"], "note.txt", { type: "text/plain" }));
    const uploadResponse = await worker.fetch(
      new Request(`${origin}/api/files`, { method: "POST", body: form }),
      env,
      createExecutionContext(),
    );
    expect(uploadResponse.status).toBe(200);
    const upload = (await uploadResponse.json()) as { fileId: string };
    expect(upload.fileId).toMatch(/^[a-f0-9]{32}\.txt$/);

    // Only KVTransitFileService writes an expirationTtl; its presence proves the KV
    // backend (not R2) was selected end-to-end from the TRANSIT_FILES_BACKEND flag.
    expect(namespace.entry(`transit/${upload.fileId}`)?.expirationTtl).toBe(86_400);

    const getResponse = await worker.fetch(
      new Request(`${origin}/api/files/${upload.fileId}`),
      env,
      createExecutionContext(),
    );
    expect(getResponse.status).toBe(200);
    await expect(getResponse.text()).resolves.toBe("kv-payload");
  });

  it("defaults to the R2 backend when TRANSIT_FILES_BACKEND is unset and round-trips a file", async () => {
    const bucket = new MemoryR2Bucket();
    // A distinct host keeps this out of the other tests' cached app instances.
    const origin = "https://r2.example.com";
    const env: CloudflareEnv = {
      DB: new EmptyMarketplaceD1Database(),
      TRANSIT_FILES: bucket,
      // TRANSIT_FILES_BACKEND intentionally omitted -> must fall back to R2.
      ASSETS: memoryAssets(chunkedCatalog()),
    };

    const form = new FormData();
    form.set("file", new File(["r2-payload"], "note.txt", { type: "text/plain" }));
    const uploadResponse = await worker.fetch(
      new Request(`${origin}/api/files`, { method: "POST", body: form }),
      env,
      createExecutionContext(),
    );
    expect(uploadResponse.status).toBe(200);
    const upload = (await uploadResponse.json()) as { fileId: string };
    expect(upload.fileId).toMatch(/^[a-f0-9]{32}\.txt$/);

    // Only R2TransitFileService writes httpMetadata.contentType (KV never does); its
    // presence proves the R2 backend was selected by default from an absent flag.
    expect(bucket.stored(`transit/${upload.fileId}`)?.httpMetadata?.contentType).toBe("text/plain");

    const getResponse = await worker.fetch(
      new Request(`${origin}/api/files/${upload.fileId}`),
      env,
      createExecutionContext(),
    );
    expect(getResponse.status).toBe(200);
    await expect(getResponse.text()).resolves.toBe("r2-payload");
  });
});

function createEnv(): CloudflareEnv {
  return {
    DB: new EmptyMarketplaceD1Database(),
    TRANSIT_FILES: new UnusedR2Bucket(),
    ASSETS: memoryAssets(chunkedCatalog()),
  };
}

function createExecutionContext(): Parameters<typeof worker.fetch>[2] {
  return {
    waitUntil() {},
    passThroughOnException() {},
  };
}

/** The asset layout `scripts/copy-catalog-assets.ts` emits, so the worker tests boot the shipped path. */
function chunkedCatalog(): Record<string, unknown> {
  return {
    "/catalog/index.json": { version: 1, providerCount: 1, chunks: ["apps-0000.json"] },
    "/catalog/apps-0000.json": [provider],
  };
}

function memoryAssets(files: Record<string, unknown>): AssetsBinding {
  return {
    async fetch(request) {
      const pathname = new URL(request.url).pathname;
      if (!(pathname in files)) {
        return new Response("not found", { status: 404 });
      }

      return Response.json(files[pathname]);
    },
  };
}

class EmptyMarketplaceD1Database implements D1DatabaseBinding {
  async batch(): Promise<{ results: Record<string, unknown>[] }[]> {
    throw new Error("Unexpected D1 batch");
  }
  prepare(query: string): D1PreparedStatementBinding {
    if (query === "select value from marketplace_config where id = 1") {
      return new EmptyMarketplaceConfigStatement();
    }
    throw new Error(`Unexpected D1 query: ${query}`);
  }
}

class EmptyMarketplaceConfigStatement implements D1PreparedStatementBinding {
  bind(): D1PreparedStatementBinding {
    throw new Error("Unexpected D1 bind");
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    throw new Error("Unexpected D1 all");
  }

  async run(): Promise<{ success: boolean; meta: { changes?: number } }> {
    throw new Error("Unexpected D1 run");
  }
}

class UnusedR2Bucket implements R2BucketBinding {
  async put(): Promise<unknown> {
    throw new Error("Unexpected R2 put");
  }

  async get(): Promise<R2ObjectBinding | null> {
    throw new Error("Unexpected R2 get");
  }

  async delete(): Promise<void> {
    throw new Error("Unexpected R2 delete");
  }
}

class MemoryKVNamespace implements KVNamespaceBinding {
  private readonly store = new Map<string, { bytes: ArrayBuffer; expirationTtl?: number }>();

  async put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
    options?: { expirationTtl?: number; expiration?: number },
  ): Promise<void> {
    this.store.set(key, { bytes: await toArrayBuffer(value), expirationTtl: options?.expirationTtl });
  }

  get(key: string, type: "text"): Promise<string | null>;
  get(key: string, type: "arrayBuffer"): Promise<ArrayBuffer | null>;
  async get(key: string, type: "text" | "arrayBuffer" | { type: "json" } = "text"): Promise<unknown> {
    const stored = this.store.get(key);
    if (!stored) {
      return null;
    }
    if (type === "arrayBuffer") return stored.bytes.slice(0);
    const value = new TextDecoder().decode(stored.bytes);
    return type === "text" ? value : JSON.parse(value);
  }

  async list({ prefix = "" }: { prefix?: string } = {}) {
    return {
      keys: [...this.store.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })),
      list_complete: true,
    };
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  entry(key: string): { bytes: ArrayBuffer; expirationTtl?: number } | undefined {
    return this.store.get(key);
  }
}

class MemoryR2Bucket implements R2BucketBinding {
  private readonly objects = new Map<string, MemoryR2Object>();

  async put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown> {
    this.objects.set(key, new MemoryR2Object(await toArrayBuffer(value), options?.httpMetadata));
    return {};
  }

  async get(key: string): Promise<R2ObjectBinding | null> {
    return this.objects.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  stored(key: string): MemoryR2Object | undefined {
    return this.objects.get(key);
  }
}

class MemoryR2Object implements R2ObjectBinding {
  readonly body: ReadableStream;
  readonly httpMetadata?: { contentType?: string };

  private readonly bytes: ArrayBuffer;

  constructor(bytes: ArrayBuffer, httpMetadata?: { contentType?: string }) {
    this.bytes = bytes;
    this.body = new Blob([bytes]).stream();
    this.httpMetadata = httpMetadata;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.bytes.slice(0);
  }
}

async function toArrayBuffer(
  value: string | ArrayBuffer | ArrayBufferView | ReadableStream | Blob,
): Promise<ArrayBuffer> {
  if (typeof value === "string") {
    return new TextEncoder().encode(value).buffer;
  }
  if (value instanceof Blob) {
    return await value.arrayBuffer();
  }
  if (value instanceof ArrayBuffer) {
    return value.slice(0);
  }
  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return new Uint8Array(bytes).buffer;
  }

  return await new Response(value).arrayBuffer();
}

it("processes scheduled cleanup without an HTTP request, public origin or asset bindings", async () => {
  const binding = new SqliteD1Database();
  const secretCodec = await createWorkerSecretCodec("scheduled-key");
  const database = new D1RuntimeDatabase(binding, { secretCodec });
  const project = { id: "managed", projectId: "project", baseUrl: "https://saas.example", apiKey: "project-key" };
  await database.saasProjectStore.saveProject(project);
  const now = new Date().toISOString();
  const lease = await database.connectionRequestStore.createSaas({
    connectionRequestId: crypto.randomUUID(),
    connectionId: crypto.randomUUID(),
    connectionName: "scheduled",
    owner: "admin",
    service: "example",
    managedProjectId: "managed",
    providerConfigId: "config",
    externalUserId: "user",
    createdAt: now,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  });
  await database.connectionRequestStore.saveSaasRequest(lease, "remote");
  await database.connectionRequestStore.saveSaasCandidate(lease, {
    connectedAccountId: "account",
    status: "active",
    comment: null,
    profile: { accountId: "user", displayName: "User", grantedScopes: [] },
  });
  await database.connectionRequestStore.cancelSaas(lease.pending.connectionRequestId, "admin");
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({ success: true, data: { connectedAccountId: "account", deleted: true } }),
  );
  vi.stubGlobal("fetch", fetcher);
  const pending: Promise<unknown>[] = [];
  try {
    await worker.scheduled(
      {},
      { DB: binding, TRANSIT_FILES: new UnusedR2Bucket(), OOMOL_CONNECT_ENCRYPTION_KEY: "scheduled-key" },
      {
        waitUntil(promise) {
          pending.push(promise);
        },
        passThroughOnException() {},
      },
    );
    expect(pending).toHaveLength(1);
    await Promise.all(pending);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1]?.method).toBe("DELETE");
    expect(await database.saasProjectStore.getCleanupStats()).toMatchObject({ pending: 0, manual: 0 });
  } finally {
    binding.close();
    vi.unstubAllGlobals();
  }
});

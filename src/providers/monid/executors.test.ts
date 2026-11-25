import type { ExecutionContext, ResolvedCredential } from "../../core/types.ts";

import { afterEach, assert, describe, expect, test, vi } from "vitest";
import { provider } from "./definition.ts";
import { credentialValidators, executors, proxy } from "./executors.ts";

const getApiKeyValidator = (): NonNullable<typeof credentialValidators.apiKey> => {
  const { apiKey } = credentialValidators;
  assert(apiKey, "The API-key validator must be registered");
  return apiKey;
};

const credential = (apiKey = "monid_saved_key"): Extract<ResolvedCredential, { authType: "api_key" }> => ({
  apiKey,
  authType: "api_key",
  metadata: {},
  profile: { accountId: "workspace-1", displayName: "Monid workspace", grantedScopes: [] },
  values: { apiKey },
});

const executionContext = (hasSavedCredential = true): ExecutionContext => ({
  getCredential: vi
    .fn<ExecutionContext["getCredential"]>()
    .mockResolvedValue(hasSavedCredential ? credential() : undefined),
});

const apiKeyValidationInput = (apiKey: string): { apiKey: string; values: Record<string, string> } => ({
  apiKey,
  values: { apiKey },
});

const parseForwardedBody = (body: RequestInit["body"]): unknown => {
  assert(typeof body === "string", "Expected a forwarded JSON string"); // oxlint-disable-line rules/force-predicate -- Narrow the native fetch body without adding a dependency.
  return JSON.parse(body) as unknown;
};

const fetchStub = (response: Response): ReturnType<typeof vi.fn<typeof fetch>> => {
  const replay = Promise.resolve(response);
  const fetcher = vi.fn<typeof fetch>(async () => {
    const original = await replay;
    return original.clone();
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
};

const requestUrl = ([input]: Parameters<typeof fetch>): RequestInfo => (input instanceof URL ? input.href : input);

describe("monid provider definition", () => {
  test("advertises only API-key proxy access and no actions or extra credential fields", () => {
    expect(provider.authTypes).toStrictEqual(["api_key"]);
    expect(provider.auth[0]).toMatchObject({ type: "api_key" });
    expect(provider.auth[0]).not.toHaveProperty("extraFields");
    expect(provider.actions).toStrictEqual([]);
    expect(executors).toStrictEqual({});
  });
});

// oxlint-disable-next-line eslint/max-lines-per-function -- Keep the existing suite title and register its proxy cases together.
describe("monid provider proxy", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("forwards documented discovery, inspection, and synchronous run JSON requests", async () => {
    expect.assertions(12);
    const fetcher = fetchStub(Response.json({ result: "complete" }, { headers: { "x-request-id": "req-1" } }));

    const requestsToForward: { endpoint: string; body: Record<string, unknown> }[] = [
      { body: { limit: 5, query: "twitter posts" }, endpoint: "/v1/discover" },
      { body: { endpoint: "/apidojo/tweet-scraper", provider: "apify" }, endpoint: "/v1/inspect" },
      {
        body: { endpoint: "/apidojo/tweet-scraper", input: { maxItems: 10, searchTerms: ["AI"] }, provider: "apify" },
        endpoint: "/v1/run",
      },
    ];
    // Array.fromAsync waits for each dispatch before advancing to the next request.
    await Array.fromAsync(requestsToForward, async ({ endpoint, body }) => {
      await expect(proxy({ body, endpoint, method: "POST" }, executionContext())).resolves.toMatchObject({
        ok: true,
        response: { data: { result: "complete" }, headers: { "x-request-id": "req-1" }, status: 200 },
      });
    });

    expect(fetcher.mock.calls.map(requestUrl)).toStrictEqual([
      "https://api.monid.ai/v1/discover",
      "https://api.monid.ai/v1/inspect",
      "https://api.monid.ai/v1/run",
    ]);
    expect(fetcher.mock.calls.map(([, init]) => parseForwardedBody(init?.body))).toStrictEqual([
      { limit: 5, query: "twitter posts" },
      { endpoint: "/apidojo/tweet-scraper", provider: "apify" },
      { endpoint: "/apidojo/tweet-scraper", input: { maxItems: 10, searchTerms: ["AI"] }, provider: "apify" },
    ]);
    fetcher.mock.calls.forEach(([, init]) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer monid_saved_key");
      expect(headers.get("content-type")).toBe("application/json");
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  test("preserves accepted asynchronous run output status and headers", async () => {
    const fetcher = fetchStub(
      Response.json(
        { endpoint: "/apidojo/tweet-scraper", provider: "apify", runId: "run-123", status: "READY" },
        { headers: { "x-request-id": "req-async" }, status: 202 },
      ),
    );

    const expectedHeaders: unknown = expect.objectContaining({ "x-request-id": "req-async" });
    await expect(
      proxy(
        { body: { endpoint: "/apidojo/tweet-scraper", provider: "apify" }, endpoint: "/v1/run", method: "POST" },
        executionContext(),
      ),
    ).resolves.toStrictEqual({
      ok: true,
      response: {
        data: { endpoint: "/apidojo/tweet-scraper", provider: "apify", runId: "run-123", status: "READY" },
        headers: expectedHeaders,
        status: 202,
      },
    });
    expect(parseForwardedBody(fetcher.mock.calls[0]?.[1]?.body)).toStrictEqual({
      endpoint: "/apidojo/tweet-scraper",
      provider: "apify",
    });
  });

  test("forwards documented non-run POST and GET paths with their methods", async () => {
    const fetcher = fetchStub(Response.json({ ok: true }));

    const requestsToForward = [
      { endpoint: "/v1/auth/whoami", method: "GET" },
      { endpoint: "/v1/auth/workspaces", method: "GET" },
      { endpoint: "/v1/runs", method: "GET" },
      { endpoint: "/v1/runs/run-123", method: "GET" },
      { endpoint: "/v1/runs/run-123/stop", method: "POST" },
      { endpoint: "/v1/wallet/balance", method: "GET" },
      { endpoint: "/v1/wallet/activities", method: "GET", query: { cursor: "a/b", limit: "10" } },
    ];
    await Array.fromAsync(requestsToForward, async (request) => {
      await proxy(request, executionContext());
    });

    expect(fetcher.mock.calls.map(requestUrl)).toStrictEqual([
      "https://api.monid.ai/v1/auth/whoami",
      "https://api.monid.ai/v1/auth/workspaces",
      "https://api.monid.ai/v1/runs",
      "https://api.monid.ai/v1/runs/run-123",
      "https://api.monid.ai/v1/runs/run-123/stop",
      "https://api.monid.ai/v1/wallet/balance",
      "https://api.monid.ai/v1/wallet/activities?cursor=a%2Fb&limit=10",
    ]);
    expect(fetcher.mock.calls.map(([, init]) => init?.method)).toStrictEqual([
      "GET",
      "GET",
      "GET",
      "GET",
      "POST",
      "GET",
      "GET",
    ]);
  });

  test("overwrites caller-supplied authorization with the saved API key", async () => {
    const fetcher = fetchStub(Response.json({ ok: true }));

    await proxy(
      {
        endpoint: "/v1/wallet/balance",
        headers: { authorization: "Bearer attacker_key", "x-client": "test" },
        method: "GET",
      },
      executionContext(),
    );

    const headers = new Headers(fetcher.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer monid_saved_key");
    expect(headers.get("x-client")).toBe("test");
  });

  test("rejects unsupported origins and paths outside the v1 API before egress", async () => {
    const fetcher = fetchStub(Response.json({ ok: true }));

    await expect(
      proxy({ endpoint: "https://example.com/v1/wallet/balance", method: "GET" }, executionContext()),
    ).resolves.toMatchObject({
      error: { code: "invalid_input" },
      ok: false,
    });
    await expect(proxy({ endpoint: "/v2/wallet/balance", method: "GET" }, executionContext())).resolves.toMatchObject({
      error: { code: "invalid_input", message: "endpoint is not supported for this provider" },
      ok: false,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("requires a saved API-key credential", async () => {
    const fetcher = fetchStub(Response.json({ ok: true }));

    await expect(
      proxy({ endpoint: "/v1/wallet/balance", method: "GET" }, executionContext(false)),
    ).resolves.toMatchObject({
      error: { code: "authorization_failed", message: "Configure monid API key credentials first." },
      ok: false,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("normalizes a Monid non-success response into a proxy failure result", async () => {
    fetchStub(
      new Response("Monid operation cannot be stopped", { headers: { "x-request-id": "req-failed" }, status: 409 }),
    );

    await expect(
      proxy({ endpoint: "/v1/runs/run-123/stop", method: "POST" }, executionContext()),
    ).resolves.toMatchObject({
      error: { code: "invalid_input", message: "Monid operation cannot be stopped" },
      ok: false,
    });
  });
});

// oxlint-disable-next-line eslint/max-lines-per-function -- Keep the existing suite title and register its credential cases together.
describe("monid credential validation", () => {
  test("uses the injected fetcher and returns a safe workspace profile", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        user: { userId: "user-1", username: "alice" },
        workspace: { name: "Production workspace", workspaceId: "workspace-1" },
      }),
    );

    await expect(
      getApiKeyValidator()(apiKeyValidationInput("monid_validation_key"), { fetcher }),
    ).resolves.toStrictEqual({
      profile: { accountId: "workspace-1", displayName: "Production workspace" },
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.monid.ai/v1/auth/whoami",
      expect.objectContaining({ headers: { authorization: "Bearer monid_validation_key" } }),
    );
  });

  test("falls back to the stable user ID when username is empty", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ user: { userId: "user-1", username: "" }, workspace: {} }));

    await expect(getApiKeyValidator()(apiKeyValidationInput("key"), { fetcher })).resolves.toStrictEqual({
      profile: { accountId: "user-1", displayName: "user-1" },
    });
  });

  test("does not expose API keys or provider error payloads on credential failure", async () => {
    const apiKey = "monid_secret_should_not_leak";
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(`invalid key ${apiKey}`, { status: 401 }));

    await expect(getApiKeyValidator()(apiKeyValidationInput(apiKey), { fetcher })).rejects.toMatchObject({
      message: "Monid credential validation failed",
      status: 401,
    });
  });

  test("rejects malformed or identity-less successful responses", async () => {
    const malformedFetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("not json", { status: 200 }));
    const identityLessFetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ user: { username: "alice" } }));

    await expect(getApiKeyValidator()(apiKeyValidationInput("key"), { fetcher: malformedFetcher })).rejects.toThrow(
      "Monid credential validation returned an invalid response",
    );
    await expect(getApiKeyValidator()(apiKeyValidationInput("key"), { fetcher: identityLessFetcher })).rejects.toThrow(
      "Monid credential validation returned an invalid user identity",
    );
  });

  test("rejects a whoami response over the one MiB credential-validation limit", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("x".repeat(1024 * 1024 + 1)));

    await expect(getApiKeyValidator()(apiKeyValidationInput("key"), { fetcher })).rejects.toThrow(
      "Monid credential validation response exceeds 1048576 bytes",
    );
  });

  test("forwards an aborted caller signal to whoami validation", async () => {
    const response = Promise.resolve(Response.json({ user: { userId: "user-1" } }));
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      init?.signal?.throwIfAborted();
      return response;
    });

    await expect(
      getApiKeyValidator()(apiKeyValidationInput("key"), { fetcher, signal: AbortSignal.abort() }),
    ).rejects.toThrow("Monid credential validation request timed out");
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
});

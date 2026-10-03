import type { ExecutionContext, ResolvedCredential } from "../../core/types.ts";

import { afterEach, describe, expect, it, vi } from "vitest";
import { provider } from "./definition.ts";
import { credentialValidators, executors, proxy } from "./executors.ts";

interface CapturedRequest {
  url: string;
  init: RequestInit | undefined;
}

function credential(apiKey = "monid_saved_key"): Extract<ResolvedCredential, { authType: "api_key" }> {
  return {
    authType: "api_key",
    apiKey,
    values: { apiKey },
    profile: { accountId: "workspace-1", displayName: "Monid workspace", grantedScopes: [] },
    metadata: {},
  };
}

function executionContext(savedCredential: ResolvedCredential | undefined = credential()): ExecutionContext {
  return { getCredential: async () => savedCredential };
}

function noCredentialExecutionContext(): ExecutionContext {
  return { getCredential: async () => undefined };
}

function apiKeyValidationInput(apiKey: string): { apiKey: string; values: Record<string, string> } {
  return { apiKey, values: { apiKey } };
}

function fetchStub(response: Response): { fetcher: ReturnType<typeof vi.fn>; requests: CapturedRequest[] } {
  const requests: CapturedRequest[] = [];
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    return response.clone();
  });
  vi.stubGlobal("fetch", fetcher);
  return { fetcher, requests };
}

afterEach(() => vi.unstubAllGlobals());

describe("Monid provider definition", () => {
  it("advertises only API-key proxy access and no actions or extra credential fields", () => {
    expect(provider.authTypes).toEqual(["api_key"]);
    expect(provider.auth[0]).toMatchObject({ type: "api_key" });
    expect(provider.auth[0]).not.toHaveProperty("extraFields");
    expect(provider.actions).toEqual([]);
    expect(executors).toEqual({});
  });
});

describe("Monid provider proxy", () => {
  it("forwards documented discovery, inspection, and synchronous run JSON requests", async () => {
    const { fetcher, requests } = fetchStub(
      Response.json({ result: "complete" }, { headers: { "x-request-id": "req-1" } }),
    );

    const requestsToForward: Array<{ endpoint: string; body: Record<string, unknown> }> = [
      { endpoint: "/v1/discover", body: { query: "twitter posts", limit: 5 } },
      { endpoint: "/v1/inspect", body: { provider: "apify", endpoint: "/apidojo/tweet-scraper" } },
      {
        endpoint: "/v1/run",
        body: { provider: "apify", endpoint: "/apidojo/tweet-scraper", input: { searchTerms: ["AI"], maxItems: 10 } },
      },
    ];
    for (const { endpoint, body } of requestsToForward) {
      await expect(proxy({ method: "POST", endpoint, body }, executionContext())).resolves.toMatchObject({
        ok: true,
        response: { status: 200, data: { result: "complete" }, headers: { "x-request-id": "req-1" } },
      });
    }

    expect(requests.map((request) => request.url)).toEqual([
      "https://api.monid.ai/v1/discover",
      "https://api.monid.ai/v1/inspect",
      "https://api.monid.ai/v1/run",
    ]);
    expect(requests.map((request) => JSON.parse(String(request.init?.body)))).toEqual([
      { query: "twitter posts", limit: 5 },
      { provider: "apify", endpoint: "/apidojo/tweet-scraper" },
      { provider: "apify", endpoint: "/apidojo/tweet-scraper", input: { searchTerms: ["AI"], maxItems: 10 } },
    ]);
    for (const request of requests) {
      const headers = new Headers(request.init?.headers);
      expect(headers.get("authorization")).toBe("Bearer monid_saved_key");
      expect(headers.get("content-type")).toBe("application/json");
    }
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("preserves accepted asynchronous run output status and headers", async () => {
    const { requests } = fetchStub(
      Response.json(
        { runId: "run-123", status: "READY", provider: "apify", endpoint: "/apidojo/tweet-scraper" },
        { status: 202, headers: { "x-request-id": "req-async" } },
      ),
    );

    await expect(
      proxy(
        { method: "POST", endpoint: "/v1/run", body: { provider: "apify", endpoint: "/apidojo/tweet-scraper" } },
        executionContext(),
      ),
    ).resolves.toEqual({
      ok: true,
      response: {
        status: 202,
        headers: expect.objectContaining({ "x-request-id": "req-async" }),
        data: { runId: "run-123", status: "READY", provider: "apify", endpoint: "/apidojo/tweet-scraper" },
      },
    });
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      provider: "apify",
      endpoint: "/apidojo/tweet-scraper",
    });
  });

  it("forwards documented non-run POST and GET paths with their methods", async () => {
    const { requests } = fetchStub(Response.json({ ok: true }));

    const requestsToForward = [
      { method: "GET", endpoint: "/v1/auth/whoami" },
      { method: "GET", endpoint: "/v1/auth/workspaces" },
      { method: "GET", endpoint: "/v1/runs" },
      { method: "GET", endpoint: "/v1/runs/run-123" },
      { method: "POST", endpoint: "/v1/runs/run-123/stop" },
      { method: "GET", endpoint: "/v1/wallet/balance" },
      { method: "GET", endpoint: "/v1/wallet/activities", query: { cursor: "a/b", limit: "10" } },
    ];
    for (const request of requestsToForward) {
      await proxy(request, executionContext());
    }

    expect(requests.map((request) => request.url)).toEqual([
      "https://api.monid.ai/v1/auth/whoami",
      "https://api.monid.ai/v1/auth/workspaces",
      "https://api.monid.ai/v1/runs",
      "https://api.monid.ai/v1/runs/run-123",
      "https://api.monid.ai/v1/runs/run-123/stop",
      "https://api.monid.ai/v1/wallet/balance",
      "https://api.monid.ai/v1/wallet/activities?cursor=a%2Fb&limit=10",
    ]);
    expect(requests.map((request) => request.init?.method)).toEqual(["GET", "GET", "GET", "GET", "POST", "GET", "GET"]);
  });

  it("overwrites caller-supplied authorization with the saved API key", async () => {
    const { requests } = fetchStub(Response.json({ ok: true }));

    await proxy(
      {
        method: "GET",
        endpoint: "/v1/wallet/balance",
        headers: { authorization: "Bearer attacker_key", "x-client": "test" },
      },
      executionContext(),
    );

    const headers = new Headers(requests[0]?.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer monid_saved_key");
    expect(headers.get("x-client")).toBe("test");
  });

  it("rejects unsupported origins and paths outside the v1 API before egress", async () => {
    const { fetcher } = fetchStub(Response.json({ ok: true }));

    await expect(
      proxy({ method: "GET", endpoint: "https://example.com/v1/wallet/balance" }, executionContext()),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
    await expect(proxy({ method: "GET", endpoint: "/v2/wallet/balance" }, executionContext())).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_input", message: "endpoint is not supported for this provider" },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("requires a saved API-key credential", async () => {
    const { fetcher } = fetchStub(Response.json({ ok: true }));

    await expect(
      proxy({ method: "GET", endpoint: "/v1/wallet/balance" }, noCredentialExecutionContext()),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "authorization_failed", message: "Configure monid API key credentials first." },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("normalizes a Monid non-success response into a proxy failure result", async () => {
    fetchStub(
      new Response("Monid operation cannot be stopped", { status: 409, headers: { "x-request-id": "req-failed" } }),
    );

    await expect(
      proxy({ method: "POST", endpoint: "/v1/runs/run-123/stop" }, executionContext()),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_input", message: "Monid operation cannot be stopped" },
    });
  });
});

describe("Monid credential validation", () => {
  it("uses the injected fetcher and returns a safe workspace profile", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        user: { userId: "user-1", username: "alice" },
        workspace: { workspaceId: "workspace-1", name: "Production workspace" },
      }),
    );

    await expect(
      credentialValidators.apiKey!(apiKeyValidationInput("monid_validation_key"), { fetcher }),
    ).resolves.toEqual({
      profile: { accountId: "workspace-1", displayName: "Production workspace" },
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.monid.ai/v1/auth/whoami",
      expect.objectContaining({ headers: { authorization: "Bearer monid_validation_key" } }),
    );
  });

  it("falls back to the stable user ID when username is empty", async () => {
    const fetcher = vi.fn(async () => Response.json({ user: { userId: "user-1", username: "" }, workspace: {} }));

    await expect(credentialValidators.apiKey!(apiKeyValidationInput("key"), { fetcher })).resolves.toEqual({
      profile: { accountId: "user-1", displayName: "user-1" },
    });
  });

  it("does not expose API keys or provider error payloads on credential failure", async () => {
    const apiKey = "monid_secret_should_not_leak";
    const fetcher = vi.fn(async () => new Response(`invalid key ${apiKey}`, { status: 401 }));

    await expect(credentialValidators.apiKey!(apiKeyValidationInput(apiKey), { fetcher })).rejects.toMatchObject({
      status: 401,
      message: "Monid credential validation failed",
    });
  });

  it("rejects malformed or identity-less successful responses", async () => {
    const malformedFetcher = vi.fn(async () => new Response("not json", { status: 200 }));
    const identityLessFetcher = vi.fn(async () => Response.json({ user: { username: "alice" } }));

    await expect(
      credentialValidators.apiKey!(apiKeyValidationInput("key"), { fetcher: malformedFetcher }),
    ).rejects.toThrow("Monid credential validation returned an invalid response");
    await expect(
      credentialValidators.apiKey!(apiKeyValidationInput("key"), { fetcher: identityLessFetcher }),
    ).rejects.toThrow("Monid credential validation returned an invalid user identity");
  });

  it("rejects a whoami response over the one MiB credential-validation limit", async () => {
    const fetcher = vi.fn(async () => new Response("x".repeat(1024 * 1024 + 1)));

    await expect(credentialValidators.apiKey!(apiKeyValidationInput("key"), { fetcher })).rejects.toThrow(
      "Monid credential validation response exceeds 1048576 bytes",
    );
  });

  it("forwards an aborted caller signal to whoami validation", async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      init?.signal?.throwIfAborted();
      return Response.json({ user: { userId: "user-1" } });
    });

    await expect(
      credentialValidators.apiKey!(apiKeyValidationInput("key"), { fetcher, signal: AbortSignal.abort() }),
    ).rejects.toThrow("Monid credential validation request timed out");
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
});

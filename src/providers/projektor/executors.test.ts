import type { ExecutionContext, ResolvedCredential } from "../../core/types.ts";

import { afterEach, describe, expect, it, vi } from "vitest";
import { setPrivateNetworkAccessAllowed } from "../../core/request.ts";
import { provider } from "./definition.ts";
import { credentialValidators, executors, proxy } from "./executors.ts";

const backend = "https://projektor.example.com";

function context(baseUrl = backend, metadata: Record<string, unknown> = {}): ExecutionContext {
  const credential: ResolvedCredential = {
    authType: "api_key",
    apiKey: "saved-token",
    values: { apiKey: "saved-token", baseUrl },
    profile: { accountId: "user-1", displayName: "Alice", grantedScopes: [] },
    metadata,
  };
  return { getCredential: async () => credential };
}

afterEach(() => {
  vi.unstubAllGlobals();
  setPrivateNetworkAccessAllowed(false);
});

describe("Projektor provider", () => {
  it("requires a backend URL and token and advertises proxy-only access", () => {
    expect(provider.authTypes).toEqual(["api_key"]);
    expect(provider.auth[0]).toMatchObject({
      type: "api_key",
      label: "API Token",
      extraFields: [{ key: "baseUrl", required: true, secret: false }],
    });
    expect(provider.actions).toEqual([]);
    expect(executors).toEqual({});
  });

  it.each([backend, `${backend}/`, `${backend}/api`, `${backend}/api/`])(
    "validates %s through the backend identity endpoint",
    async (baseUrl) => {
      const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ user: { id: "user-1", name: "Alice", email: "private@example.com" } }),
      );
      await expect(
        credentialValidators.apiKey!({ apiKey: "saved-token", values: { baseUrl } }, { fetcher }),
      ).resolves.toEqual({
        profile: { accountId: `${backend}:user-1`, displayName: "Alice" },
        metadata: { apiBaseUrl: backend },
      });
      expect(String(fetcher.mock.calls[0]?.[0])).toBe(`${backend}/auth/me`);
      expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer saved-token");
      expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe("manual");
    },
  );

  it("forwards API methods, bodies, query parameters, and workspace selection with stored authentication", async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({ id: "issue-1" }));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      proxy(
        {
          endpoint: "/api/issues/issue-1",
          method: "PATCH",
          query: { expand: "comments" },
          headers: { authorization: "Bearer attacker", "x-workspace-slug": "workspace-a" },
          body: { title: "Updated issue" },
        },
        context(`${backend}/api/`),
      ),
    ).resolves.toMatchObject({ ok: true, response: { status: 200, data: { id: "issue-1" } } });
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(`${backend}/api/issues/issue-1?expand=comments`);
    const init = fetcher.mock.calls[0]?.[1];
    expect(init).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ title: "Updated issue" }),
      redirect: "manual",
    });
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer saved-token");
    expect(new Headers(init?.headers).get("x-workspace-slug")).toBe("workspace-a");
  });

  it("uses validated connection metadata and preserves a backend mount path", async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ user: { id: "user-1" } }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      proxy(
        { endpoint: "/auth/me", method: "GET" },
        context("https://unused.example.com", {
          apiBaseUrl: `${backend}/backend`,
        }),
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(`${backend}/backend/auth/me`);
  });

  it.each([
    "/oauth/token",
    "/auth/tokens",
    "/api-other",
    "/api/../auth/tokens",
    "https://attacker.example.com/api/issues",
    "//attacker.example.com/api/issues",
  ])("rejects unsupported endpoint %s before egress", async (endpoint) => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(proxy({ endpoint, method: "GET" }, context())).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    "",
    "file:///etc/passwd",
    "http://127.0.0.1",
    "http://169.254.169.254",
    "https://user:password@projektor.example.com",
    `${backend}?token=secret`,
    `${backend}#fragment`,
  ])("rejects unsafe backend URL %s before credential validation", async (baseUrl) => {
    const fetcher = vi.fn();
    await expect(
      credentialValidators.apiKey!({ apiKey: "saved-token", values: { baseUrl } }, { fetcher }),
    ).rejects.toMatchObject({ status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("allows private backends only with the deployment opt-in", async () => {
    const fetcher = vi.fn(async () => Response.json({ user: { id: "user-1" } }));
    const input = { apiKey: "saved-token", values: { baseUrl: "http://10.0.0.5" } };
    setPrivateNetworkAccessAllowed(false);
    await expect(credentialValidators.apiKey!(input, { fetcher })).rejects.toMatchObject({ status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
    setPrivateNetworkAccessAllowed(true);
    await expect(credentialValidators.apiKey!(input, { fetcher })).resolves.toMatchObject({
      metadata: { apiBaseUrl: "http://10.0.0.5" },
    });
  });

  it.each([401, 403, 302, 500])(
    "rejects credential HTTP %s without exposing token-bearing error bodies",
    async (status) => {
      const fetcher = vi.fn(
        async () => new Response("invalid saved-token", { status, headers: { location: "https://login.example.com" } }),
      );
      await expect(
        credentialValidators.apiKey!({ apiKey: "saved-token", values: { baseUrl: backend } }, { fetcher }),
      ).rejects.toMatchObject({
        status,
        message: "Projektor credential validation failed",
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    Response.json({ user: { name: "Alice" } }),
    Response.json(null),
    new Response("<html>Login</html>"),
    new Response("x".repeat(1024 * 1024 + 1)),
  ])("rejects malformed, identity-less, or oversized validation responses", async (response) => {
    const fetcher = vi.fn(async () => response.clone());
    await expect(
      credentialValidators.apiKey!({ apiKey: "saved-token", values: { baseUrl: backend } }, { fetcher }),
    ).rejects.toBeInstanceOf(Error);
  });

  it("requires a configured credential before proxy egress", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(
      proxy({ endpoint: "/api/workspaces", method: "GET" }, { getCredential: async () => undefined }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "authorization_failed" },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

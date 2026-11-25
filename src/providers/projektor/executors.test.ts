import type { ExecutionContext, ResolvedCredential } from "../../core/types.ts";

import { afterEach, assert, describe, expect, test, vi } from "vitest";
import { setPrivateNetworkAccessAllowed } from "../../core/request.ts";
import { provider } from "./definition.ts";
import { credentialValidators, executors, proxy } from "./executors.ts";

const getApiKeyValidator = (): NonNullable<typeof credentialValidators.apiKey> => {
  const { apiKey } = credentialValidators;
  assert(apiKey, "The API-key validator must be registered");
  return apiKey;
};

const backend = "https://projektor.example.com";

const context = (baseUrl = backend, metadata: Record<string, unknown> = {}): ExecutionContext => {
  const credential: ResolvedCredential = {
    apiKey: "saved-token",
    authType: "api_key",
    metadata,
    profile: { accountId: "user-1", displayName: "Alice", grantedScopes: [] },
    values: { apiKey: "saved-token", baseUrl },
  };
  return { getCredential: vi.fn<ExecutionContext["getCredential"]>().mockResolvedValue(credential) };
};

const requestUrl = (input: RequestInfo | URL | undefined): RequestInfo | undefined =>
  input instanceof URL ? input.href : input;

// oxlint-disable-next-line eslint/max-lines-per-function -- Keep the existing suite title and register its provider cases together.
describe("projektor provider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setPrivateNetworkAccessAllowed(false);
  });

  test("requires a backend URL and token and advertises proxy-only access", () => {
    expect(provider.authTypes).toStrictEqual(["api_key"]);
    expect(provider.auth[0]).toMatchObject({
      extraFields: [{ key: "baseUrl", required: true, secret: false }],
      label: "API Token",
      type: "api_key",
    });
    expect(provider.actions).toStrictEqual([]);
    expect(executors).toStrictEqual({});
  });

  test.each([backend, `${backend}/`, `${backend}/api`, `${backend}/api/`])(
    "validates %s through the backend identity endpoint",
    async (baseUrl) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ user: { email: "private@example.com", id: "user-1", name: "Alice" } }));
      await expect(
        getApiKeyValidator()({ apiKey: "saved-token", values: { baseUrl } }, { fetcher }),
      ).resolves.toStrictEqual({
        metadata: { apiBaseUrl: backend },
        profile: { accountId: `${backend}:user-1`, displayName: "Alice" },
      });
      expect(requestUrl(fetcher.mock.calls[0]?.[0])).toBe(`${backend}/auth/me`);
      expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer saved-token");
      expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe("manual");
    },
  );

  test("forwards API methods, bodies, query parameters, and workspace selection with stored authentication", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: "issue-1" }));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      proxy(
        {
          body: { title: "Updated issue" },
          endpoint: "/api/issues/issue-1",
          headers: { authorization: "Bearer attacker", "x-workspace-slug": "workspace-a" },
          method: "PATCH",
          query: { expand: "comments" },
        },
        context(`${backend}/api/`),
      ),
    ).resolves.toMatchObject({ ok: true, response: { data: { id: "issue-1" }, status: 200 } });
    expect(requestUrl(fetcher.mock.calls[0]?.[0])).toBe(`${backend}/api/issues/issue-1?expand=comments`);
    const init = fetcher.mock.calls[0]?.[1];
    expect(init).toMatchObject({
      body: JSON.stringify({ title: "Updated issue" }),
      method: "PATCH",
      redirect: "manual",
    });
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer saved-token");
    expect(new Headers(init?.headers).get("x-workspace-slug")).toBe("workspace-a");
  });

  test("uses validated connection metadata and preserves a backend mount path", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ user: { id: "user-1" } }));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      proxy(
        { endpoint: "/auth/me", method: "GET" },
        context("https://unused.example.com", {
          apiBaseUrl: `${backend}/backend`,
        }),
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(requestUrl(fetcher.mock.calls[0]?.[0])).toBe(`${backend}/backend/auth/me`);
  });

  test.each([
    "/oauth/token",
    "/auth/tokens",
    "/api-other",
    "/api/../auth/tokens",
    "https://attacker.example.com/api/issues",
    "//attacker.example.com/api/issues",
  ])("rejects unsupported endpoint %s before egress", async (endpoint) => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);
    await expect(proxy({ endpoint, method: "GET" }, context())).resolves.toMatchObject({
      error: { code: "invalid_input" },
      ok: false,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  test.each([
    "",
    "file:///etc/passwd",
    "http://127.0.0.1",
    "http://169.254.169.254",
    "https://user:password@projektor.example.com",
    `${backend}?token=secret`,
    `${backend}#fragment`,
  ])("rejects unsafe backend URL %s before credential validation", async (baseUrl) => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      getApiKeyValidator()({ apiKey: "saved-token", values: { baseUrl } }, { fetcher }),
    ).rejects.toMatchObject({ status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("allows private backends only with the deployment opt-in", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ user: { id: "user-1" } }));
    const input = { apiKey: "saved-token", values: { baseUrl: "http://10.0.0.5" } };
    setPrivateNetworkAccessAllowed(false);
    await expect(getApiKeyValidator()(input, { fetcher })).rejects.toMatchObject({ status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
    setPrivateNetworkAccessAllowed(true);
    await expect(getApiKeyValidator()(input, { fetcher })).resolves.toMatchObject({
      metadata: { apiBaseUrl: "http://10.0.0.5" },
    });
  });

  describe("credential response validation", () => {
    test.each([401, 403, 302, 500])(
      "rejects credential HTTP %s without exposing token-bearing error bodies",
      async (status) => {
        const fetcher = vi
          .fn<typeof fetch>()
          .mockResolvedValue(
            new Response("invalid saved-token", { headers: { location: "https://login.example.com" }, status }),
          );
        await expect(
          getApiKeyValidator()({ apiKey: "saved-token", values: { baseUrl: backend } }, { fetcher }),
        ).rejects.toMatchObject({
          message: "Projektor credential validation failed",
          status,
        });
        expect(fetcher).toHaveBeenCalledOnce();
      },
    );

    test.each([
      Response.json({ user: { name: "Alice" } }),
      new Response("null", { headers: { "content-type": "application/json" } }),
      new Response(),
      new Response("<html>Login</html>"),
      new Response("x".repeat(1024 * 1024 + 1)),
    ])("rejects malformed, identity-less, or oversized validation responses", async (response) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response.clone());
      await expect(
        getApiKeyValidator()({ apiKey: "saved-token", values: { baseUrl: backend } }, { fetcher }),
      ).rejects.toBeInstanceOf(Error);
    });
  });

  test("requires a configured credential before proxy egress", async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);
    await expect(
      proxy(
        { endpoint: "/api/workspaces", method: "GET" },
        // oxlint-disable-next-line unicorn/no-useless-undefined -- The async credential lookup resolves to undefined when no credential is saved.
        { getCredential: vi.fn<ExecutionContext["getCredential"]>().mockResolvedValue(undefined) },
      ),
    ).resolves.toMatchObject({
      error: { code: "authorization_failed" },
      ok: false,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

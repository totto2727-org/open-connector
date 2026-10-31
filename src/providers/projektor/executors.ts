import type { CredentialValidators, ProviderExecutors, ProviderProxyExecutor } from "../../core/types.ts";

import { optionalRecord, optionalString } from "../../core/cast.ts";
import { assertPublicHttpUrl, isPrivateNetworkAccessAllowed } from "../../core/request.ts";
import {
  createProviderFetch,
  credentialProviderProxyBaseUrl,
  defineProviderProxy,
  providerInputError,
  providerProxyEndpointPrefixes,
  providerResponseError,
  ProviderRequestError,
  readProviderJsonBody,
  requiredInputString,
  runProviderRequest,
} from "../provider-runtime.ts";

const service = "projektor";
const resolveBaseUrl = credentialProviderProxyBaseUrl("apiBaseUrl", "baseUrl");
const isApiEndpoint = providerProxyEndpointPrefixes("/api");

export const executors: ProviderExecutors = {};

export const proxy: ProviderProxyExecutor = defineProviderProxy({
  service,
  baseUrl: async (context) => normalizeBackendUrl(await resolveBaseUrl(context, service)),
  auth: { type: "api_key_authorization", prefix: "Bearer " },
  allowedEndpoint: (endpoint) => isApiEndpoint(endpoint) || endpoint === "/auth/me",
  allowPrivateNetwork: isPrivateNetworkAccessAllowed,
  redirect: "manual",
});

export const credentialValidators: CredentialValidators = {
  async apiKey(input, { fetcher, signal }) {
    const apiBaseUrl = normalizeBackendUrl(input.values.baseUrl);
    const guardedFetcher = createProviderFetch({ fetch: fetcher, allowPrivateNetwork: isPrivateNetworkAccessAllowed });
    const payload = await runProviderRequest(
      { signal, label: "Projektor credential validation" },
      async (requestSignal) => {
        const response = await guardedFetcher(`${apiBaseUrl}/auth/me`, {
          headers: { authorization: `Bearer ${input.apiKey}`, accept: "application/json" },
          redirect: "manual",
          signal: requestSignal,
        });
        if (!response.ok) {
          throw new ProviderRequestError(response.status, "Projektor credential validation failed");
        }
        return readProviderJsonBody(response, {
          emptyBody: null,
          invalidJsonMessage: "Projektor credential validation returned invalid JSON",
          maxBytes: 1024 * 1024,
        });
      },
    );
    const user = optionalRecord(optionalRecord(payload)?.user);
    const userId = optionalString(user?.id);
    if (!userId) {
      throw providerResponseError("Projektor credential validation returned an invalid user identity");
    }
    return {
      profile: { accountId: `${apiBaseUrl}:${userId}`, displayName: optionalString(user?.name) ?? userId },
      metadata: { apiBaseUrl },
    };
  },
};

function normalizeBackendUrl(value: unknown): string {
  const url = assertPublicHttpUrl(requiredInputString(value, "baseUrl"), {
    fieldName: "baseUrl",
    createError: providerInputError,
    allowPrivateNetwork: isPrivateNetworkAccessAllowed(),
  });
  if (url.username || url.password || url.search || url.hash) {
    throw providerInputError("baseUrl must not include credentials, a query, or a fragment");
  }
  url.pathname = url.pathname.replace(/\/+$/u, "").replace(/\/api$/u, "");
  return url.toString().replace(/\/$/u, "");
}

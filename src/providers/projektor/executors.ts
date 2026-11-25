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
const projektorCredentialResponseMaxBytes = 1_048_576;

const normalizeBackendUrl = (value: unknown): string => {
  const url = assertPublicHttpUrl(requiredInputString(value, "baseUrl"), {
    allowPrivateNetwork: isPrivateNetworkAccessAllowed(),
    createError: providerInputError,
    fieldName: "baseUrl",
  });
  if (url.username || url.password || url.search || url.hash) {
    throw providerInputError("baseUrl must not include credentials, a query, or a fragment");
  }
  url.pathname = url.pathname.replace(/\/+$/u, "").replace(/\/api$/u, "");
  return url.toString().replace(/\/$/u, "");
};

export const executors: ProviderExecutors = {};

export const proxy: ProviderProxyExecutor = defineProviderProxy({
  allowPrivateNetwork: isPrivateNetworkAccessAllowed,
  allowedEndpoint: (endpoint) => isApiEndpoint(endpoint) || endpoint === "/auth/me",
  auth: { prefix: "Bearer ", type: "api_key_authorization" },
  baseUrl: async (context) => normalizeBackendUrl(await resolveBaseUrl(context, service)),
  redirect: "manual",
  service,
});

export const credentialValidators: CredentialValidators = {
  async apiKey(input, { fetcher, signal }) {
    const apiBaseUrl = normalizeBackendUrl(input.values.baseUrl);
    const guardedFetcher = createProviderFetch({ allowPrivateNetwork: isPrivateNetworkAccessAllowed, fetch: fetcher });
    const payload = await runProviderRequest(
      { label: "Projektor credential validation", signal },
      async (requestSignal) => {
        const response = await guardedFetcher(`${apiBaseUrl}/auth/me`, {
          headers: { accept: "application/json", authorization: `Bearer ${input.apiKey}` },
          redirect: "manual",
          signal: requestSignal,
        });
        if (!response.ok) {
          throw new ProviderRequestError(response.status, "Projektor credential validation failed");
        }
        return readProviderJsonBody(response, {
          emptyBody: undefined,
          invalidJsonMessage: "Projektor credential validation returned invalid JSON",
          maxBytes: projektorCredentialResponseMaxBytes,
        });
      },
    );
    const user = optionalRecord(optionalRecord(payload)?.user);
    const userId = optionalString(user?.id) ?? "";
    if (!userId) {
      throw providerResponseError("Projektor credential validation returned an invalid user identity");
    }
    // oxlint-disable-next-line eslint/sort-keys -- Keep the published validator result order of profile followed by metadata.
    return {
      profile: { accountId: `${apiBaseUrl}:${userId}`, displayName: optionalString(user?.name) ?? userId },
      metadata: { apiBaseUrl },
    };
  },
};

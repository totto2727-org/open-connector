import type {
  CredentialProfileInput,
  CredentialValidators,
  ProviderExecutors,
  ProviderProxyExecutor,
} from "../../core/types.ts";

import { optionalRecord, optionalString } from "../../core/cast.ts";
import { readBoundedResponseBytes } from "../../core/request.ts";
import {
  defineProviderProxy,
  providerProxyEndpointPrefixes,
  providerResponseError,
  ProviderRequestError,
  runProviderRequest,
} from "../provider-runtime.ts";

const service = "monid";
const monidApiBaseUrl = "https://api.monid.ai";
const monidWhoamiUrl = `${monidApiBaseUrl}/v1/auth/whoami`;
const monidCredentialResponseMaxBytes = 1024 * 1024;

export const executors: ProviderExecutors = {};

export const proxy: ProviderProxyExecutor = defineProviderProxy({
  service,
  baseUrl: monidApiBaseUrl,
  auth: { type: "api_key_authorization", prefix: "Bearer " },
  allowedEndpoint: providerProxyEndpointPrefixes("/v1"),
  skipDnsValidation: true,
  timeoutMs: 120_000,
});

export const credentialValidators: CredentialValidators = {
  async apiKey(input, { fetcher, signal }) {
    const payload = await runProviderRequest(
      { signal, label: "Monid credential validation" },
      async (requestSignal) => {
        const response = await fetcher(monidWhoamiUrl, {
          headers: { authorization: `Bearer ${input.apiKey}` },
          signal: requestSignal,
        });
        if (!response.ok) {
          throw new ProviderRequestError(response.status, "Monid credential validation failed");
        }

        const bytes = await readBoundedResponseBytes(response, {
          maxBytes: monidCredentialResponseMaxBytes,
          fieldName: "Monid credential validation response",
          createError: providerResponseError,
        });
        try {
          return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
        } catch {
          throw providerResponseError("Monid credential validation returned an invalid response");
        }
      },
    );

    return { profile: monidCredentialProfile(payload) };
  },
};

function monidCredentialProfile(payload: unknown): CredentialProfileInput {
  const user = optionalRecord(optionalRecord(payload)?.user);
  const userId = optionalString(user?.userId);
  const username = optionalString(user?.username);
  if (!userId) {
    throw providerResponseError("Monid credential validation returned an invalid user identity");
  }

  const workspace = optionalRecord(optionalRecord(payload)?.workspace);
  const workspaceId = optionalString(workspace?.workspaceId);
  const workspaceName = optionalString(workspace?.name);
  return {
    accountId: workspaceId ?? userId,
    displayName: workspaceName ?? username ?? userId,
  };
}

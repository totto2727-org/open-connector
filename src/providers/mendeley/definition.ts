import type { ProviderDefinition } from "../../core/types.ts";

import { mendeleyActions, mendeleyProviderScopes } from "./actions.ts";
// oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
export const provider: ProviderDefinition = {
  service: "mendeley",
  displayName: "Mendeley",
  categories: ["Productivity", "Data"],
  authTypes: ["oauth2"],
  auth: [
    // oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
    {
      type: "oauth2",
      authorizationUrl: "https://api.mendeley.com/oauth/authorize",
      tokenUrl: "https://api.mendeley.com/oauth/token",
      scopes: [mendeleyProviderScopes.all],
      tokenEndpointAuthMethod: "client_secret_basic",
    },
  ],
  homepageUrl: "https://www.mendeley.com/",
  actions: mendeleyActions,
};

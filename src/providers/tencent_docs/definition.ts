import type { ProviderDefinition } from "../../core/types.ts";

import { tencentDocsActions, tencentDocsProviderScopes } from "./actions.ts";

// oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
export const provider: ProviderDefinition = {
  service: "tencent_docs",
  displayName: "Tencent Docs",
  categories: ["Productivity", "Storage"],
  authTypes: ["oauth2"],
  auth: [
    // oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
    {
      type: "oauth2",
      authorizationUrl: "https://docs.qq.com/oauth/v2/authorize",
      tokenUrl: "https://docs.qq.com/oauth/v2/token",
      scopes: [
        tencentDocsProviderScopes.userInfoBase,
        tencentDocsProviderScopes.driveCreatable,
        tencentDocsProviderScopes.driveEditable,
        tencentDocsProviderScopes.driveFileMetadata,
        tencentDocsProviderScopes.driveFileMetadataReadonly,
        tencentDocsProviderScopes.driveReadonly,
        tencentDocsProviderScopes.driveExportable,
        tencentDocsProviderScopes.doc,
        tencentDocsProviderScopes.sheet,
        tencentDocsProviderScopes.smartsheetReadonly,
        tencentDocsProviderScopes.form,
      ],
      tokenEndpointAuthMethod: "client_secret_post",
      authorizationRequestFields: {
        scope: false,
      },
      authorizationParams: {
        scope: "all",
      },
    },
  ],
  homepageUrl: "https://docs.qq.com",
  actions: tencentDocsActions,
};

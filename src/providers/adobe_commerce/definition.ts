import type { ProviderDefinition } from "../../core/types.ts";

import { adobeCommerceActions } from "./actions.ts";

const service = "adobe_commerce";

export const adobeCommerceCredentialHelpUrl = "https://developer.adobe.com/commerce/webapi/get-started/authentication/";

// oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
export const provider: ProviderDefinition = {
  service,
  displayName: "Adobe Commerce",
  categories: ["Productivity", "Marketing"],
  authTypes: ["api_key"],
  auth: [
    // oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
    {
      type: "api_key",
      label: "Admin Access Token",
      placeholder: "Adobe Commerce bearer token",
      description: `Adobe Commerce Admin access token sent as an Authorization Bearer token. Learn about Adobe Commerce API authentication at ${adobeCommerceCredentialHelpUrl}`,
      extraFields: [
        // oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
        {
          key: "baseUrl",
          label: "Store Base URL",
          inputType: "text",
          required: true,
          secret: false,
          placeholder: "https://shop.example.com",
          description: "Public HTTPS root URL for your Adobe Commerce store. Do not include the /rest/V1 path.",
        },
        // oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
        {
          key: "storeCode",
          label: "Store Code",
          inputType: "text",
          required: false,
          secret: false,
          placeholder: "default",
          description:
            "Optional Adobe Commerce store view code used in REST URLs such as /rest/default/V1. Leave blank to use /rest/V1.",
        },
      ],
    },
  ],
  homepageUrl: "https://business.adobe.com/products/magento/magento-commerce.html",
  actions: adobeCommerceActions,
};

import type { ProviderDefinition } from "../../core/types.ts";

import { shopifyActions } from "./actions.ts";
import { shopifyOAuthScopes, shopifyOptionalScopes } from "./scopes.ts";
import { snapshot as triggerSnapshot0_0 } from "./trigger-on-shop-event.definition.ts";
import { triggerPermissions } from "./trigger-permissions.ts";

const service = "shopify";
const shopifyAuthorizationUrl = "https://{shopSubdomain}.myshopify.com/admin/oauth/authorize";
const shopifyTokenUrl = "https://{shopSubdomain}.myshopify.com/admin/oauth/access_token";

// oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
export const provider: ProviderDefinition = {
  service,
  displayName: "Shopify",
  categories: ["Marketing", "Data"],
  authTypes: ["oauth2", "api_key"],
  auth: [
    // oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
    {
      type: "oauth2",
      authorizationUrl: shopifyAuthorizationUrl,
      tokenUrl: shopifyTokenUrl,
      scopes: shopifyOAuthScopes,
      optionalScopes: shopifyOptionalScopes,
      scopeSeparator: ",",
      tokenEndpointAuthMethod: "client_secret_post",
      clientConfigFields: [
        // oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
        {
          key: "shopSubdomain",
          label: "Shop subdomain",
          inputType: "text",
          required: true,
          secret: false,
          placeholder: "acme",
          description: "The store-specific part before .myshopify.com, such as acme for acme.myshopify.com.",
        },
      ],
    },
    // oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
    {
      type: "api_key",
      label: "Admin API access token",
      placeholder: "shpat_...",
      description:
        "Shopify Admin API access token sent with the X-Shopify-Access-Token header. Create or install a custom app and copy its Admin API access token.",
      extraFields: [
        // oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
        {
          key: "shopDomain",
          label: "Shop domain",
          inputType: "text",
          required: true,
          secret: false,
          placeholder: "acme.myshopify.com",
          description:
            "The store's myshopify.com domain, such as acme.myshopify.com. A Shopify admin URL for the same shop is also accepted.",
        },
      ],
    },
  ],
  homepageUrl: "https://www.shopify.com",
  actions: shopifyActions,
  triggers: [triggerSnapshot0_0],
  triggerPermissions,
};

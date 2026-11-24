import type { ProviderDefinition } from "../../core/types.ts";

const service = "monid";

// oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
export const provider: ProviderDefinition = {
  service,
  displayName: "Monid",
  description: "Monid AI discovery, inspection, and agent execution API.",
  categories: ["AI", "Developer"],
  authTypes: ["api_key"],
  auth: [
    // oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
    {
      type: "api_key",
      label: "API Key",
      placeholder: "monid_live_...",
      description: "Monid API key sent as a Bearer token.",
    },
  ],
  homepageUrl: "https://monid.ai/docs/api/overview",
  actions: [],
};

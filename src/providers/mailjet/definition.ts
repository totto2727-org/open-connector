import type { ProviderDefinition } from "../../core/types.ts";

import { mailjetActions } from "./actions.ts";

const service = "mailjet";
const mailjetCredentialHelpUrl = "https://app.mailjet.com/account/api_keys";

// oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
export const provider: ProviderDefinition = {
  service,
  displayName: "Mailjet",
  categories: ["Marketing"],
  authTypes: ["api_key"],
  auth: [
    // oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
    {
      type: "api_key",
      label: "API Key",
      placeholder: "MJ_APIKEY_PUBLIC",
      description: `Mailjet Email API key used as the HTTP Basic Auth username. Find it with the API Secret Key on the Mailjet API Key Management page: ${mailjetCredentialHelpUrl}.`,
      extraFields: [
        // oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
        {
          key: "apiSecret",
          label: "API Secret Key",
          inputType: "password",
          required: true,
          secret: true,
          placeholder: "MJ_APIKEY_PRIVATE",
          description: `Mailjet Email API Secret Key used as the HTTP Basic Auth password. Find it with the API key on the Mailjet API Key Management page: ${mailjetCredentialHelpUrl}.`,
        },
      ],
    },
  ],
  homepageUrl: "https://www.mailjet.com",
  actions: mailjetActions,
};

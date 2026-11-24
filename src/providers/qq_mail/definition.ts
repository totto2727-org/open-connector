import type { ProviderDefinition } from "../../core/types.ts";

import { qqMailActions } from "./actions.ts";

export const nodeOnly = true;

// oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
export const provider: ProviderDefinition = {
  service: "qq_mail",
  displayName: "QQ Mail",
  description:
    "Unavailable on Cloudflare Workers. QQ Mail requires IMAP/SMTP, so run this provider from the Node.js runtime.",
  categories: ["Communication", "Productivity"],
  authTypes: ["custom_credential"],
  auth: [
    // oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
    {
      type: "custom_credential",
      fields: [
        // oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
        {
          key: "email",
          label: "Email Address",
          inputType: "text",
          required: true,
          secret: false,
          placeholder: "user@qq.com",
          description: "The full QQ Mail address to connect, such as user@qq.com.",
        },
        // oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
        {
          key: "authorizationCode",
          label: "Authorization Code",
          inputType: "password",
          required: true,
          secret: true,
          placeholder: "16-character code",
          description:
            "The 16-character QQ Mail authorization code from QQ Mail web settings > Account and Security after enabling POP3/IMAP/SMTP service: https://help.mail.qq.com/detail/0/1087. This is not the QQ Mail web login password.",
        },
      ],
      testAction: {
        actionName: "list_folders",
        input: {},
      },
    },
  ],
  homepageUrl: "https://mail.qq.com/",
  actions: qqMailActions,
};

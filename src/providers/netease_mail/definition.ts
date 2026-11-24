import type { ProviderDefinition } from "../../core/types.ts";

import { neteaseMailActions } from "./actions.ts";

export const nodeOnly = true;

// oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
export const provider: ProviderDefinition = {
  service: "netease_mail",
  displayName: "NetEase Mail",
  description:
    "Unavailable on Cloudflare Workers. NetEase Mail requires IMAP/SMTP, so run this provider from the Node.js runtime.",
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
          placeholder: "user@163.com",
          description: "The full personal NetEase Mail address to connect, using 163.com, 126.com, or yeah.net.",
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
            "The 16-character client authorization code created after enabling IMAP/SMTP in NetEase Mail settings: https://help.mail.163.com/faqDetail.do?code=d7a5dc8471cd0c0e8b4b8f4f8e49998b374173cfe9171305fa1ce630d7f67ac2a5feb28b66796d3b. This is not the NetEase Mail web login password.",
        },
      ],
      testAction: {
        actionName: "list_folders",
        input: {},
      },
    },
  ],
  homepageUrl: "https://mail.163.com/",
  actions: neteaseMailActions,
};

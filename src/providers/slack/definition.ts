import type { OAuthAuthorizationOption, ProviderDefinition } from "../../core/types.ts";

import { slackActions } from "./actions.ts";
import { snapshot as triggerSnapshot0_0 } from "./trigger-on-message-posted.definition.ts";
import { triggerPermissions } from "./trigger-permissions.ts";

const service = "slack";
const slackAuthorizationOptions: OAuthAuthorizationOption[] = [
  // oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
  {
    id: "channels:read",
    label: "Public channels",
    description: "List public Slack channels and read their metadata.",
    required: true,
    defaultSelected: true,
    risk: "standard",
  },
  // oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
  {
    id: "channels:history",
    label: "Public channel messages",
    description: "Read message history in public Slack channels.",
    required: false,
    defaultSelected: true,
    risk: "sensitive",
    requires: ["channels:read"],
  },
  // oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
  {
    id: "groups:read",
    label: "Private channels",
    description: "List private channels that the connected user can access.",
    required: false,
    defaultSelected: true,
    risk: "sensitive",
  },
  // oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
  {
    id: "groups:history",
    label: "Private channel messages",
    description: "Read message history in private Slack channels.",
    required: false,
    defaultSelected: true,
    risk: "sensitive",
    requires: ["groups:read"],
  },
  // oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
  {
    id: "users:read",
    label: "User directory",
    description: "Read Slack user profiles and directory information.",
    required: false,
    defaultSelected: true,
    risk: "standard",
  },
  // oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
  {
    id: "im:read",
    label: "Direct messages",
    description: "Read direct-message conversation metadata.",
    required: false,
    defaultSelected: true,
    risk: "sensitive",
  },
  // oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
  {
    id: "im:history",
    label: "Direct message history",
    description: "Read direct-message history.",
    required: false,
    defaultSelected: true,
    risk: "sensitive",
    requires: ["im:read"],
  },
  // oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
  {
    id: "mpim:read",
    label: "Group direct messages",
    description: "Read group direct-message conversation metadata.",
    required: false,
    defaultSelected: true,
    risk: "sensitive",
  },
  // oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
  {
    id: "mpim:history",
    label: "Group direct message history",
    description: "Read group direct-message history.",
    required: false,
    defaultSelected: true,
    risk: "sensitive",
    requires: ["mpim:read"],
  },
  // oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
  {
    id: "files:read",
    label: "Files",
    description: "Read files shared in Slack.",
    required: false,
    defaultSelected: true,
    risk: "sensitive",
  },
  // oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
  {
    id: "reactions:read",
    label: "Reactions",
    description: "Read reactions on Slack messages.",
    required: false,
    defaultSelected: true,
    risk: "standard",
  },
  // oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
  {
    id: "chat:write",
    label: "Send messages",
    description: "Send messages as the connected Slack user.",
    required: false,
    defaultSelected: true,
    risk: "sensitive",
  },
  // oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
  {
    id: "im:write",
    label: "Send direct messages",
    description: "Send direct messages as the connected Slack user.",
    required: false,
    defaultSelected: true,
    risk: "sensitive",
    requires: ["im:read"],
  },
  // oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
  {
    id: "files:write",
    label: "Upload files",
    description: "Upload files to Slack.",
    required: false,
    defaultSelected: true,
    risk: "sensitive",
  },
  // oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
  {
    id: "reactions:write",
    label: "Manage reactions",
    description: "Add and remove reactions on Slack messages.",
    required: false,
    defaultSelected: true,
    risk: "sensitive",
  },
  // oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
  {
    id: "search:read",
    label: "Legacy message search",
    description: "Search messages with Slack's legacy search API.",
    required: false,
    defaultSelected: true,
    risk: "sensitive",
  },
  // oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
  {
    id: "search:read.public",
    label: "Public message search",
    description: "Search public-channel messages with Slack Real-time Search.",
    required: false,
    defaultSelected: false,
    risk: "sensitive",
  },
  // oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
  {
    id: "search:read.private",
    label: "Private message search",
    description: "Search private-channel messages with Slack Real-time Search.",
    required: false,
    defaultSelected: false,
    risk: "sensitive",
    requires: ["search:read.public"],
  },
];

/**
 * User-authorized Slack provider backed by the Slack Web API.
 */
// oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
export const provider: ProviderDefinition = {
  service,
  displayName: "Slack",
  categories: ["Communication", "Productivity"],
  authTypes: ["oauth2", "api_key"],
  auth: [
    // oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
    {
      type: "oauth2",
      authorizationUrl: "https://slack.com/oauth/v2_user/authorize",
      tokenUrl: "https://slack.com/api/oauth.v2.user.access",
      refreshTokenUrl: "https://slack.com/api/oauth.v2.access",
      scopes: slackAuthorizationOptions.map((option) => option.id),
      scopeSeparator: ",",
      tokenEndpointAuthMethod: "client_secret_post",
      authorizationOptions: slackAuthorizationOptions,
    },
    // oxlint-disable-next-line eslint/sort-keys -- This metadata object retains its serialized catalog order.
    {
      type: "api_key",
      label: "Access token",
      placeholder: "xoxb-... or xoxp-...",
      description:
        "Slack bot or user token used with the Authorization Bearer header. Create a Slack app, install it to the workspace, then copy the bot token or user token from OAuth & Permissions.",
    },
  ],
  homepageUrl: "https://slack.com",
  actions: slackActions,
  triggers: [triggerSnapshot0_0],
  triggerPermissions,
};

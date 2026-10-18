import type { ProviderDefinition } from "../../core/types.ts";

export const provider: ProviderDefinition = {
  service: "projektor",
  displayName: "Projektor",
  description: "Access projects, issues, wiki pages, and workflows on a Projektor backend through its HTTP API.",
  categories: ["Developer Tools", "Productivity"],
  authTypes: ["api_key"],
  auth: [
    {
      type: "api_key",
      label: "API Token",
      placeholder: "Enter your Projektor API token",
      description: "A Projektor API token sent as Authorization: Bearer <token>.",
      extraFields: [
        {
          key: "baseUrl",
          label: "Backend API URL",
          inputType: "text",
          required: true,
          secret: false,
          placeholder: "https://projektor-api.example.com",
          description:
            "The HTTP or HTTPS backend URL, not the frontend URL. A trailing /api is optional. Private-network backends require OOMOL_CONNECT_ALLOW_PRIVATE_NETWORK in the self-hosted runtime. Unsafe local, reserved, and cloud-metadata targets remain blocked.",
        },
      ],
    },
  ],
  homepageUrl: "https://github.com/totto2727-org/projektor",
  actions: [],
};

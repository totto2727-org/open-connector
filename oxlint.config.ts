import preset from "@totto2727/oxlint/preset/application";
import { defineConfig } from "oxlint";
import orderedActionDefinitions from "./oxlint-ordered-action-definitions.json" with { type: "json" };
import orderedProviderDefinitions from "./oxlint-ordered-provider-definitions.json" with { type: "json" };

const config = defineConfig({
  // Node runs the server, scripts, and examples. The Vite UI uses browser globals.
  env: { node: true },
  extends: [preset],
  ignorePatterns: [
    "dist",
    "node_modules",
    "/catalog",
    "/coverage",
    "deploy/helm/open-connector/templates",
    "src/providers/registry*.generated.ts",
    "src/providers/action-contracts.generated.ts",
  ],
  overrides: [
    { env: { browser: true, node: false }, files: ["web/src/**"] },
    {
      // These files contain only public action definitions. The catalog and web parameter summaries preserve their field order.
      files: orderedActionDefinitions,
      rules: { "eslint/sort-keys": "off" },
    },
    {
      // These files contain only public provider metadata. The catalog serializes its key order.
      files: orderedProviderDefinitions,
      rules: { "eslint/sort-keys": "off" },
    },
  ],
  rules: {
    "import/consistent-type-specifier-style": ["error", "prefer-top-level"],
  },
  settings: {
    vitest: { typecheck: false },
  },
});

// oxlint-disable-next-line import/no-default-export -- Oxlint discovers this config through its default export.
export default config;

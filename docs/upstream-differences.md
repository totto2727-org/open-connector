# Fork differences from upstream

This document records maintained differences between [totto2727-org/open-connector](https://github.com/totto2727-org/open-connector) and [oomol-lab/open-connector](https://github.com/oomol-lab/open-connector).
It includes changes committed locally before the organization fork was created, not only the Monid provider addition.
It is a fork-maintenance reference, not a work-progress log.

## Comparison baseline

The recorded upstream baseline is [`0535653ace7338adb346ccf564458eb7a57bdefd`](https://github.com/oomol-lab/open-connector/commit/0535653ace7338adb346ccf564458eb7a57bdefd).
The existing local history was retained and merged with that upstream baseline in [`88b8488b761727d2319bb460817694da97288da9`](https://github.com/totto2727-org/open-connector/commit/88b8488b761727d2319bb460817694da97288da9), then published to the fork's `main` branch.
The Monid provider and the buffered native HTTP adapter are additional maintained fork features.

| Remote     | Repository                                            | Role                                                                       |
| ---------- | ----------------------------------------------------- | -------------------------------------------------------------------------- |
| `origin`   | `https://github.com/totto2727-org/open-connector.git` | Publish fork branches and target pull requests at this repository's `main` |
| `upstream` | `https://github.com/oomol-lab/open-connector.git`     | Fetch original history for comparison and synchronization                  |

No pull request to the original repository is required for these fork-local changes.
The virtual workspace maps this independent repository to `app/open-connector/` and ignores its contents at the workspace root.

## Buffered native HTTP adapter and CLI compatibility

The fork adds `/v1/passthrough/:service/*` alongside the existing envelope-based `/v1/proxy/:service` route.
It reuses runtime authentication, proxy and connection grants, stored credentials, policy snapshots, provider dispatch, and SSRF-guarded egress, but accepts native HTTP method/path/query/text body and returns native buffered status/body.
The intended consumer is the official Monid CLI using a gateway base URL, without a local HTTP relay.
The adapter supports UTF-8 requests without adding a request size cap, MIME/charset whitelist, or duplicate method/path validation beyond the existing proxy.
It does not support streaming, upgrades, non-UTF-8 or compressed requests, arbitrary destinations, cookie sessions, or byte-identical transport headers.
Gateway-owned CSP sandbox and nosniff headers prevent upstream active content from becoming a same-origin application.
Local provider proxy executions also gain a real correlated execution UUID and `meta.service`, fixing the official `oo` CLI's required response metadata without changing the existing envelope payload.
Maintained regression coverage exercises native forwarding, grants, provider boundaries, unsafe inputs, active-content headers, and legacy envelope behavior.
See [runtime API](runtime-api.md#buffered-native-http-passthrough) and [Monid integration](monid.md#native-cli-through-the-gateway) for the contract and live-verification limitations.

## Existing committed differences retained in the fork

### Personal Cloudflare deployment configuration

- Source commit: [`bb84e96c9269b24570a47e14584aa0ee67bed6d8`](https://github.com/totto2727-org/open-connector/commit/bb84e96c9269b24570a47e14584aa0ee67bed6d8), `chore: configure personal Cloudflare deployment`.
- Changed file: `wrangler.jsonc`, a fork-only, tracked deployment configuration.
- Purpose: configure the personal Worker, static assets, observability, D1 migrations, and the selected transit-file storage backend.
- Upstream uses an example configuration and an ignored local configuration instead of this tracked personal configuration.
- The configured D1 and storage identifiers are deployment-specific, not API credentials; secrets must continue to use the runtime's secret-management mechanism and must not be added to this file.
- Retain this file when synchronizing upstream, and review new upstream binding or migration requirements before deploying.

### Cloudflare script selection and package-manager policy

- Source commit: [`0072c4301225a21a7308c5d22f77260a4db3886a`](https://github.com/totto2727-org/open-connector/commit/0072c4301225a21a7308c5d22f77260a4db3886a), `wip`.
- Changed file: `package.json`.
- `dev:cloudflare` and `deploy:cloudflare` omit upstream's `--config wrangler.local.jsonc` flag, so Wrangler selects the fork's tracked `wrangler.jsonc` by default.
- `devEngines.packageManager` specifies `npm` version `12.0.2` with `onFail: "download"`.
- This is an existing fork-local policy, not a dependency requirement introduced by Monid.
- npm `11.19.0` rejects ordinary package-script invocations with `EBADDEVENGINES`; use the configured package-manager version, or invoke the relevant Node entrypoint directly when testing already-generated sources.

### Compatible dependency ranges

- Changed files: `package.json` and `package-lock.json`.
- The fork uses `@types/bun: ^1.4.0` instead of an exact dependency requirement so compatible releases remain eligible.
- The lockfile retains the concrete resolved version and integrity for reproducible installs.
- The package manager version and version-specific lifecycle-script approvals are unchanged because they describe toolchain and execution trust boundaries, not dependency update constraints.
- This dependency policy does not change provider runtime source or deployment behavior.

### Automatic D1 migrations before Cloudflare deployment

- Changed files: `package.json` and `docs/cloudflare.md`.
- `migrate:cloudflare` independently applies pending migrations to the remote `open-connector` D1 database using the fork's tracked `wrangler.jsonc`.
- The migration command sets `CI=true` to accept Wrangler's migration confirmation automatically; declining its interactive prompt otherwise returns a successful exit code without applying migrations.
- `deploy:cloudflare` runs `migrate:cloudflare` before catalog generation, Web Console build, asset copying, and Worker deployment.
- The commands are chained with `&&`, so migration failure prevents the new Worker from being deployed against an outdated database schema.
- This is a fork-local deployment safeguard, not a migration requirement introduced by adding a provider.

### History-only synchronization commits

- [`c91a6300`](https://github.com/totto2727-org/open-connector/commit/c91a6300), `chore: merge upstream main through 28b7579c`, was already present locally before the fork was created.
- [`88b8488b761727d2319bb460817694da97288da9`](https://github.com/totto2727-org/open-connector/commit/88b8488b761727d2319bb460817694da97288da9) merges the recorded upstream baseline while preserving both existing customization commits.
- These merge commits retain provenance and incorporate upstream changes; they are not additional fork features.
- Immediately after this synchronization, the surviving file differences against the recorded upstream baseline were `package.json` and `wrangler.jsonc` only.

## Monid-only provider addition

| Fork-only path                          | Purpose                                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `src/providers/monid/definition.ts`     | API-key-only provider metadata with no Actions                                                                           |
| `src/providers/monid/executors.ts`      | Authenticated `/v1` Proxy and API-key validation through Monid's `whoami` endpoint                                       |
| `src/providers/monid/executors.test.ts` | Maintained regression coverage for credentials, request forwarding, response semantics, and provider-specific boundaries |
| `docs/monid.md`                         | Usage, API coverage, security boundaries, limitations, and official sources                                              |
| `docs/upstream-differences.md`          | This committed upstream-divergence reference                                                                             |

The provider uses OpenConnector's shared Proxy runtime rather than modifying Marketplace discovery, transport semantics, or shared provider infrastructure.
Generated Catalog and Registry files remain generated and untracked, and must not be included in the pull request.
OpenCode Go is intentionally excluded from this fork change.
The earlier local experiment under the virtual workspace's `tmp/` is not part of this independent repository or its committed differences.
See [Monid provider](monid.md) for the exact API coverage and the distinction between the API-key HTTP API and other Monid surfaces.

## Reproduce and maintain the comparison

Run these commands inside the independent `open-connector` repository:

```bash
git fetch upstream
git diff --name-status upstream/main HEAD
git diff upstream/main HEAD -- package.json wrangler.jsonc src/providers/monid docs/monid.md docs/upstream-differences.md
git log --oneline --no-merges upstream/main..HEAD
```

Use the fixed upstream SHA below to reproduce this document's original baseline after `upstream/main` advances:

```bash
git diff --name-status 0535653ace7338adb346ccf564458eb7a57bdefd HEAD
git diff 0535653ace7338adb346ccf564458eb7a57bdefd HEAD -- package.json wrangler.jsonc
git log --oneline 0535653ace7338adb346ccf564458eb7a57bdefd..HEAD
```

These are two-endpoint comparisons of committed trees, so they include all surviving committed customizations rather than only an uncommitted working-tree diff or the latest pull request.
When synchronizing a new upstream baseline or adding/removing a fork-only feature, update the baseline, retained differences, and file inventory here in the same change.
Preserve historical commits without rewriting or force-pushing the fork merely to make its history look identical to upstream.

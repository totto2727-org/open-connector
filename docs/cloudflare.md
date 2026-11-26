# Cloudflare Deployment

OpenConnector supports Cloudflare Workers as a metadata and runtime-state deployment target. The
Worker runtime uses:

- Workers for the HTTP runtime.
- D1 for connections, OAuth config/state, runtime tokens, run logs, and Action idempotency records.
- R2 or Workers KV for temporary transit files.
- Static Assets for the Web Console.

## SaaS OAuth deployment

Set OOMOL_CONNECT_ORIGIN explicitly to the public Console origin and configure encrypted storage
before saving a project key. The SaaS callback returns to that origin's completion page; the
browser synchronization POST must carry the same origin. Reverse proxies must preserve it.
Workers do not infer trusted SaaS origin from the incoming request.

Apply D1 migrations through 0015_saas_cleanup_runtime.sql, deploy the scheduled handler and
copy the once-per-minute triggers.crons from the example configuration. Verify actual scheduled
invocations and cleanup progress after deployment; HTTP traffic does not replace cron.
See [SaaS OAuth](saas-oauth.md) and [D1 maintenance](saas-maintenance.md#offline-d1-maintenance).
The temporary reset Worker has automatic batch/retry coverage; real D1 reset remains a dedicated
test-database acceptance step, not a claim established by local test adapters.

## Prerequisites

- A Cloudflare account with Workers, D1, and either R2 or Workers KV access.
- Wrangler available through `npx wrangler`.
- Node.js 22 or newer.

## Review Worker Config

Install dependencies:

```bash
npm install
```

This fork uses the tracked `wrangler.jsonc` for local preview and remote deployment.
Review its Cloudflare resource IDs before running either workflow, and keep secrets out of this file.

## Log In With Wrangler

Skip this step if you are already logged in:

```bash
npx wrangler login
```

## Create Cloudflare Resources

Create the D1 database:

```bash
npx wrangler d1 create open-connector
```

Then choose one transit-file backend. R2 is the default and supports files larger than 25 MiB:

```bash
npx wrangler r2 bucket create open-connector-transit-files
```

Alternatively, create a Workers KV namespace for lightweight deployments that do not need files
larger than 25 MiB:

```bash
npx wrangler kv namespace create open-connector-transit-files
```

Put the returned D1 `database_id` and R2 bucket name or KV namespace `id` into `wrangler.jsonc`.
For KV, comment out the `r2_buckets` block, uncomment the `kv_namespaces` block, and set `TRANSIT_FILES_BACKEND` to `"kv"` as shown in the example config.
Only one backend may use the `TRANSIT_FILES` binding.
All Wrangler commands that read the Worker config use the tracked `wrangler.jsonc` by default.

## Local Worker Preview

The local Worker preview stores its D1, R2, and KV data under the ignored `.wrangler` directory.
This data is separate from the remote Cloudflare resources.

Set a separate encryption key in the ignored `.env` file before you test encrypted storage in the local preview:

```dotenv
OOMOL_CONNECT_ENCRYPTION_KEY=replace-with-a-local-encryption-key
```

Apply the migrations to Wrangler's local D1 state, then start the Worker:

```bash
npx wrangler d1 migrations apply open-connector --local
npm run dev:cloudflare
```

`npm run dev:cloudflare` generates the catalog, builds the Web Console, copies catalog assets, and runs `wrangler dev`.
The local Worker preview uses the same generated provider Action executor registry as the Node runtime.

Check the local Worker:

```bash
curl http://localhost:8787/health
```

The health endpoint should return `{"ok":true}`.
Use `npm test -- src/server/cloudflare.test.ts` to verify administrator and runtime authentication locally.

## Remote Deployment

`npm run deploy:cloudflare` applies all pending migrations to the remote D1 database before generating assets and deploying the Worker.
If migration fails, the command stops without deploying the new Worker.
To apply migrations independently, run:

```bash
npm run migrate:cloudflare
```

Both scripts use this fork's tracked `wrangler.jsonc` by default, so confirm its D1 database and Worker settings before running either command.
The migration script targets the remote database, not the local preview state.
It sets `CI=true` to automatically confirm pending migrations, so declining an interactive Wrangler prompt cannot accidentally allow deployment to continue without applying them.
Review the pending migrations before running either script.
Passing `--dry-run` to `deploy:cloudflare` only skips Worker upload; the remote migration step still runs.

Generate an encryption key for a new deployment:

```bash
openssl rand -base64 32
```

Store the encryption key in a secrets vault.
Keep the current key for existing deployments so the Worker can decrypt the D1 records.

Set the encryption key and the Cloudflare Access application audience:

```bash
npx wrangler secret put OOMOL_CONNECT_ENCRYPTION_KEY
npx wrangler secret put OPEN_CONNECTOR_ACCESS_AUDIENCE
```

Deploy:

```bash
npm run deploy:cloudflare
```

`npm run deploy:cloudflare` first runs `npm run migrate:cloudflare`, then generates the catalog, builds the Web Console, copies catalog assets, and runs `wrangler deploy --minify`.
The tracked `wrangler.jsonc` maps the built Web Console assets to the `ASSETS` binding used by the Worker.
`--minify` matters on Workers beyond the upload size limit: a heap snapshot of the running isolate (taken through the `wrangler dev` inspector) shows the script source retained as one string for as long as the isolate lives, so the 13.8 MiB minified script costs about half the isolate memory of the 28.7 MiB unminified one, out of the 128 MB each Worker isolate gets.

Use the Worker URL printed by Wrangler to check the deployed runtime:

```bash
curl https://open-connector.example.workers.dev/health
```

The health endpoint should return `{"ok":true}`. Replace the example URL with the deployed Worker
URL or your custom domain.
Open the configured console origin to sign in with Cloudflare Access.

## MCP OAuth on the fork

Use `https://open-connector-api.totto2727.dev/mcp` to connect an OAuth-capable MCP client.
The API origin publishes OAuth discovery and supports Dynamic Client Registration (DCR) and Client ID Metadata Documents (CIMD).
Only the browser consent route at `/oauth/mcp/authorize` requires Cloudflare Access.
Sign in with your passkey, then select **Allow access** or **Deny**.
The MCP client uses the OAuth access token to call `/mcp` on the API origin.
An individually issued runtime API key also gives direct bearer access to `/mcp` on either origin and to runtime endpoints under `/v1`.
Keep `https://open-connector.totto2727.workers.dev` as the CLI endpoint.

1. Apply the OpenConnector Access application from [infra PR #30](https://github.com/totto2727-org/infra/pull/30) before adding the API domain to the Worker.
2. Set the shared `OPEN_CONNECTOR_ACCESS_AUDIENCE` Worker secret to the application's `openConnectorAccessAudience` Pulumi output.
   Keep the existing `OOMOL_CONNECT_ENCRYPTION_KEY` secret.
   `OPEN_CONNECTOR_MCP_OAUTH_ORIGIN` is separate from `OOMOL_CONNECT_ORIGIN`, which still controls provider OAuth and the general runtime origin.
3. Run `npm run deploy:cloudflare` after reviewing the deployment.
   The `OAUTH_KV` binding without an ID uses [Wrangler automatic provisioning](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-resource-provisioning).
   Record the resulting namespace ID and reuse that namespace on subsequent deployments.
   If there is already a namespace for MCP OAuth, set its existing ID in the binding before deploying rather than provisioning a replacement.
   Replacing the namespace invalidates registered clients and grants.
   Do not use the transit-file namespace for OAuth.
   This backport needs no new D1 migration: the Worker keeps OAuth data in KV and backing runtime credentials in the existing D1 runtime-token table.

After deployment, request `/.well-known/oauth-authorization-server` on the API origin without a browser session.
It must return OAuth metadata rather than an Access login redirect.
Connect from an OAuth client and verify that Access prompts for login only when the browser opens the authorization page.
To revoke the MCP connection, delete its `MCP OAuth` runtime API key in the console.
Verify that subsequent MCP calls and token refresh requests for that connection fail.

## Runtime Behavior

The Cloudflare runtime serves catalog metadata, `/api` and `/v1` metadata endpoints, connections,
runtime tokens, OAuth config/state, transit files backed by the configured R2 bucket or KV
namespace, and the generated provider Action executor registry.

Configure an R2 lifecycle rule for the transit bucket if you want unread expired transit files
cleaned up automatically. Workers KV applies the configured TTL when each file is written and
deletes it automatically. KV clamps `OOMOL_CONNECT_TRANSIT_FILE_TTL_SECONDS` to a minimum of 60
seconds and `OOMOL_CONNECT_TRANSIT_FILE_MAX_BYTES` to a maximum of 25 MiB.

## Response Compression

Cloudflare negotiates and applies response compression on egress, so the Worker leaves compression
to the edge instead of running it in the application. Workers build responses with `encodeBody` set
to `"automatic"`, which means the runtime encodes the body itself to satisfy the `Content-Encoding`
header; a body the application had already compressed would be encoded a second time and arrive
undecodable. Node deployments have no edge in front of them and keep compressing in the application.

[Cloudflare's default compressible content types][cf-compression] include `application/json`, so
eligible `/api` and `/v1` metadata responses are compressed for clients that advertise support.
Eligibility also requires a `200` status and a body of at least 48 bytes for gzip or 50 bytes for
Brotli and Zstandard, so the smallest responses stay uncompressed whatever their content type. The
list has `text/x-markdown` but not `text/markdown`, which `/api/actions/:actionId/agent.md` returns,
so agent guides are served uncompressed. They are small — around 1.5 KiB for a typical action and
20 KiB for the largest one in the catalog — so this is usually not worth acting on. Add a
Compression Rule matching `text/markdown` if your deployment serves agent guides heavily.

[cf-compression]: https://developers.cloudflare.com/speed/optimization/content/compression/

## Configuration

Cloudflare uses the same environment variable names for origin, action policy, transit file limits, and credential encryption.
The Worker requires an issued runtime API key for runtime HTTP and direct MCP access, even when D1 has no keys.
Use Cloudflare Access for the console and administrator APIs, including connection management and the console's action runner.
See [Cloudflare Access deployment](cloudflare-access.md).

`PORT`, `HOST`, `OOMOL_CONNECT_DATA_DIR`, `OOMOL_CONNECT_CATALOG_LAZY_SCHEMAS`, and `OOMOL_CONNECT_CATALOG_SCHEMA_CACHE_FILES` are Node-only settings.

See [configuration.md](configuration.md) for all runtime environment variables.

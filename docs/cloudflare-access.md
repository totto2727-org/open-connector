# Deploy the OpenConnector console behind Cloudflare Access

Use `https://open-connector.totto2727.dev` for the Web Console and administrator APIs.
Use an individually issued runtime API key as a bearer token for the CLI and direct MCP clients at `https://open-connector.totto2727.workers.dev`.
Use **Access** in the Web Console to create and revoke these keys.
The console uses the Access session for **Debug Action** and for connection setup and management.

## Roll out the change

1. Apply the Cloudflare stack in `totto2727-org/infra` and confirm the OpenConnector Access application allows only the approved passkey group.
2. Set the Worker secret `OPEN_CONNECTOR_ACCESS_AUDIENCE` to the stack's `openConnectorAccessAudience` output with `npx wrangler secret put OPEN_CONNECTOR_ACCESS_AUDIENCE`.
3. If clients use a shared runtime secret, issue a key for each client and switch those clients to their new keys before deploying.
   The CLI can still read its issued key from the client-side `OOMOL_CONNECT_RUNTIME_TOKEN` environment variable.
   Deploy with `npm run deploy:cloudflare` after the clients pass their checks.
4. Confirm that a private browser window receives the Cloudflare Access challenge, and that a permitted passkey opens the console without an OpenConnector password prompt.
5. Confirm that the `workers.dev` origin rejects console requests and anonymous runtime requests.
   Check that each client can use its issued key and that the retired shared credential receives HTTP 401.
6. After the rollback window closes, delete the obsolete `OOMOL_CONNECT_RUNTIME_TOKEN` and `OOMOL_CONNECT_ADMIN_TOKEN` secrets from the Worker.
   Keep the encryption key.
   Check the console and issued keys again after the secret deletion.

The Worker checks the Access assertion signature, issuer, audience, expiry, and user identity.
Browser mutations also require the console origin.
If Access settings are missing, administrator requests fail closed.
Issued runtime API keys continue to work.
Sign out of the console at `https://open-connector.totto2727.dev/cdn-cgi/access/logout`.

Provider OAuth apps that use an explicit callback allowlist may need the new console callback URL if the Worker does not have a fixed `OOMOL_CONNECT_ORIGIN`.

See Cloudflare's [application token validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/) and [Workers static assets routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/).

# Deploy the OpenConnector console behind Cloudflare Access

Use `https://open-connector.totto2727.dev` for the Web Console and administrator APIs.
The existing `https://open-connector.totto2727.workers.dev` origin still accepts runtime bearer tokens for the CLI and existing MCP clients.
It does not accept the old administrator password or serve the Web Console.

## Roll out the change

1. Apply the Cloudflare stack in `totto2727-org/infra` and confirm the OpenConnector Access application allows only the approved passkey group.
2. Set the Worker secret `OPEN_CONNECTOR_ACCESS_AUDIENCE` to the stack's `openConnectorAccessAudience` output with `npx wrangler secret put OPEN_CONNECTOR_ACCESS_AUDIENCE`.
3. Deploy with `npm run deploy:cloudflare`.
4. Confirm that a private browser window receives the Cloudflare Access challenge, and that a permitted passkey opens the console without an OpenConnector password prompt.
5. Confirm that the legacy origin rejects console requests and that the current CLI runtime token still works.

The Worker checks the Access assertion signature, issuer, audience, expiry, and user identity.
Browser mutations also require the console origin.
If the audience is missing, administrator requests fail closed. The runtime bearer continues to work.
Sign out of the console at `https://open-connector.totto2727.dev/cdn-cgi/access/logout`.

Keep the previous administrator secret until the sign-in and CLI checks pass and the rollback window closes.
After that, remove `OOMOL_CONNECT_ADMIN_TOKEN` from the Worker. Do not remove or change the runtime or encryption key.
To roll back, redeploy the previous Worker configuration while its administrator secret is still available.
Provider OAuth apps that use an explicit callback allowlist may need the new console callback URL if the Worker does not have a fixed `OOMOL_CONNECT_ORIGIN`.

See Cloudflare's [application token validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/) and [Workers static assets routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/).

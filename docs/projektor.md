# Projektor

The `projektor` provider gives Open Connector authenticated HTTP access to a configured Projektor backend.
It is proxy-only and has no provider-specific actions.

## Configure a connection

In the connection form, enter the **API Token** and **Backend API URL**.
Use the backend URL, not the frontend URL.
A trailing `/api` or `/` is optional.
The provider validates the token with `GET /auth/me` and stores the normalized backend URL.
Use a Projektor personal access token or workspace API token that can access this endpoint.

To configure a connection through the runtime API, send the token and URL together:

```bash
curl -sS -X POST "$OPENCONNECTOR_URL/v1/connections/projektor/connect/api-key" \
  -H "authorization: Bearer $OPENCONNECTOR_ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"apiKey":"<projektor-token>","extra":{"baseUrl":"https://projektor-api.example.com"}}'
```

The Open Connector administrator token manages the connection.
The saved Projektor token authorizes backend requests and is sent as `Authorization: Bearer <token>`.
Caller-supplied authorization cannot replace the saved token.
Use HTTPS for public backends to protect the token in transit.
URLs with embedded credentials, query parameters, or fragments are rejected.

Public backends work by default.
Private-network backends require a self-hosted runtime with `OOMOL_CONNECT_ALLOW_PRIVATE_NETWORK` enabled.
Loopback, reserved, link-local, and cloud-metadata targets remain blocked.
Cloudflare Workers cannot route to private-network addresses.
Redirects are not followed, including redirects to a frontend or login page.

## Call the API

Give the runtime token an `allowedProxies` grant for `projektor`.
If `allowedConnections` is nonempty, include the saved connection ID.
Select the saved connection with `x-oo-connector-app-id: <connection-id>` for raw runtime HTTP requests.
For `oo`, run `oo connector apps projektor --json` to find its connection name and pass `--connection-name`.

```bash
oo connector proxy projektor --connection-name '<connection-name>' --endpoint /api/workspaces --method GET --json
```

The provider supports `/api` and its descendants, plus the exact `/auth/me` endpoint.
OAuth endpoints, token-management endpoints, browser login, and streaming MCP are not exposed.
Proxy responses use the normal runtime envelope and the shared 20 MiB response limit.
The buffered native route is also available at `/v1/passthrough/projektor/api/...` for compatible HTTP clients.
It is not a streaming or binary transport.

For a personal token with access to several workspaces, pass `X-Workspace-Slug` when an endpoint requires a workspace selection:

```bash
oo connector proxy projektor \
  --connection-name '<connection-name>' \
  --endpoint /api/issues \
  --method GET \
  --headers '{"X-Workspace-Slug":"example"}' \
  --json
```

The saved token's native Projektor scopes, workspace restrictions, and project permissions remain authoritative.
The workspace header does not expand those permissions.
Create and revoke personal tokens in Projektor itself, not through this provider.

## Sources

- [Projektor backend routes](https://github.com/totto2727-org/projektor/blob/main/src/api/index.ts)
- [Projektor identity endpoint](https://github.com/totto2727-org/projektor/blob/main/src/api/routes/auth.ts)
- [Projektor authentication and workspace selection](https://github.com/totto2727-org/projektor/blob/main/src/api/middleware/auth.ts)

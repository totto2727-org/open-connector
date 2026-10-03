# Monid

The Monid provider gives a configured OpenConnector runtime authenticated HTTP access to Monid's documented API at `https://api.monid.ai/v1`.

## Configure a connection

1. Create a Monid API key in the workspace that should authorize requests.
2. Create and validate an OpenConnector `monid` connection with `POST /v1/connections/monid/connect/api-key`.
3. Give a persistent runtime token an `allowedProxies` grant for `monid` before calling the proxy.

```bash
curl -sS -X POST "$OPENCONNECTOR_URL/v1/connections/monid/connect/api-key" \
  -H "authorization: Bearer $OPENCONNECTOR_ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"apiKey":"<monid-api-key>"}'
```

`OPENCONNECTOR_ADMIN_TOKEN` authorizes OpenConnector connection management and is distinct from the saved Monid API key in the JSON body.

The saved Monid key is authoritative for Monid egress: OpenConnector sends it as `Authorization: Bearer <api-key>` and overwrites any caller-supplied `Authorization` header.

The key is workspace-bound, so no `x-workspace-id` or other workspace credential field is configured.

When a persistent runtime token has a nonempty `allowedConnections` list, it must contain the actual connection `id` returned when the Monid connection was created or listed.

An omitted or empty `allowedConnections` list does not restrict connection selection.

## Use the HTTP proxy

Call OpenConnector's `POST /v1/proxy/monid` endpoint, not Monid directly.

Start with the read-only Monid identity endpoint to confirm the configured connection before submitting a billable run.

```bash
curl -sS -X POST "$OPENCONNECTOR_URL/v1/proxy/monid" \
  -H "authorization: Bearer $OPENCONNECTOR_RUNTIME_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"endpoint":"/v1/auth/whoami","method":"GET"}'
```

The runtime token in this request authorizes OpenConnector only; it is never forwarded to Monid.

When multiple Monid connections exist, send `x-oo-connector-app-id: <connection-id>` to select the returned connection ID explicitly.

The runtime token authorizes proxy execution, the administrator token manages secret connections, and the saved Monid key authorizes Monid egress.

No workspace selection header is needed because the saved Monid key is already workspace-bound.

```json
{
  "endpoint": "/v1/run",
  "method": "POST",
  "body": {
    "provider": "apify",
    "endpoint": "/apidojo/tweet-scraper",
    "input": {
      "searchTerms": ["AI"],
      "maxItems": 10
    }
  }
}
```

OpenConnector returns its normal `/v1` JSON envelope.

```json
{
  "success": true,
  "message": "OK",
  "data": {
    "status": 202,
    "headers": {
      "x-request-id": "req-example"
    },
    "data": {
      "runId": "run-123",
      "status": "READY"
    }
  },
  "meta": {
    "service": "monid",
    "executionId": "<local-execution-uuid>"
  }
}
```

The inner `data.status`, `data.headers`, and `data.data` are buffered Monid response details, not HTTP status or headers forwarded transparently to the caller.

For an upstream non-2xx response, OpenConnector returns an outer failure envelope with the upstream status in `data.status`; its bounded error body is represented as text in the outer message rather than structured `data.data` or upstream response headers.

All ten documented API-key HTTP operations are routable through this provider: `GET /v1/auth/whoami`, `GET /v1/auth/workspaces`, `POST /v1/discover`, `POST /v1/inspect`, `POST /v1/run`, `GET /v1/runs`, `GET /v1/runs/:runId`, `POST /v1/runs/:runId/stop`, `GET /v1/wallet/balance`, and `GET /v1/wallet/activities`.

The provider is intentionally proxy-only today, so `actions` is empty and OpenConnector does not expose a provider-specific action schema.

The envelope route is not a native CLI base URL.
Use the separate buffered native route below for compatible CLI requests.

Successful proxy response bodies are buffered by the shared runtime and capped at 20 MiB.

## Native CLI through the gateway

Set `MONID_API_BASE_URL` to `<gateway-origin>/v1/passthrough/monid` for the official `@monid-ai/cli@0.1.7` CLI.
The CLI appends its documented `/v1` paths, and the gateway returns the native status and buffered body without the envelope above.
Start with `whoami --json` before a billable `run`.

```bash
MONID_API_BASE_URL="$OPENCONNECTOR_URL/v1/passthrough/monid" \
XDG_CONFIG_HOME="$MONID_GATEWAY_CONFIG_HOME" \
vpx --silent @monid-ai/cli@0.1.7 whoami --json
```

The selected Monid CLI profile must contain the OpenConnector runtime token, not the saved provider API key.
Monid CLI 0.1.7 does not read `MONID_API_KEY`, and its interactive key-registration command validates Monid-formatted keys.
For gateway use, prepare a dedicated private XDG profile with the runtime token and an active key in the native CLI configuration, rather than replacing the user's normal Monid profile.
The `monid` skill in `totto2727-org/agent` provides `scripts/configure-gateway.mjs` for that isolated profile.
The helper only writes configuration and does not run a local HTTP relay.
Keep credential files mode 0600 and profile directories mode 0700, and never print or commit them.

The route shares the same `allowedProxies` and `allowedConnections` checks as the existing proxy.
Gateway bearer credentials and cookies are stripped before the saved Monid API key is applied.
Transferable headers are preserved where the existing engine allows it, but transport reconstruction and security headers differ.
Requests must contain valid UTF-8, with no adapter-specific size cap or MIME/charset whitelist.
The existing proxy owns method, GET/HEAD body, and path validation.
Responses are buffered, not streamed, and successful bodies retain the existing 20 MiB cap.
SSE, protocol upgrades, non-UTF-8 or compressed requests, and native MCP remain unsupported.
See [the runtime API native passthrough contract](runtime-api.md#buffered-native-http-passthrough) for method, status, header, and error fallbacks.

## Long-running runs

`POST /v1/run` accepts `{ "provider": string, "endpoint": string, "input"?: object }`.

A synchronous run can return a complete run resource, while an asynchronous run returns `202` with a run ID and `READY` status.

Poll `GET /v1/runs/:runId` yourself until Monid reports a terminal status such as `COMPLETED`, `FAILED`, `BLOCKED`, `STOPPED`, or `TIMED_OUT`.

Use `POST /v1/runs/:runId/stop` to request cancellation when supported.

OpenConnector does not poll automatically.

The provider proxy uses a 120-second engineering request budget, which can be shortened by a caller or deployment deadline.

That budget is not an official maximum Monid run lifetime: Monid documents that most asynchronous runs finish in 1 to 120 seconds, while its CLI `--wait` option defaults to a separate 300-second polling timeout.

## Native MCP

Monid's native Streamable HTTP MCP endpoint is `https://mcp.monid.ai/v1` and has its own interactive authentication flow.

It is separate from this OpenConnector provider proxy.

## References and verification status

- [Monid API overview](https://monid.ai/docs/api/overview)
- [Discover API](https://monid.ai/docs/api/discover)
- [Inspect API](https://monid.ai/docs/api/inspect)
- [Run API](https://monid.ai/docs/api/run)
- [Run polling API](https://monid.ai/docs/api/runs/get)
- [Stop run API](https://monid.ai/docs/api/runs/stop)
- [Monid MCP quickstart](https://monid.ai/docs/guide/quickstart-mcp)
- [Monid CLI run reference](https://monid.ai/docs/cli/run)

The integration has focused tests for request forwarding, authentication, validation, response forwarding, and provider boundaries.

Live read-only identity validation through the existing envelope proxy succeeded, and upstream input errors and gateway authentication failures were observed.
The native route has public server integration coverage with outbound transport fixtures, but that is not a deployed Monid run or proof of live search behavior.
Deployment and an official CLI search/fetch acceptance check remain necessary before claiming live end-to-end support.

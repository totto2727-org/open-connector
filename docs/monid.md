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
  "meta": {}
}
```

The inner `data.status`, `data.headers`, and `data.data` are buffered Monid response details, not HTTP status or headers forwarded transparently to the caller.

For an upstream non-2xx response, OpenConnector returns an outer failure envelope with the upstream status in `data.status`; its bounded error body is represented as text in the outer message rather than structured `data.data` or upstream response headers.

All ten documented API-key HTTP operations are routable through this provider: `GET /v1/auth/whoami`, `GET /v1/auth/workspaces`, `POST /v1/discover`, `POST /v1/inspect`, `POST /v1/run`, `GET /v1/runs`, `GET /v1/runs/:runId`, `POST /v1/runs/:runId/stop`, `GET /v1/wallet/balance`, and `GET /v1/wallet/activities`.

The provider is intentionally proxy-only today, so `actions` is empty and OpenConnector does not expose a provider-specific action schema.

This is API-key HTTP access to Monid's documented `/v1` API, not a direct SDK `baseURL`, transparent arbitrary HTTP proxy, MCP transport, SSE transport, native CLI base-URL replacement, OAuth flow, or x402 client.

Successful proxy response bodies are buffered by the shared runtime and capped at 20 MiB.

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

No successful live API-key validation or end-to-end Monid run was performed, so this documentation does not claim every Monid behavior was independently verified against a live account.

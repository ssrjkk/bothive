# Webhooks

Webhooks push bot events to **your own** endpoints, so external services can react without polling BotHive.

## Model

| Field | Type | Notes |
|---|---|---|
| `name` | string | display name |
| `url` | string | destination — must be `http(s)` and SSRF-allowed |
| `events` | string[] | non-empty subset of the event types below |
| `botId` | string \| null | `null` = global (all bots); scoped to one bot otherwise |
| `secret` | string \| null | optional HMAC secret |
| `active` | boolean | toggle delivery |
| `lastStatus` / `lastError` / `lastDeliveredAt` | — | delivery telemetry |
| `deliveryCount` | number | total successful deliveries |

The HMAC `secret` is **never** serialized to the API client — the API only reports `hasSecret: true`.

## Event types

`message` · `follow` · `subscribe` · `donation` · `comment` · `interval` · `status`

## Delivery & signature

Deliveries are POST requests with a JSON body of the shape:

```json
{
  "type": "message",
  "botId": "…",
  "platform": "twitch",
  "timestamp": "…",
  "payload": { }
}
```

When a `secret` is set, the request carries an HMAC header:

```
X-BotHive-Signature: sha256=<hex hmac of the raw body with the secret>
```

Verify it on your side to prove the request really came from BotHive.

## SSRF protection

- By default, deliveries to **private / loopback** IP ranges are blocked at parse time.
- With `WEBHOOK_DNS_CHECK=true`, hostnames are also resolved and blocked if they point at a private range (adds one DNS lookup per delivery).
- `ALLOW_PRIVATE_WEBHOOK_URLS=true` disables all of this — **never** set it in production.
- The same URL rules apply to webhook URLs used inside scripts.

## Delivery telemetry

Every delivery updates `lastStatus` (http status or `error`), `lastError`, `lastDeliveredAt` and `deliveryCount` — visible in the dashboard and the API response, so you can tell at a glance whether a target is healthy.

## Management

- CRUD under `/api/webhooks` (admin-only).
- `POST /api/webhooks/:id/test` fires a synthetic delivery with a custom `sample` body / `eventType`, recording the result — use it to validate the receiver without waiting for a real event.

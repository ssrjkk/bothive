# Script engine

Scripts are the automation layer of BotHive. Each script is attached to a **bot**, fires on a platform **trigger** (or a timer), and runs inside a hardened Node `vm` sandbox.

## Triggers

| Trigger     | Fires when                                       |
| ----------- | ------------------------------------------------ |
| `message`   | the bot receives a chat message                  |
| `follow`    | someone follows the channel/account              |
| `subscribe` | someone subscribes (or gifts a sub)              |
| `donation`  | a donation / bit / super-chat is detected        |
| `comment`   | a comment is received (e.g. YouTube live chat)   |
| `interval`  | on a timer (see `INTERVAL_POLL_MS`, default 30s) |
| `raid`      | the channel is raided (Twitch)                   |
| `host`      | the channel is hosted (Twitch)                   |
| `price`     | a crypto price threshold is crossed              |
| `signal`    | a crypto trading signal fires                    |
| `trade`     | a crypto trade executes                          |

## Actions exposed to scripts

| Action                                     | Platform           | Description                                                 |
| ------------------------------------------ | ------------------ | ----------------------------------------------------------- |
| `sendMessage(chatId, text)`                | telegram           | send a chat message                                         |
| `sendPhoto(chatId, url)`                   | telegram           | send a photo by URL                                         |
| `deleteMessage(chatId, msgId)`             | telegram           | delete a message                                            |
| `say(channel, text)`                       | twitch             | send an IRC message                                         |
| `timeout(channel, user, seconds, reason?)` | twitch             | timeout a viewer                                            |
| `tweet(text)`                              | twitter            | post a tweet                                                |
| `reply(text, tweetId?)`                    | twitter            | reply to the triggering event                               |
| `react(...)`                               | telegram / twitter | react to a message / tweet                                  |
| `log(level, msg)`                          | all                | write to the bot's log stream                               |
| `fetch(url, opts)`                         | all                | SSRF-guarded HTTP fetch (checked on **every** redirect hop) |
| `remember(key, value, ttl)`                | all                | store a value in the bot's Redis-backed memory              |
| `recall(key)`                              | all                | read a value from memory                                    |
| `forget(key)`                              | all                | remove a value from memory                                  |
| `getPrice(symbol)`                         | crypto             | latest price for a trading pair                             |
| `getCandles(symbol, interval?, limit?)`    | crypto             | OHLC candles (`interval` defaults to `15m`)                 |
| `getBalance(asset)`                        | crypto             | exchange balance for one asset                              |
| `getWallet()`                              | crypto             | the bot's generated EVM wallet address                      |
| `marketBuy(symbol, amountUsdt)`            | crypto             | market BUY for a USDT amount                                |
| `marketSell(symbol, quantity)`             | crypto             | market SELL for a base-asset quantity                       |

Actions are only exposed where the platform adapter implements them; calling a missing action fails the script safely.

### Crypto actions

The six `crypto` actions above execute **only while a crypto worker is running**. That worker is opt-in and is not started by `docker compose up`:

```bash
docker compose --profile crypto up -d workers-crypto
```

Without it, a crypto bot's scripts are accepted, saved and scheduled, but nothing consumes the work — the actions never run and no error is raised. See [Crypto trading (opt-in)](../README.md#crypto-trading-opt-in) for the safety defaults (`tradeMode` defaults to `dry`; `maxDailyOrderValueUsdt` defaults to `0`, i.e. no daily cap) before enabling it.

## Script API types

The `api` and `ctx` sandbox globals are typed, so editors give you autocomplete and type-checking while writing scripts. Declarations are generated from `packages/workers/src/script-api.ts` into [docs/script-api.d.ts](script-api.d.ts) — point your editor at that file (or the source of truth) when authoring scripts.

Regenerate after changing the script API:

```bash
npm run script:types
```

## Execution limits

- A per-script `maxExecutionMs` (100–600 000 ms; unset = no global limit) caps the **whole action chain** against a wall-clock deadline: once the deadline passes, the script stops between steps and the worker logs a warning. It is validated at save time, so scripts can't accidentally run forever.
- Each single custom action also has its own sandbox timeout, and infinite loops are killed by a hard timeout.
- Per-bot `rateLimitPerMinute` in the bot config limits how many actions that bot can dispatch per minute (enforced via Redis across the whole worker fleet), on top of the global per-window limit.

## Sandbox guarantees

- Scripts run in a Node `vm` context — the host realm's `process`, `Buffer`, `require` etc. are **not** reachable, and return values are sanitized before they cross back.
- `fetch` is wrapped so every redirect is re-checked against the SSRF allow-list (no private / loopback addresses).
- Infinite loops are killed by a hard timeout.
- Scripts have a **cooldown** per bot so a failing script cannot hammer the platform.

## Save-time safety checks

The API validates a script's config before it is stored (and again on backup import):

- **catastrophic regex** filters are rejected (e.g. unbounded `. *` patterns that could freeze the worker).
- **custom code** attempting to escape the sandbox (`constructor.constructor`, `process`, `globalThis` tricks, …) is rejected.
- **webhook URLs** inside scripts must pass the same SSRF rules as the Webhooks feature.

## Management

- **Manual CRUD** — `POST /api/scripts`, `GET/PATCH/DELETE /api/scripts/:id`.
- **Generator** — `GET /api/scripts/patterns` lists reusable prompt patterns; `POST /api/scripts/generate` turns a pattern + params into a draft script you can review before enabling.
- **Test** — `POST /api/scripts/:id/test` publishes a synthetic event (`sample`) straight into the bot's trigger channel, letting you dry-run a script without waiting for a real event.
- **Bulk ops** — `POST /api/bulk/scripts` with `enable` / `disable` / `delete`.

Changes are broadcast to workers over Redis pub/sub, so a script edit takes effect without restarts.

# Script engine

Scripts are the automation layer of BotHive. Each script is attached to a **bot**, fires on a platform **trigger** (or a timer), and runs inside a hardened Node `vm` sandbox.

## Triggers

| Trigger | Fires when |
|---|---|
| `message` | the bot receives a chat message |
| `follow` | someone follows the channel/account |
| `subscribe` | someone subscribes (or gifts a sub) |
| `donation` | a donation / bit / super-chat is detected |
| `comment` | a comment is received (e.g. YouTube live chat) |
| `interval` | on a timer (see `INTERVAL_POLL_MS`, default 30s) |
| `status` | the bot's status changes |

## Actions exposed to scripts

| Action | Platform | Description |
|---|---|---|
| `sendMessage(chatId, text)` | telegram | send a chat message |
| `sendPhoto(chatId, url)` | telegram | send a photo by URL |
| `deleteMessage(chatId, msgId)` | telegram | delete a message |
| `say(channel, text)` | twitch | send an IRC message |
| `timeout(user, seconds)` | twitch | timeout a viewer |
| `tweet(text)` | twitter | post a tweet |
| `reply(text)` | twitter / youtube | reply to the triggering event |
| `react(...)` | youtube | react to a live-chat event |
| `log(level, msg)` | all | write to the bot's log stream |
| `fetch(url, opts)` | all | SSRF-guarded HTTP fetch (checked on **every** redirect hop) |
| `remember(key, value, ttl)` | all | store a value in the bot's Redis-backed memory |
| `recall(key)` | all | read a value from memory |
| `forget(key)` | all | remove a value from memory |

Actions are only exposed where the platform adapter implements them; calling a missing action fails the script safely.

## Execution limits

- A per-script `maxExecutionMs` (100–600 000 ms, default 60 s) caps the **whole action chain** against a wall-clock deadline: once the deadline passes, the script stops between steps and the worker logs a warning. It is validated at save time, so scripts can't accidentally run forever.
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

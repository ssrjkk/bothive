# ADR-0003: Platform credentials encrypted at rest

- **Status:** Accepted
- **Date:** 2026-08
- **Deciders:** maintainer

## Context

Bot accounts hold platform credentials (Telegram bot tokens, Twitch OAuth tokens + client secrets, YouTube/Twitter API keys). These are stored in Postgres (`Account.token`, `Account.secret`, `Proxy.url`, …). A database dump or backup therefore contains live platform credentials. Additionally, one `ENCRYPTION_KEY` must be shared by the API (which writes credentials) and the workers (which read and use them to connect).

## Decision

- Encrypt credential fields at rest with **AES-256-GCM** using a 32-byte hex `ENCRYPTION_KEY` (Node `crypto`, `packages/core/src/utils/crypto.ts`): `iv:tag:ciphertext`, prefixed with `enc:` by `credential-cipher.ts`.
- The API encrypts on write (`encryptCredential`), workers and API decrypt on read (`decryptCredential`); plaintext values are treated as "already encrypted/imported" and returned unchanged on round-trip (backup import path).
- `ENCRYPTION_KEY` is mandatory in production (`validateApiSecrets` throws at startup if missing/weak/default); `validateWorkerSecrets` enforces the same for workers. Default/weak values are rejected.
- If `ENCRYPTION_KEY` is missing, `encryptCredential` logs a warning and stores plaintext (dev-only convenience) — never silently in production.
- Decryption failure returns `null` and logs, so a bot with an undecryptable token fails to connect instead of crashing the process.

## Consequences

- **Positive:** backups are not a plaintext leak of platform tokens; credentials never appear in logs; crypto is audited/standard (AES-256-GCM with per-value IV).
- **Negative:** key management burden — losing `ENCRYPTION_KEY` permanently makes stored credentials undecryptable; rotating it requires re-encrypting every credential (out of scope today, documented in `docs/security.md`).
- **Risk:** the key must be provisioned identically to API and all workers (shared env var), and to the backup/restore workflow if off-site restore is ever needed on another host.

## Alternatives considered

- Plaintext columns — rejected: leaks tokens in dumps/logs.
- Per-account KMS wrapping (AWS KMS, Vault) — rejected: single-node self-hosted deploy has no KMS; `ENCRYPTION_KEY` keeps infra requirements minimal while supporting a future move (keys could be stored in a secret manager instead of env).

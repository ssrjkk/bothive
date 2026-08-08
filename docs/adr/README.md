# Architecture Decision Records

ADR records document significant technical decisions and their context. Each entry is immutable once accepted — corrections are new ADRs, not edits.

| ID                                                  | Title                                                             | Status   |
| --------------------------------------------------- | ----------------------------------------------------------------- | -------- |
| [0001](0001-prisma-config-driven-client.md)         | Prisma 7 config-driven client, compiled to JS                     | Accepted |
| [0002](0002-worker-per-platform-leader-election.md) | One BullMQ worker process per platform + leader election          | Accepted |
| [0003](0003-encrypted-credentials-at-rest.md)       | Platform credentials encrypted at rest (AES-256-GCM)              | Accepted |
| [0004](0004-prometheus-and-single-node-compose.md)  | Prometheus metrics + Alertmanager on a single-node compose deploy | Accepted |

# Inventory & Barcode Microservices — Architecture

**Stack:** .NET 10, Aspire 13, PostgreSQL, MongoDB, Redis, RabbitMQ + Wolverine, Kubernetes (later), Linkerd/Istio (later)
**Consistency model:** Strong consistency for stock reads/writes; eventual consistency for reporting/notifications
**Scope:** Practice project — designed to expose real distributed-systems tradeoffs, not just CRUD-over-network

## Core decision
Inventory Service owns stock truth. It is queried live (gRPC, direct to Postgres — no cache on this path). Nothing else is allowed to cache or replicate that number as authoritative.

## Service boundaries

| Service | Responsibility | Data store | Consistency |
|---|---|---|---|
| Catalog | Items, categories, barcodes | PostgreSQL | Eventual (cacheable) |
| Inventory | Stock levels, movements, reservations | PostgreSQL | Strong (source of truth) |
| Scan Gateway | Barcode → item, routes to Catalog/Inventory | Stateless | N/A (orchestrator) |
| Staff/Auth | Users, roles, audit log | PostgreSQL | Strong |
| Notification | Low-stock alerts | MongoDB | Eventual |
| Reporting | Trends, dashboards | MongoDB | Eventual |
| Purchase Order *(stretch)* | Restock saga | PostgreSQL | Strong (saga-coordinated) |

## Communication

| Interaction | Protocol |
|---|---|
| Client → Scan Gateway | REST |
| Client → dashboard query | GraphQL (HotChocolate) |
| Scan Gateway → Catalog / Inventory | gRPC |
| Inventory → broker (movement happened) | Async event via Wolverine (transactional outbox) |
| Notification/Reporting ← broker | Async consumption |

## Tech stack decisions (with rationale, so future-me remembers why)

- **.NET 10** — LTS through Nov 2028; .NET 8/9 both end support Nov 2026.
- **Aspire 13** (not raw Docker Compose/k3d for local dev) — AppHost models all resources in C#, gives OTel/dashboard tracing from day one instead of bolted on at the end.
- **Wolverine, not MassTransit** — MassTransit v8 moved to a commercial license for production use; Wolverine is the free (MIT) equivalent with built-in transactional outbox and source-generated handlers.
- **GraphQL only for the dashboard query** — everywhere else (scan lookup) stays REST; GraphQL solves the "aggregate multiple services into one client-shaped query" problem, nothing else.
- **gRPC for all internal service-to-service calls** — including from the GraphQL resolvers into Catalog/Inventory, so there's one consistent internal-call pattern.
- **Redis only for barcode→item resolution caching** — never on the live-stock-read path.
- **Monorepo, one `.sln`/`.slnx`** — Aspire's AppHost needs visibility into every service project; splitting into many repos adds friction with no benefit at this scale.

## Build order
1. Aspire AppHost + ServiceDefaults skeleton ✅
2. Catalog.Api + Inventory.Api (REST, Postgres) — get strong-consistency stock logic right first
3. Concurrency tests against the stock-decrement logic
4. Scan Gateway
5. Redis (barcode caching only)
6. GraphQL dashboard (HotChocolate)
7. Convert internal calls to gRPC
8. RabbitMQ + Wolverine + outbox + Notification Service
9. Staff/Auth + JWT
10. Containerize, move to k3d/Kubernetes
11. Service mesh (Linkerd), mTLS, canary deploy
12. OTel/Jaeger/Prometheus for the k8s environment (Aspire already gives this locally)
13. *(Stretch)* Purchase Order saga (Wolverine sagas)

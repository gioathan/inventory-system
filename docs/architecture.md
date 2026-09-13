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
| Scan Gateway / Dashboard resolvers → Catalog / Inventory | gRPC |
| Inventory → broker (movement happened) | Async event via Wolverine (transactional outbox) |
| Notification/Reporting ← broker | Async consumption |

## Tech stack decisions (with rationale, so future-me remembers why)

- **.NET 10** — LTS through Nov 2028; .NET 8/9 both end support Nov 2026.
- **Aspire 13** (not raw Docker Compose/k3d for local dev) — AppHost models all resources in C#, gives OTel/dashboard tracing from day one instead of bolted on at the end.
- **Wolverine, not MassTransit** — MassTransit v8 moved to a commercial license for production use; Wolverine is the free (MIT) equivalent with built-in transactional outbox and source-generated handlers.
- **GraphQL only for the dashboard query** — everywhere else (scan lookup) stays REST; GraphQL solves the "aggregate multiple services into one client-shaped query" problem, nothing else.
- **gRPC for all internal service-to-service calls** — including from the GraphQL resolvers into Catalog/Inventory, so there's one consistent internal-call pattern. Covers everything Scan Gateway/Dashboard actually call internally: reads (barcode lookup, list items, get/list stock, session summary) and writes alike (CreateItem, CreateCategory, ReceiveStock, AdjustStock). Contracts (`.proto` files) live in `src/Shared/Grpc.Contracts`, referenced by both server and client projects — one definition, not duplicated per consumer.
- **Catalog/Inventory's REST surface was trimmed to just what gRPC doesn't cover** — every REST route that duplicated a gRPC RPC already called internally (items, categories, stock read/receive/adjust, session summary) was removed rather than kept as a second, unused way to reach the same logic; Catalog.Api is now gRPC-only. What's left on Inventory is genuinely admin-only with no gRPC equivalent: `POST /stock` (exact-quantity creation, used by the concurrency test's fixture setup), the restock-session open/close/list/current endpoints, and `GET /movements` for raw ledger queries.
- **GraphQL stays query-only, no exceptions** — categories were briefly considered as a GraphQL mutation (the "it's rare, low-stakes setup data" argument), but the value of "GraphQL never writes, Scan Gateway is the only front door for writes" as an absolute rule outweighs the convenience of a one-off exception. `POST/GET /categories` live on Scan Gateway instead, proxying to Catalog over gRPC like every other Scan Gateway write.
- **Redis only for barcode→item resolution caching** — never on the live-stock-read path. Lives in Scan Gateway (cache-aside, TTL-based), not inside Catalog — it's a property of the barcode-routing step, not of Catalog's own storage. Catalog 404s are never cached, so a newly-created item resolves immediately. TTL-only for now (no explicit invalidation) because Catalog has no update/delete endpoints yet; revisit once it does.
- **Monorepo, one `.sln`/`.slnx`** — Aspire's AppHost needs visibility into every service project; splitting into many repos adds friction with no benefit at this scale.

## Domain model & real-world intake workflow

The real usage pattern this system is built around: scan/generate a code for an item, give it a category/name/price/image, and add quantity — if the code already exists, just add to its quantity instead.

- **`Item` (Catalog)** — `Sku`, `Name`, `Barcode`, `Price` (decimal), `ImageUrl` (nullable string; storage — likely Cloudflare R2 — deferred, but the column exists now so it isn't a migration-shaped afterthought later), `CategoryId`.
- **Barcode/Sku generation** — the system always generates the code for new items (a random 12-digit numeric string, retried on the vanishingly-rare collision via the DB's own unique constraint — see `ItemCreationService`). Sku defaults to the same value as the generated barcode unless explicitly supplied, since in this system the code *is* the item's identifier. Explicitly-supplied barcodes/skus (e.g. registering a real product's existing manufacturer barcode) are still supported via the REST/gRPC `CreateItem` contract; only the Scan Gateway intake flow always omits them.
- **Two distinct write flows, not one "upsert"** — because "new item" and "restock existing item" need different inputs and different failure modes:
  - `POST /items/intake` (Scan Gateway) — brand-new item, no barcode known yet. Takes name/price/category/image/quantity, never a barcode. Creates the Catalog item (generating its code) then gives Inventory the initial quantity via `ReceiveStock`. Returns the generated barcode.
  - `POST /scan/{barcode}/receive` (Scan Gateway) — restocking something already in the system. Takes only quantity; 404s on an unrecognized barcode rather than silently creating an item with no name/price.
- **`ReceiveStock` (Inventory)** — a third stock-mutation path alongside the existing `create` (fails if exists) and `adjust` (fails if it doesn't, concurrency-guarded floor at zero): an atomic upsert-add (`INSERT ... ON CONFLICT (Sku) DO UPDATE SET QuantityOnHand = QuantityOnHand + $qty`) — creates the row at the given quantity if it doesn't exist, otherwise adds to what's there, in one statement so two concurrent "receive" calls for a brand-new Sku can't race each other.
- **Barcode visualization/decode** — not yet implemented, but the design is settled: `Barcode` is just a string encoded into a scannable image via a symbology (Code128 for arbitrary strings, or EAN-13 if real GS1-registered codes matter later) using a library like ZXing.Net — a natural future Catalog.Api endpoint (`GET /items/by-sku/{sku}/barcode-image`). Decoding happens client-side (phone camera / a JS scanning library), which then calls `GET /scan/{barcode}` — already built. Server-side image decoding isn't needed unless photos get uploaded instead of live-scanned.

## Build order
1. Aspire AppHost + ServiceDefaults skeleton ✅
2. Catalog.Api + Inventory.Api (REST, Postgres) — get strong-consistency stock logic right first ✅
3. Concurrency tests against the stock-decrement logic ✅
4. Scan Gateway ✅
5. Redis (barcode caching only) ✅
6. GraphQL dashboard (HotChocolate) ✅
7. Convert internal calls to gRPC ✅
8. RabbitMQ + Wolverine + outbox + Notification Service
9. Staff/Auth + JWT
10. Containerize, move to k3d/Kubernetes
11. Service mesh (Linkerd), mTLS, canary deploy
12. OTel/Jaeger/Prometheus for the k8s environment (Aspire already gives this locally)
13. *(Stretch)* Purchase Order saga (Wolverine sagas)

## Stock movement ledger & restock sessions

Added ahead of step 8, inside Inventory.Api (not deferred to the future event-driven Reporting
service) since it only needs Inventory's own data, not cross-service events yet.

- **`StockMovement`** — append-only row per quantity change (Sku, Delta, Reason, Timestamp,
  ResultingQuantity, nullable SessionId). `StockItem.QuantityOnHand` remains the current total;
  this table is the history the total alone can't answer ("how much did I have 3 restockings
  ago" is a range query over this table, not a special "since last count" case).
- **`RestockSession`** — an explicit, admin-opened/closed window (only one open at a time,
  enforced by a partial unique index on `ClosedAt IS NULL`, not just app logic). Every
  receive/adjust made while a session is open is auto-tagged with it server-side — Scan Gateway
  and Dashboard never need to know a session exists, let alone pass its id.
- **`GET /restock-sessions/{id}/summary`** (Inventory, also exposed over gRPC as
  `GetSessionSummary`) — per-Sku Restocked/Sold/NetDelta from that session's `OpenedAt` through
  right now — **time-bounded by when the session opened, not tag-filtered by its `SessionId`**.
  A closed session still answers "since this restocking, how much has moved, as of today," not
  a snapshot frozen at whenever it was closed — that's the whole point of picking "restocking
  #7" as your starting line rather than a raw date. `Sold` only counts `Reason == Sale`
  movements, so a `ManualAdjust` correction never gets counted as a sale. 404s if the session id
  doesn't exist.
- **Revenue lives in Dashboard, not Inventory** — Inventory's ledger only ever knows quantities,
  never money (same boundary as everywhere else: Inventory owns stock truth, Catalog owns
  price). Dashboard's new `sessionReport(sessionId)` GraphQL query is the join point: it calls
  Inventory's `GetSessionSummary` and Catalog's `ListItems` in parallel and multiplies
  `Sold × Price` in memory — the same fan-out-and-join pattern `GetItems` already uses.

## Scan-and-sell (two-step, never implicit)

The seller-facing UX is: scan a barcode, see current quantity in a popup, then either close
(just checking) or pick a quantity and confirm a sale. That maps directly onto two endpoints
with no overlap in effect:

- **`GET /scan/{barcode}`** — always a pure read, no matter how many times it's called. This is
  what populates the popup. Scanning to merely check stock has zero side effects by construction,
  not by convention — there's no code path from this endpoint that touches `StockItems`.
- **`POST /scan/{barcode}/sell`** *(new)* — the only thing that reduces stock from a scan.
  Fires only on the seller's explicit confirm, with whatever quantity they picked (defaults to
  1). Resolves barcode → Sku via the same cached Catalog lookup as the GET, then calls
  Inventory's new `AdjustStock` RPC with `Reason.Sale` and a negative delta.
- **`AdjustStock`** (Inventory, gRPC-only — the REST `/adjust` twin was removed once this and
  Scan Gateway's scan-to-sell were both confirmed working) — the same atomic floor-at-zero guard
  as everywhere else, implemented once in `StockReceivingService.AdjustStockAsync`. Selling more
  than what's on hand returns `FailedPrecondition`, so two sellers racing to sell the last unit
  can't both succeed.

No UI exists yet for this — the popup/confirm flow described above is a client-side
responsibility for whatever eventually calls these two endpoints.

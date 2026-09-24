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
8. RabbitMQ + Wolverine + outbox + Notification Service ✅
9. Staff/Auth + JWT ✅
10. Containerize, move to k3d/Kubernetes ✅ (all 6 services + Postgres×3/RabbitMQ/MongoDB/Redis — see `k8s/README.md`)
11. Service mesh (Linkerd), mTLS ✅, canary deploy ✅ (see `k8s/README.md`)
12. OTel/Jaeger for the k8s environment ✅ (Prometheus already covered by Linkerd's `viz` extension — see below; Aspire already gives this locally)
13. *(Stretch)* Purchase Order saga (Wolverine sagas) ✅

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

## Staff/Auth & JWT

A new `Staff.Api` service (Postgres `staffdb`) is the sole issuer of JWTs; every other service
only validates. Two roles, no more: **Admin** (staff management, audit log, category creation,
manual stock corrections, restock sessions, low-stock alerts) and **Seller** (scan/sell/intake —
the shop-floor day-to-day). Two policies compose them: `SellerOrAdmin` and `AdminOnly`.

- **Scope is everything, not just the front door** — every endpoint on every service requires a
  valid JWT, including the internal gRPC calls Scan Gateway/Dashboard make to Catalog/Inventory.
  A stolen service-to-service call is just as much a hole as a stolen browser session in a
  single-VM local setup with no network segmentation between services, so there's no "internal
  therefore trusted" carve-out. ASP.NET Core `[Authorize]` on a gRPC service class/method combines
  AND-wise with any class-level attribute — used to make e.g. `CreateCategory`/`ListCategories`
  Admin-only while the rest of `CatalogGrpcServiceImpl` stays `SellerOrAdmin`.
- **Category creation goes through Scan Gateway (REST), not GraphQL** — Dashboard's GraphQL
  surface stays strictly query-only, no mutation exceptions, even for an Admin-only action.
- **Bearer token forwarding** — Scan Gateway and Dashboard both call Catalog/Inventory over gRPC
  on the caller's behalf, so both use `AddCallCredentials` on their gRPC clients to re-attach the
  inbound request's `Authorization` header to the outbound gRPC call (`IHttpContextAccessor` reads
  the original header). Nothing is re-issued or impersonated — the same token just rides along.
- **Two real bugs found wiring this up, both in TECH_DEBT.md** — `UseHttpsRedirection()` silently
  strips the `Authorization` header on the http→https redirect it issues (removed from every
  service instead); and a corrupted Postgres-backed Wolverine node-tracking row left over from
  crash/restart cycles made Inventory.Api fail to start at all, which looked exactly like a JWT
  bug (every call to it just hung) but had nothing to do with auth.

## Item discounts (batch, non-destructive)

Lets an admin take a percentage off a batch of items at once for a "low prices period" —
e.g. 20% off 10 SKUs — without touching their base `Price`.

- **`Item.DiscountPercentage`** (Catalog, nullable `double`, strictly between 0 and 1) sits
  alongside `Price`, never replaces it. Effective price = `Price × (1 - DiscountPercentage)`,
  computed wherever an item is read (`ItemReply.EffectivePrice`) so every caller (Scan Gateway's
  scan popup, Dashboard) sees the same number without re-deriving the multiplication. Removing a
  discount just clears the field back to `null` — an exact, lossless revert to `Price`, which is
  the reason it's a separate field instead of overwriting `Price` directly.
- **`ApplyDiscount`/`RemoveDiscount`** (Catalog gRPC, Admin-only) take a list of SKUs and are
  all-or-nothing: a typo'd SKU fails the whole batch instead of silently discounting a subset.
  Fronted by Scan Gateway's `POST /items/discount` and `POST /items/discount/remove` — same
  "Catalog is gRPC-only internally, Scan Gateway is the REST admin surface" pattern as categories.
- **A single global sale, not scheduled** — this is a manually-triggered admin action with no
  start/end date or history of past discounts, matching how restock sessions started simple (see
  above). If discounts ever need scheduling or an audit trail of past sales, that's a dedicated
  entity; not worth it while it's an admin flipping a value on and off by hand.
- **Scan Gateway's item cache is invalidated on apply/remove** — a discount changes the price a
  cached barcode→item lookup would return, so `CatalogApiClient` explicitly clears the affected
  entries instead of waiting out the 5-minute TTL (see `InvalidateCacheAsync`).
- **SessionReport revenue uses `EffectivePrice`**, not `Price` — consistent with the existing
  "revenue uses today's Catalog price, not price-at-time-of-sale" tradeoff already in
  TECH_DEBT.md; a discount is just today's price being lower than it was.

## Kubernetes (Step 10) — local k3d

Every service now also runs as a plain-YAML Kubernetes deployment (`k8s/`), rehearsed locally
against a `k3d` cluster (k3s packaged as Docker containers — see `k8s/README.md` for the
build/import/apply workflow). This is deliberately **not** a replacement for Aspire's `AppHost.cs`
day-to-day — Aspire stays the fast inner loop; this is the "how does this actually run on real
Kubernetes" rehearsal, one step closer to production than local dev, one step short of it.

- **Each service gets its own Postgres instance**, not one shared server split into three
  databases like Aspire's local setup. Full storage isolation per service (no shared blast
  radius) at the cost of three small containers instead of one — a defensible real
  microservices tradeoff, not just a k8s quirk.
- **No TLS at the *application* level, mTLS at the *network* level since Step 11** — every
  service still dials plain `http://` internally (Catalog.Api/Inventory.Api's gRPC endpoints are
  genuinely cleartext HTTP/2 as far as .NET is concerned), but Linkerd now transparently encrypts
  that traffic on the actual wire between pods. See the Service Mesh section below for why those
  are two different, both-true statements. This still has two concrete consequences, documented
  as real bugs in TECH_DEBT.md: Catalog.Api/Inventory.Api need a dedicated HTTP/2-only Kestrel
  endpoint for gRPC (there's no ALPN without app-level TLS to negotiate HTTP/1.1-vs-2 on one
  port), and every gRPC client needs `UnsafeUseInsecureChannelCallCredentials = true` — permanently,
  confirmed by testing, not just until Step 11 — or `GrpcChannel` refuses to send the bearer token
  at all over what it considers an insecure channel.
- **gRPC client addresses are config-driven, not hardcoded** — `ScanGateway.Api`/`Dashboard.Api`
  read `GrpcClients:CatalogApi`/`GrpcClients:InventoryApi` from config, defaulting to Aspire's
  `https://catalog-api` shape when unset. The k8s manifests override both to `http://catalog-api`
  or `http://inventory-api` (plain k8s Service DNS, no scheme mismatch).
- **No equivalent of Aspire's `WaitFor()`** — a plain Deployment has no built-in "don't start
  until this other thing is ready" primitive. In practice this surfaced as each service
  restarting once on first boot (RabbitMQ/Postgres not yet accepting connections), self-healed by
  Wolverine's/Npgsql's own retry logic — not something this project has needed to solve
  explicitly yet, but the real fix (an initContainer that polls the dependency, or a Helm chart's
  dependency ordering) is worth knowing about before this ever needs to be reliable rather than
  "restarts once and then it's fine."

## Service mesh (Step 11) — Linkerd, mTLS

Linkerd is installed cluster-wide (`linkerd install --crds`, `linkerd install`, `linkerd viz
install` for the observability extension), and the `inventory-system` namespace is annotated
`linkerd.io/inject: enabled` (in `k8s/namespace.yaml`) so every Pod created there automatically
gets a `linkerd-proxy` sidecar — every one of the 12 Pods now runs `2/2`, not `1/1`.

- **mTLS is real, verified with `linkerd viz edges`** — every edge between meshed Pods
  (`scan-gateway → catalog-api`, `catalog-api → postgres-catalog`, even Prometheus scraping every
  Pod's metrics) shows `SECURED: √`. This is genuine encryption on the wire between nodes,
  protecting against something like a compromised network tap.
- **This does *not* mean the application is doing TLS.** Tested directly: removed
  `UnsafeUseInsecureChannelCallCredentials` from Scan Gateway's gRPC clients with the mesh fully
  installed and got the identical `InvalidOperationException` as before Linkerd existed. The
  sidecar intercepts traffic via iptables rules *inside* the Pod's network namespace — completely
  invisible to the .NET process, which still dials plain `http://catalog-api` and has `GrpcChannel`
  make its secure/insecure decision purely from that URI's scheme. Real wire encryption and
  "does the app think it's using TLS" are two independent facts; Step 10's workaround stays
  permanent. Full writeup in TECH_DEBT.md.
- **`linkerd viz`** (Prometheus + a small dashboard) is what makes any of this checkable at all —
  `linkerd viz stat deploy -n inventory-system` shows live RPS/success-rate/latency per Pod
  without any code changes, which is normally Step 12's job. Worth remembering that a mesh's
  observability extension gets you partway there before Step 12's own OTel/Prometheus setup.
- **Canary deploy: `catalog-api-v1`/`catalog-api-v2` behind a weighted `GRPCRoute`** — the apex
  `catalog-api` Service has no selector of its own; Linkerd's destination controller answers
  "where does traffic for catalog-api go" using the `GRPCRoute`'s weighted `backendRefs` instead
  of the Service's own endpoint list, so callers keep dialing plain `catalog-api` and never know
  a split is happening. `GRPCRoute` (Gateway API), not `HTTPRoute` — Linkerd dropped the older
  SMI `TrafficSplit` CRD in favor of Gateway API, and `GRPCRoute` understands gRPC service/method
  semantics rather than matching on raw HTTP paths, matching Catalog.Api's actual protocol.
  Verified real, not just configured: sent 300 requests through scan-gateway at an 80/20 weight
  and watched `linkerd viz stat` converge toward that ratio. See `k8s/README.md`.

## Observability (Step 12) — Jaeger for traces, Linkerd's Prometheus for metrics

Every service already had `OpenTelemetry` wired up in `ServiceDefaults` (it's part of the Aspire
template) — `OTEL_EXPORTER_OTLP_ENDPOINT` just needed pointing at something real once there's no
Aspire dashboard to receive it. `k8s/jaeger.yaml` runs Jaeger's `all-in-one` image (OTLP receiver
+ in-memory storage + query UI in one lightweight container — appropriate for local dev on a
single-node cluster already running 13 other workloads; a real deployment would split these and
use persistent storage).

- **Two gaps found and fixed, both things Aspire quietly does for you locally:**
  1. gRPC client calls weren't traced at all — `AddGrpcClientInstrumentation()` was commented out
     in the ServiceDefaults template scaffold. Since gRPC is the majority of this system's actual
     internal traffic (Scan Gateway/Dashboard → Catalog/Inventory), leaving it off meant every
     trace stopped dead at the calling service. Enabled it (needs the still-beta-only
     `OpenTelemetry.Instrumentation.GrpcNetClient` package — not a deliberate older pin, that's
     genuinely the only version that exists).
  2. Every service showed up in Jaeger as the same generic `unknown_service:dotnet` — Aspire
     sets `OTEL_SERVICE_NAME` automatically per-resource for local dev; nothing does that in
     plain Kubernetes, so each Deployment sets it explicitly now.
- **Verified with a real trace, not just "traces are being sent somewhere"** — one request
  through `GET /categories` shows up as a single connected trace: `GET /categories` (scan-gateway)
  → `catalog.CatalogGrpcService/ListCategories` (the gRPC client call, now visible) →
  `POST /catalog.CatalogGrpcService/ListCategories` (catalog-api's server-side span) →
  `postgresql` (the actual query, auto-instrumented by Aspire's `Npgsql.EntityFrameworkCore`
  component — no extra code needed).
- **Deliberately no second Prometheus** — `linkerd-viz` (Step 11) already runs one scraping every
  meshed pod for RPS/latency/success-rate, which covers Step 12's metrics goal at the request
  level. A dedicated app-level Prometheus is worth adding once there are custom business metrics
  to scrape that Linkerd's own request-level view can't answer — not before.

## Purchase Order saga (Step 13, stretch) — Wolverine sagas

Everything else in this system handles one message/request and is done. A Purchase Order is the
first thing that genuinely needs state to persist across however many messages it takes to reach
a terminal outcome — created, sent to a supplier, then received in however many separate
shipments it actually takes (possibly over several real-world days) before it's fully in. That's
a saga, not a handler: `PurchaseOrder` (in `Inventory.Api`, `Data/PurchaseOrder.cs`) inherits
Wolverine's `Saga` base class, and a static `Start(CreatePurchaseOrder)` plus instance
`Handle(...)` methods drive it through `Draft → Sent → PartiallyReceived → Received` (or
`Cancelled` from `Draft`/`Sent`).

- **Lives inside Inventory.Api, not a new service** — a PO's entire point is driving Inventory's
  own stock, and it reuses the Postgres/Wolverine/outbox wiring already there. A seventh service
  wasn't proportionate for a stretch goal.
- **Fronted the same way as everything else**: new gRPC RPCs on `InventoryGrpcService`
  (`CreatePurchaseOrder`/`SendPurchaseOrder`/`ReceivePurchaseOrderShipment`/`CancelPurchaseOrder`/
  `GetPurchaseOrder`/`ListPurchaseOrders`, all Admin-only), fronted by Scan Gateway's
  `/purchase-orders` REST routes — same "Inventory is gRPC-only, Scan Gateway is the REST
  surface" pattern as everything else. The RPC handler calls `IMessageBus.InvokeAsync(command)`
  (runs the saga in-process and waits for it to finish, unlike `PublishAsync`'s at-least-once
  fire-and-forget) then re-queries the saga's current state to build the reply.
- **`opts.UseEntityFrameworkCoreTransactions()` is what actually makes saga persistence work** —
  registering `InventoryDbContext` with a matching `DbSet<PurchaseOrder>` is necessary but not
  sufficient; without this call Wolverine runs `Start`/`Handle` correctly but never persists what
  they changed, silently. No error — a saga that "worked" and then doesn't exist. Full story in
  TECH_DEBT.md, including a second, nastier issue this uncovered: Wolverine's own transaction
  middleware collides with `StockReceivingService`'s manual transactions (`ReceiveStockAsync`)
  when called from inside a saga's ambient transaction, and separately collides with Npgsql's
  retry-on-failure execution strategy the way our own code already learned to avoid — Inventory's
  `DbContext` now runs with retry disabled as a result, a real trade-off, not free.
- **No `MarkCompleted()` on the terminal transitions** — that tells Wolverine to delete the saga
  row once done, but a Received/Cancelled purchase order should stay queryable forever, same as
  `RestockSession`'s own `OpenedAt`/`ClosedAt` (closed, never deleted). Nothing routes further
  messages to a terminal PO anyway — the `Handle` methods' own guard clauses already refuse to
  touch one — so there's nothing left for "stop persisting this" to actually protect against.
- **Receiving returns events as Wolverine cascading messages, not via the manual outbox** — the
  saga can't call `StockReceivingService.ReceiveStockAsync` (it opens its own transaction, which
  collides with the saga's ambient one); a sibling method does the same upsert+ledger write
  without owning a transaction, and hands back the `StockMovementRecorded` event for `Handle` to
  return, which Wolverine publishes itself once the ambient transaction actually commits — same
  delivery guarantee as the outbox gives everywhere else, just through a different mechanism.

## Image uploads (Cloudflare Images) — optional, behind an interface

`Item.ImageUrl` has always just been an opaque string — swapping who hosts images was already
free before this feature existed. What wasn't free: an admin who has a raw file, not a link yet.
`POST /images` on Scan Gateway (Admin-only, multipart upload) fills that gap by proxying the file
to Cloudflare Images and handing back the delivery URL.

- **Two convergent, independent paths to the same field** — an admin who already has a URL from
  anywhere just passes it straight into `/items/intake`'s existing `imageUrl`, untouched by any of
  this. `/images` only exists for "I have a file, not a link yet"; it's deliberately not a combined
  "create item with an optional file" endpoint, since uploading an image and creating an item are
  separate concerns that happen to produce the same kind of value.
- **Lives in Scan Gateway, not Catalog** — same "admin-managed setup, not a day-to-day seller
  action" bucket as categories/discounts, all fronted from the same service.
- **`ICloudflareImageUploader` behind an interface, not called directly** — the one dependency in
  this whole system with no local/Dockerized equivalent (there's no way to run "Cloudflare" the way
  Postgres/RabbitMQ/Redis/Mongo run locally). The interface is what makes the request-building and
  error-handling logic unit-testable at all: `tests/UnitTests` (new project, sibling to
  `tests/IntegrationTests`, no Aspire.Hosting.Testing, no containers) verifies
  `CloudflareImageUploader` against a fake `HttpMessageHandler` modeling Cloudflare's documented
  response shape. This is a genuine gap, not a stand-in for a real test: nothing here has verified
  behavior against the actual Cloudflare API, since no real account/token exists yet. See
  TECH_DEBT.md.
- **Binds the upload from `HttpRequest` directly, not an `IFormFile` parameter** — minimal APIs
  bind an `IFormFile` parameter by reading the form during argument binding, before the handler
  body runs at all; a request with no multipart body throws ASP.NET Core's own
  `BadHttpRequestException` (still a 400, but an unhandled-exception one) instead of ever reaching
  application code. Found via manual smoke test against a live AppHost, not the unit tests (which
  construct `CloudflareImageUploader` directly and never touch the minimal-API binding layer at
  all). Fixed by checking `HttpRequest.HasFormContentType` and reading `HttpRequest.Form` directly,
  so every invalid-request shape returns the endpoint's own clean message.
- **Degrades to 502, not a startup failure, when unconfigured** — `AddParameter("cloudflare-...",
  "")` (no pinned local-dev literal, unlike every other AppHost parameter) leaves `AccountId`/
  `ApiToken` blank by default; `CloudflareImageUploader` checks for that itself and throws
  `ImageUploadException` only when actually called, which the endpoint maps to `502 Bad Gateway`
  ("this service is a proxy here, and the failure is on the far side"). The rest of the system —
  including `/items/intake`'s own `imageUrl` field — works identically whether or not Cloudflare is
  configured at all.

## CORS — opt-in per service, not global

Until now every caller has been curl, gRPC, or another service — nothing has ever come from a
browser, so no service had a CORS policy. The moment a browser-based frontend (planned: Next.js)
calls these APIs directly, that changes.

- **`AddInventorySystemCors`/`UseInventorySystemCors`** (`ServiceDefaults/Extensions.cs`) — shared
  helpers, same "opt in per service" shape as `AddInventorySystemJwtAuth`, but *not* folded into
  `AddServiceDefaults()` itself. Only the three services a browser calls directly — Staff.Api
  (login), Scan Gateway (scan/sell/receiving/categories/discounts/purchase-orders/images),
  Dashboard.Api (GraphQL) — call them. Catalog.Api, Inventory.Api, and Notification.Api are
  internal gRPC-only services a browser never reaches, so they're deliberately left out rather
  than given a CORS policy that would never apply to anything.
- **Allowed origin(s) come from `Cors:AllowedOrigins`**, comma-separated, wired through a new
  AppHost parameter (`frontend-origin`) so it's configured once and passed identically to all
  three services — same pattern as `jwt-signing-key`. Defaults to `http://localhost:3000` (Next.js's
  own default dev port), so local frontend work needs no extra setup; a real deployment overrides
  it to the frontend's actual URL.
- **No `AllowCredentials`** — auth here is a bearer token in the `Authorization` header, not a
  cookie, so CORS's credentials mode never comes into play. If the frontend later moves to an
  httpOnly-cookie session pattern instead, this policy would need revisiting (credentials mode
  requires an exact origin match, no wildcards).

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

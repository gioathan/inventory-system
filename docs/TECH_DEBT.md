# Tech Debt / Known Shortcuts

Track anything done quick-and-dirty here the moment you do it — future you will not remember the context otherwise.

## Format
- **What:** the shortcut taken
- **Why:** why it was reasonable at the time
- **Fix later by:** what the proper fix looks like, and roughly when it matters

---

## [2026-07-26] Aspire dashboard using default/insecure local settings
- **What:** No auth hardening on the Aspire dashboard, default local URLs.
- **Why:** Local-only dev tool, not a security concern at this stage.
- **Fix later by:** N/A — this only matters if the dashboard is ever exposed beyond localhost, which it shouldn't be.

## [2026-08-08] Inventory.Api applies EF migrations at startup, gated on Development only
- **What:** `Program.cs` calls `db.Database.Migrate()` inside the `IsDevelopment()` block on every app startup, instead of running migrations as a separate step.
- **Why:** Convenient for local dev with Aspire — no manual `dotnet ef database update` step to remember, and it's gated so it can never run in a non-dev environment as written.
- **Fix later by:** Before any non-local deployment (step 10, containerize/k8s), replace with a proper migration step (EF Core migration bundle or a one-off job) run before the app starts, not from inside the app itself.

## [2026-08-08] NU1903 vulnerability warning on Microsoft.OpenApi 2.0.0 (transitive)
- **What:** `dotnet build` reports a known high-severity advisory (GHSA-v5pm-xwqc-g5wc) for Microsoft.OpenApi 2.0.0, pulled in transitively by the webapi template's OpenAPI support.
- **Why:** Not pinned deliberately — it's whatever version `dotnet new webapi` referenced; only matters for OpenAPI doc generation in dev, not a runtime attack surface for this stage.
- **Fix later by:** Check for an updated Microsoft.OpenApi package before this project is ever exposed beyond local dev; revisit alongside other services once more are scaffolded and dependency versions are audited together.

## [2026-08-08] Running `dotnet test` can kill a manually-running `dotnet run` AppHost's Postgres
- **What:** Aspire derives container names deterministically from the resource config (e.g. `postgres-uqkwxjbd`), not randomized per process. Running the Aspire.Hosting.Testing-based concurrency test while the AppHost was already running manually via `dotnet run` caused the test's teardown to stop the same-named Postgres container the manual instance depended on, killing its database out from under it (the API process itself stayed up, just lost its DB).
- **Why:** Not something we chose — it's how Aspire's local container naming/reuse behaves. Only surfaced because we happened to run tests while a manual dev session was also up.
- **Fix later by:** No real fix needed; just a habit to keep — stop any manually-running AppHost before running the test suite locally (or accept you'll need to restart it after). Worth double-checking whether this also affects CI if multiple test runs could ever overlap on the same machine.

## [2026-08-08] `dotnet ef migrations add` timing trap: build-then-generate ordering
- **What:** `dotnet ef migrations add` runs its own build *before* writing the new migration `.cs` files, so a prior `dotnet build` + a later `dotnet run --no-build` can end up running a DLL that predates the migration and silently has zero migrations compiled in (`Database.Migrate()` then does nothing — no error, just an empty `__EFMigrationsHistory` table and every query 500ing with "relation does not exist").
- **Why:** Genuinely non-obvious tool behavior, not a code mistake — caught it by running Catalog.Api standalone and reading its console output directly, since Aspire doesn't forward per-resource console output to the AppHost's own stdout.
- **Fix later by:** Nothing to fix in code; just a habit — always `dotnet build` the solution *after* generating a migration and before the next `dotnet run --no-build`, or don't use `--no-build` right after touching migrations.

## [2026-08-08] Integration tests share the dev Postgres data volume across runs
- **What:** `AppHost.cs`'s `postgres.WithDataVolume()` is the same code path used by both `dotnet run` (manual dev) and `Aspire.Hosting.Testing`'s `DistributedApplicationTestingBuilder` (tests), so they all persist to the same named volume. Tests that used fixed constant SKUs/barcodes (e.g. `"WIDGET-1"`, `"CATALOG-TEST-DUPLICATE-SKU"`) started failing on reruns once leftover rows existed from a prior run or from manual `curl` testing — not because the code was broken, but because the test data wasn't unique.
- **Why:** `WithDataVolume()` is the right call for local dev (don't lose stock data every restart), and wasn't written with test isolation in mind since the test project didn't exist yet when that line was added.
- **Fix later by:** Fixed the immediate issue by generating unique SKUs/barcodes per test run (`Guid.NewGuid()` suffixes) rather than hardcoded constants — sufficient for now. If this becomes a recurring pain as more tests are added, look at giving the AppHost a way to skip `WithDataVolume()` under `DistributedApplicationTestingBuilder` specifically (e.g. an execution-context check) so tests get a clean database every run instead of relying on unique data alone.

## [2026-08-09] Integration tests were timing out from running full stacks in parallel
- **What:** Each integration test spins up its own complete AppHost (Postgres + Redis + all four services) via Aspire.Hosting.Testing. xUnit runs different test classes in parallel by default, so once there were 6 test classes, up to 6 full stacks were starting simultaneously and starving each other's containers/processes past each test's 60s timeout — 3 tests failed with `TaskCanceledException`, not because the code was wrong.
- **Why:** Wasn't a problem with only 1-2 test classes; only surfaced once enough services/tests accumulated to make the parallel resource contention real.
- **Fix later by:** Added `xunit.runner.json` with `parallelizeTestCollections: false` so these full-stack tests run sequentially — slower total wall-clock time, but each test gets the machine to itself. If the suite keeps growing and sequential runtime becomes painful, consider sharing one AppHost instance across tests in a class (via `IClassFixture`) instead of spinning up a fresh one per test.

## [2026-08-09] gRPC clients need "https://", not the REST clients' "https+http://" scheme
- **What:** Copying the REST clients' `new Uri("https+http://catalog-api")` pattern into `AddGrpcClient` broke immediately with `System.InvalidOperationException: No address resolver configured for the scheme 'https+http'.` `GrpcChannel` inspects the URI scheme itself to pick a resolver before any HttpClientFactory handler runs, and doesn't recognize Aspire's compound "try https, fall back to http" scheme — only plain `HttpClient`-based calls understand it. Fixed by using `https://catalog-api` for the gRPC clients specifically; service discovery still resolves it correctly underneath since `AddGrpcClient` is built on the same `HttpClientFactory` pipeline.
- **Why:** Not documented anywhere obvious — found by hitting the actual `InvalidOperationException` at runtime and reasoning through where GrpcChannel vs HttpClient diverge in how they interpret the URI.
- **Fix later by:** N/A — this is just the correct pattern going forward for any future gRPC client added to the system.

## [2026-08-09] CreateItem's category_id/image_url aren't validated before Guid.Parse
- **What:** `CatalogGrpcServiceImpl.CreateItem` calls `Guid.Parse(request.CategoryId)` directly on the incoming string with no try/catch — a malformed value throws an unhandled `FormatException`, surfacing as a generic gRPC `INTERNAL` error rather than a clean `INVALID_ARGUMENT`.
- **Why:** Scan Gateway's intake flow only ever passes a real `Guid.ToString()` or omits the field entirely, so this can't happen through the one caller that exists today. Left unvalidated to keep the first cut of intake/restock focused.
- **Fix later by:** Wrap the parse in a try/catch mapping to `RpcException(StatusCode.InvalidArgument)` before any other caller (e.g. a future admin UI) can hit this with untrusted input.

## [2026-09-12] sessionReport revenue uses today's Catalog price, not the price at time of sale
- **What:** `Query.SessionReport` multiplies a session's `Sold` quantity by whatever `CatalogApiClient.GetAllItemsAsync` returns *right now* for that Sku's price. If the price changed after the movements in that session happened, the reported revenue for that historical session will silently drift from what was actually charged at the time.
- **Why:** Catalog has no price history — `Item` stores one current `Price`, full stop. Snapshotting price per-movement would mean adding a `Price` column to `StockMovement`, which means Inventory would need to know price at write time, which crosses the "Inventory never knows money" boundary the whole ledger/reporting split was built around (see architecture.md). Not worth doing until this project actually needs to survive a price change occurring inside an already-closed session's window.
- **Fix later by:** If/when this matters: have Scan Gateway pass the price it already fetched from Catalog (during the scan/receive call) through to Inventory's `ReceiveStockAsync`/`/adjust` calls purely as an opaque snapshot value stored on the `StockMovement` row — Inventory still never *interprets* it, just carries it for Dashboard's report to read back instead of re-fetching current price.

## [2026-09-12] RestockSession is a single global lock, not per-item or per-category
- **What:** Only one `RestockSession` can be open system-wide at a time (enforced by a partial unique index on `ClosedAt IS NULL`). Two admins can't run independent restocking sessions concurrently, even for unrelated categories.
- **Why:** Matches the actual usage pattern described when this was designed — one admin, one restocking period, 2-3 days at a time — so a single global session was the simplest thing that fit. Also sidesteps having to decide how movements should be tagged if sessions could overlap.
- **Fix later by:** N/A unless multiple people start restocking concurrently; if that happens, the likely fix is scoping sessions by a category or location tag rather than making them fully independent per-Sku.

## [2026-09-13] `dotnet run --no-launch-profile` on the AppHost breaks all inter-service gRPC calls
- **What:** Running the AppHost with `dotnet run --no-launch-profile` makes Aspire bind every project resource to a single HTTP-only port instead of the usual HTTP+HTTPS pair. Every gRPC client (`AddGrpcClient<...>(o => o.Address = new Uri("https://catalog-api"))`) still insists on HTTPS, so any cross-service call (Scan Gateway → Catalog, Dashboard → Inventory) hangs waiting on a TLS handshake against a port that's only ever speaking plain HTTP — no error, no timeout from the server side, just silence until the caller's own client-side timeout eventually fires. REST-only endpoints (health checks, anything not calling another service) work fine, which made this confusing to isolate: the service is "up," just selectively broken.
- **Why:** `--no-launch-profile` was used during earlier debugging (started as a way to avoid `launchBrowser: true` opening a browser window in a headless session) without realizing it also drops the AppHost's own environment variables (`ASPIRE_DASHBOARD_OTLP_ENDPOINT_URL` etc. from `Properties/launchSettings.json`'s `https` profile), which is apparently what Aspire uses to decide whether to give child resources dual-scheme endpoints at all.
- **Fix later by:** N/A — just don't use `--no-launch-profile` when running the AppHost locally. Plain `dotnet run` (using the default `https` profile) is correct and was confirmed to give every project resource real HTTP+HTTPS endpoints, at which point every gRPC-dependent flow (category creation, item lookup, session summaries) works immediately with no code changes.

<!-- Add new entries above this line as you go -->

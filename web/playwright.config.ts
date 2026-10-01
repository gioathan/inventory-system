import { defineConfig } from "@playwright/test";

// End-to-end tests drive the real running system (frontend + every backend service), so they
// need the AppHost up first:
//
//   dotnet run --project src/AppHost/InventorySystem.AppHost.csproj    (from the repo root)
//   cd web && npm run e2e
//
// The frontend is pinned to http://localhost:3000 by the AppHost; set E2E_BASE_URL to point
// elsewhere. Tests share one database, so they run one at a time and tag everything they create.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 8 * 60_000,
  reporter: [["list"]],
  outputDir: "test-results/artifacts",
  // The UI picks its language from Accept-Language when no locale cookie is set, and the specs
  // assert on English text — so pin it rather than inherit whatever the machine's OS is set to.
  use: { locale: "en-US" },
});

import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { baseUrl } from "./support/env";
import { ensureSeller } from "./support/seller";

// Sweeps every page of the app, both themes, desktop and phone, as both an admin and a seller,
// and fails if axe finds any WCAG 2.0/2.1 A/AA violation. Ported from scratchpad/a11y.mjs, which
// found and fixed the light-theme contrast issues now baked into globals.css.

type Viewport = { width: number; height: number };
const VIEWPORTS: Viewport[] = [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
];
const THEMES = ["dark", "light"] as const;

test("no accessibility violations across the app, both themes, desktop and phone", async ({ browser }) => {
  test.slow();
  const seller = await ensureSeller();

  async function newSession(theme: string, viewport: Viewport, user: string, pass: string) {
    const context = await browser.newContext({ viewport, locale: "en-US" });
    await context.addInitScript((t) => {
      try {
        localStorage.setItem("theme", t);
      } catch {
        // best-effort only
      }
    }, theme);
    const page = await context.newPage();
    await page.goto(`${baseUrl}/login`);
    await page.fill("#username", user);
    await page.fill("#password", pass);
    await page.click("button[type=submit]");
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
    await page.waitForLoadState("networkidle");
    return { context, page };
  }

  const probe = await newSession("dark", { width: 1280, height: 800 }, "admin", "ChangeMe123!");
  const firstSku: string = await probe.page.evaluate(
    async () =>
      (
        await (
          await fetch("/api/backend/dashboard/graphql", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: "{ items { sku } }" }),
          })
        ).json()
      ).data.items[0].sku,
  );
  await probe.context.close();

  const adminPages = [
    "/dashboard",
    "/catalog",
    `/catalog?sku=${firstSku}`,
    "/catalog/new",
    "/catalog/bulk",
    "/categories",
    "/discounts",
    "/restock-sessions",
    "/restock-sessions?tab=compare",
    "/restock-sessions?tab=insights",
    "/staff",
    "/audit-log",
    `/labels/print?sku=${firstSku}`,
    "/scan",
    "/receive",
    "/receive/delivery",
    "/stock",
  ];
  const sellerPages = ["/scan", "/receive", "/receive/delivery", "/stock"];

  const violationSummaries: string[] = [];

  async function audit(page: Page, path: string, theme: string, viewport: Viewport) {
    await page.goto(`${baseUrl}${path}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(700);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .exclude("nextjs-portal")
      .analyze();
    for (const v of results.violations) {
      violationSummaries.push(
        `${path} (${theme}/${viewport.width}) :: ${v.id} [${v.impact}] on ${v.nodes.length} node(s) :: ${v.help}` +
          `  e.g. ${v.nodes[0].target.join(" ")}`,
      );
    }
  }

  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      const admin = await newSession(theme, viewport, "admin", "ChangeMe123!");
      for (const path of adminPages) await audit(admin.page, path, theme, viewport);
      await admin.context.close();

      const sellerSession = await newSession(theme, viewport, seller.username, seller.password);
      for (const path of sellerPages) await audit(sellerSession.page, path, theme, viewport);
      await sellerSession.context.close();

      // The login page is unauthenticated.
      const anon = await browser.newContext({ viewport, locale: "en-US" });
      await anon.addInitScript((t) => {
        try {
          localStorage.setItem("theme", t);
        } catch {
          // best-effort only
        }
      }, theme);
      const page = await anon.newPage();
      await audit(page, "/login", theme, viewport);
      await anon.close();
    }
  }

  expect.soft(violationSummaries, violationSummaries.join("\n")).toEqual([]);
});

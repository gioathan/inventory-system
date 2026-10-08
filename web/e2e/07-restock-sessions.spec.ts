/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, type Browser, type Page } from "@playwright/test";
import { baseUrl } from "./support/env";
import { check } from "./support/check";
import { ensureSeller } from "./support/seller";

// Restock sessions are one system-wide timeline (only one can be open), so this test necessarily
// ends whatever session was open on the dev stack when it starts its own. It closes its own
// sessions at the end so no test session is left as the current one.
test("restock sessions: starting one closes the last, and each report covers only its own period", async ({ browser }) => {
  const seller = await ensureSeller();
  const tag = Date.now().toString(36).toUpperCase();

  const visible = (page: Page, text: string, timeout = 8000) =>
    page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout }).then(() => true, () => false);

  async function login(b: Browser, user: string, pass: string, landing: string) {
    const context = await b.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
    const page = await context.newPage();
    await page.goto(`${baseUrl}/login`);
    await page.fill("#username", user);
    await page.fill("#password", pass);
    await page.click("button[type=submit]");
    await page.waitForURL(`**${landing}`, { timeout: 30000 });
    return { context, page };
  }
  const call = (page: Page, path: string, body?: unknown) =>
    page.evaluate(
      async ([p, b]: [string, unknown]) => {
        const r = await fetch(`/api/backend/gateway/${p}`, b === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
        return { status: r.status, body: await r.json().catch(() => null) };
      },
      [path, body] as [string, unknown],
    );
  const report = async (page: Page, sessionId: string) =>
    page.evaluate(async (id) => {
      const r = await fetch("/api/backend/dashboard/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: `{ sessionReport(sessionId: "${id}") { sku restocked sold revenue } }` }),
      });
      return (await r.json()).data.sessionReport as { sku: string; restocked: number; sold: number; revenue: number | null }[];
    }, sessionId);

  const admin = await login(browser, "admin", "ChangeMe123!", "/dashboard");
  const page = admin.page;
  const before = (await call(page, "restock-sessions/current")).body.session;

  // ---- start a session from the sessions page ---------------------------------------------------
  await page.goto(`${baseUrl}/restock-sessions`);
  await page.getByRole("button", { name: /Start (new )?session/ }).first().click();
  await page.getByLabel("Note").fill(`e2e first ${tag}`);
  await page.getByRole("dialog").getByRole("button", { name: "Start session" }).click();
  check("start: the new session is listed and open", await visible(page, `e2e first ${tag}`));
  const first = (await call(page, "restock-sessions/current")).body.session;
  check("start: it is now the current session", first?.note === `e2e first ${tag}`, JSON.stringify(first));
  if (before) {
    const list = (await call(page, "restock-sessions")).body;
    const old = list.find((s: any) => s.id === before.id);
    check("start: the session that was open got closed at the same moment", old?.closedAt === first.openedAt, `${old?.closedAt} vs ${first.openedAt}`);
  }

  // ---- activity during the first session ----------------------------------------------------------
  const item = (await call(page, "items/intake", { name: `Session Item ${tag}`, price: 10, quantity: 3, categoryId: null, imageUrl: null })).body;
  await call(page, `scan/${item.barcode}/receive`, { quantity: 5 });
  await call(page, `scan/${item.barcode}/sell`, { quantity: 2 });

  const firstLine = (await report(page, first.id)).find((l) => l.sku === item.sku);
  check("report: counts intake + receive as received (3 + 5)", firstLine?.restocked === 8, JSON.stringify(firstLine));
  check("report: counts the sale", firstLine?.sold === 2);
  check("report: revenue is units sold × price", firstLine?.revenue === 20, String(firstLine?.revenue));

  // ---- the item itself shows what's happening in the session -----------------------------------------
  await page.goto(`${baseUrl}/catalog?sku=${item.sku}`);
  const block = page.getByRole("region", { name: "This session" });
  await block.waitFor();
  const blockText = (await block.innerText()).replace(/\s+/g, " ");
  check("item: session block shows start → received → sold → now (0, +8, −2, 6)", /Start 0 Received \+8 Sold −2 Now 6/i.test(blockText), blockText);
  check("item: session block shows revenue and sell-through (2 of 8 = 25%)", blockText.includes("€20.00") && blockText.includes("25%"), blockText);
  check("catalog: a Sold this session column appears while a session is open", (await page.getByRole("columnheader", { name: /Sold this session/ }).count()) === 1);

  // ---- receive screen banner -------------------------------------------------------------------------
  await page.goto(`${baseUrl}/receive`);
  check("receive: banner names the open session", await visible(page, `e2e first ${tag}`));

  // ---- starting the next session closes the first, and splits the reports ---------------------------
  await page.getByRole("button", { name: "Start new session" }).click();
  check("start: the dialog warns it will end the open session", await visible(page, "This ends the session that opened"));
  await page.getByLabel("Note").fill(`e2e second ${tag}`);
  await page.getByRole("dialog").getByRole("button", { name: "Start session" }).click();
  check("receive: banner switches to the new session", await visible(page, `e2e second ${tag}`));
  const second = (await call(page, "restock-sessions/current")).body.session;
  await call(page, `scan/${item.barcode}/receive`, { quantity: 4 });

  const firstAfter = (await report(page, first.id)).find((l) => l.sku === item.sku);
  const secondLine = (await report(page, second.id)).find((l) => l.sku === item.sku);
  check("report: the closed session's numbers stop at its close", firstAfter?.restocked === 8 && firstAfter?.sold === 2, JSON.stringify(firstAfter));
  check("report: the new session only counts what happened in it", secondLine?.restocked === 4 && secondLine?.sold === 0, JSON.stringify(secondLine));

  // ---- the sessions page shows both, with their reports ----------------------------------------------
  await page.goto(`${baseUrl}/restock-sessions`);
  await page.getByRole("button", { name: new RegExp(`e2e first ${tag}`) }).click();
  const firstReport = page.getByRole("region", { name: /Session #\d+ report/ });
  const row = firstReport.locator("tr", { hasText: `Session Item ${tag}` });
  check("page: the first session's report lists the item", (await row.innerText()).replace(/\s+/g, " ").includes("0 +8 −2 6 €20.00"), await row.innerText());
  check("page: the first session reads as closed", (await firstReport.innerText()).includes("→") && !(await firstReport.innerText()).includes("still open"));

  // ---- compare: latest vs the one before (the defaults) ------------------------------------------------
  await page.goto(`${baseUrl}/restock-sessions?tab=compare`);
  await page.getByRole("region", { name: "Comparison" }).waitFor();
  const selectedB = await page.getByLabel("Second session").inputValue();
  const selectedA = await page.getByLabel("First session").inputValue();
  check("compare: defaults to the latest session against the one before", selectedB === second.id && selectedA === first.id, `${selectedA} → ${selectedB}`);
  await page.getByLabel("Search items").fill(`Session Item ${tag}`);
  const cmpRow = page.getByRole("region", { name: "Comparison" }).locator("tr", { hasText: `Session Item ${tag}` });
  const cmpText = (await cmpRow.innerText()).replace(/\s+/g, " ");
  check("compare: the item sold 2 then 0 and is flagged as stopped selling", cmpText.includes("Stopped selling") && /2 0 down 2/.test(cmpText), cmpText);
  await page.getByRole("button", { name: /^Stopped selling/ }).click();
  check("compare: the Stopped selling filter keeps it", (await cmpRow.count()) === 1);
  await page.getByRole("button", { name: "By category" }).click();
  check("compare: by-category view lists No category (our item has none)", await visible(page, "No category"));

  // ---- insights over the last sessions -----------------------------------------------------------------
  await page.goto(`${baseUrl}/restock-sessions?tab=insights`);
  await page.getByRole("button", { name: "Last 3" }).click();
  const topItems = page.getByRole("list", { name: "Item" });
  await topItems.waitFor();
  const itemBar = topItems.getByRole("listitem", { name: new RegExp(`^Session Item ${tag}: 2\\b`) });
  check("insights: top items include the test item with its 2 units sold", (await itemBar.count()) === 1);
  await page.getByRole("button", { name: "Revenue" }).click();
  check("insights: switching to revenue ranks it by €20.00", (await topItems.getByRole("listitem", { name: new RegExp(`^Session Item ${tag}: €20\\.00`) }).count()) === 1);
  const trendColumns = await page.getByRole("list", { name: "Sessions" }).getByRole("listitem").count();
  check("insights: the trend has one column per session in scope (3)", trendColumns === 3, String(trendColumns));
  await page.getByRole("button", { name: "Latest" }).click();
  check("insights: Latest excludes the first session's sales", (await topItems.getByRole("listitem", { name: new RegExp(`^Session Item ${tag}:`) }).count()) === 0);

  // ---- a seller sees the session but can't run them ---------------------------------------------------
  {
    const s = await login(browser, seller.username, seller.password, "/scan");
    await s.page.goto(`${baseUrl}/receive`);
    check("seller: sees which session is open", await visible(s.page, `e2e second ${tag}`));
    check("seller: gets no Start button", (await s.page.getByRole("button", { name: /Start (new )?session/ }).count()) === 0);
    await s.page.goto(`${baseUrl}/stock`);
    await s.page.getByLabel("Search items").fill(`Session Item ${tag}`);
    // The second session is open now: the 2 earlier sales belong to the first one.
    check("seller: stock card shows this session's sold count (0 in the new session)", await visible(s.page, "0 sold this session"));
    await s.page.goto(`${baseUrl}/restock-sessions`);
    check("seller: bounced from the sessions page", new URL(s.page.url()).pathname === "/scan");
    const denied = await call(s.page, "restock-sessions", { note: "nope" });
    check("seller: backend refuses starting a session (403)", denied.status === 403, `status=${denied.status}`);
    await s.context.close();
  }

  // Don't leave a test session as the current one.
  await call(page, `restock-sessions/${second.id}/close`, {});
  check("close: no session is open afterwards", (await call(page, "restock-sessions/current")).body.session === null);
  await admin.context.close();
});

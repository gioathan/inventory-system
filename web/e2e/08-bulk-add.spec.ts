/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, type Browser, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { SCREENS, baseUrl } from "./support/env";
import { check } from "./support/check";
import { ensureSeller } from "./support/seller";

test("bulk add: manual rows and CSV import, with a skipped-row failure that doesn't block the rest", async ({ browser }) => {
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

  const admin = await login(browser, "admin", "ChangeMe123!", "/dashboard");
  const page = admin.page;

  // ---- manual rows: a blank trailing row is silently skipped, not an error ---------------------
  await page.goto(`${baseUrl}/catalog/bulk`);
  await page.getByPlaceholder("Item name").nth(0).fill(`Bulk A ${tag}`);
  await page.getByPlaceholder("Price").nth(0).fill("9.99");
  await page.getByPlaceholder("Item name").nth(1).fill(`Bulk B ${tag}`);
  await page.getByPlaceholder("Price").nth(1).fill("14.50");
  check("manual: submit counts only the two filled rows", await visible(page, "Create 2 items"));
  await page.getByRole("button", { name: /^Create 2 items/ }).click();
  await page.getByText("2 created").waitFor({ timeout: 15000 });
  check("manual: both rows show Created", (await page.getByText("Created", { exact: true }).count()) === 2);

  const byGraphQl = await page.evaluate(async (t) => {
    const r = await fetch("/api/backend/dashboard/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "{ items { name price quantityOnHand } }" }),
    });
    return (await r.json()).data.items.filter((i: any) => i.name.includes(t));
  }, tag);
  check("manual: the third, untouched row created nothing", byGraphQl.length === 2, JSON.stringify(byGraphQl));
  check(
    "manual: both items exist with the right price and starting stock",
    byGraphQl.some((i: any) => i.name === `Bulk A ${tag}` && i.price === 9.99 && i.quantityOnHand === 1) &&
      byGraphQl.some((i: any) => i.name === `Bulk B ${tag}` && i.price === 14.5 && i.quantityOnHand === 1),
    JSON.stringify(byGraphQl),
  );

  // ---- CSV import: a matched category, an unmatched one, and a barcode collision ----------------
  const catName = `Bulk Cat ${tag}`;
  const cat = (await call(page, "categories", { name: catName })).body;
  const taken = (await call(page, "items/intake", { name: `Barcode Holder ${tag}`, price: 1, categoryId: null, imageUrl: null, quantity: 1 })).body;

  const csv = [
    "name,price,quantity,category,barcode",
    `"CSV One ${tag}",12.50,3,${catName},`,
    `"CSV Two ${tag}",7,2,Nonexistent Category ${tag},`,
    `"CSV Three ${tag}",5,1,,${taken.barcode}`,
  ].join("\r\n");
  const csvPath = `${SCREENS}/bulk-import-${tag}.csv`;
  writeFileSync(csvPath, csv);

  await page.goto(`${baseUrl}/catalog/bulk`);
  await page.setInputFiles('input[type="file"]', csvPath);
  // Neither getByText (only sees text nodes) nor a CSS [value=] selector (only sees the initial
  // HTML attribute, not a controlled input's live .value after React sets it) can see this — poll
  // the actual DOM property instead.
  await page.waitForFunction(
    (name) => Array.from(document.querySelectorAll("input")).some((el) => (el as HTMLInputElement).value === name),
    `CSV Three ${tag}`,
  );
  check("csv: the matched category is pre-selected", (await page.getByRole("combobox").first().inputValue()) === catName);
  check("csv: the unmatched category is flagged, not silently guessed", await visible(page, `No category named "Nonexistent Category ${tag}"`));

  await page.getByRole("button", { name: /^Create 3 items/ }).click();
  await page.getByText("2 created · 1 failed", { exact: false }).waitFor({ timeout: 15000 });
  check("csv: the barcode collision is called out on its own row", await visible(page, "already used by another item"));
  check("csv: a Retry button remains for just the failed row", await visible(page, "Retry (1)"));

  const afterCsv = await page.evaluate(async (t) => {
    const r = await fetch("/api/backend/dashboard/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "{ items { name categoryId } }" }),
    });
    return (await r.json()).data.items.filter((i: any) => i.name.includes(`CSV`) && i.name.includes(t));
  }, tag);
  check("csv: exactly the two non-colliding rows were created", afterCsv.length === 2, JSON.stringify(afterCsv));
  check(
    "csv: the matched-category row got the real category id, the unmatched one got none",
    afterCsv.find((i: any) => i.name === `CSV One ${tag}`)?.categoryId === cat.id &&
      afterCsv.find((i: any) => i.name === `CSV Two ${tag}`)?.categoryId === null,
    JSON.stringify(afterCsv),
  );

  // ---- a seller has no business here ------------------------------------------------------------
  {
    const s = await login(browser, seller.username, seller.password, "/scan");
    await s.page.goto(`${baseUrl}/catalog/bulk`);
    check("authz: seller is bounced from /catalog/bulk to /scan", new URL(s.page.url()).pathname === "/scan");
    await s.context.close();
  }

  await admin.context.close();
});

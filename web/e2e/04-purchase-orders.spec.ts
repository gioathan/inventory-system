import { chromium, test, type Page } from "@playwright/test";
import { SCREENS, baseUrl } from "./support/env";
import { check } from "./support/check";
import { ensureSeller } from "./support/seller";

type Viewport = { width: number; height: number };

test("a purchase order from draft to received, cancelled, and stale", async () => {
  const seller = await ensureSeller();
  const tag = Date.now().toString(36).toUpperCase();

  const visible = (page: Page, text: string, timeout = 8000) =>
    page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout }).then(() => true, () => false);

  const browser = await chromium.launch();
  async function login(user: string, pass: string, viewport: Viewport, landing: string) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await page.goto(`${baseUrl}/login`);
    await page.fill("#username", user);
    await page.fill("#password", pass);
    await page.click("button[type=submit]");
    await page.waitForURL(`**${landing}`, { timeout: 30000 });
    await page.waitForLoadState("networkidle");
    return { context, page };
  }
  const call = (page: Page, path: string, body?: unknown) =>
    page.evaluate(async ([p, b]: [string, unknown]) => {
      const r = await fetch(`/api/backend/gateway/${p}`, b === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
      return { status: r.status, body: await r.json().catch(() => null) };
    }, [path, body] as [string, unknown]);

  // ---- seed -----------------------------------------------------------------------------------
  const admin = await login("admin", "ChangeMe123!", { width: 1280, height: 900 }, "/dashboard");
  const mkItem = async (name: string) => (await call(admin.page, "items/intake", { name, price: 5, quantity: 1, categoryId: null, imageUrl: null })).body;
  const A = await mkItem(`POA ${tag}`);
  const B = await mkItem(`POB ${tag}`);
  const C = await mkItem(`POC ${tag}`);
  const stockOf = async (barcode: string) => (await call(admin.page, `scan/${barcode}`)).body.quantityOnHand;
  const supplier1 = `Supplier ${tag} One`;

  // ---- create an order in the UI --------------------------------------------------------------
  {
    const page = admin.page;
    const links = await page.locator("nav[aria-label=Main] a").allInnerTexts();
    check("nav: Purchase Orders is present", links.includes("Purchase Orders"), links.join(", "));

    await page.goto(`${baseUrl}/purchase-orders/new`);
    await page.getByRole("button", { name: "Create order" }).click();
    check("create: empty form shows both errors", (await visible(page, "Enter the supplier's name.")) && (await visible(page, "Add at least one item to order.")));

    await page.getByLabel("Supplier").fill(supplier1);
    const picker = page.getByLabel("Add an item");
    await picker.fill(`POA ${tag}`);
    await page.getByRole("list", { name: "Matching items" }).getByRole("button", { name: new RegExp(`POA ${tag}`) }).click();
    await picker.fill(`POB ${tag}`);
    await page.getByRole("list", { name: "Matching items" }).getByRole("button", { name: new RegExp(`POB ${tag}`) }).click();

    // Enter in the picker must pick the first match, and must NOT submit the whole order.
    await picker.fill(`POC ${tag}`);
    await picker.press("Enter");
    check("create: Enter in the picker adds the item without submitting", (await page.locator('input[aria-label^="Quantity of"]').count()) === 3 && page.url().endsWith("/purchase-orders/new"));
    await page.getByRole("button", { name: `Remove POC ${tag}` }).click();
    check("create: a line can be removed", (await page.locator('input[aria-label^="Quantity of"]').count()) === 2);

    await picker.fill(`POA ${tag}`);
    check("create: an already-added item isn't offered again", await visible(page, "No matching items"));
    await picker.fill("");

    await page.getByLabel(`Quantity of POA ${tag}`).fill("0");
    await page.getByLabel(`Quantity of POB ${tag}`).fill("6");
    await page.getByRole("button", { name: "Create order" }).click();
    check("create: zero quantity is rejected", await visible(page, "Enter 1 to 99,999."));
    await page.getByLabel(`Quantity of POA ${tag}`).fill("10");
    check("create: running total (2 lines, 16 units)", await visible(page, "2 lines · 16 units"));
    await page.screenshot({ path: `${SCREENS}/p4-desktop-new.png` });

    await page.getByRole("button", { name: "Create order" }).click();
    await page.waitForURL(/\/purchase-orders\/[0-9a-f-]{36}$/);
    check("create: lands on the new order, as a Draft", await visible(page, supplier1) && (await visible(page, "Draft")));
    check("create: a Draft offers Send and Cancel but not Record shipment",
      (await page.getByRole("button", { name: "Send to supplier" }).count()) === 1 &&
      (await page.getByRole("button", { name: "Cancel order" }).count()) === 1 &&
      (await page.getByRole("button", { name: "Record shipment" }).count()) === 0);
    check("create: lines show item names and 0 received", await visible(page, `POA ${tag}`) && (await visible(page, "0 of 16 units received")));

    // ---- send ------------------------------------------------------------------------------
    await page.getByRole("button", { name: "Send to supplier" }).click();
    await page.getByRole("button", { name: "Send order" }).click();
    check("send: notice and Sent status", (await visible(page, `Order sent to ${supplier1}.`)) && (await visible(page, "Waiting for the first delivery")));
    check("send: Send is gone, Record shipment appears",
      (await page.getByRole("button", { name: "Send to supplier" }).count()) === 0 && (await page.getByRole("button", { name: "Record shipment" }).count()) === 1);

    // ---- partial receive -------------------------------------------------------------------
    await page.getByRole("button", { name: "Record shipment" }).click();
    const qa = page.getByLabel(`Received quantity for POA ${tag}`);
    await qa.fill("12ab");
    check("receive: non-digits are stripped", (await qa.inputValue()) === "12");
    await qa.fill("999999");
    check("receive: quantity input is capped at 5 digits", (await qa.inputValue()) === "99999");
    await qa.fill("4");
    check("receive: submit label reflects the units", await visible(page, "Add 4 units to stock"));
    await page.screenshot({ path: `${SCREENS}/p4-desktop-receive.png` });
    await page.getByRole("button", { name: /Add 4 units to stock/ }).click();
    check("receive: notice says the rest is still expected", await visible(page, "Recorded 4 units. The rest is still expected."));
    check("receive: status is Partially received with progress", (await visible(page, "Partially received")) && (await visible(page, "4 of 16 units received")));
    check("receive: backend stock rose by exactly the received amount (1 -> 5)", (await stockOf(A.barcode)) === 5, `stock=${await stockOf(A.barcode)}`);
    check("receive: an untouched line's stock is unchanged", (await stockOf(B.barcode)) === 1);

    // ---- over-receipt completes the order, with a warning ------------------------------------
    await page.getByRole("button", { name: "Record shipment" }).click();
    await page.getByLabel(`Received quantity for POA ${tag}`).fill("6");
    await page.getByLabel(`Received quantity for POB ${tag}`).fill("9");
    check("receive: over-shipping is flagged before submit", (await visible(page, "Over the order by 3")) && (await visible(page, "exceeds what was ordered")));
    await page.getByRole("button", { name: /Add 15 units to stock/ }).click();
    check("receive: order completes", (await visible(page, "The order is now complete.")) && (await visible(page, "Everything ordered has arrived")));
    check("receive: the over-shipped line is marked", await visible(page, "Over by 3"));
    check("receive: no actions remain on a closed order",
      (await page.getByRole("button", { name: /Record shipment|Cancel order|Send to supplier/ }).count()) === 0);
    check("receive: stock reflects every receipt (A 1+4+6=11, B 1+9=10)", (await stockOf(A.barcode)) === 11 && (await stockOf(B.barcode)) === 10, `A=${await stockOf(A.barcode)} B=${await stockOf(B.barcode)}`);
  }

  // ---- a stale screen: the order changes underneath the user ----------------------------------
  {
    const page = admin.page;
    const supplier2 = `Supplier ${tag} Two`;
    const po2 = (await call(page, "purchase-orders", { supplierName: supplier2, lines: [{ sku: A.sku, quantity: 5 }] })).body;
    await page.goto(`${baseUrl}/purchase-orders/${po2.id}`);
    await visible(page, supplier2);
    await call(page, `purchase-orders/${po2.id}/send`, {}); // someone else sends it first
    await page.getByRole("button", { name: "Send to supplier" }).click();
    await page.getByRole("button", { name: "Send order" }).click();
    check("stale: the backend's refusal is shown in the dialog", await visible(page, "only a Draft order can be sent"));
    await page.getByRole("button", { name: "Keep as is" }).click();
    check("stale: the screen reloads to the real status (Sent)", (await visible(page, "Waiting for the first delivery")) && (await page.getByRole("button", { name: "Send to supplier" }).count()) === 0);
  }

  // ---- cancelling a partially received order --------------------------------------------------
  {
    const page = admin.page;
    const supplier3 = `Supplier ${tag} Three`;
    const po3 = (await call(page, "purchase-orders", { supplierName: supplier3, lines: [{ sku: C.sku, quantity: 8 }] })).body;
    await call(page, `purchase-orders/${po3.id}/send`, {});
    await call(page, `purchase-orders/${po3.id}/receive`, { lines: [{ sku: C.sku, quantity: 3 }] });
    await page.goto(`${baseUrl}/purchase-orders/${po3.id}`);
    await visible(page, "Partially received");
    await page.getByRole("button", { name: "Cancel order" }).click();
    check("cancel: warns that received stock stays", await visible(page, "Stock you've already received stays on hand"));
    await page.getByRole("dialog").getByRole("button", { name: "Cancel order" }).click();
    check("cancel: order shows Cancelled", (await visible(page, "Order cancelled.")) && (await visible(page, "This order was cancelled")));
    check("cancel: received stock stays (C 1+3=4)", (await stockOf(C.barcode)) === 4, `stock=${await stockOf(C.barcode)}`);
    check("cancel: no actions remain", (await page.getByRole("button", { name: /Record shipment|Cancel order|Send to supplier/ }).count()) === 0);
  }

  // ---- list ------------------------------------------------------------------------------------
  {
    const page = admin.page;
    await page.goto(`${baseUrl}/purchase-orders`);
    await page.getByLabel("Search purchase orders").fill(`Supplier ${tag}`);
    check("list: search finds this run's three orders", await visible(page, "3 orders"));
    const names = async () => page.locator("ul li h3").allInnerTexts();
    await page.getByRole("button", { name: /^Received/ }).click();
    let list = await names();
    check("list: Received filter shows only the completed order", list.length === 1 && list[0].endsWith("One"), list.join(" | "));
    await page.getByRole("button", { name: /^Cancelled/ }).click();
    list = await names();
    check("list: Cancelled filter shows only the cancelled order", list.length === 1 && list[0].endsWith("Three"), list.join(" | "));
    await page.getByRole("button", { name: /^Sent/ }).click();
    list = await names();
    check("list: Sent filter shows only the sent order", list.length === 1 && list[0].endsWith("Two"), list.join(" | "));
    await page.getByRole("button", { name: /^All/ }).click();
    await page.getByLabel("Search purchase orders").fill("zzz-nothing");
    check("list: no-match empty state", await visible(page, "No orders match"));
    await page.getByLabel("Search purchase orders").fill(`Supplier ${tag}`);
    const bars = await page.getByRole("progressbar").count();
    check("list: each card has an accessible progress bar", bars >= 3, `bars=${bars}`);
    await page.screenshot({ path: `${SCREENS}/p4-desktop-list.png` });
    await page.getByRole("link", { name: new RegExp(`Supplier ${tag} One`) }).click();
    await page.waitForURL(/\/purchase-orders\/[0-9a-f-]{36}$/);
    check("list: a card opens its order", await visible(page, "Everything ordered has arrived"));
    await page.screenshot({ path: `${SCREENS}/p4-desktop-detail.png` });
  }

  // ---- bad ids ---------------------------------------------------------------------------------
  {
    const page = admin.page;
    const junk = await page.goto(`${baseUrl}/purchase-orders/not-a-guid`);
    check("ids: a malformed id is a 404", junk!.status() === 404, `status=${junk!.status()}`);
    await page.goto(`${baseUrl}/purchase-orders/00000000-0000-0000-0000-000000000000`);
    check("ids: an unknown but well-formed id says it doesn't exist", await visible(page, "This purchase order doesn't exist."));
  }

  // ---- phone -----------------------------------------------------------------------------------
  {
    const { context, page } = await login("admin", "ChangeMe123!", { width: 390, height: 844 }, "/dashboard");
    await page.goto(`${baseUrl}/purchase-orders`);
    await page.getByLabel("Search purchase orders").fill(`Supplier ${tag}`);
    await visible(page, "3 orders");
    await page.screenshot({ path: `${SCREENS}/p4-phone-list.png` });
    await page.goto(`${baseUrl}/purchase-orders/new`);
    await page.screenshot({ path: `${SCREENS}/p4-phone-new.png`, fullPage: true });

    const po = (await call(page, "purchase-orders", { supplierName: `Supplier ${tag} Phone`, lines: [{ sku: A.sku, quantity: 12 }, { sku: B.sku, quantity: 7 }] })).body;
    await call(page, `purchase-orders/${po.id}/send`, {});
    await page.goto(`${baseUrl}/purchase-orders/${po.id}`);
    await page.getByRole("button", { name: "Record shipment" }).click();
    await page.getByRole("button", { name: "Fill everything still due" }).click();
    check("phone: 'fill everything still due' fills every line", (await page.getByLabel(`Received quantity for POA ${tag}`).inputValue()) === "12" && (await page.getByLabel(`Received quantity for POB ${tag}`).inputValue()) === "7");
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SCREENS}/p4-phone-receive.png`, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    check("phone: the receive screen doesn't scroll sideways", !overflow);
    await context.close();
  }

  // ---- authorization ---------------------------------------------------------------------------
  {
    const { context, page } = await login(seller.username, seller.password, { width: 1280, height: 800 }, "/scan");
    await page.goto(`${baseUrl}/purchase-orders`);
    check("authz: a seller is bounced from /purchase-orders", new URL(page.url()).pathname === "/scan");
    const status = await page.evaluate(async () => (await fetch("/api/backend/gateway/purchase-orders")).status);
    check("authz: the backend refuses a seller directly (403)", status === 403, `status=${status}`);
    await context.close();
  }

  await admin.context.close();
  await browser.close();
});

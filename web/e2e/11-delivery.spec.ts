/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, type Page } from "@playwright/test";
import { SCREENS, baseUrl } from "./support/env";
import { check } from "./support/check";
import { ensureSeller } from "./support/seller";

test("receive a delivery: scan, search, paste a list, survive a refresh, then receive everything at once", async ({ browser }) => {
  const seller = await ensureSeller();
  const tag = Date.now().toString(36).toUpperCase();

  const visible = (page: Page, text: string, timeout = 8000) =>
    page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout }).then(() => true, () => false);

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  context.setDefaultTimeout(20000); // a step that never happens should fail in seconds, not sit out the 8-minute test limit
  const page = await context.newPage();

  // What a hardware scanner does: every character, then Enter, a few milliseconds apart and
  // without waiting for the page to react. page.keyboard.type() can't stand in for it, because
  // Playwright waits for each key to be handled before sending the next, so a slow page slows
  // the "scanner" down with it. Typed into whatever has focus, or at the page if nothing does.
  const scan = (code: string) =>
    page.evaluate((text: string) => {
      const active = document.activeElement;
      const input = active instanceof HTMLInputElement ? active : null;
      const target: EventTarget = input ?? document.body;
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      for (const key of text) {
        if (!target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })) || !input) continue;
        setValue.call(input, input.value + key);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      target.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    }, code);
  await page.goto(`${baseUrl}/login`);
  await page.fill("#username", "admin");
  await page.fill("#password", "ChangeMe123!");
  await page.click("button[type=submit]");
  await page.waitForURL("**/dashboard", { timeout: 30000 });

  const intake = (name: string, quantity: number) =>
    page.evaluate(
      async (b: any) => {
        const r = await fetch("/api/backend/gateway/items/intake", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
        return r.json();
      },
      { name, price: 4, quantity, categoryId: null, imageUrl: null },
    );
  const stockOf = (skus: string[]) =>
    page.evaluate(async (wanted: string[]) => {
      const r = await fetch("/api/backend/dashboard/graphql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "{ items { sku quantityOnHand } }" }) });
      const items = (await r.json()).data.items as { sku: string; quantityOnHand: number }[];
      return wanted.map((sku) => items.find((i) => i.sku === sku)?.quantityOnHand ?? null);
    }, skus);

  const a = await intake(`Delivery A ${tag}`, 5);
  const b = await intake(`Delivery B ${tag}`, 2);
  const c = await intake(`Delivery C ${tag}`, 1);
  const d = await intake(`Delivery D ${tag}`, 3);

  const addBox = page.getByRole("combobox", { name: "Scan or search for an item" });
  const quantity = (name: string) => page.getByLabel(`Quantity for ${name}`);

  // ---- reachable from the one-at-a-time screen --------------------------------------------------
  await page.goto(`${baseUrl}/receive`);
  await page.getByRole("link", { name: /Receive a delivery/ }).click();
  await page.waitForURL("**/receive/delivery");
  await addBox.waitFor();
  await page.waitForFunction(() => !(document.querySelector('input[role="combobox"]') as HTMLInputElement)?.disabled);

  // ---- scanning: same item twice is two units, and the cursor never leaves the scan box ----------
  await addBox.fill(a.barcode);
  await addBox.press("Enter");
  await quantity(a.name).waitFor();
  check("scan: first scan adds the item with quantity 1", (await quantity(a.name).inputValue()) === "1");
  await addBox.fill(a.barcode);
  await addBox.press("Enter");
  check("scan: scanning it again makes it 2", (await quantity(a.name).inputValue()) === "2");
  check("scan: focus stays in the scan box, ready for the next one", await addBox.evaluate((el) => el === document.activeElement));
  check("scan: the box is cleared after each scan", (await addBox.inputValue()) === "");

  // ---- search: pick with the keyboard, type the quantity, Enter returns to the box ---------------
  await addBox.fill(`Delivery B ${tag}`);
  await page.getByRole("option", { name: new RegExp(`Delivery B ${tag}`) }).waitFor();
  await addBox.press("Enter");
  check("search: Enter adds the highlighted match and moves to its quantity", await quantity(b.name).evaluate((el) => el === document.activeElement));
  await page.keyboard.type("24", { delay: 120 }); // a person, not a scanner
  check("search: typing replaces the 1 rather than appending to it", (await quantity(b.name).inputValue()) === "24");
  await page.keyboard.press("Enter");
  check("search: Enter in the quantity goes back to the scan box", await addBox.evaluate((el) => el === document.activeElement));
  check("search: the row shows the new total (2 + 24)", await page.getByText("26", { exact: true }).isVisible());

  // ---- a scanner firing while the cursor is in a quantity box must not become the quantity -------
  await quantity(b.name).focus();
  await scan(c.barcode);
  await quantity(c.name).waitFor();
  check("scanner in a quantity box: that quantity is left as it was", (await quantity(b.name).inputValue()) === "24", await quantity(b.name).inputValue());
  check("scanner in a quantity box: the scanned item is added instead", (await quantity(c.name).inputValue()) === "1");

  // ---- a scanner firing with focus on nothing at all --------------------------------------------
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await scan(d.barcode);
  await quantity(d.name).waitFor();
  check("scanner with nothing focused: the item is still added", (await quantity(d.name).inputValue()) === "1");

  // ---- an unknown code says so and changes nothing ----------------------------------------------
  await addBox.fill(`NOPE${tag}`);
  await addBox.press("Enter");
  check("unknown code: explains that nothing matches", await visible(page, `No item matches “NOPE${tag}”.`));

  // ---- paste a supplier list: by barcode, by SKU, and one the catalog doesn't know ---------------
  await page.getByRole("button", { name: "Paste or upload a list" }).click();
  await page.getByLabel("Rows to add").fill(`${a.barcode}\t3\nMISSING${tag}\t7\n${d.sku}\t2`);
  await page.getByRole("button", { name: "Add to list" }).click();
  check("paste: reports what was added and what needs attention", await visible(page, "Added 2 rows to the list. 1 row needs your attention."));
  check("paste: quantities add to what was already scanned (2 + 3)", (await quantity(a.name).inputValue()) === "5");
  check("paste: a SKU works as well as a barcode (1 + 2)", (await quantity(d.name).inputValue()) === "3");
  check("paste: the unknown code is listed, not dropped", await visible(page, `MISSING${tag}`));
  await page.screenshot({ path: `${SCREENS}/p11-delivery-list.png`, fullPage: true });

  // ---- fix the unknown row by pointing it at the right item; its quantity comes along ------------
  await page.getByRole("button", { name: "Find item" }).click();
  check("unmatched: asks which item the code is", await visible(page, `Pick the item for “MISSING${tag}”`));
  await addBox.fill(`Delivery C ${tag}`);
  await page.getByRole("option", { name: new RegExp(`Delivery C ${tag}`) }).waitFor();
  await addBox.press("Enter");
  check("unmatched: the row's quantity is added to the chosen item (1 + 7)", (await quantity(c.name).inputValue()) === "8");
  check("unmatched: the row is gone once resolved", (await page.getByText(`MISSING${tag}`).count()) === 0);

  // ---- an empty quantity blocks the whole submit, and says why ----------------------------------
  await quantity(d.name).fill("");
  check("invalid: says how many quantities need fixing", await visible(page, "Fix 1 quantity to continue."));
  check("invalid: Receive all is disabled", await page.getByRole("button", { name: "Receive all" }).isDisabled());
  await quantity(d.name).fill("3");
  check("summary: counts items and units", await visible(page, "4 items · 40 units"));

  // ---- nothing has touched stock yet, and a refresh loses nothing -------------------------------
  check("before receiving: stock is unchanged", JSON.stringify(await stockOf([a.sku, b.sku, c.sku, d.sku])) === "[5,2,1,3]");
  await page.reload();
  await quantity(a.name).waitFor({ timeout: 15000 });
  check("refresh: the list comes back", (await quantity(a.name).inputValue()) === "5" && (await quantity(b.name).inputValue()) === "24" && (await quantity(c.name).inputValue()) === "8" && (await quantity(d.name).inputValue()) === "3");
  check("refresh: says it picked up an unfinished delivery", await visible(page, "Picked up where you left off: 4 rows"));

  // ---- receive everything in one go -------------------------------------------------------------
  await page.getByRole("button", { name: "Receive all" }).click();
  check("receive: confirms items and units", await visible(page, "Received 4 items · 40 units.", 20000));
  const after = await stockOf([a.sku, b.sku, c.sku, d.sku]);
  check("receive: every item's stock went up by its quantity", JSON.stringify(after) === "[10,26,9,6]", JSON.stringify(after));
  check("receive: the list is empty again", await visible(page, "Nothing on the list yet."));
  check("receive: what was received is listed with its new total", await visible(page, `+24 × Delivery B ${tag}`) && (await visible(page, "now 26")));
  await page.screenshot({ path: `${SCREENS}/p11-delivery-received.png`, fullPage: true });
  await page.reload();
  await addBox.waitFor();
  await page.waitForFunction(() => !(document.querySelector('input[role="combobox"]') as HTMLInputElement)?.disabled);
  check("receive: a refresh afterwards doesn't bring the received rows back", (await page.getByLabel(/^Quantity for /).count()) === 0);
  await context.close();

  // ---- sellers receive stock too, so the page is theirs as well ---------------------------------
  {
    const s = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const sp = await s.newPage();
    await sp.goto(`${baseUrl}/login`);
    await sp.fill("#username", seller.username);
    await sp.fill("#password", seller.password);
    await sp.click("button[type=submit]");
    await sp.waitForURL("**/scan", { timeout: 30000 });
    await sp.goto(`${baseUrl}/receive/delivery`);
    check("seller: can open the delivery page", new URL(sp.url()).pathname === "/receive/delivery" && (await visible(sp, "Receive a delivery")));
    const sellerBox = sp.getByRole("combobox", { name: "Scan or search for an item" });
    await sp.waitForFunction(() => !(document.querySelector('input[role="combobox"]') as HTMLInputElement)?.disabled);
    await sellerBox.fill(a.barcode);
    await sellerBox.press("Enter");
    await sp.getByLabel(`Quantity for ${a.name}`).waitFor();
    await sp.getByRole("button", { name: "Receive all" }).click();
    check("seller: can receive from it", await visible(sp, "Received 1 item · 1 unit.", 20000));
    check("phone: no horizontal scrolling", await sp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await sp.screenshot({ path: `${SCREENS}/p11-delivery-phone.png`, fullPage: true });
    await s.close();
  }
});

import { chromium, test, type Page } from "@playwright/test";
import { SCREENS, baseUrl } from "./support/env";
import { check } from "./support/check";
import { ensureSeller } from "./support/seller";
import { removeDiscountsFor } from "./support/cleanup";

type Viewport = { width: number; height: number };

test("receiving stock and the stock lookup screen", async () => {
  const seller = await ensureSeller();
  const tag = Date.now().toString(36).toUpperCase(); // unique names so filters/search are unambiguous

  const visible = async (page: Page, text: string, timeout = 8000) =>
    page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout }).then(() => true, () => false);
  const gone = async (page: Page, text: string, timeout = 8000) =>
    page.getByText(text, { exact: false }).first().waitFor({ state: "hidden", timeout }).then(() => true, () => false);

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
  const api = (page: Page, path: string, init?: RequestInit) =>
    page.evaluate(async ([p, i]: [string, RequestInit | undefined]) => (await fetch(`/api/backend/gateway/${p}`, i)).json(), [path, init] as [string, RequestInit | undefined]);

  // ---- seed: three items with distinct stock levels ------------------------------------------
  const admin = await login("admin", "ChangeMe123!", { width: 1280, height: 800 }, "/dashboard");
  const make = (name: string, price: number, quantity: number) =>
    api(admin.page, "items/intake", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, price, categoryId: null, imageUrl: null, quantity }),
    });
  const plentiful = await make(`Plentiful ${tag}`, 10, 50);
  const lowItem = await make(`Receivable ${tag}`, 20, 2);
  const lowTrue = await make(`Lowstock ${tag}`, 20, 3); // never touched, so it stays low
  const promoItem = await make(`Promo ${tag}`, 100, 30);
  await api(admin.page, "items/discount", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ skus: [promoItem.sku], percentage: 0.25 }),
  });
  // Sell the last of one item to make an out-of-stock one.
  const outItem = await make(`Sellout ${tag}`, 5, 1);
  await api(admin.page, `scan/${outItem.barcode}/sell`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quantity: 1 }),
  });

  // ---- receive --------------------------------------------------------------------------------
  {
    const { context, page } = await login(seller.username, seller.password, { width: 390, height: 844 }, "/scan");
    await page.getByRole("link", { name: "Receive" }).click();
    await page.waitForURL("**/receive");
    check("receive: seller has Scan / Receive / Stock tabs", (await page.locator("nav[aria-label=Main] a").count()) === 3);

    await page.getByLabel("Barcode").fill(lowItem.barcode);
    await page.getByRole("button", { name: "Look up" }).click();
    check("receive: item found with current stock", await visible(page, "On hand · 2"));

    await page.getByRole("button", { name: "+10" }).click();
    await page.getByRole("button", { name: "+5" }).click();
    check("receive: presets add up (1 + 10 + 5 = 16)", (await page.locator("#receive-quantity").inputValue()) === "16");
    check("receive: new-total preview (2 + 16 = 18)", await visible(page, "18"));

    await page.locator("#receive-quantity").fill("");
    check("receive: empty quantity disables confirm", await page.getByRole("button", { name: /to stock/ }).isDisabled());
    await page.locator("#receive-quantity").fill("9999999");
    check("receive: quantity is capped at 99,999", (await page.locator("#receive-quantity").inputValue()) === "99999");
    await page.locator("#receive-quantity").fill("abc4x");
    check("receive: non-digits are stripped", (await page.locator("#receive-quantity").inputValue()) === "4");

    await page.screenshot({ path: `${SCREENS}/p2-phone-receive.png`, fullPage: true });
    await page.getByRole("button", { name: /Add 4 to stock/ }).click();
    check("receive: success notice", await visible(page, `Added 4 × Receivable ${tag} · now 6 on hand`));
    check("receive: listed under Recently received", await visible(page, "Recently received"));
    const after = await api(page, `scan/${lowItem.barcode}`);
    check("receive: backend stock actually increased", after.quantityOnHand === 6, `stock=${after.quantityOnHand}`);

    await page.getByLabel("Barcode").fill("000000000000");
    await page.getByRole("button", { name: "Look up" }).click();
    check("receive: unknown barcode explains what to do", await visible(page, "needs to be added to the catalog first"));

    // Prefill from the Stock screen's Receive button.
    await page.goto(`${baseUrl}/receive?barcode=${plentiful.barcode}`);
    check("receive: ?barcode= looks the item up automatically", await visible(page, `Plentiful ${tag}`));
    check("receive: prefilled item shows its stock", await visible(page, "On hand · 50"));
    await context.close();
  }

  // ---- stock lookup ---------------------------------------------------------------------------
  {
    const { context, page } = await login(seller.username, seller.password, { width: 390, height: 844 }, "/scan");
    await page.getByRole("link", { name: "Stock" }).click();
    await page.waitForURL("**/stock");
    await page.getByLabel("Search items").fill(tag);
    check("stock: search narrows to this run's 5 items", await visible(page, "5 items"));

    const count = async (label: string) => Number((await page.getByRole("button", { name: new RegExp(`^${label}`) }).innerText()).match(/\d+$/)?.[0]);
    const listNames = async () => page.locator("ul li h3").allInnerTexts();

    // The chip counts are for the whole catalog, so check the *lists* for our own items.
    await page.getByRole("button", { name: /^Low stock/ }).click();
    let names = await listNames();
    check("stock: Low filter shows the low item", names.some((n) => n.startsWith("Lowstock")), names.join(" | "));
    check("stock: Low filter hides plentiful/promo/out items", !names.some((n) => /^(Plentiful|Promo|Sellout|Receivable)/.test(n)));

    await page.getByRole("button", { name: /^Out of stock/ }).click();
    names = await listNames();
    check("stock: Out filter shows the sold-out item", names.some((n) => n.startsWith("Sellout")), names.join(" | "));
    check("stock: Out filter hides in-stock items", !names.some((n) => /^(Plentiful|Lowstock|Promo)/.test(n)));

    await page.getByRole("button", { name: /^On promo/ }).click();
    names = await listNames();
    check("stock: Promo filter shows only the discounted item", names.length === 1 && names[0].startsWith("Promo"), names.join(" | "));
    check("stock: promo card shows 25% and the sale price", (await visible(page, "25%")) && (await visible(page, "$75.00")));
    check("stock: filter counts are numbers", Number.isFinite(await count("All")) && Number.isFinite(await count("Low stock")));

    await page.getByRole("button", { name: /^All/ }).click();
    await page.getByLabel("Search items").fill(plentiful.barcode);
    names = await listNames();
    check("stock: searching by barcode finds the item", names.length === 1 && names[0].startsWith("Plentiful"), names.join(" | "));
    await page.getByLabel("Search items").fill("zzz-no-such-item");
    check("stock: no-match empty state", await visible(page, "No items match"));
    await page.getByRole("button", { name: "Clear search" }).click();
    check("stock: clearing search restores the list", (await listNames()).length > 4);

    // Cross-screen freshness: stock received on /receive must show up here without a reload.
    await page.getByLabel("Search items").fill(`Receivable ${tag}`);
    check("stock: shows current stock (6 from the earlier receive)", await visible(page, "6 in stock"));
    await page.screenshot({ path: `${SCREENS}/p2-phone-stock.png`, fullPage: true });

    // "Receive" on a card receives in place: the search stays, and the card updates.
    await page.getByLabel("Search items").fill(`Receivable ${tag}`);
    await page.locator("ul li").getByRole("button", { name: "Receive" }).first().click();
    const dialog = page.getByRole("dialog");
    check("stock: Receive opens a dialog for that item", (await dialog.getByRole("heading").innerText()).includes(`Receivable ${tag}`));
    await dialog.getByRole("button", { name: /^Add 5 to/ }).click(); // 1 + 5 = 6
    await dialog.getByRole("button", { name: "Add to stock" }).click();
    await dialog.waitFor({ state: "detached" });
    check("stock: stays on the stock screen with the search kept", new URL(page.url()).pathname === "/stock" && (await page.getByLabel("Search items").inputValue()) === `Receivable ${tag}`);
    check("stock: the card shows the new stock (6 + 6 = 12)", await visible(page, "12 in stock"));
    await context.close();
  }

  // ---- desktop layouts + admin navigation -----------------------------------------------------
  {
    const { context, page } = await login("admin", "ChangeMe123!", { width: 1280, height: 800 }, "/dashboard");
    const links = await page.locator("nav[aria-label=Main] a").allInnerTexts();
    check("admin nav: has Receive Stock and Stock Lookup", links.includes("Receive Stock") && links.includes("Stock Lookup"), links.join(", "));
    await page.getByRole("link", { name: "Stock Lookup" }).click();
    await page.waitForURL("**/stock");
    await page.getByLabel("Search items").fill(tag);
    await visible(page, "5 items");
    await page.screenshot({ path: `${SCREENS}/p2-desktop-stock.png` });
    await page.goto(`${baseUrl}/receive?barcode=${promoItem.barcode}`);
    await visible(page, `Promo ${tag}`);
    await page.screenshot({ path: `${SCREENS}/p2-desktop-receive.png` });
    await context.close();
  }

  await api(admin.page, "items/discount/remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skus: [promoItem.sku] }) });
  await admin.context.close();
  await browser.close();

  // Leave no promotions behind in the shared dev database.
  await removeDiscountsFor(["Promo "]);
});

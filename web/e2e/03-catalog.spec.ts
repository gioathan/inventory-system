/* eslint-disable @typescript-eslint/no-explicit-any */
import { chromium, test, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import * as ZX from "@zxing/library";
import { SCREENS, baseUrl } from "./support/env";
import { check } from "./support/check";
import { ensureSeller } from "./support/seller";

type Viewport = { width: number; height: number };

test("catalog, labels that really scan, printing, new SKUs, categories and discounts", async () => {
  const seller = await ensureSeller();
  const tag = Date.now().toString(36).toUpperCase();

  const visible = (page: Page, text: string, timeout = 8000) =>
    page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout }).then(() => true, () => false);

  // Decode a PNG buffer with a real barcode reader restricted to one symbology.
  function decode(png: Buffer, format: ZX.BarcodeFormat) {
    const warn = console.warn, log = console.log, err = console.error;
    console.warn = console.log = console.error = () => {};
    try { return decodeQuiet(png, format); } finally { console.warn = warn; console.log = log; console.error = err; }
  }
  function decodeQuiet(png: Buffer, format: ZX.BarcodeFormat) {
    const { data, width, height } = PNG.sync.read(png);
    const lum = new Uint8ClampedArray(width * height);
    for (let i = 0; i < width * height; i++) lum[i] = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000;
    const reader = new ZX.MultiFormatReader();
    reader.setHints(new Map<ZX.DecodeHintType, unknown>([[ZX.DecodeHintType.POSSIBLE_FORMATS, [format]], [ZX.DecodeHintType.TRY_HARDER, true]]));
    try {
      return reader.decode(new ZX.BinaryBitmap(new ZX.HybridBinarizer(new ZX.RGBLuminanceSource(lum, width, height)))).getText();
    } catch {
      return null;
    }
  }

  const browser = await chromium.launch();
  async function login(user: string, pass: string, viewport: Viewport, landing: string, extra: Record<string, unknown> = {}) {
    const context = await browser.newContext({ viewport, ...extra });
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
    page.evaluate(async ([p, i]: [string, RequestInit | undefined]) => { const r = await fetch(`/api/backend/gateway/${p}`, i); return r.json(); }, [path, init] as [string, RequestInit | undefined]);
  const post = (page: Page, path: string, body: unknown) =>
    api(page, path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  // ---- seed -----------------------------------------------------------------------------------
  const admin = await login("admin", "ChangeMe123!", { width: 1280, height: 900 }, "/dashboard", { deviceScaleFactor: 3 });
  const cat = await post(admin.page, "categories", { name: `Cat ${tag}` });
  const make = (name: string, price: number, quantity: number, extra: Record<string, unknown> = {}) =>
    post(admin.page, "items/intake", { name, price, quantity, categoryId: null, imageUrl: null, ...extra });
  const alpha = await make(`Alpha ${tag}`, 10, 50, { categoryId: cat.id });
  const bravo = await make(`Bravo ${tag}`, 20, 2, { categoryId: cat.id });
  const mfrBarcode = `MFR-${tag}`;
  const charlie = await make(`Charlie ${tag}`, 30, 40, { barcode: mfrBarcode });
  const evil = await make(`=1+1 ${tag}`, 5, 5);
  check("seed: manufacturer barcode registered verbatim", charlie.barcode === mfrBarcode, charlie.barcode);

  // ---- catalog table (desktop) ----------------------------------------------------------------
  {
    const page = admin.page;
    const links = await page.locator("nav[aria-label=Main] a").allInnerTexts();
    check("nav: Catalog group present", ["Items & SKUs", "Categories", "Discounts & Promos"].every((l) => links.includes(l)), links.join(", "));

    await page.goto(`${baseUrl}/catalog`);
    await page.getByLabel("Search items").fill(tag);
    check("catalog: search narrows to this run", await visible(page, "4 of 4") || await visible(page, "1–4 of 4"));
    check("catalog: table shown on desktop", await page.locator("table").isVisible());

    const names = async () => page.locator("tbody tr td:nth-child(2) button").allInnerTexts();
    await page.getByRole("button", { name: /^Price/ }).click();
    let order = await names();
    check("catalog: sort by price ascending", order[0].startsWith("=1+1") && order[order.length - 1].startsWith("Charlie"), order.join(" | "));
    check("catalog: aria-sort reflects direction", (await page.locator("th[aria-sort=ascending]").count()) === 1);
    await page.getByRole("button", { name: /^Price/ }).click();
    order = await names();
    check("catalog: sort by price descending", order[0].startsWith("Charlie"), order.join(" | "));

    // ---- item panel + label ------------------------------------------------------------------
    await page.getByRole("button", { name: `Alpha ${tag}` }).click();
    await page.waitForURL(`**/catalog?sku=${alpha.sku}`);
    check("panel: opens docked with the item", await visible(page, "Label") && (await page.locator("aside").getByText(`Alpha ${tag}`).count()) > 0);
    check("panel: shows category name", await visible(page, `Cat ${tag}`));
    await page.screenshot({ path: `${SCREENS}/p3-desktop-catalog.png` });

    const label = page.locator("aside");
    const bar = await label.locator('svg[aria-label^="Barcode"]').screenshot({ scale: "device" });
    const qr = await label.locator('svg[aria-label^="QR code"]').screenshot({ scale: "device" });
    writeFileSync(`${SCREENS}/p3-label-bar.png`, bar);
    writeFileSync(`${SCREENS}/p3-label-qr.png`, qr);
    check("label: Code128 decodes to the item's barcode", decode(bar, ZX.BarcodeFormat.CODE_128) === alpha.barcode, `decoded=${decode(bar, ZX.BarcodeFormat.CODE_128)}`);
    check("label: QR decodes to the item's barcode", decode(qr, ZX.BarcodeFormat.QR_CODE) === alpha.barcode, `decoded=${decode(qr, ZX.BarcodeFormat.QR_CODE)}`);

    await page.getByRole("button", { name: "Close details" }).click();
    await page.waitForURL((u) => !u.search.includes("sku="));
    await page.getByRole("button", { name: `Charlie ${tag}` }).click();
    await visible(page, "Label");
    const cBar = await page.locator("aside").locator('svg[aria-label^="Barcode"]').screenshot({ scale: "device" });
    check("label: alphanumeric manufacturer barcode decodes too", decode(cBar, ZX.BarcodeFormat.CODE_128) === mfrBarcode, `decoded=${decode(cBar, ZX.BarcodeFormat.CODE_128)}`);
    await page.getByRole("button", { name: "Close details" }).click();

    // ---- CSV export --------------------------------------------------------------------------
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV" }).click()]);
    const csv = readFileSync(await download.path(), "utf8");
    check("csv: header and rows", csv.startsWith("SKU,Name,Barcode,Category") && csv.includes(`Alpha ${tag}`));
    check("csv: formula-looking name is neutralised", csv.includes(`'=1+1 ${tag}`) && !csv.includes(`,=1+1 ${tag}`));

    // ---- bulk discount -----------------------------------------------------------------------
    await page.locator(`table`).getByLabel(`Select Alpha ${tag}`).check();
    await page.locator(`table`).getByLabel(`Select Bravo ${tag}`).check();
    check("bulk: selection count", await visible(page, "2 selected"));
    await page.getByRole("button", { name: "Batch discount" }).click();
    const apply = page.getByRole("button", { name: /^Apply/ });
    check("bulk: apply disabled until a valid percent", await apply.isDisabled());
    await page.getByLabel("Percent off").fill("150");
    check("bulk: 150% is rejected", await apply.isDisabled());
    await page.getByLabel("Percent off").fill("15");
    await apply.click();
    check("bulk: discount shows in the table", await visible(page, "15% off"));
    const a1 = await api(page, `scan/${alpha.barcode}`);
    check("bulk: backend applied it (10 -> 8.50)", Math.abs(a1.effectivePrice - 8.5) < 0.001 && Math.abs(a1.price - 10) < 0.001, `eff=${a1.effectivePrice} list=${a1.price}`);
    check("bulk: selection cleared afterwards", (await page.getByText("selected").count()) === 0);

    await page.locator(`table`).getByLabel(`Select Alpha ${tag}`).check();
    await page.getByRole("button", { name: "Batch discount" }).click();
    await page.getByRole("button", { name: "Remove discount" }).click();
    await page.waitForTimeout(800);
    const a2 = await api(page, `scan/${alpha.barcode}`);
    check("bulk: removing restores the list price exactly", a2.discountPercentage === null && Math.abs(a2.effectivePrice - 10) < 0.001);

    // ---- print labels ------------------------------------------------------------------------
    await page.locator(`table`).getByLabel(`Select Alpha ${tag}`).check();
    await page.locator(`table`).getByLabel(`Select Bravo ${tag}`).check();
    await page.getByRole("link", { name: "Print labels" }).click();
    await page.waitForURL("**/labels/print?*");
    await visible(page, "2 labels");
    check("print: one label per selected item", (await page.locator(".label-cell").count()) === 2);
    await page.getByLabel("Copies of each").selectOption("3");
    check("print: copies multiply labels", (await page.locator(".label-cell").count()) === 6);

    await page.getByLabel("Paper").selectOption("roll");
    await page.emulateMedia({ media: "print" });
    check("print: shell chrome hidden when printing", !(await page.locator("aside").first().isVisible()) && !(await page.locator("header").first().isVisible()));
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    check("print: label-printer mode makes one page per label (6)", pages === 6, `pages=${pages}`);
    writeFileSync(`${SCREENS}/p3-labels-roll.pdf`, pdf);

    await page.emulateMedia({ media: "screen" }); // the controls are print:hidden, so switch back to use them
    await page.getByLabel("Paper").selectOption("sheet");
    await page.emulateMedia({ media: "print" });
    const sheetPdf = await page.pdf({ printBackground: true });
    const sheetPages = (sheetPdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    check("print: sheet mode packs labels onto few pages", sheetPages >= 1 && sheetPages < 6, `pages=${sheetPages}`);
    await page.emulateMedia({ media: "screen" });
    await page.screenshot({ path: `${SCREENS}/p3-desktop-print.png` });
  }

  // ---- new SKU form ---------------------------------------------------------------------------
  {
    const page = admin.page;
    await page.goto(`${baseUrl}/catalog/new`);
    await page.getByRole("button", { name: "Create item" }).click();
    check("form: empty submit shows field errors", (await visible(page, "Enter a name.")) && (await visible(page, "Enter a price like 12.99.")));
    await page.getByLabel("Name").fill(`Delta ${tag}`);
    await page.getByLabel("Price").fill("abc");
    await page.getByLabel("Barcode").fill("has space");
    await page.getByRole("button", { name: "Create item" }).click();
    check("form: bad price and barcode are rejected client-side", (await visible(page, "Enter a price like 12.99.")) && (await visible(page, "Use letters, digits")));
    await page.getByLabel("Image", { exact: true }).fill("not a url");
    await page.getByLabel("Barcode").fill("");
    await page.getByLabel("Price").fill("12.5");
    await page.getByRole("button", { name: "Create item" }).click();
    check("form: bad image address is rejected", await visible(page, "Enter a full web address"));

    await page.getByLabel("Image", { exact: true }).fill("");
    await page.getByLabel("Category").click();
    await page.getByLabel("Category").fill(`Cat ${tag}`);
    await page.getByRole("option", { name: `Cat ${tag}`, exact: true }).click();
    await page.getByLabel("Starting stock").fill("7");
    await page.screenshot({ path: `${SCREENS}/p3-desktop-new.png` });
    await page.getByRole("button", { name: "Create item" }).click();
    await page.waitForURL("**/catalog?sku=*");
    check("form: creating lands on the item's panel", await visible(page, `Delta ${tag}`));
    check("form: the chosen category was saved", (await page.locator("aside, [role=dialog]").getByText(`Cat ${tag}`).count()) > 0);
    const created = await api(page, `scan/${new URL(page.url()).searchParams.get("sku")}`);
    check("form: item exists with the entered stock (7)", created.quantityOnHand === 7 && created.name === `Delta ${tag}`, `qty=${created.quantityOnHand}`);

    await page.goto(`${baseUrl}/catalog/new`);
    await page.getByLabel("Name").fill(`Dup ${tag}`);
    await page.getByLabel("Price").fill("3");
    await page.getByLabel("Barcode").fill(mfrBarcode);
    await page.getByRole("button", { name: "Create item" }).click();
    check("form: duplicate barcode is reported on the barcode field", await visible(page, "An item with that barcode already exists."));

    // Upload with Cloudflare unconfigured must degrade to a helpful message, not an error page.
    const png = PNG.sync.write(Object.assign(new PNG({ width: 2, height: 2 }), { data: Buffer.alloc(16, 255) }));
    writeFileSync(`${SCREENS}/p3-tiny.png`, png);
    await page.getByLabel("Upload an image file").setInputFiles(`${SCREENS}/p3-tiny.png`);
    check("form: unconfigured image upload explains what to do", await visible(page, "Image uploads aren't set up on this server yet"));
    await page.getByLabel("Image", { exact: true }).fill("https://example.com/x.png");
    check("form: valid image address shows a preview slot", (await page.locator('img[alt="Item preview"], div:has(> svg.lucide-package-x)').count()) > 0);
  }

  // ---- editing an item -------------------------------------------------------------------------
  {
    const page = admin.page;
    const newBarcode = `EDIT-${tag}`;
    await page.goto(`${baseUrl}/catalog?sku=${alpha.sku}`);
    await page.getByRole("button", { name: "Edit item" }).click();
    check("edit: dialog opens pre-filled with the current values", (await page.getByLabel("Name").inputValue()) === `Alpha ${tag}`);
    check("edit: current category is pre-selected, not blank", (await page.getByRole("combobox", { name: "Category" }).inputValue()).startsWith(`Cat ${tag}`));

    await page.getByLabel("Name").fill(`Alpha Edited ${tag}`);
    await page.getByLabel("Price").fill("12.34");
    await page.getByRole("textbox", { name: "Barcode" }).fill(newBarcode);
    await page.getByRole("button", { name: "Save changes" }).click();
    check("edit: dialog closes and the panel shows the new name", await visible(page, `Alpha Edited ${tag}`));
    check("edit: category survived an edit that didn't touch it", await visible(page, `Cat ${tag}`));

    const bySku = await api(page, `scan/${newBarcode}`);
    check("edit: new barcode resolves to the edited item", bySku.name === `Alpha Edited ${tag}` && bySku.price === 12.34, JSON.stringify(bySku));
    const oldGone = await page.evaluate((barcode) => fetch(`/api/backend/gateway/scan/${barcode}`).then((r) => r.status), alpha.barcode);
    check("edit: old barcode no longer resolves", oldGone === 404, `status=${oldGone}`);

    check("edit: sku is unchanged", bySku.sku === alpha.sku, bySku.sku);
    // Keep the seed record accurate — the discount block below still refers to alpha's category,
    // which this edit never touched, but its barcode is now the new one.
    alpha.barcode = newBarcode;
    alpha.name = `Alpha Edited ${tag}`;
  }

  // ---- receiving without leaving the catalog --------------------------------------------------
  {
    const page = admin.page;
    await page.goto(`${baseUrl}/catalog?sku=${charlie.sku}`);
    await page.getByRole("button", { name: "Receive stock" }).click();
    const dialog = page.getByRole("dialog");
    check("receive: the panel opens a receive dialog for the item", (await dialog.getByRole("heading").innerText()).includes(`Charlie ${tag}`));
    await dialog.getByRole("button", { name: /^Add 5 to/ }).click(); // default 1 + 5 = 6
    await dialog.getByRole("button", { name: "Add to stock" }).click();
    await dialog.waitFor({ state: "detached" });
    check("receive: stays on the same item in the catalog", page.url().endsWith(`/catalog?sku=${charlie.sku}`), page.url());
    check("receive: the panel shows the new stock (40 + 6 = 46)", await visible(page, "46 in stock"));

    // Several at once from a selection; an empty quantity skips that item.
    await page.getByLabel("Search items").fill(tag);
    await page.locator("table").getByLabel(`Select Bravo ${tag}`).check();
    await page.locator("table").getByLabel(`Select =1+1 ${tag}`).check();
    await page.getByRole("region", { name: "Bulk actions" }).getByRole("button", { name: "Receive stock" }).click();
    check("receive: bulk dialog lists the selected items", (await dialog.getByRole("heading").innerText()).includes("Receive 2 items"));
    await dialog.getByLabel(`Bravo ${tag}`, { exact: true }).fill("3");
    await dialog.getByRole("button", { name: "Add to stock (1)" }).click();
    await dialog.waitFor({ state: "detached" });
    const bravoStock = (await api(page, `scan/${bravo.barcode}`)).quantityOnHand;
    const evilStock = (await api(page, `scan/${evil.barcode}`)).quantityOnHand;
    check("receive: bulk added only the filled-in item (Bravo 2 + 3 = 5, the other untouched at 5)", bravoStock === 5 && evilStock === 5, `bravo=${bravoStock} other=${evilStock}`);
    check("receive: selection clears afterwards", (await page.getByRole("region", { name: "Bulk actions" }).count()) === 0);
  }

  // ---- categories -----------------------------------------------------------------------------
  {
    const page = admin.page;
    await page.goto(`${baseUrl}/categories`);
    check("categories: existing category shows its item count", await visible(page, `Cat ${tag}`) && (await visible(page, "3 items")));
    await page.getByLabel("New category").fill(`Cat2 ${tag}`);
    await page.getByRole("button", { name: "Add category" }).click();
    check("categories: new category appears with 0 items", await visible(page, `Cat2 ${tag}`) && (await visible(page, "0 items")));
    await page.getByLabel("New category").fill(`Cat2 ${tag}`);
    await page.getByRole("button", { name: "Add category" }).click();
    check("categories: duplicate name is refused", await visible(page, "already exists"));
  }

  // ---- discounts page -------------------------------------------------------------------------
  {
    const page = admin.page;
    await page.goto(`${baseUrl}/discounts`);
    // The category list loads asynchronously; selecting before it arrives silently leaves the target
    // on "All items", which is how an earlier version of this test discounted the whole catalog.
    await page.getByLabel("Apply to").click();
    await page.getByLabel("Apply to").fill(`Cat ${tag} `);
    await page.getByRole("option", { name: new RegExp(`^Cat ${tag} \\(`) }).waitFor({ state: "visible", timeout: 15000 });
    const options = await page.getByRole("option").allInnerTexts();
    const target = options.find((o) => o.startsWith(`Cat ${tag} `));
    if (!target) throw new Error("category option never appeared; refusing to continue");
    await page.getByRole("option", { name: target, exact: true }).click();
    const setBtn = page.getByRole("button", { name: /^Set discount for/ });
    const btnText = await setBtn.innerText();
    const targeted = Number(btnText.match(/for (\d+) item/)?.[1]);
    check("discounts: category target covers exactly this run's 3 items", targeted === 3, btnText);
    if (targeted !== 3) throw new Error(`refusing to apply a discount to ${targeted} items`);
    await setBtn.click();
    await page.getByLabel("Percent off").fill("25");
    await page.getByRole("button", { name: "Apply 25%" }).click();
    check("discounts: category promo appears in Active promotions", await visible(page, `Active promotions (`) && (await visible(page, "25% off")));
    const bravoNow = await api(page, `scan/${bravo.barcode}`);
    check("discounts: applied to every item in the category", Math.abs(bravoNow.effectivePrice - 15) < 0.001, `eff=${bravoNow.effectivePrice}`);
    await page.screenshot({ path: `${SCREENS}/p3-desktop-discounts.png` });
    await page.getByLabel(`Select ${alpha.name}`).check(); // renamed by the edit step above
    await page.getByRole("button", { name: /Change or remove 1 selected/ }).click();
    await page.getByRole("button", { name: "Remove discount" }).click();
    await page.waitForTimeout(800);
    const alphaNow = await api(page, `scan/${alpha.barcode}`);
    check("discounts: removing one leaves the others running", alphaNow.discountPercentage === null && (await api(page, `scan/${bravo.barcode}`)).discountPercentage !== null);
  }

  // ---- phone: cards + sheet -------------------------------------------------------------------
  {
    const { context, page } = await login("admin", "ChangeMe123!", { width: 390, height: 844 }, "/dashboard");
    await page.goto(`${baseUrl}/catalog`);
    await page.getByLabel("Search items").fill(tag);
    await visible(page, alpha.name);
    check("phone: cards instead of a table", !(await page.locator("table").isVisible()) && (await page.locator("ul li").count()) >= 4);
    await page.screenshot({ path: `${SCREENS}/p3-phone-catalog.png` });
    await page.getByRole("button", { name: new RegExp(alpha.name) }).click();
    check("phone: item opens as a sheet", await visible(page, "Label") && (await page.getByRole("dialog").count()) === 1);
    await page.waitForTimeout(700); // let the slide-in animation finish
    await page.screenshot({ path: `${SCREENS}/p3-phone-sheet.png` });
    await page.keyboard.press("Escape");
    await page.waitForURL((u) => !u.search.includes("sku="));
    const closed = await page.getByRole("dialog").waitFor({ state: "detached", timeout: 5000 }).then(() => true, () => false);
    check("phone: Escape closes the sheet and clears the URL", closed);
    await page.goto(`${baseUrl}/catalog/new`);
    await page.screenshot({ path: `${SCREENS}/p3-phone-new.png`, fullPage: true });
    await context.close();
  }

  // ---- authorization --------------------------------------------------------------------------
  {
    const { context, page } = await login(seller.username, seller.password, { width: 1280, height: 800 }, "/scan");
    await page.goto(`${baseUrl}/catalog`);
    check("authz: seller is bounced from /catalog to /scan", new URL(page.url()).pathname === "/scan");
    const direct = await page.evaluate(async () => (await fetch("/api/backend/gateway/items/discount", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skus: ["x"], percentage: 0.1 }) })).status);
    check("authz: backend refuses a seller's discount call (403)", direct === 403, `status=${direct}`);
    const editDirect = await page.evaluate(
      async ([sku, barcode]: [string, string]) =>
        (
          await fetch(`/api/backend/gateway/items/${sku}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "x", price: 1, barcode, categoryId: null, imageUrl: null }),
          })
        ).status,
      [alpha.sku, alpha.barcode] as [string, string],
    );
    check("authz: backend refuses a seller's item edit (403)", editDirect === 403, `status=${editDirect}`);
    await context.close();
  }

  // Leave no promotions behind in the shared dev database.
  await admin.page.evaluate(async (t) => {
    const g = await (await fetch("/api/backend/dashboard/graphql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "{ items { sku name discountPercentage } }" }) })).json();
    const skus = g.data.items.filter((i: any) => i.name.includes(t) && i.discountPercentage !== null).map((i: any) => i.sku);
    if (skus.length) await fetch("/api/backend/gateway/items/discount/remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skus }) });
  }, tag);
  await admin.context.close();
  await browser.close();
});

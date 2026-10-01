/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, type Page } from "@playwright/test";
import { PNG } from "pngjs";
import enCatalog from "../src/messages/en/catalog.json";
import enStock from "../src/messages/en/stock.json";
import { SCREENS, baseUrl } from "./support/env";
import { check } from "./support/check";

test("item cards: clicking the image opens it full size; table thumbnails still open the item", async ({ browser }) => {
  const tag = Date.now().toString(36).toUpperCase();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/login`);
  await page.fill("#username", "admin");
  await page.fill("#password", "ChangeMe123!");
  await page.click("button[type=submit]");
  await page.waitForURL("**/dashboard", { timeout: 30000 });

  // A real 600×400 image, uploaded through the app's own upload endpoint, so the zoomed view has
  // something bigger than its thumbnail to show.
  const png = new PNG({ width: 600, height: 400 });
  for (let i = 0; i < png.data.length; i += 4) {
    const x = (i / 4) % 600;
    png.data[i] = Math.round((x / 600) * 255);
    png.data[i + 1] = 120;
    png.data[i + 2] = 200;
    png.data[i + 3] = 255;
  }
  const bytes = [...PNG.sync.write(png)];
  const upload = await page.evaluate(async (data: number[]) => {
    const body = new FormData();
    body.append("file", new Blob([new Uint8Array(data)], { type: "image/png" }), "zoom.png");
    const r = await fetch("/api/backend/gateway/images", { method: "POST", body });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, bytes);
  test.skip(upload.status !== 200, "image uploads aren't configured in this environment");
  const imageUrl: string = upload.body.imageUrl;

  const name = `Zoom ${tag}`;
  const item = await page.evaluate(async (b: any) => {
    const r = await fetch("/api/backend/gateway/items/intake", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
    return r.json();
  }, { name, price: 5, quantity: 3, categoryId: null, imageUrl });

  const zoomButton = (p: Page) => p.getByRole("button", { name: `View full image of ${name}` });
  const dialogImage = (p: Page) => p.getByRole("dialog").locator(`img[src="${imageUrl}"]`);

  // ---- catalog item panel -----------------------------------------------------------------------
  await page.goto(`${baseUrl}/catalog?sku=${item.sku}`);
  await zoomButton(page).waitFor({ timeout: 15000 });
  const thumb = await zoomButton(page).locator("img").boundingBox();
  await zoomButton(page).click();
  await dialogImage(page).waitFor({ timeout: 5000 });
  const full = await dialogImage(page).boundingBox();
  check("panel: clicking the image opens a dialog with the same image", !!full);
  check(
    "panel: the dialog shows it at full size, much larger than the thumbnail",
    !!thumb && !!full && full.width >= 590 && full.width > thumb.width * 5,
    `thumb ${thumb?.width}px → full ${full?.width}px`,
  );
  check(
    "panel: the whole image is shown, not cropped (aspect ratio kept)",
    !!full && Math.abs(full.width / full.height - 1.5) < 0.02,
    `${full?.width}×${full?.height}`,
  );
  await page.screenshot({ path: `${SCREENS}/p10-zoom-panel.png` });
  await page.keyboard.press("Escape");
  await dialogImage(page).waitFor({ state: "hidden", timeout: 5000 });
  check("panel: Escape closes the full-size view", true);
  check("panel: the item panel is still open underneath", await zoomButton(page).isVisible());

  // ---- stock lookup card ------------------------------------------------------------------------
  await page.goto(`${baseUrl}/stock`);
  await page.getByLabel(enStock.searchLabel).fill(name);
  await zoomButton(page).first().click({ timeout: 15000 });
  check("stock card: clicking the image opens it full size", await dialogImage(page).waitFor({ timeout: 5000 }).then(() => true, () => false));
  await page.keyboard.press("Escape");

  // ---- receive card -----------------------------------------------------------------------------
  await page.goto(`${baseUrl}/receive?barcode=${item.barcode}`);
  await zoomButton(page).first().click({ timeout: 15000 });
  check("receive card: clicking the image opens it full size", await dialogImage(page).waitFor({ timeout: 5000 }).then(() => true, () => false));
  await page.keyboard.press("Escape");

  // ---- catalog table thumbnails are NOT zoom buttons: the row click still opens the item ---------
  await page.goto(`${baseUrl}/catalog`);
  await page.getByLabel(enCatalog.list.searchLabel).fill(name);
  const row = page.getByRole("row", { name: new RegExp(name) }).first();
  await row.waitFor({ timeout: 15000 });
  check("table: the row thumbnail is not a zoom button", (await row.getByRole("button", { name: /View full image/ }).count()) === 0);
  await row.locator("img").first().click();
  await page.waitForURL(`**sku=${item.sku}**`, { timeout: 5000 }).catch(() => {});
  check("table: clicking the thumbnail still opens the item panel", new URL(page.url()).searchParams.get("sku") === item.sku);

  await context.close();
});

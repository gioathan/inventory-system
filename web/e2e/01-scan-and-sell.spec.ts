import { chromium, test, type Browser, type Page } from "@playwright/test";
import { makeY4m } from "./support/camera";
import { CAM, SCREENS, baseUrl } from "./support/env";
import { check } from "./support/check";
import { ensureSeller } from "./support/seller";
import { removeDiscountsFor } from "./support/cleanup";

type Viewport = { width: number; height: number };

test("seller scans, looks up and sells, by camera, hardware scanner or typing", async () => {
  const seller = await ensureSeller();

  const visible = async (page: Page, text: string, timeout = 8000) =>
    page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout }).then(() => true, () => false);

  const plain = await chromium.launch();

  // Fresh items every run so the test never depends on what earlier runs left behind.
  async function seed(): Promise<[string, string, string]> {
    const context = await plain.newContext();
    const page = await context.newPage();
    await page.goto(`${baseUrl}/login`);
    await page.fill("#username", "admin");
    await page.fill("#password", "ChangeMe123!");
    await page.click("button[type=submit]");
    await page.waitForURL("**/dashboard", { timeout: 30000 });
    const make = (name: string, price: number, quantity: number) =>
      page.evaluate(
        async ([n, p, q]: [string, number, number]) =>
          (await (await fetch("/api/backend/gateway/items/intake", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: n, price: p, categoryId: null, imageUrl: null, quantity: q }),
          })).json()).barcode,
        [name, price, quantity] as [string, number, number],
      );
    const a = await make("Sony WH-1000XM5 Headphones", 399.0, 20);
    const b = await make("Anker 737 Power Bank", 149.99, 1);
    const c = await make("Logitech MX Master 3S", 99.99, 3);
    await page.evaluate(async (sku) => fetch("/api/backend/gateway/items/discount", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skus: [sku], percentage: 0.12 }),
    }), a);
    await context.close();
    return [a, b, c];
  }
  const [A, B, C] = await seed();
  await makeY4m("qrcode", C, `${CAM}/qr.y4m`);
  await makeY4m("code128", B, `${CAM}/code128.y4m`);

  async function signedIn(browser: Browser, viewport: Viewport) {
    const context = await browser.newContext({ viewport, permissions: ["camera"] });
    const page = await context.newPage();
    await page.goto(`${baseUrl}/login`);
    await page.fill("#username", seller.username);
    await page.fill("#password", seller.password);
    await page.click("button[type=submit]");
    await page.waitForURL("**/scan", { timeout: 30000 });
    await page.waitForLoadState("networkidle");
    return { context, page };
  }

  const api = (page: Page, path: string, init?: RequestInit) =>
    page.evaluate(async ([p, i]: [string, RequestInit | undefined]) => (await fetch(`/api/backend/gateway/${p}`, i)).json(), [path, init] as [string, RequestInit | undefined]);

  // ---- 1. manual entry, discount + stock rendering -------------------------------------------
  {
    const { context, page } = await signedIn(plain, { width: 390, height: 844 });
    await page.getByLabel("Barcode").fill(A);
    await page.getByRole("button", { name: "Look up" }).click();
    check("manual: item name shown", await visible(page, "Sony WH-1000XM5 Headphones"));
    check("manual: discounted price shown", await visible(page, "$351.12"));
    check("manual: original price struck through", await visible(page, "$399.00"));
    check("manual: discount pill", await visible(page, "12% off"));
    check("manual: stock pill", await visible(page, "In stock · 20 units"));
    await page.screenshot({ path: `${SCREENS}/p1-phone-result.png`, fullPage: true });

    // ---- 2. hardware scanner: burst of keystrokes + Enter with NOTHING focused ---------------
    await page.getByRole("button", { name: /Clear/ }).click();
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.keyboard.type(C, { delay: 8 });
    await page.keyboard.press("Enter");
    check("wedge: scan with no focused input finds item", await visible(page, "Logitech MX Master 3S"));
    check("wedge: low-stock pill", await visible(page, "Low stock · 3 left"));

    // ---- 3. wedge Enter must NOT press a focused button (the accidental-sale hazard) ---------
    await page.getByRole("button", { name: /Confirm sale/ }).focus();
    await page.keyboard.type(A, { delay: 8 });
    await page.keyboard.press("Enter");
    check("wedge: scan while Confirm is focused looks up the new item", await visible(page, "Sony WH-1000XM5 Headphones"));
    const afterA = await api(page, `scan/${C}`);
    check("wedge: focused Confirm button was NOT triggered (stock unchanged)", afterA.quantityOnHand === 3, `stock=${afterA.quantityOnHand}`);

    // ---- 4. not found -------------------------------------------------------------------------
    await page.getByLabel("Barcode").fill("000000000000");
    await page.getByRole("button", { name: "Look up" }).click();
    check("not found: clear message", await visible(page, "No item found for barcode 000000000000"));
    await context.close();
  }

  // ---- 5. camera: decode a QR and a Code128 from the fake camera feed -------------------------
  for (const [label, file, expected] of [
    ["QR", `${CAM}/qr.y4m`, "Logitech MX Master 3S"],
    ["Code128", `${CAM}/code128.y4m`, "Anker 737 Power Bank"],
  ]) {
    const cam = await chromium.launch({
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${file}`],
    });
    const { context, page } = await signedIn(cam, { width: 390, height: 844 });
    await page.getByRole("button", { name: "Scan with camera" }).click();
    check(`camera ${label}: goes live`, await visible(page, "Camera live", 15000));
    check(`camera ${label}: decodes and looks up the item`, await visible(page, expected, 20000));
    if (label === "QR") await page.screenshot({ path: `${SCREENS}/p1-phone-camera.png`, fullPage: true });

    // Closing must actually release the camera, not just hide the preview.
    await page.evaluate(() => {
      (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks = (document.querySelector("video")?.srcObject as MediaStream | null)?.getTracks() ?? [];
    });
    await page.getByRole("button", { name: "Close camera" }).click();
    await page.waitForTimeout(500);
    const ended = await page.evaluate(() => (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks.length > 0 && (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks.every((t: MediaStreamTrack) => t.readyState === "ended"));
    check(`camera ${label}: closing stops the camera tracks`, ended);
    await context.close();
    await cam.close();
  }

  // ---- 6. a real sale ------------------------------------------------------------------------
  {
    const { context, page } = await signedIn(plain, { width: 1280, height: 800 });
    await page.getByLabel("Barcode").fill(C);
    await page.getByRole("button", { name: "Look up" }).click();
    await visible(page, "Logitech MX Master 3S");
    await page.getByRole("button", { name: "Increase quantity" }).click();
    await page.getByRole("button", { name: "Increase quantity" }).click();
    check("sale: total reflects quantity", await visible(page, "Confirm sale · $299.97"));
    await page.screenshot({ path: `${SCREENS}/p1-desktop-result.png` });
    await page.getByRole("button", { name: /Confirm sale/ }).click();
    check("sale: success notice with remaining stock", await visible(page, "Sold 3 × Logitech MX Master 3S · 0 left"));
    check("sale: recorded in this session", await visible(page, "This session"));
    const after = await api(page, `scan/${C}`);
    check("sale: backend stock actually decreased", after.quantityOnHand === 0, `stock=${after.quantityOnHand}`);

    await page.getByLabel("Barcode").fill(C);
    await page.getByRole("button", { name: "Look up" }).click();
    check("out of stock: pill shown", await visible(page, "Out of stock"));
    check("out of stock: no confirm button", (await page.getByRole("button", { name: /Confirm sale/ }).count()) === 0);
    await page.screenshot({ path: `${SCREENS}/p1-desktop-out.png` });

    // ---- 7. stale stock: someone else sells the last unit between lookup and confirm ---------
    await page.getByLabel("Barcode").fill(B);
    await page.getByRole("button", { name: "Look up" }).click();
    await visible(page, "In stock · 1 units").catch(() => {});
    await visible(page, "Low stock · 1 left");
    await api(page, `scan/${B}/sell`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quantity: 1 }) });
    await page.getByRole("button", { name: /Confirm sale/ }).click();
    check("conflict: explains the failed sale", await visible(page, "Insufficient stock"));
    check("conflict: refreshes to the real stock", await visible(page, "Out of stock"));
    await context.close();
  }

  await plain.close();

  // Leave no promotions behind in the shared dev database.
  await removeDiscountsFor(["Sony WH-1000XM5 Headphones"]);
});

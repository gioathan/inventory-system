import { test, type Browser, type Page } from "@playwright/test";
import elAuth from "../src/messages/el/auth.json";
import elCommon from "../src/messages/el/common.json";
import elNav from "../src/messages/el/nav.json";
import enAuth from "../src/messages/en/auth.json";
import enNav from "../src/messages/en/nav.json";
import { NAMESPACES } from "../src/i18n/config";
import { baseUrl } from "./support/env";
import { check } from "./support/check";
import { ensureSeller } from "./support/seller";

// next-intl renders a missing message as its full key path ("catalog.panel.title"), so any of
// these showing up as page text means a t() call points at a key that doesn't exist for this locale.
const RAW_KEY = new RegExp(`\\b(${NAMESPACES.join("|")})\\.[a-z][A-Za-z]+(\\.[A-Za-z]+)*\\b`);

const ADMIN_PAGES = [
  "/dashboard",
  "/catalog",
  "/catalog/new",
  "/catalog/bulk",
  "/categories",
  "/discounts",
  "/restock-sessions",
  "/staff",
  "/audit-log",
  "/scan",
  "/receive",
  "/stock",
];

test("language: toggle to Greek and back, Accept-Language fallback, every screen renders without missing keys", async ({ browser }) => {
  const seller = await ensureSeller();

  const visible = (page: Page, text: string, timeout = 8000) =>
    page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout }).then(() => true, () => false);

  async function newPage(b: Browser, locale = "en-US") {
    const context = await b.newContext({ viewport: { width: 1280, height: 900 }, locale });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));
    return { context, page, errors };
  }

  // ---- login page: English by default, the toggle flips it in place -----------------------------
  const { context, page, errors } = await newPage(browser);
  await page.goto(`${baseUrl}/login`);
  check("default: login page is English", await visible(page, enAuth.tagline));
  check("default: <html lang=en>", (await page.locator("html").getAttribute("lang")) === "en");

  await page.getByRole("button", { name: "Switch language" }).click();
  check("toggle: login page switches to Greek", await visible(page, elAuth.tagline));
  check("toggle: <html lang=el>", (await page.locator("html").getAttribute("lang")) === "el");
  check("toggle: form labels are Greek", await visible(page, elAuth.usernameLabel));

  // ---- the BFF's own error comes back in Greek too ---------------------------------------------
  await page.fill("#username", "admin");
  await page.fill("#password", "definitely-wrong");
  await page.click("button[type=submit]");
  check("login error: wrong password message is Greek", await visible(page, elAuth.incorrectCredentials));

  // ---- signed in, the choice sticks (cookie) across every admin screen --------------------------
  await page.fill("#password", "ChangeMe123!");
  await page.click("button[type=submit]");
  await page.waitForURL("**/dashboard", { timeout: 30000 });
  check("admin: sidebar group labels are Greek", await visible(page, elNav.groups.operations));
  check("admin: sidebar items are Greek", await visible(page, elNav.items.itemsAndSkus));
  check("admin: role label is Greek", await visible(page, elCommon.roles.Admin));

  for (const path of ADMIN_PAGES) {
    errors.length = 0;
    await page.goto(`${baseUrl}${path}`);
    await page.waitForLoadState("networkidle");
    const text = await page.locator("body").innerText();
    const raw = text.match(RAW_KEY);
    check(`greek ${path}: no raw message keys on screen`, !raw, raw?.[0]);
    check(`greek ${path}: still Greek after navigating`, (await page.locator("html").getAttribute("lang")) === "el");
    const intlOrHydration = errors.filter((e) => /MISSING_MESSAGE|IntlError|FORMATTING_ERROR|hydrat/i.test(e));
    check(`greek ${path}: no missing-message or hydration errors in console`, intlOrHydration.length === 0, intlOrHydration[0]);
  }

  // ---- and back to English ----------------------------------------------------------------------
  await page.goto(`${baseUrl}/dashboard`);
  await page.getByRole("button", { name: elCommon.switchLanguage }).click();
  check("toggle back: sidebar is English again", await visible(page, enNav.items.itemsAndSkus));
  check("toggle back: <html lang=en>", (await page.locator("html").getAttribute("lang")) === "en");
  await context.close();

  // ---- a Greek browser gets Greek on first visit, no toggle needed ------------------------------
  {
    const greek = await newPage(browser, "el-GR");
    await greek.page.goto(`${baseUrl}/login`);
    check("accept-language: a Greek browser lands on a Greek login page", await visible(greek.page, elAuth.tagline));

    // Seller shell too: bottom tab bar uses the nav namespace's seller keys.
    await greek.page.fill("#username", seller.username);
    await greek.page.fill("#password", seller.password);
    await greek.page.click("button[type=submit]");
    await greek.page.waitForURL("**/scan", { timeout: 30000 });
    check("seller: tab bar is Greek", await visible(greek.page, elNav.items.receive));
    await greek.context.close();
  }
});

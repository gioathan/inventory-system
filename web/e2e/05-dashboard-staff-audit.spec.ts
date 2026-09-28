/* eslint-disable @typescript-eslint/no-explicit-any */
import { chromium, test, type Page } from "@playwright/test";
import { SCREENS, baseUrl } from "./support/env";
import { check } from "./support/check";
import { ensureSeller } from "./support/seller";

type Viewport = { width: number; height: number };

test("dashboard numbers, staff accounts and the audit log", async () => {
  const seller = await ensureSeller();
  const tag = Date.now().toString(36).toUpperCase();

  const visible = (page: Page, text: string, timeout = 8000) =>
    page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout }).then(() => true, () => false);

  const browser = await chromium.launch();
  async function login(user: string, pass: string, viewport: Viewport, landing: string) {
    const context = await browser.newContext({ viewport, locale: "en-US" });
    const page = await context.newPage();
    await page.goto(`${baseUrl}/login`);
    await page.fill("#username", user);
    await page.fill("#password", pass);
    await page.click("button[type=submit]");
    await page.waitForURL(`**${landing}`, { timeout: 30000 });
    await page.waitForLoadState("networkidle");
    return { context, page };
  }
  const call = (page: Page, service: string, path: string, body?: unknown) =>
    page.evaluate(async ([s, p, b]: [string, string, unknown]) => {
      const r = await fetch(`/api/backend/${s}/${p}`, b === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
      return { status: r.status, body: await r.json().catch(() => null) };
    }, [service, path, body] as [string, string, unknown]);
  const gw = (page: Page, path: string, body?: unknown) => call(page, "gateway", path, body);

  // ---- seed ---------------------------------------------------------------------------------
  const admin = await login("admin", "ChangeMe123!", { width: 1280, height: 900 }, "/dashboard");
  const mk = async (name: string, qty: number) => (await gw(admin.page, "items/intake", { name, price: 10, quantity: qty, categoryId: null, imageUrl: null })).body;
  const low = await mk(`Dash Low ${tag}`, 4);
  await gw(admin.page, `scan/${low.barcode}/sell`, { quantity: 2 }); // ends at 2. Only a decrease raises a low-stock alert, never an intake
  const out = await mk(`Dash Out ${tag}`, 1);
  await gw(admin.page, `scan/${out.barcode}/sell`, { quantity: 1 });
  await mk(`Dash Plenty ${tag}`, 50);

  // Low-stock alerts arrive asynchronously (a message queue hop), so wait for ours.
  let alertSeen = false;
  for (let i = 0; i < 30 && !alertSeen; i++) {
    const alerts = (await call(admin.page, "notification", "alerts")).body ?? [];
    alertSeen = alerts.some((a: any) => a.sku === low.sku);
    if (!alertSeen) await new Promise((r) => setTimeout(r, 1000));
  }
  check("seed: a low-stock alert was raised for the low item", alertSeen);

  // ---- dashboard numbers, checked against the raw data ----------------------------------------
  {
    const page = admin.page;
    const items = (await page.evaluate(async () => {
      const r = await fetch("/api/backend/dashboard/graphql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "{ items { sku quantityOnHand effectivePrice discountPercentage } }" }) });
      return (await r.json()).data.items;
    }));
    const level = (q: number | null) => (q === null || q <= 0 ? "out" : q <= 5 ? "low" : "ok");
    const expected = {
      skus: items.length,
      units: items.reduce((s: any, i: any) => s + (i.quantityOnHand ?? 0), 0),
      low: items.filter((i: any) => level(i.quantityOnHand) === "low").length,
      out: items.filter((i: any) => level(i.quantityOnHand) === "out").length,
    };
    const fmt = (n: number) => n.toLocaleString("en-US");

    await page.goto(`${baseUrl}/dashboard`);
    await page.getByText("Units on hand").waitFor();
    await page.waitForLoadState("networkidle");
    const card = (label: string) => page.locator("div.rounded-2xl", { has: page.getByText(label, { exact: true }) }).first();
    const text = async (label: string) => (await card(label).innerText()).replace(/\s+/g, " ");

    check("dashboard: Items KPI equals the catalog size", (await text("Items")).includes(fmt(expected.skus)), `${expected.skus} :: ${await text("Items")}`);
    check("dashboard: Units on hand KPI equals the sum of stock", (await text("Units on hand")).includes(fmt(expected.units)), `${expected.units}`);
    check("dashboard: Low stock KPI matches the count of items at 1-5", (await text("Low stock")).includes(`${fmt(expected.low)} `) || (await text("Low stock")).includes(fmt(expected.low)), `${expected.low} :: ${await text("Low stock")}`);
    check("dashboard: out-of-stock count matches", (await text("Low stock")).includes(`${fmt(expected.out)} out of stock`), `${expected.out}`);
    check("dashboard: purchase orders are gone from the overview", (await page.getByText(/purchase order/i).count()) === 0);

    const legend = await page.locator("ul.flex.flex-wrap li").allInnerTexts();
    const legendSum = legend.map((t: any) => Number(t.replace(/\D/g, ""))).reduce((a: any, b: any) => a + b, 0);
    check("dashboard: stock health segments add up to the catalog", legendSum === expected.skus, `${legend.join(" | ")} => ${legendSum}`);

    // The list is the 8 items that most need reordering; on a catalog with many shortages our own items
    // may not be among them, so verify the rule itself against independently computed expectations.
    const named = await page.evaluate(async () => {
      const r = await fetch("/api/backend/dashboard/graphql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "{ items { name quantityOnHand } }" }) });
      return (await r.json()).data.items;
    });
    const expectedNames = named
      .filter((i: any) => i.quantityOnHand !== null && i.quantityOnHand <= 5)
      .sort((a: any, b: any) => a.quantityOnHand - b.quantityOnHand || a.name.localeCompare(b.name))
      .slice(0, 8)
      .map((i: any) => i.name);
    const attention = page.getByRole("region", { name: "Needs attention" });
    const rows = await attention.locator("li").allInnerTexts();
    const rowNames = rows.map((r) => r.split("\n")[0].trim());
    check("attention: shows the 8 most urgent items, most urgent first", JSON.stringify(rowNames) === JSON.stringify(expectedNames), rowNames.slice(0, 3).join(" | ") + " ...");
    check("attention: every row is low or out", rows.every((r) => /d+ left|Out/.test(r)));
    check("attention: an in-stock item is never listed", !rows.some((r) => r.includes(`Dash Plenty ${tag}`)));
    check("attention: never-stocked items are excluded", !rows.some((r) => r.includes("Not stocked") || r.includes("Unstocked")));

    check("alerts: the low-stock alert is shown by item name", await visible(page, `Dash Low ${tag}`) && (await page.getByRole("region", { name: "Recent low-stock alerts" }).innerText()).includes("Dropped to 2"));
    await page.screenshot({ path: `${SCREENS}/p5-desktop-dashboard.png`, fullPage: true });

    // Links go where they say.
    const firstName = rowNames[0];
    await attention.locator("li").first().getByRole("link", { name: "Receive" }).click();
    await page.waitForURL("**/receive?barcode=*");
    check("attention: Receive opens that item ready to receive", await visible(page, firstName));
  }

  // ---- staff ----------------------------------------------------------------------------------
  const newUser = `t${tag}`.toLowerCase();
  const newPass = "Sup3rSecret!";
  {
    const page = admin.page;
    await page.goto(`${baseUrl}/dashboard`); // the previous step ended on /receive, which uses the seller layout
    const links = await page.locator("nav[aria-label=Main] a").allInnerTexts();
    check("nav: Team & control links are present", links.includes("Staff Accounts") && links.includes("Audit Log"), links.join(", "));

    await page.goto(`${baseUrl}/staff`);
    await page.getByRole("heading", { name: "Staff accounts" }).waitFor();
    check("staff: the current user is marked (you)", await visible(page, "(you)"));
    check("staff: the seeded admin is listed as Admin", (await page.locator("tbody tr", { hasText: "admin" }).first().innerText()).includes("Admin"));

    await page.getByRole("button", { name: "Add staff" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Create account" }).click();
    check("staff: empty form shows errors", (await visible(page, "Use 3 to 50 characters")) && (await visible(page, "Use at least 8 characters.")));
    await dialog.getByLabel("Username").fill("has space");
    await dialog.getByLabel("Password", { exact: true }).fill("short");
    await dialog.getByLabel("Confirm password").fill("different");
    await dialog.getByRole("button", { name: "Create account" }).click();
    check("staff: bad username, short password and mismatch are all caught", (await visible(page, "Use 3 to 50 characters")) && (await visible(page, "Use at least 8 characters.")) && (await visible(page, "The passwords don't match.")));

    const pw = dialog.getByLabel("Password", { exact: true });
    check("staff: password is masked by default", (await pw.getAttribute("type")) === "password");
    await dialog.getByRole("button", { name: "Show password" }).click();
    check("staff: the show toggle reveals it", (await pw.getAttribute("type")) === "text");
    await dialog.getByRole("button", { name: "Hide password" }).click();

    check("staff: Seller role explains itself", await visible(page, "Sellers can scan, sell"));
    await dialog.getByLabel("Role").selectOption("Admin");
    check("staff: choosing Admin shows the stronger warning", await visible(page, "Admins can see and change everything"));
    await dialog.getByLabel("Role").selectOption("Seller");

    await dialog.getByLabel("Username").fill(newUser);
    await dialog.getByLabel("Password", { exact: true }).fill(newPass);
    await dialog.getByLabel("Confirm password").fill(newPass);
    await page.screenshot({ path: `${SCREENS}/p5-desktop-staff-dialog.png` });
    await dialog.getByRole("button", { name: "Create account" }).click();
    const dialogClosed = await page.getByRole("dialog").waitFor({ state: "detached", timeout: 5000 }).then(() => true, () => false); // it animates out
    check("staff: creating shows a confirmation and closes the dialog", (await visible(page, `Created the seller account “${newUser}”.`)) && dialogClosed);
    check("staff: the new account is listed as Seller", (await page.locator("tbody tr", { hasText: newUser }).innerText()).includes("Seller"));

    await page.getByRole("button", { name: "Add staff" }).click();
    await page.getByRole("dialog").getByLabel("Username").fill(newUser.toUpperCase());
    await page.getByRole("dialog").getByLabel("Password", { exact: true }).fill(newPass);
    await page.getByRole("dialog").getByLabel("Confirm password").fill(newPass);
    await page.getByRole("dialog").getByRole("button", { name: "Create account" }).click();
    check("staff: a duplicate username (any case) is reported on the field", await visible(page, "That username is already taken."));
    await page.keyboard.press("Escape");
    await page.screenshot({ path: `${SCREENS}/p5-desktop-staff.png` });
  }

  // ---- the new account works, and is a Seller --------------------------------------------------
  {
    const { context, page } = await login(newUser, newPass, { width: 1280, height: 800 }, "/scan");
    check("new account: signs in and lands on the seller home", new URL(page.url()).pathname === "/scan");
    await page.goto(`${baseUrl}/staff`);
    check("new account: is kept out of the back office", new URL(page.url()).pathname === "/scan");
    await context.close();
  }

  // ---- audit log -------------------------------------------------------------------------------
  {
    const page = admin.page;
    await page.goto(`${baseUrl}/audit-log`);
    await page.getByRole("heading", { name: "Audit log" }).waitFor();
    check("audit: the log says what it does and doesn't record", await visible(page, "Sign-ins (successful and failed) and staff account creation") && (await visible(page, "aren't tracked here yet")));
    await page.getByLabel("Search the audit log").fill(newUser);
    // Two entries for the new account: the creation, and the sign-in the previous section performed.
    check("audit: searching by person narrows to that person's entries", await visible(page, "2 entries"));
    const created = (await page.locator("ul li", { hasText: "User created" }).first().innerText()).replace(/\s+/g, " ");
    check("audit: the creation entry shows action, person and detail", created.includes(newUser) && created.includes("Role: Seller"), created);
    const signin = (await page.locator("ul li", { hasText: "Login succeeded" }).first().innerText()).replace(/\s+/g, " ");
    check("audit: the sign-in is recorded too", signin.includes(newUser), signin);
    const chips = await page.getByRole("group", { name: "Filter" }).innerText();
    check("audit: filter chips appear for the kinds of action present", chips.includes("User created") && chips.includes("Login succeeded"), chips.replace(/\s+/g, " "));
    await page.getByRole("button", { name: /^User created/ }).click();
    const shown = await page.locator("ul li").allInnerTexts();
    check("audit: filtering by action shows only that action", shown.length >= 1 && shown.every((r) => r.includes("User created")), `${shown.length} rows`);
    await page.getByRole("button", { name: /^All/ }).click();
    await page.getByLabel("Search the audit log").fill("zzz-no-such-entry");
    check("audit: no-match empty state", await visible(page, "No entries match"));
    await page.getByLabel("Search the audit log").fill("");
    await page.screenshot({ path: `${SCREENS}/p5-desktop-audit.png` });
  }

  // ---- authorization ---------------------------------------------------------------------------
  {
    const { context, page } = await login(seller.username, seller.password, { width: 1280, height: 800 }, "/scan");
    for (const path of ["/dashboard", "/staff", "/audit-log"]) {
      await page.goto(`${baseUrl}${path}`);
      check(`authz: a seller is bounced from ${path}`, new URL(page.url()).pathname === "/scan");
    }
    const statuses = await page.evaluate(async () =>
      Promise.all(["staff/staff", "staff/audit-log", "notification/alerts"].map(async (p) => (await fetch(`/api/backend/${p}`)).status)));
    check("authz: the backend refuses a seller on staff, audit log and alerts (403)", statuses.every((s) => s === 403), statuses.join(","));
    await context.close();
  }

  // ---- phone -----------------------------------------------------------------------------------
  {
    const { context, page } = await login("admin", "ChangeMe123!", { width: 390, height: 844 }, "/dashboard");
    await page.goto(`${baseUrl}/dashboard`);
    await page.getByText("Units on hand").waitFor();
    await page.waitForLoadState("networkidle");
    const overflow = async () => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    check("phone: the dashboard doesn't scroll sideways", !(await overflow()));
    await page.screenshot({ path: `${SCREENS}/p5-phone-dashboard.png`, fullPage: true });
    await page.goto(`${baseUrl}/staff`);
    await page.getByRole("heading", { name: "Staff accounts" }).waitFor();
    await page.locator("ul.md\\:hidden li").first().waitFor(); // the list loads after the heading renders
    check("phone: staff shows cards, not a table", !(await page.locator("table").isVisible()) && (await page.locator("ul.md\\:hidden li").count()) >= 2);
    check("phone: the staff screen doesn't scroll sideways", !(await overflow()));
    await page.getByRole("button", { name: "Add staff" }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SCREENS}/p5-phone-staff-dialog.png` });
    await page.keyboard.press("Escape");
    await page.goto(`${baseUrl}/audit-log`);
    await page.getByRole("heading", { name: "Audit log" }).waitFor();
    check("phone: the audit log doesn't scroll sideways", !(await overflow()));
    await page.screenshot({ path: `${SCREENS}/p5-phone-audit.png`, fullPage: true });
    await context.close();
  }

  await admin.context.close();
  await browser.close();
});

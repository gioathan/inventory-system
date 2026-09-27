import { request } from "@playwright/test";
import { admin, baseUrl } from "./env";

// Discounts are the one thing these tests leave behind that changes what other screens show, so
// they're removed at the end by item name. Items and orders can't be deleted (see TECH_DEBT.md), but
// they're tagged with a unique run id and don't affect anything they weren't created for.
export async function removeDiscountsFor(nameFragments: string[]) {
  const api = await request.newContext({ baseURL: baseUrl });
  try {
    await api.post("/api/auth/login", { data: admin });
    const response = await api.post("/api/backend/dashboard/graphql", {
      data: { query: "{ items { sku name discountPercentage } }" },
    });
    const items: { sku: string; name: string; discountPercentage: number | null }[] = (await response.json()).data.items;
    const skus = items
      .filter((i) => i.discountPercentage !== null && nameFragments.some((f) => i.name.includes(f)))
      .map((i) => i.sku);
    if (skus.length > 0) await api.post("/api/backend/gateway/items/discount/remove", { data: { skus } });
  } finally {
    await api.dispose();
  }
}

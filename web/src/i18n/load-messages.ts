import { NAMESPACES, type Locale } from "./config";

// One JSON file per feature namespace (src/messages/<locale>/<namespace>.json) rather than one
// giant file per locale — each namespace mirrors a components/<feature> directory, so whoever's
// touching catalog strings only ever has catalog.json open.
export async function loadMessages(locale: Locale) {
  const entries = await Promise.all(
    NAMESPACES.map(async (namespace) => {
      const file = (await import(`../messages/${locale}/${namespace}.json`)) as { default: Record<string, unknown> };
      return [namespace, file.default] as const;
    }),
  );
  return Object.fromEntries(entries);
}

import { getRequestConfig } from "next-intl/server";
import { loadMessages } from "./load-messages";
import { resolveLocale } from "./resolve-locale";

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  return { locale, messages: await loadMessages(locale) };
});

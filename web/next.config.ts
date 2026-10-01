import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Points next-intl at the per-request locale/messages resolver, which is what lets Server
// Components (and generateMetadata) call getTranslations() — no i18n routing/middleware involved.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Emits a self-contained server bundle (server.js + only the node_modules it needs), which is
  // what the container image runs and what Aspire's publish step expects for a Next.js app.
  output: "standalone",
};

export default withNextIntl(nextConfig);

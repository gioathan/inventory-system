import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits a self-contained server bundle (server.js + only the node_modules it needs), which is
  // what the container image runs and what Aspire's publish step expects for a Next.js app.
  output: "standalone",
};

export default nextConfig;

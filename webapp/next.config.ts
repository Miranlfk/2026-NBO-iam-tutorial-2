import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server (.next/standalone/server.js) for the container image.
  output: "standalone",
};

export default nextConfig;

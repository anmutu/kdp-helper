import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: { root: process.cwd() },
  serverExternalPackages: ["sharp", "@pdf-lib/fontkit"],
};
export default nextConfig;

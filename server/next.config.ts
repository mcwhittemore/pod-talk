import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg"],
  outputFileTracingIncludes: { "/**": ["./db/schema.sql"] },
};

export default nextConfig;

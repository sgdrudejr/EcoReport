import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow local-network device testing in development so client-side assets,
  // HMR, and interactive tabs keep working from phone or non-localhost hosts.
  allowedDevOrigins: [
    "127.0.0.1",
    "*.local",
    "*.home.arpa",
    "10.*.*.*",
    "172.*.*.*",
    "192.168.*.*",
  ],
};

export default nextConfig;

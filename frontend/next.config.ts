import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the Turbopack workspace root to this directory. Without this, a stray
  // lockfile in a parent folder makes Next infer the wrong root and Turbopack's
  // compile can hang (blank page). See frontend root, not the repo root.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;

"use client";

import type { ReactNode } from "react";
import { setClientPublicConfig, type PublicConfig } from "./public";

/**
 * Makes the server-rendered runtime configuration available to client code through
 * publicConfig(). It renders before its children, so they can read it while rendering.
 */
export function RuntimeConfigProvider({ config, children }: { config: PublicConfig; children: ReactNode }) {
  if (typeof window !== "undefined") {
    setClientPublicConfig(config);
  }

  return <>{children}</>;
}

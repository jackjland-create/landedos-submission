import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const protectedModules = [
  "./attribution/processing.server.ts",
  "./reports/issuance.server.ts",
  "./solana/canonical-processing.server.ts",
  "./solana/finality.server.ts",
  "./solana/helius-ingestion.server.ts",
  "./solana/helius.server.ts",
  "./solana/historical.server.ts",
  "./supabase/server.ts",
  "./tracking/quality.server.ts",
  "./tracking/session.server.ts",
  "./tracking/signing.server.ts",
  "./wallet/challenge.server.ts",
  "./wallet/proof.server.ts",
] as const;

describe("server-only security boundaries", () => {
  it.each(protectedModules)(
    "guards %s from client imports",
    async (modulePath) => {
      const source = await readFile(
        new URL(modulePath, import.meta.url),
        "utf8",
      );

      expect(source.startsWith('import "server-only";')).toBe(true);
    },
  );
});

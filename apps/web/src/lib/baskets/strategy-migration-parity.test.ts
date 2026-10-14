import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  basketStrategyDefinitionSchema,
  getPreparedBasket,
} from "@landed/contracts";

const migrationPath =
  "../../../../../supabase/migrations/20260908000100_goal_led_basket_drafts.sql";
const sql = readFileSync(new URL(migrationPath, import.meta.url), "utf8");

describe("BSK-08 migration contract parity", () => {
  it("retains exact published template versions in the database seed", () => {
    const templates = [...sql.matchAll(/\$template\$(.*?)\$template\$/g)].map(
      (match) => JSON.parse(match[1]!),
    );
    expect(templates).toHaveLength(3);
    for (const template of templates)
      expect(template).toEqual(
        getPreparedBasket(template.key, template.version),
      );
  });
  it("keeps the database JSON shape aligned with the shared v1 contract", () => {
    // Runtime trim refinements cannot be exported by JSON Schema. SQL adds a
    // non-whitespace pattern and checks allocation cell uniqueness separately.
    const schema = z.toJSONSchema(basketStrategyDefinitionSchema);
    const withWhitespaceChecks = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      const record = value as Record<string, unknown>;
      if (record.type === "string" && record.minLength && !record.pattern)
        record.pattern = "\\S";
      Object.values(record).forEach((child) =>
        Array.isArray(child)
          ? child.forEach(withWhitespaceChecks)
          : withWhitespaceChecks(child),
      );
    };
    withWhitespaceChecks(schema);
    // The additive devnet-only mode is checked by the later migration before
    // handing the remaining historical shape to this unchanged JSON schema.
    delete schema.properties?.distributionMode;
    expect(JSON.parse(sql.match(/\$schema\$(.*?)\$schema\$/)![1]!)).toEqual(
      schema,
    );
    const privateModeMigration = readFileSync(
      "../../supabase/migrations/20261002000100_unpaid_private_link_strategy.sql",
      "utf8",
    );
    expect(privateModeMigration).toContain(
      "normalized:=value-'distributionMode'",
    );
  });
});

import { describe, expect, it } from "vitest";
import type { ConversionRuleRecord } from "@landed/contracts";
import { basketMeasurementChoices } from "./measurement-choices";

const id = "91000000-0000-4000-8000-000000000001";
const version: ConversionRuleRecord["versions"][number] = {
  id,
  ruleId: id,
  projectId: id,
  workspaceId: id,
  version: 1,
  name: "First qualifying transaction",
  description: "A consenting wallet makes a qualifying transaction.",
  effectiveFrom: "2026-09-01T00:00:00Z",
  effectiveUntil: null,
  chain: "solana",
  templateCode: "first_qualifying_transaction",
  requiresWalletBinding: true,
  minimumFinality: "finalized",
  valueMapping: "none",
  revenueMapping: "none",
  attributionWindowSeconds: 604800,
  attributionModel: "last_eligible_creator_touch",
  programId: null,
  eventDiscriminator: null,
  evidenceCapability: "ready",
  changeReason: "Initial definition",
  createdBy: id,
  createdAt: "2026-09-01T00:00:00Z",
};
const rule: ConversionRuleRecord = {
  id,
  projectId: id,
  workspaceId: id,
  stableKey: "primary-outcome",
  createdBy: id,
  createdAt: version.createdAt,
  versions: [version],
};
describe("project measurement choices", () => {
  it("derives connection facts without claiming a finalized transaction", () => {
    const result = basketMeasurementChoices(
      {
        ...rule,
        versions: [
          {
            ...version,
            templateCode: "wallet_connected",
            minimumFinality: "not_applicable",
          },
        ],
      },
      id,
      id,
    );
    expect(result).toMatchObject({
      kind: "ready",
      options: [
        {
          qualifyingFacts: [
            "A verified wallet connection with explicit measurement consent is the qualifying action. No transaction is required.",
          ],
        },
      ],
    });
  });
  it("retains exact-match requirements without exposing the recipient address", () => {
    const recipient = "11111111111111111111111111111111";
    const result = basketMeasurementChoices(
      {
        ...rule,
        versions: [
          {
            ...version,
            description: "An editable description",
            configuredEnvironment: "devnet",
            destinationAddress: recipient,
            nativeAmountLamports: "1",
          },
        ],
      },
      id,
      id,
    );
    expect(result).toMatchObject({
      kind: "ready",
      options: [
        {
          qualifyingFacts: expect.arrayContaining([
            "The transaction must be finalized before it counts.",
            "It must match the configured recipient, exact amount and network.",
          ]),
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain(recipient);
  });
  it("returns minimal display data without protected metadata", () => {
    const result = basketMeasurementChoices(rule, id, id);
    expect(result).toEqual({
      kind: "ready",
      options: [
        {
          id,
          name: version.name,
          description: version.description,
          version: 1,
          effectiveFrom: version.effectiveFrom,
          effectiveUntil: null,
          supported: true,
          label: "First qualifying transaction",
          summary:
            "Counts the visitor’s first completed transaction that meets this rule, after wallet verification and consent.",
          qualifyingFacts: [
            "The first qualifying transaction from the verified, consenting wallet counts.",
            "The transaction must be finalized before it counts.",
          ],
        },
      ],
    });
  });
  it("represents an unconfigured project without inventing choices", () => {
    expect(basketMeasurementChoices(null, id, id)).toEqual({
      kind: "ready",
      options: [],
    });
  });
  it.each(["projectId", "workspaceId", "ruleId"] as const)(
    "fails closed on mismatched version %s",
    (field) => {
      expect(
        basketMeasurementChoices(
          { ...rule, versions: [{ ...version, [field]: "other" }] },
          id,
          id,
        ),
      ).toEqual({ kind: "unavailable" });
    },
  );
  it("fails closed on mismatched rule scope", () => {
    expect(basketMeasurementChoices(rule, "other", id)).toEqual({
      kind: "unavailable",
    });
    expect(basketMeasurementChoices(rule, id, "other")).toEqual({
      kind: "unavailable",
    });
  });
  it("retains unsupported versions for explanation without enabling selection", () => {
    const result = basketMeasurementChoices(
      {
        ...rule,
        versions: [
          { ...version, evidenceCapability: "requires_programme_decoder" },
        ],
      },
      id,
      id,
    );
    expect(result).toMatchObject({
      kind: "ready",
      options: [{ id, supported: false }],
    });
  });
});

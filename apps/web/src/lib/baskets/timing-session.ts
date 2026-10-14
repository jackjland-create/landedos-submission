import {
  campaignTimingProposalSchema,
  type CampaignTimingProposal,
} from "@landed/contracts";
import { z } from "zod";
import {
  fieldsToTiming,
  timingToFields,
  type TimingField,
  type TimingFields,
} from "./timing-fields";

const savedSchema = z.strictObject({
  ownerId: z.uuid().optional(),
  canManage: z.boolean().optional(),
  revision: z.number().int().positive().max(2147483647),
  timing: campaignTimingProposalSchema.nullable(),
});
type SavedTiming = z.infer<typeof savedSchema>;
export type TimingRecoveryDraft = {
  saved: SavedTiming;
  fields: TimingFields;
  uncertain: boolean;
};
export type TimingSessionClient = {
  onIdentityChange?: (reset: () => void) => () => void;
  /** A caller-scoped authenticated adapter; never a service-role fallback. */
  load: () => Promise<unknown>;
  save: (input: {
    expectedOwnerId?: string;
    expectedRevision: number;
    timing: CampaignTimingProposal;
  }) => Promise<unknown>;
};
export type TimingSessionState = {
  phase: "idle" | "loading" | "saving" | "ready" | "missing" | "unconfirmed";
  saved: SavedTiming | null;
  latest: SavedTiming | null;
  fields: TimingFields;
  errors: Partial<Record<TimingField, string>>;
  message: string;
  needsReview: boolean;
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const sameTiming = (
  left: CampaignTimingProposal | null,
  right: CampaignTimingProposal | null,
) => {
  if (!left || !right) return left === right;
  const instant = (value: string) =>
    value.replace(/\.0+Z$/, "Z").replace(/(\.\d*?[1-9])0+Z$/, "$1Z");
  return (["flight", "measurement"] as const).every((period) =>
    (["startedAt", "endedAt"] as const).every(
      (boundary) =>
        instant(left[period][boundary]) === instant(right[period][boundary]),
    ),
  );
};

/** Staged session coordinator for the existing builder, not a runtime route.
 * One instance belongs to one basket and permission context. Dispose it before
 * replacing that context. Refresh never discards edits; only adoptLatest does.
 * No storage, issuance, automatic retry, or mutation of an approval occurs. */
export function createTimingSession(client: TimingSessionClient) {
  let active = true;
  let state: TimingSessionState = {
    phase: "idle",
    saved: null,
    latest: null,
    fields: timingToFields(null),
    errors: {},
    message: "",
    needsReview: false,
  };
  const busy = () => state.phase === "loading" || state.phase === "saving";
  const fail = () => {
    state = {
      ...state,
      phase: "unconfirmed",
      latest: null,
      needsReview: true,
      message: state.saved
        ? "We could not confirm the saved dates. Your edits are still here. Load the saved dates and review them before trying again."
        : "We could not load your campaign dates. Choose Load saved dates to try again.",
    };
  };
  return {
    // Consumers cannot mutate session-owned records or edits through a read.
    read: () => clone(state),
    reviewContext() {
      if (
        !active ||
        state.phase !== "ready" ||
        state.needsReview ||
        !state.saved?.timing
      )
        return null;
      const proposal = fieldsToTiming(state.fields, state.saved.timing);
      if (!proposal.ok || !sameTiming(proposal.timing, state.saved.timing))
        return null;
      return clone({
        expectedRevision: state.saved.revision,
        expectedTiming: state.saved.timing,
      });
    },
    dispose() {
      active = false;
    },
    restoreDraft(draft: TimingRecoveryDraft) {
      if (
        !active ||
        busy() ||
        state.saved?.canManage === false ||
        !state.saved?.ownerId ||
        draft.saved.ownerId !== state.saved.ownerId
      )
        return false;
      const fresh = state.saved;
      const changed =
        draft.uncertain ||
        fresh.revision !== draft.saved.revision ||
        !sameTiming(fresh.timing, draft.saved.timing);
      state = {
        ...state,
        fields: clone(draft.fields),
        saved: changed ? clone(draft.saved) : fresh,
        latest: changed ? fresh : null,
        needsReview: changed,
        errors: {},
        message: changed
          ? "Your unsaved dates are restored for comparison. The saved dates need review before you can save again."
          : "Your unsaved dates are restored. Review them, then choose Save dates.",
      };
      return true;
    },
    edit(field: TimingField, value: string) {
      if (!active || busy() || !state.saved) return;
      const fields = { ...state.fields, [field]: value };
      const changed =
        JSON.stringify(fields) !==
        JSON.stringify(timingToFields(state.saved.timing));
      state = {
        ...state,
        fields,
        errors: {},
        latest: null,
        message: state.needsReview
          ? state.message
          : changed
            ? "You have unsaved date changes. Save dates before leaving this basket."
            : "Your dates match the saved dates.",
      };
    },
    async loadSaved() {
      if (!active || busy()) return false;
      state = {
        ...state,
        phase: "loading",
        message: "Loading saved dates…",
        latest: null,
      };
      try {
        const saved = savedSchema.nullable().parse(await client.load());
        if (!active) return false;
        if (!saved) {
          state = {
            ...state,
            phase: "missing",
            latest: null,
            needsReview: true,
            message:
              "No saved strategy is available for this basket. Check access and save the strategy before adding dates.",
          };
          return false;
        }
        if (state.saved?.ownerId && saved.ownerId !== state.saved.ownerId) {
          state = {
            phase: "ready",
            saved,
            latest: null,
            fields: timingToFields(saved.timing),
            errors: {},
            needsReview: false,
            message:
              "Account changed. Saved dates loaded for the current account.",
          };
          return true;
        }
        if (state.saved) {
          state = {
            ...state,
            phase: "ready",
            latest: saved,
            needsReview: true,
            message:
              "Saved dates loaded. Review them before replacing your local edits.",
          };
        } else {
          state = {
            ...state,
            phase: "ready",
            saved,
            fields: timingToFields(saved.timing),
            needsReview: false,
            errors: {},
            message: "Saved dates loaded.",
          };
        }
        return true;
      } catch {
        if (active) fail();
        return false;
      }
    },
    adoptLatest() {
      if (!active || busy() || !state.latest) return false;
      const saved = state.latest;
      state = {
        ...state,
        saved,
        latest: null,
        fields: timingToFields(saved.timing),
        errors: {},
        needsReview: false,
        phase: "ready",
        message: "Using the saved dates. Local edits were replaced.",
      };
      return true;
    },
    adoptLatestIfUnchanged(minimumRevision: number) {
      if (
        !active ||
        busy() ||
        !state.saved ||
        !state.latest ||
        state.latest.revision < minimumRevision ||
        JSON.stringify(state.fields) !==
          JSON.stringify(timingToFields(state.saved.timing))
      )
        return false;
      const saved = state.latest;
      state = {
        ...state,
        saved,
        latest: null,
        fields: timingToFields(saved.timing),
        errors: {},
        needsReview: false,
        phase: "ready",
        message: "Saved dates refreshed after the strategy changed.",
      };
      return true;
    },
    async save() {
      if (
        !active ||
        busy() ||
        !state.saved ||
        state.saved.canManage === false ||
        state.needsReview
      )
        return false;
      const proposal = fieldsToTiming(state.fields, state.saved.timing);
      if (!proposal.ok) {
        state = {
          ...state,
          errors: proposal.errors,
          message: "Check the highlighted dates before saving.",
        };
        return false;
      }
      const revision = state.saved.revision;
      const ownerId = state.saved.ownerId;
      if (revision === 2147483647) {
        state = {
          ...state,
          needsReview: true,
          message:
            "This basket cannot accept another revision. Contact a workspace administrator.",
        };
        return false;
      }
      state = {
        ...state,
        phase: "saving",
        errors: {},
        latest: null,
        message: "Saving dates…",
      };
      try {
        const result = await client.save({
          ...(ownerId ? { expectedOwnerId: ownerId } : {}),
          expectedRevision: revision,
          timing: clone(proposal.timing),
        });
        if (!active) return false;
        z.strictObject({ revision: z.literal(revision + 1) }).parse(result);
        // A write acknowledgement alone is not a confirmed saved review context.
        const saved = savedSchema.parse(await client.load());
        if (!active) return false;
        if (saved.ownerId !== state.saved?.ownerId) {
          state = {
            phase: "unconfirmed",
            saved: null,
            latest: null,
            fields: timingToFields(null),
            errors: {},
            needsReview: true,
            message:
              "Your account changed. Load saved dates before continuing.",
          };
          return false;
        }
        if (
          saved.revision !== revision + 1 ||
          !sameTiming(saved.timing, proposal.timing)
        )
          throw new Error();
        state = {
          ...state,
          phase: "ready",
          saved,
          latest: null,
          fields: timingToFields(saved.timing),
          needsReview: false,
          message: "Dates saved.",
        };
        return true;
      } catch {
        if (active) fail();
        return false;
      }
    },
  };
}

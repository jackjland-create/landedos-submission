import type { TimingRecoveryDraft, TimingSessionState } from "./timing-session";
import { timingToFields } from "./timing-fields";

// Tab-memory only: never localStorage, sessionStorage, URLs or server persistence.
// A fresh authorized read supplies the owner before anything is returned to UI.
const drafts = new Map<
  string,
  { expires: number; draft: TimingRecoveryDraft }
>();
const ttl = 30 * 60 * 1000;
const clone = <T>(value: T): T => structuredClone(value);
const key = (owner: string, project: string, basket: string) =>
  JSON.stringify([owner, project, basket.toLowerCase()]);
function prune(now: number) {
  for (const [id, entry] of drafts) if (entry.expires <= now) drafts.delete(id);
}
export function rememberTimingDraft(
  project: string,
  basket: string,
  state: TimingSessionState,
) {
  if (!state.saved?.ownerId) return;
  const now = Date.now();
  prune(now);
  const id = key(state.saved.ownerId, project, basket);
  const dirty =
    JSON.stringify(state.fields) !==
    JSON.stringify(timingToFields(state.saved.timing));
  if (!dirty && !state.needsReview && state.phase === "ready") {
    drafts.delete(id);
    return;
  }
  if (!dirty && state.phase !== "saving" && !state.needsReview) return;
  drafts.delete(id);
  drafts.set(id, {
    expires: now + ttl,
    draft: clone({
      saved: state.saved,
      fields: state.fields,
      uncertain:
        state.needsReview ||
        state.phase === "saving" ||
        state.phase === "unconfirmed",
    }),
  });
  while (drafts.size > 10) drafts.delete(drafts.keys().next().value!);
}
export function findTimingDraft(
  owner: string,
  project: string,
  basket: string,
) {
  prune(Date.now());
  const entry = drafts.get(key(owner, project, basket));
  return entry ? clone(entry.draft) : null;
}
export function forgetTimingDraft(
  owner: string,
  project: string,
  basket: string,
) {
  drafts.delete(key(owner, project, basket));
}

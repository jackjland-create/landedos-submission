import type { StrategyEdits } from "./use-basket-strategy";

export type StrategyRecovery = {
  revision: number;
  edits: StrategyEdits;
  uncertain: boolean;
};
// Private tab memory only; restored only after a fresh scoped read and identity check.
const drafts = new Map<string, { expires: number; value: StrategyRecovery }>();
const key = (owner: string, project: string, basket: string) =>
  JSON.stringify([owner, project, basket.toLowerCase()]);
export function retainStrategyDraft(
  owner: string,
  project: string,
  basket: string,
  value: StrategyRecovery | null,
) {
  const now = Date.now();
  for (const [id, row] of drafts) if (row.expires <= now) drafts.delete(id);
  const id = key(owner, project, basket);
  drafts.delete(id);
  if (value)
    drafts.set(id, {
      expires: now + 30 * 60 * 1000,
      value: structuredClone(value),
    });
  while (drafts.size > 10) drafts.delete(drafts.keys().next().value!);
}
export function recoverStrategyDraft(
  owner: string,
  project: string,
  basket: string,
) {
  const entry = drafts.get(key(owner, project, basket));
  return entry && entry.expires > Date.now()
    ? structuredClone(entry.value)
    : null;
}

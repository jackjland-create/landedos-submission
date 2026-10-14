import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { accountFlowsEnabled, recoveryEnabled } from "./account-flow.server";
afterEach(() => vi.unstubAllEnvs());
it("keeps signup and recovery closed even if their flags are enabled in submission mode", () => {
 vi.stubEnv("LANDED_ACCOUNT_FLOWS_ENABLED", "1");
 vi.stubEnv("LANDED_PASSWORD_RECOVERY_ENABLED", "1");
 vi.stubEnv("LANDED_SUBMISSION_SNAPSHOT", "1");
 expect(accountFlowsEnabled()).toBe(false);
 expect(recoveryEnabled()).toBe(false);
});

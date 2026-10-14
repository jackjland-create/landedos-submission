import { describe, expect, it } from "vitest";

import { loginPathFor, operatorReturnPath } from "./return-path";

describe("operator return path", () => {
  it("retains a project route and its local view context", () => {
    expect(
      operatorReturnPath(
        "/projects/helios/baskets/b27f30d0-ad32-4049-b7f7-388024dbe474?view=approval#basket-plan-review",
      ),
    ).toBe(
      "/projects/helios/baskets/b27f30d0-ad32-4049-b7f7-388024dbe474?view=approval#basket-plan-review",
    );
  });

  it.each([
    "https://attacker.example/projects/helios/overview",
    "//attacker.example/projects/helios/overview",
    "/auth/confirm",
    "/login",
    "/t/d1000000-0000-4000-8000-000000000001",
    "/projects\\attacker.example",
    "not-a-path",
  ])("rejects unsafe or non-operator destination %s", (value) => {
    expect(operatorReturnPath(value)).toBe("/projects/helios/overview");
  });

  it("preserves the destination when returning to login with an error", () => {
    const path = loginPathFor(
      "/projects/helios/baskets/example?view=plan",
      "The credentials could not be verified",
    );
    const url = new URL(path, "https://landed.invalid");

    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("next")).toBe(
      "/projects/helios/baskets/example?view=plan",
    );
    expect(url.searchParams.get("error")).toBe(
      "The credentials could not be verified",
    );
  });
});

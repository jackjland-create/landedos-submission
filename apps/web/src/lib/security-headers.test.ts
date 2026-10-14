import { describe, expect, it } from "vitest";

import nextConfig, { productSecurityHeaders } from "../../next.config";

describe("product security headers", () => {
  it("applies the hardened browser boundary to every route", async () => {
    const rules = await nextConfig.headers?.();
    const headers = Object.fromEntries(
      productSecurityHeaders.map(({ key, value }) => [key, value]),
    );

    expect(rules).toEqual([
      { source: "/:path*", headers: [...productSecurityHeaders] },
    ]);
    expect(headers["Content-Security-Policy"]).toContain(
      "frame-ancestors 'none'",
    );
    expect(headers["Strict-Transport-Security"]).toContain("max-age=63072000");
    expect(headers).toMatchObject({
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    });
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});

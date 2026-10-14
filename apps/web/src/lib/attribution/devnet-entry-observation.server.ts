import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

const maximumBytes = 128 * 1024;
const privateRoutes = new Map([
  ["/login", "login"],
  ["/projects/helios/settings/integrations", "destination_approval"],
  ["/projects/helios/settings/conversions", "conversion_setup"],
  ["/projects/helios/baskets", "basket_index"],
  ["/projects/helios/campaigns", "campaign_index"],
]);

type Observation = {
  at: string;
  correlationId: string;
  route: string;
  method: "GET" | "HEAD";
  phase: "received" | "auth_boundary_returned" | "auth_boundary_threw";
  status?: number;
  disposition?: "continue_not_final_response" | "redirect" | "response";
};

// INT-01 / FND-08 / SEC-02: only the temporary operator entry boundary.
// Never accept a caller path, log a URL/query/header/body, or observe participants.
function observationTarget(request: NextRequest, env: NodeJS.ProcessEnv) {
  if (
    env.LANDED_EXTERNAL_DEVNET_SESSION !== "1" ||
    env.EXTERNAL_DEVNET_PUBLIC_GATE !== "1" ||
    env.VERCEL ||
    env.VERCEL_ENV ||
    request.headers.get("host") !== "localhost:3319" ||
    request.headers.has("cf-ray") ||
    !["GET", "HEAD"].includes(request.method)
  )
    return null;
  const target = env.LANDED_EXTERNAL_ENTRY_DIAGNOSTIC_PATH;
  if (
    !target ||
    path.dirname(target) !== os.tmpdir() ||
    !/^landed-external-devnet-entry-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jsonl$/.test(
      path.basename(target),
    )
  )
    return null;
  const pathname = request.nextUrl.pathname;
  const route =
    privateRoutes.get(pathname) ??
    (/^\/projects\/helios\/baskets\/[0-9a-f-]{36}$/.test(pathname)
      ? "basket_workspace"
      : /^\/projects\/helios\/campaigns\/[0-9a-f-]{36}$/.test(pathname)
        ? "campaign_workspace"
        : null);
  return route ? { target, route } : null;
}

function append(target: string, entry: Observation) {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(
      target,
      fs.constants.O_WRONLY |
        fs.constants.O_APPEND |
        fs.constants.O_CREAT |
        fs.constants.O_NONBLOCK |
        fs.constants.O_NOFOLLOW,
      0o600,
    );
    const stat = fs.fstatSync(descriptor);
    // Refuse non-private, non-owned, linked or unbounded files. Do not chmod an
    // existing target; observations must not mutate another file's permissions.
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o777) !== 0o600
    )
      return;
    const line = JSON.stringify(entry) + "\n";
    if (stat.size + Buffer.byteLength(line) > maximumBytes) return;
    fs.writeSync(descriptor, line);
  } catch {
    // Optional diagnostics cannot replace, hide or change the Auth result.
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // A diagnostic descriptor error must not replace the Auth result.
      }
    }
  }
}

export async function observeDevnetOperatorEntry<T extends Response>(
  request: NextRequest,
  operation: () => Promise<T>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<T> {
  const scope = observationTarget(request, env);
  if (!scope) return operation();
  const base = {
    correlationId: randomUUID(),
    route: scope.route,
    method: request.method as "GET" | "HEAD",
  };
  append(scope.target, {
    ...base,
    at: new Date().toISOString(),
    phase: "received",
  });
  try {
    const response = await operation();
    append(scope.target, {
      ...base,
      at: new Date().toISOString(),
      phase: "auth_boundary_returned",
      status: response.status,
      disposition:
        response.headers.get("x-middleware-next") === "1"
          ? "continue_not_final_response"
          : response.status >= 300 && response.status < 400
            ? "redirect"
            : "response",
    });
    return response;
  } catch (error) {
    append(scope.target, {
      ...base,
      at: new Date().toISOString(),
      phase: "auth_boundary_threw",
    });
    throw error;
  }
}

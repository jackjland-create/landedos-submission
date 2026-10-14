// @vitest-environment node
// SOL-05 / SEC-02 / BSK-09: opt-in real local SDK/queue/SQL transport.
// Upstream campaign/consent and local history/finality responses are synthetic.
// No worker function, Supabase client, provider parser or checkpoint is mocked.
import { createServer } from "node:http";
import { serve } from "inngest/node";
import { expect, it } from "vitest";

const enabled = process.env.LANDED_LOCAL_WORKER_TRANSPORT === "1";

it.skipIf(!enabled)(
  process.env.LANDED_LOCAL_DIRECT_WORKER === "1"
    ? "runs the direct production worker against populated rollback-only SQL"
    : "dispatches the real worker through a local queue to actual rollback-only SQL",
  async () => {
    const port = Number(process.env.LANDED_LOCAL_WORKER_SDK_PORT);
    const queue = process.env.INNGEST_BASE_URL!;
    const jobId = process.env.LANDED_LOCAL_WORKER_JOB_ID!;
    const provider = process.env.LANDED_LOCAL_SYNTHETIC_HELIUS_HISTORY_URL!;
    const database = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const callback = process.env.LANDED_LOCAL_WORKER_CALLBACK_ORIGIN!;
    expect(callback).toBe("http://10.254.1.1:58438");
    expect(process.env.LANDED_LOCAL_DEVNET_REHEARSAL).toBe("1");
    expect(Number.isSafeInteger(port) && port > 1024 && port < 65536).toBe(
      true,
    );
    expect(jobId).toMatch(/^[a-f0-9-]{36}$/);
    const origins = new Set([queue, provider, database]);
    for (const origin of origins) {
      const url = new URL(origin);
      expect(url.protocol).toBe("http:");
      expect(url.hostname).toBe("127.0.0.1");
      expect(url.origin).toBe(origin);
    }
    // Deny accidental outbound SDK/provider/database traffic, including redirects.
    const actualFetch = globalThis.fetch;
    let observedFunctionRegistration = false;
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (!origins.has(url.origin)) throw new Error("Local origin required");
      if (
        url.origin === queue &&
        url.pathname === "/fn/register" &&
        typeof init?.body === "string"
      ) {
        const registration = JSON.parse(init.body);
        const fn = registration.functions?.find(
          (entry: { id: string }) =>
            entry.id === "landed-kol-os-solana-historical-reconciliation",
        );
        expect(fn).toBeDefined();
        expect(fn.triggers).toContainEqual({
          event: "landed/solana.reconciliation.requested",
        });
        for (const step of Object.values(fn.steps) as {
          runtime: { url: string };
        }[]) {
          const target = new URL(step.runtime.url);
          expect(target.origin).toBe(callback);
          expect(target.pathname).toBe("/api/inngest");
        }
        observedFunctionRegistration = true;
        console.log("LOCAL_WORKER_STAGE:exact-function-registration");
      }
      return actualFetch(input, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
    };
    // Construct production clients only AFTER installing the local-origin gate:
    // the SDK captures fetch when the client is created.
    const { createAdminClient } = await import("@/lib/supabase/server");
    const { inngest } = await import("./client");
    const { reconcileSolanaHistory } =
      await import("./reconcile-solana-history");
    // Opt-in populated SQL gate can isolate the data path from queue startup.
    // Same production client/worker/provider/finality, no module mocks.
    if (process.env.LANDED_LOCAL_DIRECT_WORKER === "1") {
      try {
        const { reconcileOnePage } = await import("./reconcile-solana-history");
        const client = createAdminClient();
        const initial = await client.rpc("get_solana_reconciliation_job", {
          target_job_id: jobId,
        });
        expect(initial.error).toBeNull();
        expect(initial.data).toHaveLength(1);
        const result = await reconcileOnePage(client, initial.data[0]);
        expect(result).toEqual({
          hasMore: false,
          insertedCount: 0,
          duplicateCount: 1,
          issueCount: 0,
          pageCount: 1,
          rawEventCount: 1,
        });
        const completed = await client.rpc("get_solana_reconciliation_job", {
          target_job_id: jobId,
        });
        expect(completed.error).toBeNull();
        expect(completed.data[0].status).toBe("completed");
        console.log("LOCAL_WORKER_TRANSPORT_REAL_DIRECT_OUTPUT");
      } finally {
        globalThis.fetch = actualFetch;
      }
      return;
    }
    let sdkRequests = 0;
    let terminalOutput = false;
    const sdk = serve({
      client: inngest,
      functions: [reconcileSolanaHistory],
      serveHost: callback,
      servePath: "/api/inngest",
    });
    const server = createServer((request, response) => {
      if (
        new URL(request.url!, "http://127.0.0.1").pathname !== "/api/inngest"
      ) {
        response.writeHead(404).end();
        return;
      }
      if (request.method === "POST") {
        sdkRequests++;
        if (sdkRequests === 1)
          console.log("LOCAL_WORKER_STAGE:sdk-post-received");
        const end = response.end.bind(response);
        // Observe the SDK's actual final response without changing its content.
        response.end = ((chunk: unknown, ...args: unknown[]) => {
          const body =
            typeof chunk === "string"
              ? chunk
              : Buffer.isBuffer(chunk)
                ? chunk.toString()
                : "";
          if (body.length < 16384) {
            try {
              const parsed = JSON.parse(body);
              const name =
                parsed?.error?.name ??
                parsed?.name ??
                parsed?.data?.error?.name;
              if (
                [
                  "ZodError",
                  "HeliusHistoricalConfigError",
                  "HeliusHistoricalFetchError",
                  "Error",
                  "TypeError",
                ].includes(name)
              )
                console.log(`LOCAL_WORKER_ERROR:${name}`);
              const output = parsed?.data ?? parsed;
              if (
                output?.jobId === jobId &&
                output?.pageCount === 1 &&
                output?.status === "completed"
              )
                terminalOutput = true;
            } catch {
              /* Intermediate SDK responses are not job output. */
            }
          }
          return Reflect.apply(end, response, [chunk, ...args]);
        }) as typeof response.end;
      }
      void sdk(request, response);
    });
    const wait = async (check: () => Promise<boolean>, label: string) => {
      const until = Date.now() + 45000;
      while (Date.now() < until) {
        try {
          if (await check()) return;
        } catch {
          /* Bounded startup retry. */
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error(`${label} did not finish`);
    };
    const stage = (name: string) => console.log(`LOCAL_WORKER_STAGE:${name}`);
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", resolve);
      });
      stage("server-ready");
      await wait(async () => (await fetch(queue)).ok, "Owned local queue");
      stage("queue-ready");
      // Registration is actual SDK HTTP, not a copied function invocation.
      await wait(async () => {
        const response = await actualFetch(
          `http://127.0.0.1:${port}/api/inngest`,
          {
            method: "PUT",
            redirect: "error",
            signal: AbortSignal.timeout(5000),
          },
        );
        if (!response.ok) return false;
        const registration = await response.json();
        return (
          registration.message === "Successfully registered" &&
          observedFunctionRegistration
        );
      }, "SDK registration");
      stage("registered");
      const client = createAdminClient();
      const initial = await client.rpc("get_solana_reconciliation_job", {
        target_job_id: jobId,
      });
      expect(initial.error).toBeNull();
      expect(initial.data).toMatchObject([
        { job_id: jobId, status: "queued", page_count: 0 },
      ]);
      stage("initial-job-read");
      const dispatched = await inngest.send({
        id: `rollback-local-worker:${jobId}`,
        name: "landed/solana.reconciliation.requested",
        data: { jobId },
      });
      expect(dispatched.ids).toHaveLength(1);
      stage("dispatched");
      await wait(async () => {
        const result = await client.rpc("get_solana_reconciliation_job", {
          target_job_id: jobId,
        });
        if (result.error) throw new Error("Local job read failed");
        return (
          result.data?.[0]?.status === "completed" &&
          result.data?.[0]?.page_count === 1
        );
      }, "Real SQL checkpoint");
      stage("sql-completed");
      await wait(async () => terminalOutput, "Actual SDK terminal output");
      expect(sdkRequests).toBeGreaterThan(0);
      console.log("LOCAL_WORKER_TRANSPORT_REAL_SDK_TERMINAL_OUTPUT");
    } finally {
      globalThis.fetch = actualFetch;
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
  120000,
);

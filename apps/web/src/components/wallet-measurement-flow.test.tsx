import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { walletsMock } = vi.hoisted(() => ({
  walletsMock: { current: [] as unknown[] },
}));

vi.mock("@wallet-standard/app", () => ({
  getWallets: () => ({
    get: () => walletsMock.current,
    on: () => () => undefined,
  }),
}));

import { WalletMeasurementFlow } from "./wallet-measurement-flow";
import { buildWalletNonceChallengeResponse } from "@/lib/wallet/challenge.server";

describe("wallet measurement flow", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );
  });

  afterEach(() => {
    cleanup();
    walletsMock.current = [];
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fails closed when the approved devnet path is unavailable", async () => {
    render(<WalletMeasurementFlow available={false} />);

    expect(
      await screen.findByRole("heading", {
        name: "The supervised devnet path is not configured",
      }),
    ).toBeVisible();
    expect(screen.getByText(/no wallet request is available/i)).toBeVisible();
  });

  it("offers onward navigation without requiring a wallet or recording consent", async () => {
    render(
      <WalletMeasurementFlow
        available
        receiverAddress="Vote111111111111111111111111111111111111111"
        continuationHostname="brand.example"
      />,
    );
    const link = await screen.findByRole("link", {
      name: "Continue without wallet measurement",
    });
    expect(link).toHaveAttribute("href", "/measure/continue");
    expect(link).toHaveAttribute("rel", "noreferrer");
    expect(
      screen.getByText(/does not give consent or connect your wallet/),
    ).toBeVisible();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "/api/wallet/consents",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("does not offer an unverified continuation or bypass an unknown consent state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 503 })),
    );
    render(
      <WalletMeasurementFlow available continuationHostname="brand.example" />,
    );
    await screen.findByRole("button", { name: "Retry session check" });
    expect(
      screen.queryByRole("link", { name: /Continue/ }),
    ).not.toBeInTheDocument();
  });

  it("explains the boundary when no compatible wallet is present", async () => {
    render(
      <WalletMeasurementFlow
        available
        receiverAddress="Vote111111111111111111111111111111111111111"
      />,
    );

    expect(await screen.findByText("Solana devnet")).toBeVisible();
    expect(screen.getByText("Exactly 1 lamport")).toBeVisible();
    expect(
      await screen.findByText(/no compatible solana devnet wallet/i),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Verify wallet control" }),
    ).toBeDisabled();
  });

  it("keeps light and dark presentation under the user’s control", () => {
    const { container } = render(
      <WalletMeasurementFlow
        available
        receiverAddress="Vote111111111111111111111111111111111111111"
      />,
    );
    const toggle = screen.getByRole("switch", { name: "Use dark mode" });

    expect(container.firstChild).toHaveAttribute("data-theme", "light");
    fireEvent.click(toggle);
    expect(container.firstChild).toHaveAttribute("data-theme", "dark");
    expect(toggle).toHaveAccessibleName("Use light mode");
  });

  it("recovers a committed consent after reload so unlink stays reachable", async () => {
    const receiver = "Vote111111111111111111111111111111111111111";
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            consentId: "c3000000-0000-4000-8000-000000000001",
            mappingId: "c4000000-0000-4000-8000-000000000001",
            state: "already_accepted",
            reconciliationState: "attention_required",
            consentVersion: 1,
            consentStatement:
              "I consent to Landed linking this wallet to this campaign session to measure configured campaign outcomes. Analysis may include up to 90 days of relevant pre-touch activity and relevant activity until this qualified campaign session expires. I can unlink at any time to stop future association.",
            historicalLookbackDays: 90,
            acceptedAt: "2026-09-24T17:02:00.000Z",
            monitoringEndsAt: "2026-10-01T17:02:00.000Z",
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <WalletMeasurementFlow
        available
        receiverAddress={receiver}
        continuationHostname="campaign.example"
      />,
    );

    expect(
      await screen.findByRole("heading", {
        name: "Consent is active for this session",
      }),
    ).toBeVisible();
    expect(screen.getByText(/historical measurement setup/i)).toBeVisible();
    expect(screen.getByRole("button", { name: "Unlink wallet" })).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/wallet/consents",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("keeps recovery and unlink available when new measurement is disabled", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            consentId: "c3000000-0000-4000-8000-000000000001",
            mappingId: "c4000000-0000-4000-8000-000000000001",
            state: "already_accepted",
            reconciliationState: "completed",
            consentVersion: 1,
            consentStatement:
              "I consent to Landed linking this wallet to this campaign session to measure configured campaign outcomes. Analysis may include up to 90 days of relevant pre-touch activity and relevant activity until this qualified campaign session expires. I can unlink at any time to stop future association.",
            historicalLookbackDays: 90,
            acceptedAt: "2026-09-24T17:02:00.000Z",
            monitoringEndsAt: "2026-10-01T17:02:00.000Z",
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<WalletMeasurementFlow available={false} />);

    expect(
      await screen.findByRole("button", { name: "Unlink wallet" }),
    ).toBeVisible();
    expect(
      screen.getByText("Not configured — transaction unavailable"),
    ).toBeVisible();
  });

  it("blocks a new proof when consent recovery cannot be verified", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("database unavailable");
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <WalletMeasurementFlow
        available
        receiverAddress="Vote111111111111111111111111111111111111111"
      />,
    );

    expect(
      await screen.findByRole("heading", {
        name: "We could not confirm the current consent state",
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Verify wallet control" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Retry session check" }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it.each([
    ["chain", { chainId: "solana:mainnet" }],
    ["account", { address: "Vote111111111111111111111111111111111111111" }],
    ["domain", { domain: "attacker.test" }],
    ["URI", { uri: "https://attacker.test" }],
    ["request", { requestId: "c1000000-0000-4000-8000-000000000002" }],
    ["expiry", { expirationTime: "2026-09-24T17:05:00.001Z" }],
  ])(
    "rejects a mismatched %s before asking the wallet to sign",
    async (_label, mismatch) => {
      const walletAddress = "So11111111111111111111111111111111111111112";
      const account = {
        address: walletAddress,
        publicKey: new Uint8Array(32),
        chains: ["solana:devnet"],
        features: ["solana:signIn"],
      };
      const signIn = vi.fn();
      walletsMock.current = [
        {
          version: "1.0.0",
          name: "Test Wallet",
          icon: "data:image/svg+xml;base64,PHN2Zy8+",
          chains: ["solana:devnet"],
          accounts: [account],
          features: {
            "standard:connect": {
              version: "1.0.0",
              connect: vi.fn(async () => ({ accounts: [account] })),
            },
            "solana:signIn": { version: "1.0.0", signIn },
          },
        },
      ];
      const challengeId = "c1000000-0000-4000-8000-000000000001";
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 204 }))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              challengeId,
              expiresAt: "2026-09-24T17:05:00.000Z",
              signInInput: {
                domain: window.location.host,
                address: walletAddress,
                statement:
                  "Prove wallet control for campaign measurement. This does not request a transaction or access to funds.",
                uri: window.location.origin,
                version: "1",
                chainId: "solana:devnet",
                nonce: "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6",
                issuedAt: "2026-09-24T17:00:00.000Z",
                expirationTime: "2026-09-24T17:05:00.000Z",
                requestId: challengeId,
                ...mismatch,
              },
            }),
            { status: 201 },
          ),
        );
      vi.stubGlobal("fetch", fetchMock);

      render(
        <WalletMeasurementFlow
          available
          receiverAddress="Vote111111111111111111111111111111111111111"
        />,
      );
      fireEvent.click(
        await screen.findByRole("button", { name: "Test Wallet" }),
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Verify wallet control" }),
      );

      expect(
        await screen.findByText(/did not match this devnet session/i),
      ).toBeVisible();
      expect(signIn).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it("accepts database-offset challenge serialization while separating proof, consent and the disabled response", async () => {
    const walletAddress = "So11111111111111111111111111111111111111112";
    const receiver = "Vote111111111111111111111111111111111111111";
    const account = {
      address: walletAddress,
      publicKey: new Uint8Array(32),
      chains: ["solana:devnet"],
      features: ["solana:signIn"],
    };
    walletsMock.current = [
      {
        version: "1.0.0",
        name: "Test Wallet",
        icon: "data:image/svg+xml;base64,PHN2Zy8+",
        chains: ["solana:devnet"],
        accounts: [account],
        features: {
          "standard:connect": {
            version: "1.0.0",
            connect: vi.fn(async () => ({ accounts: [account] })),
          },
          "solana:signIn": {
            version: "1.0.0",
            signIn: vi.fn(async () => [
              {
                account,
                signedMessage: new Uint8Array([1, 2, 3]),
                signature: new Uint8Array(64),
                signatureType: "ed25519",
              },
            ]),
          },
        },
      },
    ];
    const challengeId = "c1000000-0000-4000-8000-000000000001";
    const proofId = "c2000000-0000-4000-8000-000000000001";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            buildWalletNonceChallengeResponse({
              challengeId,
              walletAddress,
              applicationOrigin: window.location.origin,
              issuedAt: "2026-09-24T17:00:00.138+00:00",
              expiresAt: "2026-09-24T17:05:00.138+00:00",
              statement:
                "Prove wallet control for campaign measurement. This does not request a transaction or access to funds.",
              chainId: "solana:devnet",
              nonce: "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6",
            }),
          ),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            proofId,
            challengeId,
            state: "verified",
            verifiedAt: "2026-09-24T17:01:00.000Z",
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            consentId: "c3000000-0000-4000-8000-000000000001",
            mappingId: "c4000000-0000-4000-8000-000000000001",
            state: "accepted",
            reconciliationState: "queued",
            consentVersion: 1,
            consentStatement:
              "I consent to Landed linking this wallet to this campaign session to measure configured campaign outcomes. Analysis may include up to 90 days of relevant pre-touch activity and relevant activity until this qualified campaign session expires. I can unlink at any time to stop future association.",
            historicalLookbackDays: 90,
            acceptedAt: "2026-09-24T17:02:00.000Z",
            monitoringEndsAt: "2026-10-01T17:02:00.000Z",
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            mappingId: "c4000000-0000-4000-8000-000000000001",
            state: "unlinked",
            unlinkedAt: "2026-09-24T17:03:00.000Z",
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <WalletMeasurementFlow
        available
        receiverAddress={receiver}
        continuationHostname="campaign.example"
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Test Wallet" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Verify wallet control" }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "Proof succeeded. Measurement is still your choice.",
      }),
    ).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(3);

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Start measurement" }));
    expect(
      await screen.findByRole("heading", {
        name: "Consent is active for this session",
      }),
    ).toBeVisible();
    expect(screen.getByText(receiver)).toBeVisible();
    expect(
      screen.getByText(/transaction submission remains disabled/i),
    ).toBeVisible();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(
      screen.getByRole("link", { name: "Continue to website" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", {
        name: "Continue without wallet measurement",
      }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Unlink wallet" }));
    expect(
      screen.getByRole("group", { name: "Confirm wallet unlink" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Confirm unlink" }));
    expect(await screen.findByText("Wallet unlinked")).toBeVisible();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(
      screen.getByRole("link", { name: "Continue without wallet measurement" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Continue to website" }),
    ).not.toBeInTheDocument();
  });
});

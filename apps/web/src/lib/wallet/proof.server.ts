import "server-only";

import type { SolanaSignInOutput } from "@solana/wallet-standard-features";
import { verifySignIn } from "@solana/wallet-standard-util";
import type { WalletSignatureProofRequest } from "@landed/contracts";

import { hashWalletChallengeNonce } from "./challenge.server";

export const walletProofVerifier = "wallet_standard_siws";
export const walletProofVerifierVersion = "1.1.3";

const base58Alphabet =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export class WalletSignatureVerificationError extends Error {
  constructor() {
    super("Wallet signature proof was not valid.");
    this.name = "WalletSignatureVerificationError";
  }
}

function decodeCanonicalBase64(value: string, byteLength?: number) {
  const decoded = Buffer.from(value, "base64");

  if (
    decoded.toString("base64") !== value ||
    (byteLength !== undefined && decoded.byteLength !== byteLength)
  ) {
    throw new WalletSignatureVerificationError();
  }

  return new Uint8Array(decoded);
}

function decodeBase58(value: string) {
  const bytes = [0];

  for (const character of value) {
    const digit = base58Alphabet.indexOf(character);
    if (digit < 0) throw new WalletSignatureVerificationError();

    let carry = digit;
    for (let index = 0; index < bytes.length; index += 1) {
      carry += bytes[index]! * 58;
      bytes[index] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  for (
    let index = 0;
    value[index] === "1" && index < value.length - 1;
    index += 1
  ) {
    bytes.push(0);
  }

  return new Uint8Array(bytes.reverse());
}

function bytesEqual(left: Uint8Array, right: Uint8Array) {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
}

async function sha256Hex(value: Uint8Array) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(value).buffer,
  );
  return Buffer.from(digest).toString("hex");
}

export async function verifyWalletSignatureProof(
  request: WalletSignatureProofRequest,
) {
  const publicKey = decodeCanonicalBase64(
    request.signInOutput.accountPublicKey,
    32,
  );
  const signedMessage = decodeCanonicalBase64(
    request.signInOutput.signedMessage,
  );
  const signature = decodeCanonicalBase64(request.signInOutput.signature, 64);
  const addressPublicKey = decodeBase58(request.signInInput.address);

  if (!bytesEqual(addressPublicKey, publicKey)) {
    throw new WalletSignatureVerificationError();
  }

  const output: SolanaSignInOutput = {
    account: {
      address: request.signInOutput.accountAddress,
      publicKey,
      chains: [request.signInInput.chainId],
      features: ["solana:signIn"],
    },
    signedMessage,
    signature,
    ...(request.signInOutput.signatureType
      ? { signatureType: request.signInOutput.signatureType }
      : {}),
  };

  let verified = false;
  try {
    verified = verifySignIn(request.signInInput, output);
  } catch {
    verified = false;
  }

  if (!verified) throw new WalletSignatureVerificationError();

  return {
    nonceHash: await hashWalletChallengeNonce(request.signInInput.nonce),
    signedMessageHash: await sha256Hex(signedMessage),
    signatureHash: await sha256Hex(signature),
    verifier: walletProofVerifier,
    verifierVersion: walletProofVerifierVersion,
  };
}

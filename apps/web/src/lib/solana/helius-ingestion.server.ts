import "server-only";

import { z } from "zod";

export class HeliusIngestionConfigError extends Error {
  constructor() {
    super("Helius ingestion is not configured.");
    this.name = "HeliusIngestionConfigError";
  }
}

export function getHeliusIngestionConfig() {
  const integrationId = z
    .uuid()
    .safeParse(process.env.HELIUS_WEBHOOK_INTEGRATION_ID);
  const authorization = process.env.HELIUS_WEBHOOK_AUTHORIZATION;
  const credentialVersion = z
    .string()
    .min(1)
    .max(80)
    .safeParse(process.env.HELIUS_WEBHOOK_CREDENTIAL_VERSION);

  if (!integrationId.success || !authorization || !credentialVersion.success) {
    throw new HeliusIngestionConfigError();
  }

  return {
    integrationId: integrationId.data,
    authorization,
    credentialVersion: credentialVersion.data,
  };
}

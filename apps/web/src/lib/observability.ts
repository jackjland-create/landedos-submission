export type ErrorLog = {
  event: string;
  projectId: string;
  campaignId?: string;
  assetId?: string;
  correlationId?: string;
  error: unknown;
};

type ErrorSink = (record: string) => void;

function describeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return {
    name: "UnknownError",
    message: String(error),
  };
}

export function logError(
  input: ErrorLog,
  sink: ErrorSink = console.error,
): string {
  const correlationId = input.correlationId ?? crypto.randomUUID();
  const record = JSON.stringify({
    level: "error",
    event: input.event,
    projectId: input.projectId,
    campaignId: input.campaignId,
    assetId: input.assetId,
    correlationId,
    error: describeError(input.error),
    occurredAt: new Date().toISOString(),
  });

  sink(record);
  return correlationId;
}

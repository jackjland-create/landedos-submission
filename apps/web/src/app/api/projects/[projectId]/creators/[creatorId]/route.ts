import {
  submissionEnabled,
  authorizeSubmission,
} from "@/lib/submission-access.server";
import { buildSubmissionCampaign } from "@/lib/submission-campaign";
import { CreatorQueryError, getProjectCreatorEvidence } from "@landed/db";
import { NextResponse } from "next/server";
import { z } from "zod";

import { project } from "@/lib/demo-data";
import { logError } from "@/lib/observability";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{
    projectId: string;
    creatorId: string;
  }>;
};

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}

export async function GET(_request: Request, context: RouteContext) {
  const { projectId, creatorId } = await context.params;

  if (!z.uuid().safeParse(creatorId).success) {
    return privateJson({ message: "Creator evidence was not found." }, 404);
  }

  if (submissionEnabled() && projectId === "demo") {
    await authorizeSubmission();
    const creator = buildSubmissionCampaign().creators.find(
      (c) => c.id === creatorId,
    );
    if (!creator) return privateJson({ message: "Creator not found" }, 404);
    return privateJson({
      creator: {
        ...creator,
        profileSummary:
          "Synthetic creator profile for the three-creator consumer launch.",
        profileObservedAt: creator.updatedAt,
        profileSourceLabel: "Synthetic prototype",
        contactAccess: "missing",
        contact: null,
        rateQuotes: creator.currentRate ? [creator.currentRate] : [],
      },
    });
  }
  if (projectId !== project.id)
    return privateJson({ message: "Creator evidence was not found." }, 404);
  try {
    const client = await createClient();
    const creator = await getProjectCreatorEvidence(
      client,
      project.databaseId,
      creatorId,
    );

    if (!creator) {
      return privateJson({ message: "Creator evidence was not found." }, 404);
    }

    return privateJson({ creator });
  } catch (error) {
    if (error instanceof CreatorQueryError && error.code === "42501") {
      return privateJson(
        { message: "Creator evidence is not available for this account." },
        403,
      );
    }

    const reference = logError({
      event: "creator_evidence_failed",
      error,
      projectId,
    });

    return privateJson(
      {
        message: "Creator evidence could not be prepared.",
        reference,
      },
      500,
    );
  }
}

import {
  preparedBasketTemplateSchema,
  type PreparedBasketTemplate,
} from "./basket-strategy";

const provenance = {
  kind: "editorial_starting_hypothesis" as const,
  sourceLabel: "Landed founder basket thesis, 8 September 2026",
  reviewedOn: "2026-09-08",
};

const measurement = {
  primaryOutcome: "qualified_wallets" as const,
  qualifyingAction: "Select the project's instrumented Solana product action.",
  conversionRuleVersionId: null,
  attributionModel: "last_eligible_touch" as const,
  attributionWindowDays: 7 as const,
  leadingIndicators: ["Qualified visits"],
  retentionWindowDays: 7 as const,
  revenueTreatment: "verified_protocol_revenue_only" as const,
};

const missingEvidence = [
  "Current creator availability, quotes and audience evidence need review.",
  "No comparative campaign outcomes validate these starting allocations.",
  "Project conversion instrumentation and retention coverage need confirmation.",
];

const definitions: PreparedBasketTemplate[] = [
  {
    key: "investor_reach",
    version: 1,
    name: "Investor Reach",
    summary:
      "Reach crypto-native investors through specialist voices and deeper discussion.",
    provenance,
    strategy: {
      goal: "Generate qualified investor interest in the product and its proposition.",
      audience:
        "Crypto-native investors, research teams and ecosystem operators.",
      sector: null,
      rationale:
        "Combine specialist discovery with long-form explanation; test whether attention translates into qualified product use.",
      allocations: [
        {
          channel: "x",
          archetype: "analyst",
          format: "Research thread",
          plannedSpendBps: 4500,
          rationale: "Test discovery among relevant investor networks.",
        },
        {
          channel: "podcast",
          archetype: "long_form_host",
          format: "Founder interview",
          plannedSpendBps: 3500,
          rationale: "Explain the proposition and product evidence in depth.",
        },
        {
          channel: "newsletter_research",
          archetype: "sector_specialist",
          format: "Research briefing",
          plannedSpendBps: 2000,
          rationale: "Provide a considered follow-up for specialist readers.",
        },
      ],
      measurement: {
        ...measurement,
        leadingIndicators: [
          "Qualified visits",
          "Deck requests (separate source required)",
        ],
      },
      assumptions: [
        "Audience descriptions require source-backed creator review.",
        "Investor interest and wallet activity are different signals; neither proves investor identity.",
      ],
      missingEvidence,
      exclusions: [
        "Token-price movements are not a success metric.",
        "Deck requests are not onchain revenue or qualified-wallet proof.",
      ],
      rebalanceQuestions: [
        "Which creators generated qualified actions after attention?",
        "Does the evidence justify renewing long-form distribution?",
      ],
    },
  },
  {
    key: "tradfi_bridge",
    version: 1,
    name: "TradFi Bridge",
    summary:
      "Introduce the product to finance decision-makers through professional and specialist channels.",
    provenance,
    strategy: {
      goal: "Build qualified interest among finance-native operators and prospective partners.",
      audience:
        "Finance decision-makers, fintech operators and institutional research teams.",
      sector: null,
      rationale:
        "Test a LinkedIn-led professional audience with podcast and research support; compare against the customer's objective and evidence.",
      allocations: [
        {
          channel: "linkedin",
          archetype: "institutional_educator",
          format: "Product explainer",
          plannedSpendBps: 5000,
          rationale:
            "Test professional audience fit rather than assuming X is the default.",
        },
        {
          channel: "podcast",
          archetype: "founder_operator",
          format: "Operator interview",
          plannedSpendBps: 3000,
          rationale:
            "Explore practical adoption questions with a relevant operator.",
        },
        {
          channel: "newsletter_research",
          archetype: "sector_specialist",
          format: "Finance research briefing",
          plannedSpendBps: 2000,
          rationale: "Give interested teams material for further evaluation.",
        },
      ],
      measurement: {
        ...measurement,
        leadingIndicators: [
          "Qualified visits",
          "Partner enquiries (separate source required)",
          "Report downloads (separate source required)",
        ],
      },
      assumptions: [
        "LinkedIn audience fit is a hypothesis, not a validated performance advantage.",
        "Commercial decisions may take longer than the seven-day attribution window.",
      ],
      missingEvidence,
      exclusions: [
        "A meeting or download is not a verified Solana conversion.",
        "Sector-specific disclosure requirements must be reviewed before creator briefing.",
      ],
      rebalanceQuestions: [
        "Do measured qualified actions justify this channel mix?",
        "Is the observation window mature enough to compare customer quality?",
      ],
    },
  },
  {
    key: "high_velocity_consumer",
    version: 1,
    name: "High-Velocity Consumer",
    summary:
      "Test cultural attention and community participation against a defined product action.",
    provenance,
    strategy: {
      goal: "Convert relevant cultural attention into qualified and returning product users.",
      audience: "Consumer communities relevant to the customer's product.",
      sector: null,
      rationale:
        "Combine fast discovery, participation and demonstration while examining traffic quality and retention.",
      allocations: [
        {
          channel: "x",
          archetype: "culture_creator",
          format: "Campaign content",
          plannedSpendBps: 4000,
          rationale: "Test timely discovery among relevant communities.",
        },
        {
          channel: "community_livestream",
          archetype: "community_operator",
          format: "Product walkthrough",
          plannedSpendBps: 3500,
          rationale: "Give prospective users a participatory explanation.",
        },
        {
          channel: "short_form_video",
          archetype: "culture_creator",
          format: "Product demonstration",
          plannedSpendBps: 2500,
          rationale: "Make the intended product action understandable.",
        },
      ],
      measurement,
      assumptions: [
        "High engagement can contain low-quality or repeated traffic.",
        "Memecoin and gambling use cases require separate audience, objective and suitability decisions.",
      ],
      missingEvidence,
      exclusions: [
        "Trading volume and token price are not protocol revenue.",
        "No rewards, automated payouts or fabricated fraud-detection guarantees.",
      ],
      rebalanceQuestions: [
        "Are qualified actions and returning users following the attention?",
        "Does traffic-quality evidence justify replacing a creator?",
      ],
    },
  },
];

// Keep the canonical library private. Consumers receive validated deep copies,
// so editing one draft never changes another draft or a released template.
const templates = definitions.map((definition) =>
  preparedBasketTemplateSchema.parse(definition),
);

export function listPreparedBaskets(): PreparedBasketTemplate[] {
  return templates.map((template) =>
    preparedBasketTemplateSchema.parse(template),
  );
}

/** Exact-version lookup; never silently substitutes a newer template. */
export function getPreparedBasket(
  key: string,
  version: number,
): PreparedBasketTemplate | null {
  const template = templates.find(
    (candidate) => candidate.key === key && candidate.version === version,
  );
  return template ? preparedBasketTemplateSchema.parse(template) : null;
}

# Landed KOL OS

An AI-assisted influencer and KOL campaign management and attribution platform for Web3, beginning with Solana.

The product will help teams discover and manage creators, build campaign baskets, price and approve work, track delivery, and connect distribution activity to defensible onchain outcomes.

## Submission prototype — October 2026

**Hosted app:** https://landedos-submission.vercel.app/projects/demo/overview

Use the judge account supplied privately with the submission. Credentials are never included in this repository. The app requires sign-in and project access; no Vercel account is needed on the production URL.

**Technical walkthrough:** follow the six-screen sequence below (approximately 2 minutes 40 seconds).

This isolated submission branch demonstrates the existing LandedOS application with one **explicitly synthetic, read-only campaign**. It reuses the Campaign plans, Creators, campaign workspace and reporting components. It does not insert synthetic data into protected approval or report history.

The preview is a product prototype, not proof of production campaign execution. Authentication and project access use Supabase Auth and RLS. The campaign snapshot is generated from deterministic source data; campaign and creator costs use the existing analytics calculators. Approval, delivery, wallet consent, attribution paths and results in this snapshot are simulated. No placements, payments, live wallet signatures, revenue or externally verified performance are claimed.

### Campaign and decision

28 September–11 October inclusive; £7,000 synthetic creator fees; a target of 350 qualified wallets at £20 or less each.

| Creator           |    Fee | Visits | Consenting wallets | Qualified wallets | Cost per qualified wallet |
| ----------------- | -----: | -----: | -----------------: | ----------------: | ------------------------: |
| DeFi After Dark   | £1,805 |    650 |                200 |               100 |                    £18.05 |
| Maya / Chain Mode | £1,275 |    850 |                300 |               150 |                     £8.50 |
| Mint Condition    | £3,920 |  1,100 |                300 |               150 |                    £26.13 |
| Total             | £7,000 |  2,600 |                800 |               400 |                    £17.50 |

The funnel shows 1,800 visits that did not become consenting wallets and 400 consenting wallets that did not qualify. It illustrates where to investigate onboarding friction; it does not prove why people dropped off. The next-budget decision is to test Maya again, retain DeFi After Dark and renegotiate or replace Mint Condition. Retention and revenue remain unmeasured. The forecast range is a labelled illustrative planning assumption, not a calibrated prediction.

### Running this branch

Install Node.js 24 and pnpm 11.9.0, then run `pnpm install --frozen-lockfile`. Use public Supabase Auth configuration. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for a project where the test user already has RLS-protected access to the seeded demo project. Never place service-role secrets in public environment variables. This prototype requires no service-role key, signing keys or provider credentials.

Set the server-only environment flag `LANDED_SUBMISSION_SNAPSHOT=1`, then run `pnpm --filter @landed/web dev`. Open `/projects/demo/overview` and sign in. The flag must also be set in the runtime environment of any approved hosted preview. Without valid authentication and project access, the snapshot is not served. Existing legacy project entry links redirect to the neutral demo overview in this mode. Application mutations and tracked-link writes are blocked in this mode.

The campaign, plan, creator drawer and results routes all consume `apps/web/src/lib/submission-campaign.ts`. There is no separate demo-page route. This mode demonstrates navigation, filtering, details, calculations, charts and export. It does not demonstrate saving a new plan, issuing an immutable report or processing a live consumer transaction.

### Two-to-three-minute walkthrough

1. **0:00–0:25 — Campaign plans:** Open the saved plan. Explain the goal, target, dates, three creator packages and £7,000 fee commitment. State once that this campaign is synthetic and read-only.
2. **0:25–0:50 — Creators:** Browse the same three creators; open Maya's detail drawer to show audience context and the £1,275 package. Close it and return to the plan.
3. **0:50–1:15 — Campaign:** Continue to the actual campaign workspace. Show the saved brief and roster, then open Results. Approval and delivery states are illustrations, not real creator commitments.
4. **1:15–1:45 — Performance:** Show 400 qualified wallets, £17.50 per qualified wallet and the 14-day cumulative timeline. Revenue is unmeasured.
5. **1:45–2:10 — Funnel:** Show 2,600 visits → 800 consenting wallets → 400 qualifying outcomes. Explain the two points of drop-off.
6. **2:10–2:40 — Creator economics:** Compare Maya at £8.50, DeFi After Dark at £18.05 and Mint Condition at £26.13 against the £20 target. Explain the next-budget decision and show the synthetic evidence disclosure.

### Local verification

The candidate passed application lint, TypeScript compilation, the production build, and 191 focused tests across planning, creator evidence, campaign views, tracking cards, reporting, synthetic-data reconciliation and access boundaries. Browser checks used the existing judge account and covered creator search/details, all five plan panels, campaign navigation, delivery/tracking evidence, results, funnel, creator economics and CSV export. Desktop, compact and mobile screenshots were captured locally.

Four tests in the broader campaign-control-workspace suite fail identically against the unchanged baseline component: brief edit discovery, approved-campaign handoff, delivery controls and the evidence-review action. These remain unresolved operational-workflow issues; this branch is not a clean full-suite production release. The submission is limited to the verified read-only path above.

### Source scope and infrastructure

This is a fresh-history submission source snapshot from candidate `7cb3cd3`, not the private business repository. It includes the application, shared analytics, attribution, contracts, database client, Solana and UI packages, tests and build configuration. Internal research, operations, historical evidence, credentials and database provisioning/migration files are excluded. The validation above was performed on the source candidate before export.

The hosted judge experience uses an existing Supabase Auth project and pre-provisioned project membership. A fresh clone can install and compile, but cannot reproduce authenticated judge access without equivalent backend provisioning. Public Supabase keys alone do not grant project access. No service-role credentials are required for this read-only snapshot.

For a production build run `LANDED_SUBMISSION_SNAPSHOT=1 pnpm --filter @landed/web build`. To serve it run `pnpm --filter @landed/web exec next start`. Supply the same public Auth variables and snapshot flag at runtime.

The synthetic campaign does not prove live transaction ingestion. Genuine devnet evidence is separate and must not be inferred from these synthetic results.

### Export and hosting verification

The exported source installed independently with the frozen lockfile and passed a production build. The hosted Vercel production build also passed. Submission-only guards prevent account creation and recovery even if their feature flags are enabled; focused authentication tests passed. The app retains existing judge authentication and RLS-protected project reads, with no business database migrations.

export const guidedDemoManifest = {
  activationRequestId: "f1600000-0000-4000-8000-000000000001",
  basketId: "f1100000-0000-4000-8000-000000000001",
  basketName: "INT-01 Golden Campaign",
  blockerPackageId: "f1300000-0000-4000-8000-000000000001",
  blockerPackageName: "Golden launch package",
  projectDatabaseId: "20000000-0000-4000-8000-000000000001",
  reportId: "f2100000-0000-4000-8000-000000000001",
  measuredReportVersion: 2,
  replayedReportVersion: 3,
} as const;

export function guidedDemoReportPath(projectId: string, replay = false) {
  const query = new URLSearchParams({
    version: String(
      replay
        ? guidedDemoManifest.replayedReportVersion
        : guidedDemoManifest.measuredReportVersion,
    ),
  });
  if (replay)
    query.set("compare", String(guidedDemoManifest.measuredReportVersion));
  return `/projects/${projectId}/reports/${guidedDemoManifest.reportId}?${query}`;
}

export function guidedDemoCampaignResolverPath(
  projectId: string,
  view: "workspace" | "content-assets" | "tracking",
) {
  return `/projects/${projectId}/guided-demo/campaign?view=${view}`;
}

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { AppShell } from "@/components/app-shell";

// Opt-in visual evidence of the real components after test interactions.
// This is not an application route and never calls a live write endpoint.
export function captureHandoff(name: string, section: "baskets" | "campaigns") {
  if (process.env.CAPTURE_HANDOFF !== "1") return;
  const content =
    document.body.querySelector("[data-testid=handoff-content]") ??
    document.body.firstElementChild;
  if (!content) throw new Error("No component markup to capture");
  const shell = renderToStaticMarkup(
    <AppShell activeSection={section} projectId="helios" showGuidedDemo={false}>
      <div id="captured-component" />
    </AppShell>,
  ).replace('<div id="captured-component"></div>', content.innerHTML);
  const directory = resolve(
    process.cwd(),
    "../../outputs/component-captures",
  );
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, `${name}.html`), shell);
}

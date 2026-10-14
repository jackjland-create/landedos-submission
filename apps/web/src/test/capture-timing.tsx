import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { AppShell } from "@/components/app-shell";
import styles from "@/components/campaign-timing-fields.module.css";

/** Opt-in screenshots use actual post-interaction component markup, not a live account. */
export function captureTimingEvidence(name: string, container: HTMLElement) {
  if (process.env.CAPTURE_TIMING !== "1") return;
  const directory = resolve(
    process.cwd(),
    "../../outputs/component-captures",
  );
  mkdirSync(directory, { recursive: true });
  const css = readFileSync(
    resolve(process.cwd(), "src/app/globals.css"),
    "utf8",
  );
  const moduleCss = readFileSync(
    resolve(process.cwd(), "src/components/campaign-timing-fields.module.css"),
    "utf8",
  ).replace(/\.([a-zA-Z]+)\b/g, (match, key: string) =>
    styles[key] ? `.${styles[key]}` : match,
  );
  const shell = renderToStaticMarkup(
    <AppShell activeSection="baskets" projectId="helios" showGuidedDemo={false}>
      <div id="timing-evidence-content" />
    </AppShell>,
  ).replace('<div id="timing-evidence-content"></div>', container.innerHTML);
  writeFileSync(
    resolve(directory, `${name}.html`),
    `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Local basket timing evidence</title><style>${css}\n${moduleCss}</style></head><body>${shell}</body></html>`,
  );
}

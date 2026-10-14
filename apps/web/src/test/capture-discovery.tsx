import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { AppShell } from "@/components/app-shell";
import styles from "@/components/basket-discovery.module.css";

/** Opt-in component-state evidence, not a connected application or live write. */
export function captureDiscovery(name: string) {
  if (process.env.CAPTURE_DISCOVERY !== "1") return;
  const content = document.body.firstElementChild;
  if (!content) throw new Error("Missing discovery markup");
  const shell = renderToStaticMarkup(
    <AppShell activeSection="baskets" projectId="helios" showGuidedDemo={false}>
      <header className="page-header">
        <div>
          <h1>Baskets</h1>
          <p>Component rehearsal · not the connected customer journey</p>
        </div>
      </header>
      <div id="captured-discovery" />
    </AppShell>,
  ).replace('<div id="captured-discovery"></div>', content.innerHTML);
  const css = readFileSync(
    resolve(process.cwd(), "src/components/basket-discovery.module.css"),
    "utf8",
  )
    .replace(/:global\(([^)]+)\)/g, "$1")
    .replace(/\.([a-zA-Z][\w-]*)/g, (match, key: string) =>
      styles[key] ? `.${styles[key]}` : match,
    );
  const directory = resolve(
    process.cwd(),
    "../../outputs/component-captures",
  );
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    resolve(directory, `${name}.html`),
    `<style>${css}</style>${shell}`,
  );
}

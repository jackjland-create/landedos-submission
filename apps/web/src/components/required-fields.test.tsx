import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { CampaignTimingFields } from "./campaign-timing-fields";

const css = readFileSync(path.resolve("src/app/required-fields.css"), "utf8");
// Exercise the actual production selector, not a duplicate validity predicate.
const selector = css
  .slice(css.indexOf("label:has("), css.lastIndexOf("{"))
  .trim();
const marker =
  '<span class="required-field-marker" aria-hidden="true" title="Required"></span>';
const shown = () => document.querySelectorAll(selector).length;

describe("shared required-input markers", () => {
  beforeEach(() => document.body.replaceChildren());
  it("clears and returns with typing, prefilled values, clearing and reset", () => {
    document.body.innerHTML = `<form><label><span>Reason${marker}</span><textarea required></textarea></label></form>`;
    const input = document.querySelector("textarea")!;
    expect(shown()).toBe(1);
    input.value = "test dev net run";
    expect(shown()).toBe(0);
    input.value = "";
    expect(shown()).toBe(1);
    input.defaultValue = "Saved reason";
    document.querySelector("form")!.reset();
    expect(shown()).toBe(0);
  });

  it("covers external labels, selects, wrapped password inputs and confirmations", () => {
    document.body.innerHTML = `<label for="choice">Choice${marker}</label><select id="choice" required><option value="">Choose</option><option value="a">A</option></select><label for="password">Password${marker}</label><div><input id="password" type="password" required></div><label><input type="checkbox" required><span>Confirm${marker}</span></label>`;
    expect(shown()).toBe(3);
    document.querySelector("select")!.value = "a";
    document.querySelector<HTMLInputElement>("#password")!.value = "something";
    document.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    )!.checked = true;
    expect(shown()).toBe(0);
  });

  it("does not mark optional, disabled, fieldset-disabled or read-only controls", () => {
    document.body.innerHTML = `<label>Optional${marker}<input></label><label>Disabled${marker}<input required disabled></label><fieldset disabled><label>Permission${marker}<textarea required></textarea></label></fieldset><label>Locked${marker}<input required readonly></label>`;
    expect(shown()).toBe(0);
  });

  it("respects conditional required and native invalid types without submitting", () => {
    document.body.innerHTML = `<label>Email${marker}<input type="email"></label>`;
    const input = document.querySelector("input")!;
    expect(shown()).toBe(0);
    input.required = true;
    input.value = "not-an-email";
    expect(shown()).toBe(1);
    input.value = "operator@example.test";
    expect(shown()).toBe(0);
    input.value = "";
    input.required = false;
    expect(shown()).toBe(0);
  });

  it("marks custom approval prerequisites without adding native save constraints", () => {
    document.body.innerHTML = `<form><label>Reason${marker}<textarea aria-required="true" data-required-missing="true"></textarea></label></form>`;
    expect(shown()).toBe(1);
    expect(document.querySelector("form")!.checkValidity()).toBe(true);
    document.querySelector("textarea")!.dataset.requiredMissing = "false";
    expect(shown()).toBe(0);
  });

  it("keeps timing labels accessible and draft timing validation unchanged", () => {
    const value = {
      flightStart: "",
      flightEnd: "",
      measurementStart: "",
      measurementEnd: "",
    };
    const { rerender } = render(
      <CampaignTimingFields value={value} onChange={() => {}} />,
    );
    expect(shown()).toBe(4);
    expect(screen.getByLabelText("Activity starts (UTC)")).toHaveAttribute(
      "aria-required",
      "true",
    );
    expect(screen.getByLabelText("Activity starts (UTC)")).not.toHaveAttribute(
      "required",
    );
    rerender(
      <CampaignTimingFields
        value={{ ...value, flightStart: "2026-10-09T12:00:00" }}
        onChange={() => {}}
      />,
    );
    expect(shown()).toBe(3);
    fireEvent.focus(screen.getByLabelText("Activity starts (UTC)"));
    expect(shown()).toBe(3);
  });

  it("keeps decorative markers out of accessible names", () => {
    render(
      <label>
        <span>
          Approval reason
          <span
            className="required-field-marker"
            aria-hidden="true"
            title="Required"
          >
            {" "}
            *
          </span>
        </span>
        <textarea required />
      </label>,
    );
    expect(
      screen.getByRole("textbox", { name: "Approval reason" }),
    ).toBeRequired();
    expect(css).toContain("visibility: hidden");
    expect(css).toContain("--required-field-color: #c23b22");
    expect(css).toContain("--required-field-color: #f08a74");
  });

  it("covers every declared required control with a marked associated label", () => {
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? files(path.join(dir, entry.name))
          : entry.name.endsWith(".tsx") && !entry.name.includes(".test.")
            ? [path.join(dir, entry.name)]
            : [],
      );
    const missing: string[] = [];
    for (const file of files("src")) {
      const source = readFileSync(file, "utf8");
      const ast = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const labels: ts.JsxElement[] = [];
      const controls: (ts.JsxSelfClosingElement | ts.JsxOpeningElement)[] = [];
      const attribute = (
        node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
        name: string,
      ) =>
        node.attributes.properties.find(
          (attr) => ts.isJsxAttribute(attr) && attr.name.getText(ast) === name,
        ) as ts.JsxAttribute | undefined;
      const visit = (node: ts.Node) => {
        if (
          ts.isJsxElement(node) &&
          node.openingElement.tagName.getText(ast) === "label"
        )
          labels.push(node);
        if (
          (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
          ["input", "select", "textarea"].includes(node.tagName.getText(ast)) &&
          (attribute(node, "required") || attribute(node, "aria-required"))
        )
          controls.push(node);
        ts.forEachChild(node, visit);
      };
      visit(ast);
      for (const control of controls) {
        const id = attribute(control, "id")?.initializer?.getText(ast);
        const label = labels.find(
          (node) =>
            (node.pos <= control.pos && node.end >= control.end) ||
            (id &&
              attribute(node.openingElement, "htmlFor")?.initializer?.getText(
                ast,
              ) === id),
        );
        if (!label?.getText(ast).includes("required-field-marker"))
          missing.push(
            `${file}:${ast.getLineAndCharacterOfPosition(control.pos).line + 1}`,
          );
      }
    }
    expect(missing).toEqual([]);
  });
});

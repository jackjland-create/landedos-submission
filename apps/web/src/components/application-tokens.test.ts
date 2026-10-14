// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tokens = JSON.parse(
  readFileSync(
    new URL("../../../../brand/design-tokens.json", import.meta.url),
    "utf8",
  ),
).application;
const css = readFileSync(
  new URL("./application-tokens.module.css", import.meta.url),
  "utf8",
);
function luminance(hex: string) {
  const rgb = hex
    .slice(1)
    .match(/../g)!
    .map((part) => parseInt(part, 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}
describe("canonical application tokens", () => {
  it.each(["light", "dark"])(
    "maps all %s colors without inventing values",
    (theme) => {
      for (const [name, token] of Object.entries(tokens[theme]) as [
        string,
        { $value: string },
      ][]) {
        const property = name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
        expect(css).toContain(`--app-color-${property}: ${token.$value};`);
      }
    },
  );
  it.each(["light", "dark"])(
    "keeps %s text and surrounding focus contrast at AA",
    (theme) => {
      const value = (name: string) => tokens[theme][name].$value;
      for (const surface of ["card", "canvas", "side", "sunk"]) {
        expect(contrast(value("ink"), value(surface))).toBeGreaterThanOrEqual(
          4.5,
        );
        expect(
          contrast(value("secondary"), value(surface)),
        ).toBeGreaterThanOrEqual(4.5);
        expect(contrast(value("focus"), value(surface))).toBeGreaterThanOrEqual(
          3,
        );
      }
      expect(contrast(value("heroInk"), value("hero"))).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrast(value("bad"), value("card"))).toBeGreaterThanOrEqual(4.5);
      for (const pastel of ["go", "warn", "badFill", "info"]) {
        expect(
          contrast(value("onPastel"), value(pastel)),
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
});

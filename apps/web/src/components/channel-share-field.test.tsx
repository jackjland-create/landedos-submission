import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { ChannelShareField } from "./channel-share-field";

afterEach(cleanup);

it("preserves decimal editing and emits exact integer shares", () => {
  const changed = vi.fn();
  function Harness() {
    const [value, setValue] = useState(0);
    return (
      <ChannelShareField
        name="share"
        value={value}
        onChange={(next) => {
          changed(next);
          setValue(next);
        }}
      />
    );
  }
  render(<Harness />);
  const input = screen.getByLabelText("Spend share (%)");
  expect(input).toHaveValue("");
  for (const [text, basisPoints] of [
    ["0", 0],
    ["0.", 0],
    ["0.5", 50],
    ["0.01", 1],
    ["100", 10000],
    ["", 0],
  ] as const) {
    fireEvent.change(input, { target: { value: text } });
    expect(input).toHaveValue(text);
    expect(changed).toHaveBeenLastCalledWith(basisPoints);
  }
  const count = changed.mock.calls.length;
  fireEvent.change(input, { target: { value: "0.001" } });
  expect(changed).toHaveBeenCalledTimes(count);
  expect(input).toHaveValue("");
});

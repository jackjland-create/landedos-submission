import { useState } from "react";

/** Keep intermediate decimal text without inventing a share for a new row. */
export function ChannelShareField({
  value,
  name,
  onChange,
}: {
  value: number;
  name: string;
  onChange: (basisPoints: number) => void;
}) {
  const [entry, setEntry] = useState({
    value,
    text: value ? String(value / 100) : "",
  });
  return (
    <label>
      <span>
        Spend share (%)
        <span
          className="required-field-marker"
          aria-hidden="true"
          title="Required"
        />
      </span>
      <input
        name={name}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder="e.g. 100"
        required
        value={
          entry.value === value ? entry.text : value ? String(value / 100) : ""
        }
        onChange={(event) => {
          const text = event.target.value;
          const match = /^(\d*)(?:\.(\d{0,2}))?$/.exec(text);
          if (!match) return;
          const next =
            Number(match[1] || "0") * 100 +
            Number((match[2] ?? "").padEnd(2, "0"));
          setEntry({ value: next, text });
          onChange(next);
        }}
      />
    </label>
  );
}

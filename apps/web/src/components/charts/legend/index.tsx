"use client";

import {
  cloneElement,
  createContext,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useContext,
  useState,
} from "react";

import { cn } from "@/lib/utils";

export interface LegendItemData {
  label: string;
  value: number;
  displayValue?: string;
  detail?: string;
  color: string;
}

type LegendContextValue = {
  hoveredIndex: number | null;
  setHoveredIndex: (index: number | null) => void;
};

type LegendItemContextValue = {
  index: number;
  isFaded: boolean;
  isHovered: boolean;
  item: LegendItemData;
};

const LegendContext = createContext<LegendContextValue | null>(null);
const LegendItemContext = createContext<LegendItemContextValue | null>(null);

function useLegend() {
  const context = useContext(LegendContext);
  if (!context) throw new Error("LegendItem must be used inside Legend");
  return context;
}

function useLegendItem() {
  const context = useContext(LegendItemContext);
  if (!context) throw new Error("Legend child must be used inside LegendItem");
  return context;
}

export function Legend({
  items,
  hoveredIndex: controlledHoveredIndex,
  onHoverChange,
  className,
  children,
}: {
  items: LegendItemData[];
  hoveredIndex?: number | null;
  onHoverChange?: (index: number | null) => void;
  className?: string;
  children: ReactElement;
}) {
  const [internalHoveredIndex, setInternalHoveredIndex] = useState<
    number | null
  >(null);
  const isControlled = controlledHoveredIndex !== undefined;
  const hoveredIndex = isControlled
    ? controlledHoveredIndex
    : internalHoveredIndex;
  const setHoveredIndex = (index: number | null) => {
    if (isControlled) onHoverChange?.(index);
    else setInternalHoveredIndex(index);
  };

  return (
    <LegendContext.Provider value={{ hoveredIndex, setHoveredIndex }}>
      <div className={cn("chart-legend", className)}>
        {items.map((item, index) => {
          if (!isValidElement(children)) return null;
          return (
            <LegendItemContext.Provider
              key={item.label}
              value={{
                index,
                isFaded: hoveredIndex !== null && hoveredIndex !== index,
                isHovered: hoveredIndex === index,
                item,
              }}
            >
              {cloneElement(children)}
            </LegendItemContext.Provider>
          );
        })}
      </div>
    </LegendContext.Provider>
  );
}

export function LegendItem({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const { setHoveredIndex } = useLegend();
  const { index, isFaded, isHovered } = useLegendItem();

  return (
    <button
      className={cn("chart-legend__item", className)}
      data-faded={isFaded ? "" : undefined}
      data-hovered={isHovered ? "" : undefined}
      onBlur={() => setHoveredIndex(null)}
      onFocus={() => setHoveredIndex(index)}
      onMouseEnter={() => setHoveredIndex(index)}
      onMouseLeave={() => setHoveredIndex(null)}
      type="button"
    >
      {children}
    </button>
  );
}

export const LegendItemComponent = LegendItem;

export function LegendMarker() {
  const { item } = useLegendItem();
  return (
    <span
      aria-hidden="true"
      className="chart-legend__marker"
      style={{ backgroundColor: item.color }}
    />
  );
}

export function LegendLabel() {
  const { item } = useLegendItem();
  return <span className="chart-legend__label">{item.label}</span>;
}

export function LegendValue() {
  const { item } = useLegendItem();
  return (
    <span className="chart-legend__value">
      {item.displayValue ?? item.value.toLocaleString("en-GB")}
    </span>
  );
}

export function LegendDetail() {
  const { item } = useLegendItem();
  return item.detail ? (
    <span className="chart-legend__detail">{item.detail}</span>
  ) : null;
}

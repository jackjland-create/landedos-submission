"use client";

import { motion, useReducedMotion } from "motion/react";
import { useCallback, useState } from "react";

import { cn } from "@/lib/utils";

export interface FunnelStage {
  label: string;
  value: number;
  displayValue?: string;
  color?: string;
}

export interface FunnelChartProps {
  data: FunnelStage[];
  color?: string;
  layers?: number;
  className?: string;
  hoveredIndex?: number | null;
  onHoverChange?: (index: number | null) => void;
  gap?: number;
  orientation?: "horizontal" | "vertical";
}

const VIEWBOX_WIDTH = 900;
const VIEWBOX_HEIGHT = 300;

function horizontalSegmentPath({
  start,
  end,
  x,
  width,
  scale,
}: {
  start: number;
  end: number;
  x: number;
  width: number;
  scale: number;
}) {
  const middle = VIEWBOX_HEIGHT / 2;
  const startHeight = start * VIEWBOX_HEIGHT * 0.44 * scale;
  const endHeight = end * VIEWBOX_HEIGHT * 0.44 * scale;
  const curve = width * 0.55;

  return [
    `M ${x} ${middle - startHeight}`,
    `C ${x + curve} ${middle - startHeight}, ${x + width - curve} ${middle - endHeight}, ${x + width} ${middle - endHeight}`,
    `L ${x + width} ${middle + endHeight}`,
    `C ${x + width - curve} ${middle + endHeight}, ${x + curve} ${middle + startHeight}, ${x} ${middle + startHeight}`,
    "Z",
  ].join(" ");
}

function verticalSegmentPath({
  start,
  end,
  y,
  height,
  scale,
}: {
  start: number;
  end: number;
  y: number;
  height: number;
  scale: number;
}) {
  const middle = VIEWBOX_HEIGHT / 2;
  const startWidth = start * VIEWBOX_HEIGHT * 0.44 * scale;
  const endWidth = end * VIEWBOX_HEIGHT * 0.44 * scale;
  const curve = height * 0.55;

  return [
    `M ${middle - startWidth} ${y}`,
    `C ${middle - startWidth} ${y + curve}, ${middle - endWidth} ${y + height - curve}, ${middle - endWidth} ${y + height}`,
    `L ${middle + endWidth} ${y + height}`,
    `C ${middle + endWidth} ${y + height - curve}, ${middle + startWidth} ${y + curve}, ${middle + startWidth} ${y}`,
    "Z",
  ].join(" ");
}

/**
 * Bklit funnel primitive adapted to the Landed reporting boundary.
 * The SVG is decorative; the paired Legend supplies the accessible controls.
 */
export function FunnelChart({
  data,
  color = "var(--chart-1)",
  layers = 3,
  className,
  hoveredIndex: controlledHoveredIndex,
  onHoverChange,
  gap = 8,
  orientation = "horizontal",
}: FunnelChartProps) {
  const reduceMotion = useReducedMotion();
  const [internalHoveredIndex, setInternalHoveredIndex] = useState<
    number | null
  >(null);
  const isControlled = controlledHoveredIndex !== undefined;
  const hoveredIndex = isControlled
    ? controlledHoveredIndex
    : internalHoveredIndex;
  const setHoveredIndex = useCallback(
    (index: number | null) => {
      if (isControlled) onHoverChange?.(index);
      else setInternalHoveredIndex(index);
    },
    [isControlled, onHoverChange],
  );

  if (data.length === 0) return null;

  const entryValue = data[0]?.value ?? 0;
  const isHorizontal = orientation === "horizontal";
  const segmentExtent =
    (VIEWBOX_WIDTH - Math.max(0, data.length - 1) * gap) / data.length;
  const normalised = data.map((stage) =>
    entryValue > 0 ? Math.max(0, stage.value / entryValue) : 0,
  );

  return (
    <div
      className={cn(
        "bklit-funnel-chart",
        `bklit-funnel-chart--${orientation}`,
        className,
      )}
    >
      <svg
        aria-hidden="true"
        preserveAspectRatio="none"
        role="presentation"
        viewBox={
          isHorizontal
            ? `0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`
            : `0 0 ${VIEWBOX_HEIGHT} ${VIEWBOX_WIDTH}`
        }
      >
        {data.map((stage, index) => {
          const position = index * (segmentExtent + gap);
          const start = normalised[index] ?? 0;
          const end = normalised[Math.min(index + 1, data.length - 1)] ?? 0;
          const stageColor = stage.color ?? color;
          const isDimmed = hoveredIndex !== null && hoveredIndex !== index;
          const isHovered = hoveredIndex === index;

          return (
            <motion.g
              animate={{ opacity: isDimmed ? 0.28 : 1 }}
              data-faded={isDimmed ? "" : undefined}
              data-funnel-stage={stage.label}
              initial={false}
              key={stage.label}
              transition={{
                duration: reduceMotion ? 0 : 0.2,
                delay: reduceMotion ? 0 : index * 0.1,
              }}
            >
              {Array.from({ length: Math.max(1, layers) }, (_, ringIndex) => {
                const ringScale = 1 - (ringIndex / Math.max(layers, 1)) * 0.35;
                const ringOpacity =
                  0.18 + (ringIndex / Math.max(layers - 1, 1)) * 0.65;

                return (
                  <motion.path
                    animate={
                      isHorizontal
                        ? { scaleY: isHovered ? 1.06 : 1 }
                        : { scaleX: isHovered ? 1.06 : 1 }
                    }
                    d={
                      isHorizontal
                        ? horizontalSegmentPath({
                            start,
                            end,
                            x: position,
                            width: segmentExtent,
                            scale: ringScale,
                          })
                        : verticalSegmentPath({
                            start,
                            end,
                            y: position,
                            height: segmentExtent,
                            scale: ringScale,
                          })
                    }
                    fill={stageColor}
                    key={`${stage.label}-${ringIndex}`}
                    opacity={ringOpacity}
                    style={{
                      transformBox: "fill-box",
                      transformOrigin: "center",
                    }}
                    transition={
                      reduceMotion
                        ? { duration: 0 }
                        : {
                            type: "spring",
                            stiffness: 280 - ringIndex * 45,
                            damping: 24,
                          }
                    }
                  />
                );
              })}
              <rect
                fill="transparent"
                height={isHorizontal ? VIEWBOX_HEIGHT : segmentExtent}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
                width={isHorizontal ? segmentExtent : VIEWBOX_HEIGHT}
                x={isHorizontal ? position : 0}
                y={isHorizontal ? 0 : position}
              />
            </motion.g>
          );
        })}
      </svg>
    </div>
  );
}

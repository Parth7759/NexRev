"use client";

import React, { useState } from "react";

// ============================================================================
// 1. Area Trend Chart (Review Volume / Ratings over time)
// ============================================================================
export interface TrendDataPoint {
  label: string;
  value: number;
  secondaryValue?: number;
}

export function AreaTrendChart({
  data,
  height = 200,
  valuePrefix = "",
  valueSuffix = "",
  lineColor = "#059669",
  fillGradientId = "greenGradient",
}: {
  data: TrendDataPoint[];
  height?: number;
  valuePrefix?: string;
  valueSuffix?: string;
  lineColor?: string;
  fillGradientId?: string;
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return (
      <div
        className="w-full flex items-center justify-center text-xs text-slate-400 bg-slate-50/50 rounded-xl border border-dashed border-slate-200"
        style={{ height }}
      >
        No trend data available for this range
      </div>
    );
  }

  const paddingX = 40;
  const paddingY = 24;
  const svgWidth = 600;
  const svgHeight = height;

  const innerWidth = svgWidth - paddingX * 2;
  const innerHeight = svgHeight - paddingY * 2;

  const maxVal = Math.max(...data.map((d) => d.value), 5);
  const minVal = 0;

  const points = data.map((d, i) => {
    const x = paddingX + (i / Math.max(data.length - 1, 1)) * innerWidth;
    const y =
      paddingY + innerHeight - ((d.value - minVal) / (maxVal - minVal || 1)) * innerHeight;
    return { x, y, ...d };
  });

  const pathD = points.reduce((acc, p, i) => {
    return i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`;
  }, "");

  const areaD = `${pathD} L ${points[points.length - 1].x} ${
    paddingY + innerHeight
  } L ${points[0].x} ${paddingY + innerHeight} Z`;

  return (
    <div className="w-full relative select-none">
      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className="w-full h-auto overflow-visible"
        style={{ maxHeight: height }}
      >
        <defs>
          <linearGradient id={fillGradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity="0.22" />
            <stop offset="100%" stopColor={lineColor} stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {/* Horizontal gridlines */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct, idx) => {
          const y = paddingY + innerHeight * (1 - pct);
          const gridVal = Math.round(minVal + (maxVal - minVal) * pct);
          return (
            <g key={idx}>
              <line
                x1={paddingX}
                y1={y}
                x2={svgWidth - paddingX}
                y2={y}
                stroke="#E2EBE5"
                strokeDasharray="3 3"
                strokeWidth="1"
              />
              <text
                x={paddingX - 8}
                y={y + 3}
                textAnchor="end"
                className="text-[9px] fill-slate-400 font-mono"
              >
                {gridVal}
              </text>
            </g>
          );
        })}

        {/* Area fill */}
        <path d={areaD} fill={`url(#${fillGradientId})`} />

        {/* Trend Line */}
        <path
          d={pathD}
          fill="none"
          stroke={lineColor}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Data points & hover triggers */}
        {points.map((p, i) => {
          const isHovered = hoveredIdx === i;
          return (
            <g key={i}>
              <circle
                cx={p.x}
                cy={p.y}
                r={isHovered ? 5.5 : 3.5}
                fill="#FFFFFF"
                stroke={lineColor}
                strokeWidth={isHovered ? 2.5 : 2}
                className="transition-all duration-150 cursor-pointer"
              />
              {/* Invisible larger hit area for hover */}
              <circle
                cx={p.x}
                cy={p.y}
                r={16}
                fill="transparent"
                className="cursor-pointer"
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(null)}
              />
              {/* X-axis labels (render every 2nd or 3rd label if dense) */}
              {(data.length <= 8 || i % Math.ceil(data.length / 6) === 0 || i === data.length - 1) && (
                <text
                  x={p.x}
                  y={svgHeight - 4}
                  textAnchor="middle"
                  className="text-[10px] fill-slate-500 font-medium"
                >
                  {p.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Floating Tooltip */}
      {hoveredIdx !== null && points[hoveredIdx] && (
        <div
          className="absolute pointer-events-none transform -translate-x-1/2 -translate-y-full bg-slate-900 text-white text-[11px] font-medium py-1 px-2.5 rounded-lg shadow-lg flex items-center gap-1.5 transition-all z-20"
          style={{
            left: `${(points[hoveredIdx].x / svgWidth) * 100}%`,
            top: `${(points[hoveredIdx].y / svgHeight) * 100}%`,
            marginTop: "-8px",
          }}
        >
          <span className="text-slate-300">{points[hoveredIdx].label}:</span>
          <span className="font-bold text-emerald-400">
            {valuePrefix}
            {points[hoveredIdx].value}
            {valueSuffix}
          </span>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 2. Bar Rating Distribution (5 Star down to 1 Star)
// ============================================================================
export interface RatingDistributionItem {
  stars: number;
  count: number;
  percentage: number;
}

export function RatingDistributionChart({
  distribution,
}: {
  distribution: RatingDistributionItem[];
}) {
  const total = distribution.reduce((sum, item) => sum + item.count, 0);

  return (
    <div className="space-y-2.5 w-full">
      {distribution.map((item) => {
        const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
        return (
          <div key={item.stars} className="flex items-center gap-2.5 text-xs">
            <span className="w-11 font-medium text-slate-700 shrink-0 flex items-center gap-1">
              <span>{item.stars}</span>
              <span className="text-amber-400 font-bold">★</span>
            </span>

            <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden relative">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  item.stars >= 4
                    ? "bg-emerald-600"
                    : item.stars === 3
                    ? "bg-amber-500"
                    : "bg-rose-500"
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>

            <span className="w-9 text-right font-mono text-[11px] text-slate-500 shrink-0">
              {item.count}
            </span>
            <span className="w-10 text-right font-mono text-[11px] text-slate-400 shrink-0">
              {pct}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// 3. Sentiment Donut Breakdown (Positive, Neutral, Negative)
// ============================================================================
export function SentimentDonutChart({
  positive = 0,
  neutral = 0,
  negative = 0,
}: {
  positive: number;
  neutral: number;
  negative: number;
}) {
  const total = positive + neutral + negative;

  if (total === 0) {
    return (
      <div className="h-36 flex items-center justify-center text-xs text-slate-400">
        No sentiment data recorded
      </div>
    );
  }

  const posPct = Math.round((positive / total) * 100);
  const neuPct = Math.round((neutral / total) * 100);
  const negPct = Math.max(0, 100 - posPct - neuPct);

  // SVG circle circumference for r=40 is 2 * PI * 40 ≈ 251.3
  const c = 251.3;
  const strokePos = (posPct / 100) * c;
  const strokeNeu = (neuPct / 100) * c;
  const strokeNeg = (negPct / 100) * c;

  return (
    <div className="flex items-center gap-6">
      <div className="relative w-28 h-28 shrink-0">
        <svg viewBox="0 0 100 100" className="w-full h-full transform -rotate-90">
          {/* Background circle */}
          <circle cx="50" cy="50" r="40" fill="transparent" stroke="#F1F5F3" strokeWidth="12" />

          {/* Positive segment */}
          <circle
            cx="50"
            cy="50"
            r="40"
            fill="transparent"
            stroke="#059669"
            strokeWidth="12"
            strokeDasharray={`${strokePos} ${c - strokePos}`}
            strokeDashoffset="0"
          />

          {/* Neutral segment */}
          <circle
            cx="50"
            cy="50"
            r="40"
            fill="transparent"
            stroke="#F59E0B"
            strokeWidth="12"
            strokeDasharray={`${strokeNeu} ${c - strokeNeu}`}
            strokeDashoffset={`${-strokePos}`}
          />

          {/* Negative segment */}
          <circle
            cx="50"
            cy="50"
            r="40"
            fill="transparent"
            stroke="#E11D48"
            strokeWidth="12"
            strokeDasharray={`${strokeNeg} ${c - strokeNeg}`}
            strokeDashoffset={`${-(strokePos + strokeNeu)}`}
          />
        </svg>

        {/* Center label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-base font-bold text-slate-900 leading-none">{posPct}%</span>
          <span className="text-[9px] uppercase tracking-wider text-slate-400 font-semibold mt-0.5">
            Positive
          </span>
        </div>
      </div>

      <div className="flex-1 space-y-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-slate-700">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 inline-block" />
            Positive
          </span>
          <span className="font-semibold text-slate-900 font-mono">
            {positive} ({posPct}%)
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-slate-700">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" />
            Neutral
          </span>
          <span className="font-semibold text-slate-900 font-mono">
            {neutral} ({neuPct}%)
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-slate-700">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-600 inline-block" />
            Negative
          </span>
          <span className="font-semibold text-slate-900 font-mono">
            {negative} ({negPct}%)
          </span>
        </div>
      </div>
    </div>
  );
}

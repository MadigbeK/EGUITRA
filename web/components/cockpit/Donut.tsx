/**
 * Donut — donut chart SVG inline (zéro dépendance), style Dire Wolf.
 * Segments colorés sur fond vert sombre + label central.
 */

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

export function Donut({
  segments,
  centerLabel,
  centerSub,
  size = 132,
  thickness = 16,
}: {
  segments: DonutSegment[];
  centerLabel: string;
  centerSub?: string;
  size?: number;
  thickness?: number;
}) {
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;

  let offset = 0;
  const arcs = segments.map((seg) => {
    const frac = seg.value / total;
    const dash = frac * circ;
    const arc = { ...seg, dash, gap: circ - dash, offset: -offset, frac };
    offset += dash;
    return arc;
  });

  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90 flex-none">
        {/* Track */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="#1a2156"
          strokeWidth={thickness}
        />
        {arcs.map((a, i) => (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={a.color}
            strokeWidth={thickness}
            strokeDasharray={`${a.dash} ${a.gap}`}
            strokeDashoffset={a.offset}
            strokeLinecap="butt"
          />
        ))}
        {/* Centre label (contre-rotation) */}
        <g className="rotate-90" style={{ transformOrigin: "center" }}>
          <text
            x={cx}
            y={cy - 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="#EEF3F6"
            style={{ fontSize: 19, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}
          >
            {centerLabel}
          </text>
          {centerSub && (
            <text
              x={cx}
              y={cy + 15}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#8FA2C0"
              style={{ fontSize: 8.5, letterSpacing: "0.12em" }}
            >
              {centerSub.toUpperCase()}
            </text>
          )}
        </g>
      </svg>

      {/* Légende */}
      <ul className="space-y-1.5">
        {arcs.map((a, i) => (
          <li key={i} className="flex items-center gap-2 text-[11px]">
            <span
              className="h-2.5 w-2.5 flex-none rounded-[2px]"
              style={{ backgroundColor: a.color }}
            />
            <span className="text-[#c4d6cb]">{a.label}</span>
            <span className="ml-auto tabular-nums font-bold text-[#EEF3F6]">
              {Math.round(a.frac * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

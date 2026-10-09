/**
 * SegmentBar — barre segmentée multi-couleurs (inspirée statistics-card-5).
 * Répartition d'un total en parts colorées avec labels sous chaque segment.
 */

export interface BarSegment {
  label: string;
  pct: number;
  color: string;
  amount?: string;
}

export function SegmentBar({ segments }: { segments: BarSegment[] }) {
  return (
    <div className="flex w-full items-stretch gap-1.5">
      {segments.map((s) => (
        <div key={s.label} style={{ width: `${s.pct}%` }} className="min-w-0 space-y-2">
          <div
            className="h-2.5 w-full overflow-hidden rounded-sm"
            style={{ backgroundColor: s.color }}
          />
          <div className="flex flex-col">
            <span className="truncate text-[10px] font-medium text-[#7fa78d]">{s.label}</span>
            <span className="text-sm font-bold tabular-nums text-[#e7f2ea]">{s.pct}%</span>
            {s.amount && (
              <span className="truncate text-[10px] tabular-nums text-[#5c7d68]">{s.amount}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

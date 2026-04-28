import { toShortDateString } from "../date-utils";

const DEFAULT_CLASS = "text-xs text-muted-foreground";

export function DatesLine({
  startDate,
  endDate,
  className = DEFAULT_CLASS,
}: {
  startDate?: string | null;
  endDate?: string | null;
  className?: string;
}) {
  const startStr = toShortDateString(startDate);
  const endStr = toShortDateString(endDate);

  if (startStr && endStr && startStr === endStr) {
    return <span className={className}>Dates: {startStr}</span>;
  }

  const NullSpan = (
    <span data-testid="dates-null" className="text-red-400">null</span>
  );
  return (
    <span className={className} data-testid="dates-line">
      Dates: {startStr ?? NullSpan} – {endStr ?? NullSpan}
    </span>
  );
}

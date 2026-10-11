/** A cubic-bezier curve to plot: its control points and how to draw it. */
export type CurveSpec = {
  label: string;
  points: readonly [number, number, number, number];
  /** Tailwind text color for the stroke and legend swatch. */
  className: string;
  dashed?: boolean;
};

const SIZE = 200;
const PAD = 16;

/** Maps a curve point (0..1, y up) to SVG space (y down). */
const at = (x: number, y: number) =>
  `${PAD + x * SIZE},${PAD + (1 - y) * SIZE}`;

/**
 * Plots easing curves: time runs left to right, progress bottom to top. A
 * curve that rises early starts fast and settles softly.
 */
export function EaseCurve({ curves }: { curves: readonly CurveSpec[] }) {
  const box = SIZE + PAD * 2;
  return (
    <figure className="sb-unstyled my-6 flex flex-wrap items-center gap-6 rounded-xl border border-border bg-card p-4 text-card-foreground">
      <svg
        viewBox={`0 0 ${box} ${box}`}
        className="w-full max-w-56 shrink-0"
        role="img"
        aria-label={`Easing curves: ${curves.map((curve) => curve.label).join(', ')}`}
      >
        <rect
          x={PAD}
          y={PAD}
          width={SIZE}
          height={SIZE}
          className="fill-muted/40 stroke-border"
        />
        <line
          x1={PAD}
          y1={PAD + SIZE}
          x2={PAD + SIZE}
          y2={PAD}
          className="stroke-border"
          strokeDasharray="4 4"
        />
        {curves.map(
          ({ label, points: [x1, y1, x2, y2], className, dashed }) => (
            <path
              key={label}
              d={`M${at(0, 0)} C${at(x1, y1)} ${at(x2, y2)} ${at(1, 1)}`}
              className={className}
              stroke="currentColor"
              strokeWidth={3}
              strokeDasharray={dashed ? '6 5' : undefined}
              fill="none"
            />
          ),
        )}
      </svg>
      <figcaption className="flex min-w-0 flex-col gap-2 text-sm">
        {curves.map(({ label, points, className, dashed }) => (
          <span key={label} className="flex items-center gap-2">
            <svg
              viewBox="0 0 24 4"
              className={`w-6 shrink-0 ${className}`}
              aria-hidden="true"
            >
              <line
                x1="0"
                y1="2"
                x2="24"
                y2="2"
                stroke="currentColor"
                strokeWidth={3}
                strokeDasharray={dashed ? '6 5' : undefined}
              />
            </svg>
            <span>
              <span className="font-medium">{label}</span>{' '}
              <span className="font-mono text-xs text-muted-foreground">
                cubic-bezier({points.join(', ')})
              </span>
            </span>
          </span>
        ))}
        <span className="text-xs text-muted-foreground">
          Time runs left to right; progress bottom to top. The dashed diagonal
          is linear.
        </span>
      </figcaption>
    </figure>
  );
}

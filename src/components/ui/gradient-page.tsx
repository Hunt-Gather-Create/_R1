import { cn } from "@/lib/utils";

interface GradientPageProps {
  /** The color for the gradient (hex format). Defaults to blue. */
  color?: string;
  /** Content to render in the top-right actions area */
  actions?: React.ReactNode;
  /** Page content */
  children: React.ReactNode;
  /** Additional classes for the main element */
  className?: string;
}

/**
 * A page wrapper with a subtle gradient background that fades from
 * the accent color to the background color.
 */
export function GradientPage({
  color = "#3b82f6",
  actions,
  children,
  className,
}: GradientPageProps) {
  return (
    <main
      className={cn("min-h-125 page-content", className)}
      style={{
        background: `linear-gradient(to bottom, ${color}26, var(--background))`,
      }}
    >
      {actions && <div className="page-actions">{actions}</div>}
      {children}
    </main>
  );
}

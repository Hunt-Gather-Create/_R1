import { cn } from "@/lib/utils";

interface PageHeaderProps {
  /** Small uppercase label above the title (e.g., "BRAND", "WORKSPACE") */
  label?: string;
  /** Main page title */
  title: string;
  /** Optional subtitle/tagline below the title */
  subtitle?: string;
  /** Additional content below the header text (e.g., logo, description) */
  children?: React.ReactNode;
  /** Additional classes for the header element */
  className?: string;
}

export function PageHeader({
  label,
  title,
  subtitle,
  children,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("relative py-8 container", className)}>
      {label && (
        <div className="text-xs font-medium text-foreground/80 uppercase tracking-wider mb-2">
          {label}
        </div>
      )}
      <h1 className="text-3xl font-bold text-foreground mb-1">{title}</h1>
      {subtitle && <p className="text-foreground">{subtitle}</p>}
      {children}
    </header>
  );
}

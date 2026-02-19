export function SettingsRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-8 px-6 py-4 border-b border-border last:border-b-0">
      <div className="shrink-0 min-w-35 pt-1.5">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description && (
          <div className="text-xs text-muted-foreground mt-0.5">
            {description}
          </div>
        )}
      </div>
      <div className="flex-1 max-w-md">{children}</div>
    </div>
  );
}

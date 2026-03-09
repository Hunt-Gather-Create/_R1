"use client";

const SKIP_KEYS = new Set(["prompt"]);
const TEXTAREA_KEYS = new Set(["caption", "description", "headline", "body", "text"]);

function camelToTitle(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase());
}

function EditField({
  fieldKey,
  value,
  onChange,
}: {
  fieldKey: string;
  value: unknown;
  onChange: (newValue: unknown) => void;
}) {
  if (SKIP_KEYS.has(fieldKey)) return null;

  const label = camelToTitle(fieldKey);

  if (typeof value === "string") {
    if (TEXTAREA_KEYS.has(fieldKey)) {
      return (
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">{label}</label>
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            rows={3}
          />
        </div>
      );
    }
    return (
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">{label}</label>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
    );
  }

  if (typeof value === "number") {
    return (
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">{label}</label>
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
    );
  }

  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    const strArr = value as string[];
    return (
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">{label}</label>
        <div className="space-y-1">
          {strArr.map((item, index) => (
            <div key={index} className="flex gap-1">
              <input
                type="text"
                value={item}
                onChange={(e) => {
                  const newArr = [...strArr];
                  newArr[index] = e.target.value;
                  onChange(newArr);
                }}
                className="flex-1 px-2 py-1.5 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                type="button"
                onClick={() => onChange(strArr.filter((_, i) => i !== index))}
                className="px-2 py-1 text-xs text-destructive hover:bg-destructive/10 rounded transition-colors"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange([...strArr, ""])}
            className="text-xs text-primary hover:underline"
          >
            + Add
          </button>
        </div>
      </div>
    );
  }

  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return (
      <div className="space-y-2">
        <p className="text-xs font-semibold text-foreground uppercase tracking-wide">{label}</p>
        <div className="pl-3 border-l border-border space-y-2">
          <RecursiveForm
            content={value}
            onChange={(newObj) => onChange(newObj)}
          />
        </div>
      </div>
    );
  }

  return null;
}

function RecursiveForm({
  content,
  onChange,
}: {
  content: unknown;
  onChange: (newContent: unknown) => void;
}) {
  if (!content || typeof content !== "object" || Array.isArray(content)) return null;

  const obj = content as Record<string, unknown>;

  return (
    <>
      {Object.entries(obj).map(([key, value]) => (
        <EditField
          key={key}
          fieldKey={key}
          value={value}
          onChange={(newValue) => onChange({ ...obj, [key]: newValue })}
        />
      ))}
    </>
  );
}

export interface AdContentEditFormProps {
  content: unknown;
  onChange: (newContent: unknown) => void;
}

export function AdContentEditForm({ content, onChange }: AdContentEditFormProps) {
  return (
    <div className="space-y-3">
      <RecursiveForm content={content} onChange={onChange} />
    </div>
  );
}

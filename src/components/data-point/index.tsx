"use client";

import { Copy, Check } from "lucide-react";
import { useState } from "react";

interface DataPointProps {
  label: string;
  value: string;
  copyable?: boolean;
}

export function DataPoint({ label, value, copyable }: DataPointProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground font-medium">{label}</p>
      <div className="flex items-start gap-2">
        <p className="text-sm">{value}</p>
        {copyable && (
          <button
            onClick={handleCopy}
            className="flex-shrink-0 p-1 rounded hover:bg-muted transition-colors"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-green-500" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-muted-foreground" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}

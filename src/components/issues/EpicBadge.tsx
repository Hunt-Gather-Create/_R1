import { Layers } from "lucide-react";

export function EpicBadge({ title }: { title: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-purple-500/15 text-purple-400">
      <Layers className="w-2.5 h-2.5" />
      {title}
    </span>
  );
}

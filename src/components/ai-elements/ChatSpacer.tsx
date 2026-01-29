"use client";

interface ChatSpacerProps {
  height: number;
}

export function ChatSpacer({ height }: ChatSpacerProps) {
  if (height <= 0) return null;

  return (
    <div
      data-chat-spacer
      style={{ height }}
      aria-hidden="true"
    />
  );
}

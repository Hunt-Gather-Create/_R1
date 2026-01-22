"use client";

import * as React from "react";
import TextareaAutosize from "react-textarea-autosize";
import { ArrowUp, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface PromptInputContextValue {
  value: string;
  setValue: (value: string) => void;
  isLoading: boolean;
  onSubmit: () => void;
}

const PromptInputContext = React.createContext<PromptInputContextValue | null>(
  null
);

function usePromptInput() {
  const context = React.useContext(PromptInputContext);
  if (!context) {
    throw new Error("usePromptInput must be used within PromptInput");
  }
  return context;
}

interface PromptInputProps extends React.FormHTMLAttributes<HTMLFormElement> {
  value: string;
  onValueChange: (value: string) => void;
  isLoading?: boolean;
  onSubmit: () => void;
}

export function PromptInput({
  value,
  onValueChange,
  isLoading = false,
  onSubmit,
  className,
  children,
  ...props
}: PromptInputProps) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim() && !isLoading) {
      onSubmit();
    }
  };

  return (
    <PromptInputContext.Provider
      value={{
        value,
        setValue: onValueChange,
        isLoading,
        onSubmit,
      }}
    >
      <form
        onSubmit={handleSubmit}
        className={cn(
          "flex items-end gap-2 rounded-lg border border-border bg-muted/50 p-2",
          className
        )}
        {...props}
      >
        {children}
      </form>
    </PromptInputContext.Provider>
  );
}

interface PromptInputTextareaProps {
  placeholder?: string;
  rows?: number;
  className?: string;
}

export function PromptInputTextarea({
  className,
  placeholder,
  rows = 1,
}: PromptInputTextareaProps) {
  const { value, setValue, isLoading, onSubmit } = usePromptInput();

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !isLoading) {
        onSubmit();
      }
    }
  };

  return (
    <TextareaAutosize
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      disabled={isLoading}
      placeholder={placeholder}
      minRows={rows}
      className={cn(
        "flex-1 resize-none bg-transparent text-sm",
        "placeholder:text-muted-foreground",
        "focus:outline-none",
        "disabled:opacity-50",
        "min-h-[40px] max-h-[200px] py-2 px-2",
        className
      )}
    />
  );
}

type PromptInputSubmitProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export function PromptInputSubmit({
  className,
  children,
  ...props
}: PromptInputSubmitProps) {
  const { value, isLoading } = usePromptInput();
  const canSubmit = value.trim() && !isLoading;

  return (
    <button
      type="submit"
      disabled={!canSubmit}
      className={cn(
        "flex items-center justify-center",
        "h-8 w-8 rounded-md",
        "bg-primary text-primary-foreground",
        "hover:bg-primary/90",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        "transition-colors",
        className
      )}
      {...props}
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        children || <ArrowUp className="h-4 w-4" />
      )}
    </button>
  );
}

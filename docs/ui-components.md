# UI Components

This guide covers the UI component patterns used in this codebase.

## Component Philosophy

1. **Use shadcn/ui components first** - Check `/src/components/ui/` before creating new components
2. **Avoid creating new primitives** - Compose existing components instead
3. **Keep components focused** - One component, one purpose

## Available shadcn/ui Components

Located in `/src/components/ui/`:

| Component | Import | Usage |
|-----------|--------|-------|
| `Button` | `@/components/ui/button` | Primary action buttons |
| `Card` | `@/components/ui/card` | Content containers |
| `Dialog` | `@/components/ui/dialog` | Modal dialogs |
| `DropdownMenu` | `@/components/ui/dropdown-menu` | Context menus |
| `Input` | `@/components/ui/input` | Text inputs |
| `Textarea` | `@/components/ui/textarea` | Multi-line text |
| `Select` | `@/components/ui/select` | Dropdown selects |
| `Popover` | `@/components/ui/popover` | Floating content |
| `Tooltip` | `@/components/ui/tooltip` | Hover hints |
| `Badge` | `@/components/ui/badge` | Status indicators |
| `Sheet` | `@/components/ui/sheet` | Side panels |
| `Skeleton` | `@/components/ui/skeleton` | Loading states |
| `Command` | `@/components/ui/command` | Command palette |
| `HoverCard` | `@/components/ui/hover-card` | Rich hover previews |

## Styling Patterns

### The `cn()` Utility

Merge Tailwind classes conditionally:

```typescript
import { cn } from "@/lib/utils";

<div className={cn(
  "base-classes",
  isActive && "active-classes",
  className
)} />
```

Implementation in `/src/lib/utils.ts`:

```typescript
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

### CVA Variants

Use `class-variance-authority` for component variants:

```typescript
import { cva, type VariantProps } from "class-variance-authority";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md text-sm font-medium",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-white hover:bg-destructive/90",
        outline: "border bg-background hover:bg-accent",
        ghost: "hover:bg-accent hover:text-accent-foreground",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3",
        lg: "h-10 px-6",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

interface ButtonProps extends VariantProps<typeof buttonVariants> {
  // ...
}
```

See `/src/components/ui/button.tsx` for a complete example.

### Tailwind CSS v4

This project uses Tailwind CSS v4. Key patterns:

```css
/* CSS variables for theming */
--primary: oklch(0.21 0.006 285.88);
--primary-foreground: oklch(0.98 0 0);

/* Use semantic color names */
bg-primary text-primary-foreground
bg-muted text-muted-foreground
bg-destructive text-destructive-foreground
border-border
```

## AI-Specific Components

Located in `/src/components/ai-elements/`:

### PromptInput

Compound component for chat input with file attachments:

```tsx
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputSubmit,
  PromptInputAttachmentButton,
  PromptInputFilePreviews,
  PromptInputActions,
} from "@/components/ai-elements/prompt-input";

<PromptInput
  value={input}
  onValueChange={setInput}
  isLoading={isLoading}
  onSubmit={handleSubmit}
  files={files}
  onFilesChange={setFiles}
>
  <PromptInputFilePreviews />
  <PromptInputTextarea placeholder="Type a message..." />
  <PromptInputActions>
    <PromptInputAttachmentButton />
    <PromptInputSubmit />
  </PromptInputActions>
</PromptInput>
```

**Sub-components:**
- `PromptInputTextarea` - Auto-resizing textarea with Enter to submit
- `PromptInputSubmit` - Submit button with loading state
- `PromptInputAttachmentButton` - File attachment trigger
- `PromptInputFilePreviews` - Preview attached files with remove option
- `PromptInputActions` - Container for action buttons

### ChatMessageBubble

Display chat messages with role-based styling:

```tsx
import { ChatMessageBubble, ChatLoadingIndicator } from "@/components/ai-elements/ChatMessageBubble";

<ChatMessageBubble role="user">
  {message.content}
</ChatMessageBubble>

<ChatMessageBubble role="assistant">
  <MarkdownContent content={message.content} />
</ChatMessageBubble>

{isLoading && <ChatLoadingIndicator />}
```

### MarkdownContent

Render markdown with syntax highlighting and copy buttons:

```tsx
import { MarkdownContent } from "@/components/ai-elements/MarkdownContent";

<MarkdownContent content={markdownString} className="prose-sm" />
```

Features:
- Fenced code blocks with language labels
- Copy button on code blocks
- Inline code styling
- Prose typography

### ToolResultDisplay

Show tool execution results inline:

```tsx
import { ToolResultDisplay } from "@/components/ai-elements/ToolResultDisplay";

<ToolResultDisplay toolName="web_search" result={toolResult} />
```

Supported tool types:
- `web_search` - "Searched the web"
- `web_fetch` - "Fetched URL content"
- `code_execution` - "Code executed" with success/failure
- `readFile`, `listFiles` - File operations
- `bash`, `text_editor` - MCP tool indicators

## Creating New Components

Before creating a new component:

1. **Check shadcn/ui** - [ui.shadcn.com](https://ui.shadcn.com) may have what you need
2. **Check existing components** - Browse `/src/components/ui/`
3. **Compose existing primitives** - Combine shadcn components

If you must create a new component:

```tsx
// /src/components/ui/my-component.tsx
import { cn } from "@/lib/utils";

interface MyComponentProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "alternate";
}

export function MyComponent({
  className,
  variant = "default",
  ...props
}: MyComponentProps) {
  return (
    <div
      className={cn(
        "base-styles",
        variant === "alternate" && "alternate-styles",
        className
      )}
      {...props}
    />
  );
}
```

## External Resources

- [shadcn/ui](https://ui.shadcn.com) - Component documentation
- [Radix UI](https://www.radix-ui.com) - Primitive component docs
- [lucide-react](https://lucide.dev) - Icon reference
- [Tailwind CSS](https://tailwindcss.com/docs) - Utility class reference

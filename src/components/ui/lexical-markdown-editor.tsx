"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
} from "@lexical/list";
import { TOGGLE_LINK_COMMAND } from "@lexical/link";
import { $createCodeNode } from "@lexical/code";
import { $setBlocksType } from "@lexical/selection";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  TRANSFORMERS,
} from "@lexical/markdown";
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  $getRoot,
  FORMAT_TEXT_COMMAND,
  REDO_COMMAND,
  UNDO_COMMAND,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
  type EditorState,
  type LexicalCommand,
  TextNode,
  $isParagraphNode,
} from "lexical";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Link2,
  Undo2,
  Redo2,
  Code,
  ChevronDown,
  ImagePlus,
} from "lucide-react";
import {
  $createImageNode,
  MARKDOWN_TRANSFORMERS,
  LEXICAL_NODES,
  LEXICAL_THEME,
} from "./lexical/shared";

interface LexicalMarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  onUploadImage?: (file: File) => Promise<string>;
  compact?: boolean;
  onBlur?: () => void;
  minHeight?: number;
}

type InsertImagePayload = {
  src: string;
  altText?: string;
};

const INSERT_IMAGE_COMMAND: LexicalCommand<InsertImagePayload> = createCommand(
  "INSERT_IMAGE_COMMAND",
);

const IMAGE_LINE_REGEXP = /^!\[([^\]]*)\]\(([^)\s]+(?:\s+"[^"]*")?)\)$/;

function ImageMarkdownFallbackPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerNodeTransform(TextNode, (textNode) => {
      const match = textNode.getTextContent().trim().match(IMAGE_LINE_REGEXP);
      if (!match) return;

      const parent = textNode.getParent();
      if (!$isParagraphNode(parent)) return;
      if (parent.getChildrenSize() !== 1) return;

      const [, alt, srcRaw] = match;
      const src = srcRaw.replace(/\s+"[^"]*"$/, "");
      parent.replace(
        $createImageNode({
          src,
          altText: alt ?? "",
        }),
      );
    });
  }, [editor]);

  return null;
}

function SyncMarkdownPlugin({ value }: { value: string }) {
  const [editor] = useLexicalComposerContext();
  const lastSyncedRef = useRef(value);

  useEffect(() => {
    if (value === lastSyncedRef.current) {
      return;
    }

    editor.update(() => {
      const current = $convertToMarkdownString(TRANSFORMERS);
      const currentWithImages = $convertToMarkdownString(MARKDOWN_TRANSFORMERS);
      if (currentWithImages === value || current === value) {
        lastSyncedRef.current = value;
        return;
      }

      const root = $getRoot();
      root.clear();
      if (value.trim().length === 0) {
        root.append($createParagraphNode());
      } else {
        $convertFromMarkdownString(value, MARKDOWN_TRANSFORMERS);
      }
      lastSyncedRef.current = value;
    });
  }, [editor, value]);

  return null;
}

function ToolbarPlugin({
  onUploadImage,
}: {
  onUploadImage?: (file: File) => Promise<string>;
}) {
  const [editor] = useLexicalComposerContext();
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return editor.registerCommand(
      INSERT_IMAGE_COMMAND,
      (payload: InsertImagePayload) => {
        editor.update(() => {
          const selection = $getSelection();
          const imageNode = $createImageNode({
            src: payload.src,
            altText: payload.altText ?? "",
          });

          if ($isRangeSelection(selection)) {
            selection.insertNodes([imageNode]);
            return;
          }

          $getRoot().append(imageNode);
        });
        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    );
  }, [editor]);

  const applyBlockType = (
    blockType:
      | "paragraph"
      | "h1"
      | "h2"
      | "h3"
      | "quote"
      | "bullet"
      | "number"
      | "code",
  ) => {
    editor.focus(() => {
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;

        if (blockType === "bullet") {
          editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
          return;
        }
        if (blockType === "number") {
          editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
          return;
        }
        if (blockType === "paragraph") {
          $setBlocksType(selection, () => $createParagraphNode());
          return;
        }
        if (blockType === "quote") {
          $setBlocksType(selection, () => $createQuoteNode());
          return;
        }
        if (blockType === "code") {
          $setBlocksType(selection, () => $createCodeNode());
          return;
        }

        $setBlocksType(selection, () => $createHeadingNode(blockType));
      });
    });
  };

  const handleImagePick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!file || !onUploadImage) return;

    try {
      setIsUploadingImage(true);
      const imageUrl = await onUploadImage(file);
      editor.dispatchCommand(INSERT_IMAGE_COMMAND, {
        src: imageUrl,
        altText: file.name,
      });
    } finally {
      setIsUploadingImage(false);
    }
  };

  return (
    <div className="flex items-center gap-1 border-b border-border px-2 py-1.5 bg-muted/30">
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImagePick}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onMouseDown={(event) => event.preventDefault()}
          >
            Normal
            <ChevronDown className="w-3 h-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => applyBlockType("paragraph")}
          >
            Normal
          </DropdownMenuItem>
          <DropdownMenuItem
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => applyBlockType("h1")}
          >
            Heading 1
          </DropdownMenuItem>
          <DropdownMenuItem
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => applyBlockType("h2")}
          >
            Heading 2
          </DropdownMenuItem>
          <DropdownMenuItem
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => applyBlockType("h3")}
          >
            Heading 3
          </DropdownMenuItem>
          <DropdownMenuItem
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => applyBlockType("number")}
          >
            Numbered List
          </DropdownMenuItem>
          <DropdownMenuItem
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => applyBlockType("bullet")}
          >
            Bullet List
          </DropdownMenuItem>
          <DropdownMenuItem
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => applyBlockType("quote")}
          >
            Quote
          </DropdownMenuItem>
          <DropdownMenuItem
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => applyBlockType("code")}
          >
            Code Block
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="w-px h-4 bg-border mx-1" />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}
      >
        <Undo2 className="w-3.5 h-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)}
      >
        <Redo2 className="w-3.5 h-3.5" />
      </Button>
      <div className="w-px h-4 bg-border mx-1" />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold")}
      >
        <Bold className="w-3.5 h-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic")}
      >
        <Italic className="w-3.5 h-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "code")}
      >
        <Code className="w-3.5 h-3.5" />
      </Button>
      <div className="w-px h-4 bg-border mx-1" />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() =>
          editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)
        }
      >
        <List className="w-3.5 h-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() =>
          editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)
        }
      >
        <ListOrdered className="w-3.5 h-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          const link = window.prompt("Enter URL");
          if (link === null) return;
          editor.dispatchCommand(TOGGLE_LINK_COMMAND, link || null);
        }}
      >
        <Link2 className="w-3.5 h-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        disabled={!onUploadImage || isUploadingImage}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => imageInputRef.current?.click()}
        title={isUploadingImage ? "Uploading image..." : "Upload image"}
      >
        <ImagePlus className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

export function LexicalMarkdownEditor({
  value,
  onChange,
  placeholder = "Write markdown...",
  className,
  onUploadImage,
  compact = false,
  onBlur,
  minHeight = 280,
}: LexicalMarkdownEditorProps) {
  const initialConfig = useMemo(
    () => ({
      namespace: "knowledge-lexical-editor",
      onError(error: Error) {
        throw error;
      },
      nodes: LEXICAL_NODES,
      editorState: () => {
        if (value.trim().length > 0) {
          $convertFromMarkdownString(value, MARKDOWN_TRANSFORMERS);
          return;
        }

        const root = $getRoot();
        root.clear();
        root.append($createParagraphNode());
      },
      theme: LEXICAL_THEME,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only init once
    [],
  );

  return (
    <div
      className={cn(
        "h-full min-h-0 flex flex-col rounded-md border border-border bg-background",
        className,
      )}
    >
      <LexicalComposer initialConfig={initialConfig}>
        {!compact && <ToolbarPlugin onUploadImage={onUploadImage} />}
        <div
          className="flex-1 min-h-0 overflow-y-auto px-3 py-2"
          style={{ minHeight: `${minHeight}px` }}
          onBlur={onBlur}
        >
          <RichTextPlugin
            contentEditable={
              <ContentEditable className="min-h-[260px] outline-none text-sm leading-6 prose prose-sm max-w-none prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-pre:my-3 prose-code:before:content-none prose-code:after:content-none dark:prose-invert" />
            }
            placeholder={
              <div className="text-sm text-muted-foreground pointer-events-none">
                {placeholder}
              </div>
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
          <HistoryPlugin />
          <ListPlugin />
          <LinkPlugin />
          <MarkdownShortcutPlugin transformers={MARKDOWN_TRANSFORMERS} />
          <SyncMarkdownPlugin value={value} />
          <ImageMarkdownFallbackPlugin />
          <OnChangePlugin
            onChange={(editorState: EditorState) => {
              editorState.read(() => {
                onChange($convertToMarkdownString(MARKDOWN_TRANSFORMERS));
              });
            }}
          />
        </div>
      </LexicalComposer>
    </div>
  );
}

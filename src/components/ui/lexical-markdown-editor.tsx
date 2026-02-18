"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
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
import {
  $createHeadingNode,
  $createQuoteNode,
  HeadingNode,
  QuoteNode,
} from "@lexical/rich-text";
import { ListItemNode, ListNode, INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND } from "@lexical/list";
import { LinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { $createCodeNode, CodeNode } from "@lexical/code";
import { $setBlocksType } from "@lexical/selection";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  TRANSFORMERS,
  type ElementTransformer,
  type TextMatchTransformer,
  type Transformer,
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
  DecoratorNode,
  type EditorConfig,
  type EditorState,
  type LexicalCommand,
  type LexicalNode,
  type NodeKey,
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

interface LexicalMarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  onUploadImage?: (file: File) => Promise<string>;
}

type InsertImagePayload = {
  src: string;
  altText?: string;
};

const INSERT_IMAGE_COMMAND: LexicalCommand<InsertImagePayload> = createCommand(
  "INSERT_IMAGE_COMMAND"
);

class ImageNode extends DecoratorNode<JSX.Element> {
  __src: string;
  __altText: string;

  static getType(): string {
    return "image";
  }

  static clone(node: ImageNode): ImageNode {
    return new ImageNode(node.__src, node.__altText, node.__key);
  }

  constructor(src: string, altText: string, key?: NodeKey) {
    super(key);
    this.__src = src;
    this.__altText = altText;
  }

  static importJSON(serializedNode: {
    src: string;
    altText?: string;
  }): ImageNode {
    return $createImageNode({
      src: serializedNode.src,
      altText: serializedNode.altText ?? "",
    });
  }

  exportJSON() {
    return {
      type: "image",
      version: 1,
      src: this.__src,
      altText: this.__altText,
    };
  }

  createDOM(config: EditorConfig): HTMLElement {
    void config;
    const span = document.createElement("span");
    span.className = "block my-3";
    return span;
  }

  updateDOM(): false {
    return false;
  }

  decorate(): JSX.Element {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={this.__src}
        alt={this.__altText}
        className="max-w-full h-auto rounded border border-border"
      />
    );
  }
}

function $createImageNode({
  src,
  altText = "",
}: {
  src: string;
  altText?: string;
}): ImageNode {
  return new ImageNode(src, altText);
}

function $isImageNode(node: LexicalNode | null | undefined): node is ImageNode {
  return node instanceof ImageNode;
}

const IMAGE_MARKDOWN_TRANSFORMER: TextMatchTransformer = {
  type: "text-match",
  dependencies: [ImageNode],
  trigger: ")",
  importRegExp: /!\[([^\]]*)\]\(([^)\s]+(?:\s+"[^"]*")?)\)/,
  regExp: /!\[([^\]]*)\]\(([^)\s]+(?:\s+"[^"]*")?)\)$/,
  export: (node) => {
    if (!$isImageNode(node)) {
      return null;
    }
    return `![${node.__altText}](${node.__src})`;
  },
  replace: (textNode, match) => {
    const [, alt, srcRaw] = match;
    const src = srcRaw.replace(/\s+"[^"]*"$/, "");
    textNode.replace(
      $createImageNode({
        src,
        altText: alt ?? "",
      })
    );
  },
};

const IMAGE_ELEMENT_TRANSFORMER: ElementTransformer = {
  type: "element",
  dependencies: [ImageNode],
  regExp: /^!\[([^\]]*)\]\(([^)\s]+(?:\s+"[^"]*")?)\)$/,
  export: (node) => {
    if (!$isImageNode(node)) {
      return null;
    }
    return `![${node.__altText}](${node.__src})`;
  },
  replace: (parentNode, _children, match) => {
    const [, alt, srcRaw] = match;
    const src = srcRaw.replace(/\s+"[^"]*"$/, "");
    parentNode.replace(
      $createImageNode({
        src,
        altText: alt ?? "",
      })
    );
  },
};

const MARKDOWN_TRANSFORMERS: Transformer[] = [
  IMAGE_ELEMENT_TRANSFORMER,
  ...TRANSFORMERS,
  IMAGE_MARKDOWN_TRANSFORMER,
];
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
        })
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
      COMMAND_PRIORITY_EDITOR
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
      | "code"
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
}: LexicalMarkdownEditorProps) {
  const initialConfig = useMemo(
    () => ({
      namespace: "knowledge-lexical-editor",
      onError(error: Error) {
        throw error;
      },
      nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, CodeNode, ImageNode],
      editorState: () => {
        if (value.trim().length > 0) {
          $convertFromMarkdownString(value, MARKDOWN_TRANSFORMERS);
          return;
        }

        const root = $getRoot();
        root.clear();
        root.append($createParagraphNode());
      },
      theme: {
        paragraph: "mb-2",
        heading: {
          h1: "text-3xl font-bold leading-tight mt-4 mb-2",
          h2: "text-2xl font-semibold leading-tight mt-4 mb-2",
          h3: "text-xl font-semibold leading-tight mt-3 mb-1",
        },
        quote: "border-l-2 border-border pl-3 text-muted-foreground italic",
        text: {
          bold: "font-semibold",
          italic: "italic",
          code: "rounded bg-muted px-1 py-0.5 font-mono text-xs",
        },
      },
    }),
    [value]
  );

  return (
    <div className={cn("h-full min-h-0 rounded-md border border-border bg-background", className)}>
      <LexicalComposer initialConfig={initialConfig}>
        <ToolbarPlugin onUploadImage={onUploadImage} />
        <div className="h-[calc(100%-40px)] min-h-[280px] overflow-y-auto px-3 py-2">
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

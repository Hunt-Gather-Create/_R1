import type { ReactElement } from "react";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListItemNode, ListNode } from "@lexical/list";
import { LinkNode } from "@lexical/link";
import { CodeNode } from "@lexical/code";
import {
  $convertFromMarkdownString,
  TRANSFORMERS,
  type ElementTransformer,
  type TextMatchTransformer,
  type Transformer,
} from "@lexical/markdown";
import {
  DecoratorNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
} from "lexical";

// ---------------------------------------------------------------------------
// ImageNode
// ---------------------------------------------------------------------------

function getSerializedStringField(
  serializedNode: SerializedLexicalNode,
  field: string,
): string | null {
  const value = (serializedNode as Record<string, unknown>)[field];
  return typeof value === "string" ? value : null;
}

export class ImageNode extends DecoratorNode<ReactElement> {
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

  static importJSON(serializedNode: SerializedLexicalNode): ImageNode {
    const src = getSerializedStringField(serializedNode, "src");
    if (!src) {
      throw new Error("Invalid serialized image node: missing src");
    }

    return $createImageNode({
      src,
      altText: getSerializedStringField(serializedNode, "altText") ?? "",
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

  decorate(): ReactElement {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={this.__src}
        alt={this.__altText}
        className="max-w-full h-auto rounded border border-border"
      />
    );
  }
}

export function $createImageNode({
  src,
  altText = "",
}: {
  src: string;
  altText?: string;
}): ImageNode {
  return new ImageNode(src, altText);
}

export function $isImageNode(
  node: LexicalNode | null | undefined,
): node is ImageNode {
  return node instanceof ImageNode;
}

// ---------------------------------------------------------------------------
// Markdown transformers
// ---------------------------------------------------------------------------

export const IMAGE_ELEMENT_TRANSFORMER: ElementTransformer = {
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
      }),
    );
  },
};

export const IMAGE_MARKDOWN_TRANSFORMER: TextMatchTransformer = {
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
      }),
    );
  },
};

export const MARKDOWN_TRANSFORMERS: Transformer[] = [
  IMAGE_ELEMENT_TRANSFORMER,
  ...TRANSFORMERS,
  IMAGE_MARKDOWN_TRANSFORMER,
];

// ---------------------------------------------------------------------------
// Shared node list & theme
// ---------------------------------------------------------------------------

export const LEXICAL_NODES = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  LinkNode,
  CodeNode,
  ImageNode,
];

export const LEXICAL_THEME = {
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
  list: {
    ul: "list-disc pl-5 my-2",
    ol: "list-decimal pl-5 my-2",
    listitem: "my-0.5",
  },
  link: "text-primary hover:underline",
  code: "block bg-muted/50 rounded p-3 text-xs font-mono overflow-x-auto my-2",
};

// ---------------------------------------------------------------------------
// Helper: initialise editor state from markdown
// ---------------------------------------------------------------------------

export function createEditorStateFromMarkdown(markdown: string) {
  return () => {
    $convertFromMarkdownString(markdown, MARKDOWN_TRANSFORMERS);
  };
}

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
  $getRoot,
  $isParagraphNode,
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
    return (
      // eslint-disable-next-line @next/next/no-img-element -- Lexical node, not a Next.js component
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
// HorizontalRuleNode
// ---------------------------------------------------------------------------

export class HorizontalRuleNode extends DecoratorNode<ReactElement> {
  static getType(): string {
    return "horizontal-rule";
  }

  static clone(node: HorizontalRuleNode): HorizontalRuleNode {
    return new HorizontalRuleNode(node.__key);
  }

  static importJSON(): HorizontalRuleNode {
    return new HorizontalRuleNode();
  }

  exportJSON() {
    return { type: "horizontal-rule", version: 1 };
  }

  createDOM(config: EditorConfig): HTMLElement {
    void config;
    const div = document.createElement("div");
    div.className = "my-4";
    return div;
  }

  updateDOM(): false {
    return false;
  }

  decorate(): ReactElement {
    return <hr className="border-border" />;
  }
}

const HR_ELEMENT_TRANSFORMER: ElementTransformer = {
  type: "element",
  dependencies: [HorizontalRuleNode],
  regExp: /^(?:---|\*\*\*|___)$/,
  export: (node) => {
    if (node instanceof HorizontalRuleNode) {
      return "---";
    }
    return null;
  },
  replace: (parentNode) => {
    parentNode.replace(new HorizontalRuleNode());
  },
};

// ---------------------------------------------------------------------------
// TableDecoratorNode
// ---------------------------------------------------------------------------

type TableAlignment = "left" | "center" | "right" | null;

function getSerializedArrayField(
  serializedNode: SerializedLexicalNode,
  field: string,
): unknown[] | null {
  const value = (serializedNode as Record<string, unknown>)[field];
  return Array.isArray(value) ? value : null;
}

export class TableDecoratorNode extends DecoratorNode<ReactElement> {
  __headers: string[];
  __rows: string[][];
  __alignments: TableAlignment[];

  static getType(): string {
    return "markdown-table";
  }

  static clone(node: TableDecoratorNode): TableDecoratorNode {
    return new TableDecoratorNode(
      node.__headers,
      node.__rows,
      node.__alignments,
      node.__key,
    );
  }

  constructor(
    headers: string[],
    rows: string[][],
    alignments: TableAlignment[],
    key?: NodeKey,
  ) {
    super(key);
    this.__headers = headers;
    this.__rows = rows;
    this.__alignments = alignments;
  }

  static importJSON(serializedNode: SerializedLexicalNode): TableDecoratorNode {
    const headers = getSerializedArrayField(serializedNode, "headers");
    const rows = getSerializedArrayField(serializedNode, "rows");
    const alignments = getSerializedArrayField(serializedNode, "alignments");
    return new TableDecoratorNode(
      (headers as string[]) ?? [],
      (rows as string[][]) ?? [],
      (alignments as TableAlignment[]) ?? [],
    );
  }

  exportJSON() {
    return {
      type: "markdown-table",
      version: 1,
      headers: this.__headers,
      rows: this.__rows,
      alignments: this.__alignments,
    };
  }

  createDOM(config: EditorConfig): HTMLElement {
    void config;
    const div = document.createElement("div");
    div.className = "my-3 overflow-x-auto";
    return div;
  }

  updateDOM(): false {
    return false;
  }

  decorate(): ReactElement {
    const { __headers: headers, __rows: rows, __alignments: alignments } = this;

    const alignStyle = (i: number): React.CSSProperties | undefined => {
      const a = alignments[i];
      return a ? { textAlign: a } : undefined;
    };

    return (
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            {headers.map((h, i) => (
              <th
                key={i}
                className="px-3 py-2 text-left font-medium text-foreground"
                style={alignStyle(i)}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-border last:border-0">
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className="px-3 py-2 text-muted-foreground"
                  style={alignStyle(ci)}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
}

// ---------------------------------------------------------------------------
// Table helpers: parsing & post-processing
// ---------------------------------------------------------------------------

const TABLE_ROW_RE = /^\|(.+)\|\s*$/;
const TABLE_DIVIDER_RE = /^\|(\s*:?-+:?\s*\|)+\s*$/;

function parseTableRow(text: string): string[] {
  const match = TABLE_ROW_RE.exec(text);
  if (!match) return [];
  return match[1].split("|").map((c) => c.trim());
}

function parseAlignments(dividerText: string): TableAlignment[] {
  const match = TABLE_ROW_RE.exec(dividerText);
  if (!match) return [];
  return match[1].split("|").map((c) => {
    const trimmed = c.trim();
    const left = trimmed.startsWith(":");
    const right = trimmed.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return null;
  });
}

/**
 * Post-process the Lexical tree after markdown conversion to detect
 * sequences of paragraph nodes that form GFM tables and replace them
 * with TableDecoratorNode instances.
 *
 * Must be called inside an editor.update() or editorState callback
 * AFTER $convertFromMarkdownString.
 */
export function $postProcessTables(): void {
  const root = $getRoot();
  const children = root.getChildren();

  let i = 0;
  while (i < children.length) {
    const child = children[i];

    if ($isParagraphNode(child) && TABLE_ROW_RE.test(child.getTextContent())) {
      // Look ahead to gather all consecutive table-row paragraphs
      let end = i + 1;
      while (end < children.length) {
        const node = children[end];
        if (
          $isParagraphNode(node) &&
          TABLE_ROW_RE.test(node.getTextContent())
        ) {
          end++;
        } else {
          break;
        }
      }

      // Need header + divider at minimum
      if (end - i >= 2) {
        const slice = children.slice(i, end);
        const texts = slice.map((n) => n.getTextContent());

        if (TABLE_DIVIDER_RE.test(texts[1])) {
          const headers = parseTableRow(texts[0]);
          const alignments = parseAlignments(texts[1]);
          const bodyRows = texts.slice(2).map(parseTableRow);

          const tableNode = new TableDecoratorNode(
            headers,
            bodyRows,
            alignments,
          );

          // Replace first paragraph with the table node
          slice[0].replace(tableNode);
          // Remove remaining table-row paragraphs
          for (let j = 1; j < slice.length; j++) {
            slice[j].remove();
          }

          i++;
          continue;
        }
      }
    }

    i++;
  }
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
  HR_ELEMENT_TRANSFORMER,
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
  HorizontalRuleNode,
  TableDecoratorNode,
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
    $postProcessTables();
  };
}

"use client";

import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { CodeNode } from "@lexical/code";
import type { NodeMutation } from "lexical";

/**
 * Adds a copy-to-clipboard button and an optional language label to every
 * `CodeNode` rendered in the editor DOM. Works in both editable and read-only
 * modes.
 *
 * The button is absolutely positioned and becomes visible on hover via the
 * `group-hover:opacity-100` Tailwind pattern applied on the wrapper injected
 * around the code element.
 */
export function CodeBlockEnhancerPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const enhance = (element: HTMLElement, language: string | undefined) => {
      // Avoid double-enhancing
      if (element.dataset.enhanced) return;
      element.dataset.enhanced = "true";

      // Wrap the <code> element's parent (the DOM element created by CodeNode)
      // in a `group relative` div so we can position the copy button.
      const wrapper = document.createElement("div");
      wrapper.className = "relative group";
      element.parentNode?.insertBefore(wrapper, element);
      wrapper.appendChild(element);

      // Language label
      if (language) {
        const label = document.createElement("span");
        label.className =
          "absolute top-0 left-0 px-2 py-0.5 text-[10px] text-muted-foreground bg-muted/50 rounded-tl rounded-br select-none pointer-events-none";
        label.textContent = language;
        wrapper.appendChild(label);
        // Add top padding to the code block so the label doesn't overlap content
        element.style.paddingTop = "1.5rem";
      }

      // Copy button
      const btn = document.createElement("button");
      btn.className =
        "absolute top-2 right-2 p-1.5 rounded-md transition-colors bg-muted/80 hover:bg-muted text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100";
      btn.title = "Copy code";
      btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;

      btn.addEventListener("click", () => {
        const code = element.textContent ?? "";
        navigator.clipboard.writeText(code).then(() => {
          btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-green-500"><path d="M20 6 9 17l-5-5"/></svg>`;
          btn.title = "Copied!";
          setTimeout(() => {
            btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
            btn.title = "Copy code";
          }, 2000);
        });
      });

      wrapper.appendChild(btn);
    };

    return editor.registerMutationListener(
      CodeNode,
      (mutations: Map<string, NodeMutation>) => {
        for (const [nodeKey, mutation] of mutations) {
          if (mutation !== "created") continue;

          const dom = editor.getElementByKey(nodeKey);
          if (!dom) continue;

          // Read the language from the Lexical node
          editor.getEditorState().read(() => {
            const node = editor
              .getEditorState()
              ._nodeMap.get(nodeKey) as CodeNode | undefined;
            const language = node?.getLanguage() ?? undefined;
            enhance(dom, language);
          });
        }
      },
    );
  }, [editor]);

  return null;
}

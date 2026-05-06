import type { ReactNode } from "react";

/**
 * Track 4 Wave 4.1 — shared collapse/expand primitive.
 *
 * Wraps native `<details>` so chevron rotation, keyboard support, and
 * open/close state come from the platform. No React state. Consumers
 * pass a `header` slot rendered inside `<summary>` and `children` for
 * the body.
 *
 * Chevron (▶) sits left of the header and rotates 90deg via the CSS
 * `[open]` attribute selector with a 150ms ease-out transition. The
 * default disclosure triangle is hidden cross-browser.
 */
export function CollapsibleSection({
  header,
  defaultOpen = true,
  children,
  className = "",
}: {
  header: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const detailsClass = ["account-tier-details", className]
    .filter(Boolean)
    .join(" ");
  return (
    <>
      <style>{`
        details.account-tier-details > summary {
          list-style: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        details.account-tier-details > summary::-webkit-details-marker {
          display: none;
        }
        details.account-tier-details > summary > .account-tier-chevron {
          display: inline-block;
          transition: transform 150ms ease-out;
          transform: rotate(0deg);
          font-size: 0.65rem;
          line-height: 1;
        }
        details.account-tier-details[open] > summary > .account-tier-chevron {
          transform: rotate(90deg);
        }
      `}</style>
      <details className={detailsClass} open={defaultOpen}>
        <summary>
          <span aria-hidden="true" className="account-tier-chevron">
            ▶
          </span>
          {header}
        </summary>
        <div className="account-tier-body">{children}</div>
      </details>
    </>
  );
}

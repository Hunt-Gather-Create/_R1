/**
 * Tailwind safelist (dark-account-view theme)
 * Tailwind's content scanner reads source files literally. The dark theme
 * applies these classes through string interpolation, so list them here:
 *
 *   bg-sky-500/30 border-sky-400
 *   border-slate-500/40 bg-slate-500/10
 *   bg-amber-500/30 border-amber-400
 *   bg-red-500/30 border-red-400
 *   bg-emerald-500/20 border-emerald-400 opacity-70
 *   bg-slate-600/20 line-through opacity-60
 *   // legend swatches:
 *   bg-sky-400 bg-amber-400 bg-red-400 bg-emerald-400 bg-slate-400
 *   border-slate-400/40
 */

import { readFileSync } from "fs";
import { join } from "path";
import type { Theme } from "./types";

// ── Logo loading (module-level, cached once) ──────────────

const LOGO_PATH = join(process.cwd(), "src/lib/runway/gantt/assets/CIV_TOP_LEFT.png");

let _logoDataUri: string | null = null;

function loadLogoDataUri(): string {
  if (_logoDataUri !== null) return _logoDataUri;
  const buf = readFileSync(LOGO_PATH);
  if (buf.length > 200 * 1024) {
    console.warn(
      `[gantt/themes] Logo at ${LOGO_PATH} is ${buf.length} bytes (>200KB). This may inflate HTML output significantly.`,
    );
  }
  // File extension is .png but actual format is JPEG; use image/jpeg MIME type.
  _logoDataUri = `data:image/jpeg;base64,${buf.toString("base64")}`;
  return _logoDataUri;
}

// Eagerly load at module initialization. Throws if the file is missing.
const LOGO_DATA_URI = loadLogoDataUri();

// ── ThemeTokens shape ─────────────────────────────────────

export type ThemeTokens = {
  chrome: {
    showDataIntegrityPanel: boolean;
    showRowAlerts: boolean;
    showChartIssueList: boolean;
    showLogo: boolean;
    useBrandedHeader: boolean;
  };
  palette: {
    background: string;
    surface: string;
    borderColor: string;
    textPrimary: string;
    textMuted: string;
    barInProgress: string;
    barScheduledBg: string;
    barScheduledBorder: string;
    barAtRisk: string;
    barBlocked: string;
    barCompletedBg: string;
    barCompletedBorder: string;
    barCanceledStripe: string;
    barCanceledBg: string;
    milestone: string;
    todayLine: string;
  };
  typography: {
    fontStack: string;
  };
  logo: {
    dataUri: string | null;
    altText: string;
  };
};

// ── light-internal tokens ─────────────────────────────────
// Documentation-shape only — renderer uses STYLES const verbatim, not these
// values directly. Captured here so the three token objects are symmetric.

export const LIGHT_INTERNAL_TOKENS: ThemeTokens = {
  chrome: {
    showDataIntegrityPanel: true,
    showRowAlerts: true,
    showChartIssueList: true,
    showLogo: false,
    useBrandedHeader: false,
  },
  palette: {
    background: "#fafafa",
    surface: "#ffffff",
    borderColor: "#e3e3e3",
    textPrimary: "#222222",
    textMuted: "#777777",
    barInProgress: "#3b82f6",
    barScheduledBg: "#eff6ff",
    barScheduledBorder: "#93c5fd",
    barAtRisk: "#f59e0b",
    barBlocked: "#ef4444",
    barCompletedBg: "#86efac",
    barCompletedBorder: "#4ade80",
    barCanceledStripe: "#64748b",
    barCanceledBg: "#cbd5e1",
    milestone: "#6366f1",
    todayLine: "#ef4444",
  },
  typography: {
    fontStack: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  },
  logo: {
    dataUri: null,
    altText: "",
  },
};

// ── light-branded tokens ──────────────────────────────────

export const LIGHT_BRANDED_TOKENS: ThemeTokens = {
  chrome: {
    showDataIntegrityPanel: false,
    showRowAlerts: false,
    showChartIssueList: false,
    showLogo: true,
    useBrandedHeader: true,
  },
  palette: {
    background: "#ffffff",
    surface: "#F9FAFB",
    borderColor: "#E5E7EB",
    textPrimary: "#000000",
    textMuted: "#333333",
    barInProgress: "#0E5DFF",
    barScheduledBg: "#E5E7EB",
    barScheduledBorder: "#D1D5DB",
    barAtRisk: "#F59E0B",
    barBlocked: "#DC2626",
    barCompletedBg: "#10B981",
    barCompletedBorder: "#059669",
    barCanceledStripe: "#9CA3AF",
    barCanceledBg: "#F3F4F6",
    milestone: "#0E5DFF",
    todayLine: "#0E5DFF",
  },
  typography: {
    fontStack: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  },
  logo: {
    dataUri: LOGO_DATA_URI,
    altText: "Civilization Agency",
  },
};

// ── dark-account-view tokens ──────────────────────────────
// Palette values are Tailwind class strings — applied via className, not
// inline styles. The renderer switches behavior based on theme value.

export const DARK_ACCOUNT_VIEW_TOKENS: ThemeTokens = {
  chrome: {
    showDataIntegrityPanel: false,
    showRowAlerts: false,
    showChartIssueList: false,
    showLogo: false,
    useBrandedHeader: false,
  },
  palette: {
    background: "bg-slate-900",
    surface: "bg-slate-800",
    borderColor: "border-slate-700",
    textPrimary: "text-slate-100",
    textMuted: "text-slate-400",
    barInProgress: "bg-sky-500/30 border-sky-400",
    barScheduledBg: "bg-slate-500/10",
    barScheduledBorder: "border-slate-500/40",
    barAtRisk: "bg-amber-500/30 border-amber-400",
    barBlocked: "bg-red-500/30 border-red-400",
    barCompletedBg: "bg-emerald-500/20 border-emerald-400 opacity-70",
    barCompletedBorder: "border-emerald-400",
    barCanceledStripe: "bg-slate-600/20",
    barCanceledBg: "bg-slate-600/20 line-through opacity-60",
    milestone: "bg-sky-400",
    todayLine: "bg-red-400",
  },
  typography: {
    fontStack: "inherit",
  },
  logo: {
    dataUri: null,
    altText: "",
  },
};

// ── Resolver ──────────────────────────────────────────────

export function getThemeTokens(theme: Theme): ThemeTokens {
  switch (theme) {
    case "light-internal":
      return LIGHT_INTERNAL_TOKENS;
    case "light-branded":
      return LIGHT_BRANDED_TOKENS;
    case "dark-account-view":
      return DARK_ACCOUNT_VIEW_TOKENS;
    default: {
      // TypeScript exhaustiveness check
      const _exhaustive: never = theme;
      return _exhaustive;
    }
  }
}

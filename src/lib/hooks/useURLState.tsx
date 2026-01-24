"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback, useMemo, createContext, useContext, type ReactNode } from "react";
import { VIEW, GROUP_BY, type ViewType, type GroupBy } from "@/lib/design-tokens";
import { deserializeFilters, serializeFilters, type FilterState } from "@/lib/filters";

export interface URLState {
  issue: string | null;
  view: ViewType;
  groupBy: GroupBy;
  create: boolean;
  filters: FilterState;
}

interface URLStateContextValue {
  urlState: URLState;
  setIssue: (identifier: string | null) => void;
  setView: (view: ViewType) => void;
  setGroupBy: (groupBy: GroupBy) => void;
  setCreate: (create: boolean) => void;
  setFilters: (filters: FilterState) => void;
  clearURLState: () => void;
}

const URLStateContext = createContext<URLStateContextValue | null>(null);

const VALID_VIEWS = Object.values(VIEW);
const VALID_GROUP_BY = Object.values(GROUP_BY);

function parseURLState(searchParams: URLSearchParams): URLState {
  const viewParam = searchParams.get("view");
  const view = viewParam && VALID_VIEWS.includes(viewParam as ViewType)
    ? (viewParam as ViewType)
    : VIEW.BOARD;

  const groupByParam = searchParams.get("groupBy");
  const groupBy = groupByParam && VALID_GROUP_BY.includes(groupByParam as GroupBy)
    ? (groupByParam as GroupBy)
    : GROUP_BY.STATUS;

  return {
    issue: searchParams.get("issue"),
    view,
    groupBy,
    create: searchParams.get("create") === "1",
    filters: deserializeFilters(searchParams),
  };
}

function serializeURLState(state: URLState): URLSearchParams {
  const params = new URLSearchParams();

  if (state.issue) {
    params.set("issue", state.issue);
  }

  // Only serialize non-default values
  if (state.view !== VIEW.BOARD) {
    params.set("view", state.view);
  }

  if (state.groupBy !== GROUP_BY.STATUS) {
    params.set("groupBy", state.groupBy);
  }

  if (state.create) {
    params.set("create", "1");
  }

  const filterParams = serializeFilters(state.filters);
  filterParams.forEach((value, key) => {
    params.set(key, value);
  });

  return params;
}

function useURLStateInternal() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const urlState = useMemo(() => parseURLState(searchParams), [searchParams]);

  const updateURL = useCallback(
    (newState: URLState) => {
      const newParams = serializeURLState(newState);
      const queryString = newParams.toString();
      router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
    },
    [pathname, router]
  );

  const setIssue = useCallback(
    (identifier: string | null) => updateURL({ ...urlState, issue: identifier }),
    [urlState, updateURL]
  );

  const setView = useCallback(
    (view: ViewType) => updateURL({ ...urlState, view }),
    [urlState, updateURL]
  );

  const setGroupBy = useCallback(
    (groupBy: GroupBy) => updateURL({ ...urlState, groupBy }),
    [urlState, updateURL]
  );

  const setCreate = useCallback(
    (create: boolean) => updateURL({ ...urlState, create }),
    [urlState, updateURL]
  );

  const setFilters = useCallback(
    (filters: FilterState) => updateURL({ ...urlState, filters }),
    [urlState, updateURL]
  );

  const clearURLState = useCallback(
    () => router.replace(pathname, { scroll: false }),
    [pathname, router]
  );

  return {
    urlState,
    setIssue,
    setView,
    setGroupBy,
    setCreate,
    setFilters,
    clearURLState,
  };
}

export function URLStateProvider({ children }: { children: ReactNode }) {
  const value = useURLStateInternal();
  return (
    <URLStateContext.Provider value={value}>
      {children}
    </URLStateContext.Provider>
  );
}

export function useURLState() {
  const context = useContext(URLStateContext);
  if (!context) {
    throw new Error("useURLState must be used within URLStateProvider");
  }
  return context;
}

"use client";

import { useSyncExternalStore } from "react";

// Hydration-safe mount detection without triggering cascading renders.
// Returns false during SSR, true after hydration on the client.
const emptySubscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export function useMounted(): boolean {
  return useSyncExternalStore(emptySubscribe, getClientSnapshot, getServerSnapshot);
}

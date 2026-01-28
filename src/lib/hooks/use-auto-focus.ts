import { useEffect, useRef, type RefObject } from "react";

/**
 * Auto-focuses an input element when a loading state transitions from true to false.
 * Useful for chat interfaces to focus the input after AI finishes responding.
 *
 * @param isLoading - Current loading state
 * @param inputRef - Ref to the input element to focus
 */
export function useAutoFocusOnComplete(
  isLoading: boolean,
  inputRef: RefObject<HTMLElement | null>
): void {
  const wasLoadingRef = useRef(false);

  useEffect(() => {
    if (wasLoadingRef.current && !isLoading) {
      inputRef.current?.focus();
    }
    wasLoadingRef.current = isLoading;
  }, [isLoading, inputRef]);
}

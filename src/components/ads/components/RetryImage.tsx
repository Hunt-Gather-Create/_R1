"use client";

import React, { useState, useCallback, useRef } from "react";

const DEFAULT_MAX_RETRIES = 2;
const RETRY_DELAY_MS = 400;

interface RetryImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  /** Fallback src to try after initial load fails (e.g. placeholder). Only used once; not retried. */
  fallbackSrc?: string;
  /** Max number of retries for the current src (default 2 = 3 total attempts). */
  maxRetries?: number;
}

/**
 * Renders an img that retries loading a few times on error, then gives up
 * so we don't keep requesting a missing file.
 */
export function RetryImage({
  src,
  fallbackSrc,
  maxRetries = DEFAULT_MAX_RETRIES,
  onError,
  ...imgProps
}: RetryImageProps) {
  const [currentSrc, setCurrentSrc] = useState(src);
  const [retryCount, setRetryCount] = useState(0);
  const [giveUp, setGiveUp] = useState(false);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleError = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
      if (retryCount < maxRetries) {
        retryTimeoutRef.current = setTimeout(() => {
          setRetryCount((c) => c + 1);
          retryTimeoutRef.current = null;
        }, RETRY_DELAY_MS);
      } else if (fallbackSrc && currentSrc === src) {
        setCurrentSrc(fallbackSrc);
        setRetryCount(0);
      } else {
        setGiveUp(true);
      }
      onError?.(e);
    },
    [retryCount, maxRetries, fallbackSrc, currentSrc, src, onError]
  );

  React.useEffect(() => {
    if (src !== currentSrc) {
      setCurrentSrc(src);
      setRetryCount(0);
      setGiveUp(false);
    }
  }, [src, currentSrc]);

  React.useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
    };
  }, []);

  if (giveUp || !currentSrc) {
    return (
      <div
        role="img"
        aria-label={imgProps.alt ?? "Logo"}
        className={imgProps.className}
        style={{
          ...imgProps.style,
          backgroundColor: "var(--muted, #e5e7eb)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      />
    );
  }

  return (
    <img
      {...imgProps}
      key={`${currentSrc}-${retryCount}`}
      src={currentSrc}
      onError={handleError}
    />
  );
}

import { useEffect, useRef, useState, useCallback, type RefObject } from "react";

/**
 * Handles chat scroll behavior:
 * 1. On initial load with persisted messages, scrolls to the bottom
 * 2. When user submits a message, scrolls their message to the top
 * 3. Keeps user's message at top after streaming by calculating exact spacer height
 *
 * Requires message elements to have data-message-role attribute.
 * Returns spacerHeight - the height needed to keep user's message at top.
 */
export function useChatAutoScroll(
  containerRef: RefObject<HTMLElement | null>,
  messagesLength: number,
  status: "ready" | "submitted" | "streaming" | "error"
): { spacerHeight: number } {
  const prevStatusRef = useRef(status);
  const prevLengthRef = useRef(0);
  const hasScrolledInitialRef = useRef(false);
  const hasScrolledForSubmitRef = useRef(false);
  const [spacerHeight, setSpacerHeight] = useState(0);

  const scrollToLastUserMessage = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const userMessages = container.querySelectorAll(
      '[data-message-role="user"]'
    );
    const lastUserMessage = userMessages[userMessages.length - 1] as
      | HTMLElement
      | undefined;

    if (lastUserMessage) {
      // Use getBoundingClientRect for accurate positioning
      const containerRect = container.getBoundingClientRect();
      const messageRect = lastUserMessage.getBoundingClientRect();
      // Subtract 5px to add margin between message and header
      const scrollOffset =
        messageRect.top - containerRect.top + container.scrollTop - 5;
      container.scrollTo({
        top: Math.max(0, scrollOffset),
        behavior: "smooth",
      });
    }
  }, [containerRef]);

  const calculateSpacerHeight = useCallback(() => {
    const container = containerRef.current;
    if (!container) return 0;

    const userMessages = container.querySelectorAll(
      '[data-message-role="user"]'
    );
    const lastUserMessage = userMessages[userMessages.length - 1] as
      | HTMLElement
      | undefined;

    if (!lastUserMessage) return 0;

    // Use getBoundingClientRect for accurate measurement
    const containerRect = container.getBoundingClientRect();
    const messageRect = lastUserMessage.getBoundingClientRect();
    // Account for 5px margin above user message
    const messageTopInContainer =
      messageRect.top - containerRect.top + container.scrollTop - 5;

    // Calculate content height from user message to end (excluding current spacer)
    const spacer = container.querySelector("[data-chat-spacer]");
    const spacerCurrentHeight = spacer?.clientHeight || 0;
    const contentHeight =
      container.scrollHeight - spacerCurrentHeight - messageTopInContainer;
    const containerHeight = container.clientHeight;

    // Spacer height needed to allow user message to be at top with margin
    return Math.max(0, containerHeight - contentHeight);
  }, [containerRef]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const statusChanged = status !== prevStatusRef.current;
    const lengthIncreased = messagesLength > prevLengthRef.current;
    const justSubmitted = statusChanged && status === "submitted";

    // Detect initial load: messages appeared while status is ready (not from submission)
    const isInitialLoad =
      !hasScrolledInitialRef.current &&
      messagesLength > 0 &&
      prevLengthRef.current === 0 &&
      status === "ready";

    // When streaming ends, calculate exact spacer height to keep user message at top
    const streamingJustEnded =
      status === "ready" &&
      prevStatusRef.current === "streaming" &&
      hasScrolledForSubmitRef.current;

    // Reset submit scroll flag when status returns to ready
    if (status === "ready" && prevStatusRef.current !== "ready") {
      hasScrolledForSubmitRef.current = false;
    }

    prevStatusRef.current = status;
    prevLengthRef.current = messagesLength;

    // When streaming ends, calculate and set the exact spacer height needed
    if (streamingJustEnded) {
      requestAnimationFrame(() => {
        const neededHeight = calculateSpacerHeight();
        setSpacerHeight(neededHeight);
        // Keep scroll position at user message
        scrollToLastUserMessage();
      });
      return;
    }

    // On initial load with persisted messages, scroll to the bottom
    if (isInitialLoad) {
      hasScrolledInitialRef.current = true;
      requestAnimationFrame(() => {
        setSpacerHeight(0);
        container.scrollTop = container.scrollHeight;
      });
      return;
    }

    // When user submits, set large spacer and scroll their message to the top
    const shouldScrollToUserMessage =
      !hasScrolledForSubmitRef.current &&
      (justSubmitted ||
        (lengthIncreased && (status === "submitted" || status === "streaming")));

    if (shouldScrollToUserMessage) {
      hasScrolledForSubmitRef.current = true;
      // Set large spacer to allow scrolling, then scroll after render
      requestAnimationFrame(() => {
        setSpacerHeight(9999);
        requestAnimationFrame(() => {
          scrollToLastUserMessage();
        });
      });
    }
  }, [
    status,
    containerRef,
    messagesLength,
    scrollToLastUserMessage,
    calculateSpacerHeight,
  ]);

  return { spacerHeight };
}

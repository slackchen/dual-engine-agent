import { useRef, useState, useCallback, useEffect } from 'react';

export function useChatScroll(messages: any[]) {
  const userScrolledUp = useRef(false);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const lastUserScrollIntentAt = useRef(0);
  const suppressScrollEventsUntil = useRef(0);
  const pendingPinnedScrollFrame = useRef(0);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const handleChatScroll = useCallback(() => {
    const container = chatContainerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const distFromBottom = scrollHeight - scrollTop - clientHeight;
    const isAwayFromBottom = distFromBottom > 120;
    const now = Date.now();

    if (!isAwayFromBottom) {
      userScrolledUp.current = false;
    } else if (now - suppressScrollEventsUntil.current > 0 && now - lastUserScrollIntentAt.current < 1200) {
      userScrolledUp.current = true;
    }

    setShowScrollBtn(distFromBottom > 120);
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    const container = chatContainerRef.current;
    if (!container) return;
    suppressScrollEventsUntil.current = Date.now() + 150;
    if (smooth) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    } else {
      container.scrollTop = container.scrollHeight;
    }
  }, []);

  const markUserScrollIntent = useCallback(() => {
    lastUserScrollIntentAt.current = Date.now();
  }, []);

  const keepPinnedToBottom = useCallback(() => {
    if (!hasInitialScrolled.current || userScrolledUp.current) return;
    if (pendingPinnedScrollFrame.current) {
      cancelAnimationFrame(pendingPinnedScrollFrame.current);
    }
    pendingPinnedScrollFrame.current = requestAnimationFrame(() => {
      pendingPinnedScrollFrame.current = 0;
      scrollToBottom(false);
    });
  }, [scrollToBottom]);

  // Initial load: jump to bottom instantly when messages first populate
  const hasInitialScrolled = useRef(false);
  useEffect(() => {
    if (!hasInitialScrolled.current && messages.length > 0 && chatContainerRef.current) {
      hasInitialScrolled.current = true;
      setTimeout(() => scrollToBottom(false), 80);
    }
  }, [messages, scrollToBottom]);

  // Auto-scroll on message updates while the user is still pinned near bottom.
  useEffect(() => {
    if (!hasInitialScrolled.current) return;
    if (userScrolledUp.current) return;

    const frames: number[] = [];
    const scheduleFrame = (remaining: number) => {
      const frame = requestAnimationFrame(() => {
        keepPinnedToBottom();
        if (remaining > 1) scheduleFrame(remaining - 1);
      });
      frames.push(frame);
    };
    scheduleFrame(3);

    return () => {
      frames.forEach(cancelAnimationFrame);
    };
  }, [messages, keepPinnedToBottom]);

  // Markdown, syntax highlighting, plan cards, and step details can change height
  // after the message state update. Keep pinned chats pinned through layout changes.
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(keepPinnedToBottom)
      : null;

    resizeObserver?.observe(container);
    Array.from(container.children).forEach(child => resizeObserver?.observe(child));

    const mutationObserver = typeof MutationObserver !== 'undefined'
      ? new MutationObserver(keepPinnedToBottom)
      : null;
    mutationObserver?.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });

    return () => {
      if (pendingPinnedScrollFrame.current) {
        cancelAnimationFrame(pendingPinnedScrollFrame.current);
        pendingPinnedScrollFrame.current = 0;
      }
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [messages, keepPinnedToBottom]);

  /** Call this before adding a user message to ensure chat jumps to bottom */
  const resetScrollPosition = useCallback(() => {
    userScrolledUp.current = false;
    setShowScrollBtn(false);
  }, []);

  return {
    chatContainerRef,
    showScrollBtn,
    handleChatScroll,
    scrollToBottom,
    resetScrollPosition,
    markUserScrollIntent,
    userScrolledUp,
  };
}

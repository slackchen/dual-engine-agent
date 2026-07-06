import { useRef, useState, useCallback, useEffect } from 'react';

export function useChatScroll(messages: any[]) {
  const userScrolledUp = useRef(false);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const handleChatScroll = useCallback(() => {
    const container = chatContainerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const distFromBottom = scrollHeight - scrollTop - clientHeight;
    userScrolledUp.current = distFromBottom > 120;
    setShowScrollBtn(distFromBottom > 120);
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    const container = chatContainerRef.current;
    if (!container) return;
    if (smooth) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    } else {
      container.scrollTop = container.scrollHeight;
    }
  }, []);

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

    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      scrollToBottom(false);
      secondFrame = requestAnimationFrame(() => scrollToBottom(false));
    });

    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
    };
  }, [messages, scrollToBottom]);

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
    userScrolledUp,
  };
}

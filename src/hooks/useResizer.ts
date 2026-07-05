import { useRef, useEffect, useCallback } from 'react';

export function useResizer(
  initialSize: number,
  direction: 'right' | 'left' | 'top',
  cssVar: string
) {
  useEffect(() => {
    document.documentElement.style.setProperty(cssVar, `${initialSize}px`);
  }, []);

  const isResizing = useRef(false);

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = direction === 'top' ? 'ns-resize' : 'ew-resize';
  }, [direction]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      let newSize: number | undefined;
      if (direction === 'right') {
        newSize = Math.max(150, Math.min(e.clientX, window.innerWidth - 400));
      } else if (direction === 'left') {
        newSize = Math.max(250, Math.min(window.innerWidth - e.clientX, window.innerWidth - 300));
      } else if (direction === 'top') {
        newSize = Math.max(100, Math.min(window.innerHeight - e.clientY, window.innerHeight - 200));
      }
      if (newSize) {
        document.documentElement.style.setProperty(cssVar, `${newSize}px`);
      }
    };
    const handleMouseUp = () => {
      if (isResizing.current) {
        isResizing.current = false;
        document.body.style.cursor = 'default';
      }
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [direction, cssVar]);

  return { startResizing };
}

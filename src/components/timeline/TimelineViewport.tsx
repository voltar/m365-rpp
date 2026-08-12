import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import styles from "./Timeline.module.css";

interface TimelineViewportProps {
  readonly children: ReactNode;
}

export const TimelineViewport = forwardRef<HTMLDivElement, TimelineViewportProps>(function TimelineViewport(
  { children },
  ref
) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const scrollbarRef = useRef<HTMLDivElement>(null);
  const [scrollbarWidth, setScrollbarWidth] = useState(0);

  useImperativeHandle(ref, () => viewportRef.current as HTMLDivElement, []);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    const updateScrollbarWidth = () => {
      setScrollbarWidth(viewport.scrollWidth);
    };

    updateScrollbarWidth();

    const resizeObserver = new ResizeObserver(updateScrollbarWidth);
    resizeObserver.observe(viewport);

    return () => resizeObserver.disconnect();
  }, [children]);

  const syncStickyScrollbar = useCallback(() => {
    const viewport = viewportRef.current;
    const scrollbar = scrollbarRef.current;

    if (viewport && scrollbar && scrollbar.scrollLeft !== viewport.scrollLeft) {
      scrollbar.scrollLeft = viewport.scrollLeft;
    }
  }, []);

  const syncViewport = useCallback(() => {
    const viewport = viewportRef.current;
    const scrollbar = scrollbarRef.current;

    if (viewport && scrollbar && viewport.scrollLeft !== scrollbar.scrollLeft) {
      viewport.scrollLeft = scrollbar.scrollLeft;
    }
  }, []);

  return (
    <div className={styles.viewport} ref={viewportRef} onScroll={syncStickyScrollbar}>
      {children}
      <div className={styles.stickyHorizontalScrollbar} ref={scrollbarRef} onScroll={syncViewport} aria-hidden="true">
        <div style={{ width: scrollbarWidth, height: 1 }} />
      </div>
    </div>
  );
});

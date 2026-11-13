import { RefObject, useEffect, useRef, useState } from 'react';

const THRESHOLD = 70;
const MAX_PULL = 110;

/** Pull-to-refresh per un contenitore scrollabile (touch). Ritorna la distanza di trascinamento. */
export function usePullToRefresh(ref: RefObject<HTMLElement>, onRefresh: () => Promise<unknown>) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const cb = useRef(onRefresh);
  cb.current = onRefresh;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let startY: number | null = null;
    let dist = 0;

    const start = (e: TouchEvent) => {
      startY = el.scrollTop <= 0 ? e.touches[0].clientY : null;
      dist = 0;
    };
    const move = (e: TouchEvent) => {
      if (startY === null) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0) {
        setPull(0);
        return;
      }
      dist = Math.min(MAX_PULL, dy * 0.5); // resistenza elastica
      if (e.cancelable) e.preventDefault();
      setPull(dist);
    };
    const end = async () => {
      if (startY === null) return;
      startY = null;
      if (dist >= THRESHOLD) {
        setRefreshing(true);
        setPull(THRESHOLD * 0.7);
        try {
          await cb.current();
        } finally {
          setRefreshing(false);
        }
      }
      setPull(0);
    };

    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, [ref]);

  return { pull, refreshing, threshold: THRESHOLD };
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Reveals streamed text with a smooth "typing" animation. Providers deliver
 * text in uneven chunks (often a whole sentence at once); this decouples what
 * has been received (the target) from what is shown (revealed), advancing the
 * revealed length over time so it reads like a live type-out.
 *
 * Speed scales with how far behind the display is, so it feels responsive on
 * short replies and still catches up on large bursts without lagging.
 */
export function useTypewriter() {
  const [displayed, setDisplayed] = useState('');
  const targetRef = useRef('');
  const shownRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const finishingRef = useRef(false);
  const onDoneRef = useRef<(() => void) | null>(null);

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    lastTsRef.current = null;
  }, []);

  const tick = useCallback(
    (ts: number) => {
      const last = lastTsRef.current ?? ts;
      const dtSec = Math.min(0.1, (ts - last) / 1000);
      lastTsRef.current = ts;

      const target = targetRef.current;
      const remaining = target.length - shownRef.current;
      if (remaining > 0) {
        // Dynamic speed: faster the further behind we are (chars/second).
        const cps = Math.min(1400, Math.max(140, remaining * 4));
        const advance = Math.max(1, Math.round(cps * dtSec));
        shownRef.current = Math.min(target.length, shownRef.current + advance);
        setDisplayed(target.slice(0, shownRef.current));
        rafRef.current = requestAnimationFrame(tick);
      } else if (finishingRef.current) {
        // Caught up and the turn is complete: signal the caller to swap in the
        // persisted message.
        finishingRef.current = false;
        stop();
        const cb = onDoneRef.current;
        onDoneRef.current = null;
        cb?.();
      } else {
        // Caught up but more may still arrive; idle until the next append.
        stop();
      }
    },
    [stop],
  );

  const ensureRunning = useCallback(() => {
    if (rafRef.current === null) {
      lastTsRef.current = null;
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [tick]);

  /** Append newly received text to the buffer. */
  const push = useCallback(
    (delta: string) => {
      targetRef.current += delta;
      ensureRunning();
    },
    [ensureRunning],
  );

  /**
   * Mark the turn complete. `onDone` fires once the visible text has caught up
   * to everything received, so the caller can seamlessly swap to the final
   * persisted message with no text popping in early or being cut off.
   */
  const finish = useCallback(
    (onDone: () => void) => {
      onDoneRef.current = onDone;
      if (targetRef.current.length - shownRef.current <= 0) {
        // Already caught up.
        onDoneRef.current = null;
        stop();
        onDone();
      } else {
        finishingRef.current = true;
        ensureRunning();
      }
    },
    [ensureRunning, stop],
  );

  /** Reset everything (e.g. when switching conversations). */
  const reset = useCallback(() => {
    stop();
    targetRef.current = '';
    shownRef.current = 0;
    finishingRef.current = false;
    onDoneRef.current = null;
    setDisplayed('');
  }, [stop]);

  useEffect(() => () => stop(), [stop]);

  return { displayed, push, finish, reset, isTyping: displayed.length > 0 };
}

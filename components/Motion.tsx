'use client';

import { LazyMotion, MotionConfig, domMax } from 'motion/react';

/** One easing curve for the whole app, and motion switched off for people who ask for less. */
export const EASE = [0.22, 1, 0.36, 1] as const;

export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={domMax} strict>
      <MotionConfig reducedMotion="user" transition={{ duration: 0.4, ease: EASE }}>
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}

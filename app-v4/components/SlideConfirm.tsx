"use client";

import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { haptic, pop } from "@/lib/sounds";

export function SlideConfirm({ disabled, hint, onConfirm }: { disabled?: boolean; hint?: string; onConfirm: () => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const stretch = useMotionValue(1);
  const [max, setMax] = useState(0);
  const done = useRef(false);

  useEffect(() => {
    const measure = () => {
      const width = trackRef.current?.clientWidth ?? 0;
      setMax(Math.max(0, width - 62));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const fill = useTransform(x, (value) => `${Math.max(0, value + 58)}px`);

  return (
    <div className={disabled ? "slider slider-locked" : "slider"} aria-disabled={disabled}>
      <div className="slider-inner" ref={trackRef}>
        <motion.div
          style={{ width: fill }}
          className="absolute inset-y-0 left-0 rounded-full"
          aria-hidden
        >
          <div className="h-full w-full rounded-full bg-[linear-gradient(90deg,#ffe4ea,#fff6d4,#ddfff4)] opacity-80" />
        </motion.div>
        <div className="slider-label">
          {disabled ? (
            <span className="inline-flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
              {hint ?? "Locked"}
            </span>
          ) : "slide to confirm"}
        </div>
        <span className="chev" aria-hidden>›</span>
        <motion.div
          className="knob"
          style={{ x, scaleX: stretch, touchAction: "none" }}
          drag={disabled ? false : "x"}
          dragConstraints={{ left: 0, right: max }}
          dragElastic={0.18}
          dragMomentum={false}
          onDrag={(_, info) => {
            const velocity = typeof info.velocity === "number" ? info.velocity : info.velocity.x;
            const pull = 1 + Math.min(0.42, Math.abs(velocity) / 2200);
            stretch.set(velocity < 0 ? 1 / pull : pull);
          }}
          onDragEnd={() => {
            void animate(stretch, 1, { type: "spring", stiffness: 420, damping: 16 });
            if (disabled || done.current) {
              void animate(x, 0, { type: "spring", stiffness: 380, damping: 18 });
              return;
            }
            if (x.get() > max * 0.9) {
              done.current = true;
              void animate(x, max, { type: "spring", stiffness: 520, damping: 24 });
              pop(700);
              haptic([12, 30, 18]);
              onConfirm();
              return;
            }
            void animate(x, 0, { type: "spring", stiffness: 380, damping: 16 });
          }}
          role="slider"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Slide to confirm"
          aria-disabled={disabled}
          tabIndex={0}
          onKeyDown={(event) => {
            if (disabled || done.current) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              done.current = true;
              void animate(x, max, { type: "spring", stiffness: 520, damping: 24 });
              pop(700);
              haptic([12, 30, 18]);
              onConfirm();
            }
          }}
        >
          {disabled ? "🔒" : "→"}
        </motion.div>
      </div>
    </div>
  );
}

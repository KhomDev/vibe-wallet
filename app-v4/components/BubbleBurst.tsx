"use client";

import { motion } from "framer-motion";

const COLORS = ["#ffd0dc", "#fff3c2", "#c9fff0", "#d7f6ff", "#ffffff"];

export function BubbleBurst() {
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {Array.from({ length: 16 }, (_, index) => {
        const angle = (index / 16) * Math.PI * 2;
        return (
          <motion.span
            key={index}
            className="absolute left-1/2 top-[42%] block rounded-full border border-white"
            style={{ background: COLORS[index % COLORS.length], width: 8 + (index % 4) * 3, height: 8 + (index % 4) * 3 }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 0.4 }}
            animate={{ x: Math.cos(angle) * (90 + index * 4), y: Math.sin(angle) * (70 + index * 3) - 20, opacity: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 180, damping: 16, mass: 0.6 }}
          />
        );
      })}
    </div>
  );
}

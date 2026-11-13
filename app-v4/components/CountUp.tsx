"use client";

import { motion, useSpring, useTransform } from "framer-motion";
import { useEffect, useState } from "react";

export function CountUp({ value, digits = 2 }: { value: number; digits?: number }) {
  const [reduced, setReduced] = useState(false);
  const spring = useSpring(0, { stiffness: 70, damping: 18, mass: 0.7 });
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(media.matches);
    spring.set(Number.isFinite(value) ? value : 0);
  }, [spring, value]);
  const text = useTransform(spring, (current) => current.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }));
  if (reduced || !Number.isFinite(value)) {
    return <span>{Number.isFinite(value) ? value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }) : "—"}</span>;
  }
  return <motion.span>{text}</motion.span>;
}

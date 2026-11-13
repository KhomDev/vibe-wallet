"use client";

import { useEffect, useRef } from "react";

export type OrbState = "idle" | "listening" | "thinking" | "reviewing" | "confirming" | "done" | "blocked";

export function HoloOrb({
  state,
  levelRef,
  onPress,
}: {
  state: OrbState;
  levelRef: React.RefObject<number>;
  onPress: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const squash = useRef({ value: 1, velocity: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    const bubbles = Array.from({ length: 14 }, (_, index) => ({
      x: 0.2 + ((index * 37) % 60) / 100,
      y: (index * 0.13) % 1,
      r: 2 + (index % 4),
      s: 0.12 + (index % 5) * 0.03,
    }));

    const draw = (time: number) => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.floor(rect.width * dpr));
      const height = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      ctx.clearRect(0, 0, width, height);
      const spring = squash.current;
      if (!reduced) {
        spring.velocity += (1 - spring.value) * 0.18;
        spring.velocity *= 0.72;
        spring.value += spring.velocity;
      } else {
        spring.value = 1;
      }
      const mode = stateRef.current;
      const level = mode === "listening" ? levelRef.current ?? 0 : 0;
      const breathe = reduced ? 1 : 1 + Math.sin(time * 0.0014) * 0.035;
      const wobble = reduced ? 0 : mode === "listening" ? 0.045 + level * 0.11 : mode === "thinking" ? 0.05 : 0.028;
      const cx = width / 2;
      const cy = height / 2 + Math.sin(time * 0.0011) * (reduced ? 0 : height * 0.012);
      const base = Math.min(width, height) * 0.36 * breathe;
      const sx = spring.value;
      const sy = 1 + (1 - spring.value) * 0.72;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(sx, sy);
      const glow = ctx.createRadialGradient(0, 0, base * 0.4, 0, 0, base * 1.35);
      glow.addColorStop(0, "rgba(255,255,255,0.0)");
      glow.addColorStop(1, mode === "thinking" ? "rgba(255, 214, 170, 0.45)" : "rgba(255, 255, 255, 0.0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, base * 1.35, 0, Math.PI * 2);
      ctx.fill();

      const path = new Path2D();
      const steps = 90;
      for (let i = 0; i <= steps; i += 1) {
        const theta = (i / steps) * Math.PI * 2;
        const n = Math.sin(3 * theta + time * 0.002) * 0.62
          + Math.sin(5 * theta - time * 0.0016) * 0.38
          + Math.sin(8 * theta + time * 0.0024) * 0.16;
        const radius = base * (1 + wobble * n);
        const x = Math.cos(theta) * radius;
        const y = Math.sin(theta) * radius;
        if (i === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      }
      path.closePath();
      ctx.save();
      ctx.clip(path);
      const body = ctx.createRadialGradient(-base * 0.2, -base * 0.28, base * 0.05, 0, 0, base);
      body.addColorStop(0, "rgba(255,255,255,0.96)");
      body.addColorStop(0.28, "rgba(255, 186, 214, 0.82)");
      body.addColorStop(0.55, "rgba(126, 226, 255, 0.7)");
      body.addColorStop(0.78, "rgba(186, 255, 214, 0.72)");
      body.addColorStop(1, "rgba(255, 214, 140, 0.88)");
      ctx.fillStyle = body;
      ctx.fillRect(-base * 2, -base * 2, base * 4, base * 4);

      const drift = reduced ? 0 : time * 0.0007;
      const patches: Array<[number, number, string]> = [
        [Math.cos(drift) * base * 0.35, Math.sin(drift) * base * 0.2, "rgba(255, 120, 168, 0.72)"],
        [Math.cos(drift + 2) * base * 0.4, Math.sin(drift + 1) * base * 0.35, "rgba(90, 230, 196, 0.66)"],
        [Math.cos(drift + 4) * base * 0.3, Math.sin(drift + 3) * base * 0.28, "rgba(255, 206, 90, 0.7)"],
        [Math.cos(drift + 5.2) * base * 0.2, Math.sin(drift + 2.2) * base * 0.4, "rgba(120, 220, 255, 0.7)"],
      ];
      for (const [px, py, color] of patches) {
        const g = ctx.createRadialGradient(px, py, 0, px, py, base * 0.55);
        g.addColorStop(0, color);
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(-base * 2, -base * 2, base * 4, base * 4);
      }
      const shine = ctx.createRadialGradient(-base * 0.32, -base * 0.38, 0, -base * 0.2, -base * 0.2, base * 0.55);
      shine.addColorStop(0, "rgba(255,255,255,0.95)");
      shine.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = shine;
      ctx.beginPath();
      ctx.ellipse(-base * 0.22, -base * 0.28, base * 0.34, base * 0.22, -0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.strokeStyle = "rgba(255,255,255,0.98)";
      ctx.lineWidth = Math.max(5, base * 0.07);
      ctx.stroke(path);
      ctx.strokeStyle = "rgba(255, 170, 196, 0.9)";
      ctx.lineWidth = Math.max(2, base * 0.02);
      ctx.stroke(path);
      ctx.restore();

      if (!reduced) {
        for (const bubble of bubbles) {
          bubble.y -= bubble.s * 0.004;
          if (bubble.y < -0.05) bubble.y = 1.05;
          const bx = (bubble.x + Math.sin(time * 0.001 + bubble.x * 8) * 0.02) * width;
          const by = bubble.y * height;
          ctx.beginPath();
          ctx.fillStyle = "rgba(255,255,255,0.55)";
          ctx.arc(bx, by, bubble.r * dpr, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "rgba(255, 210, 220, 0.8)";
          ctx.stroke();
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [levelRef]);

  return (
    <button
      className="orb-hit"
      type="button"
      aria-label={state === "listening" ? "Stop listening" : "Start listening"}
      onPointerDown={() => {
        squash.current.value = 0.82;
        squash.current.velocity = 0.04;
      }}
      onClick={onPress}
    >
      <canvas ref={canvasRef} />
    </button>
  );
}

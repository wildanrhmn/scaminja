import { useEffect, useRef } from "react";

// All of this is pure decoration and touches the DOM/canvas, so it only runs in
// the browser (inside effects) — during SSG it renders as empty, inert elements.
export default function Background() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);

  // cursor glow (fine pointers only)
  useEffect(() => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !matchMedia("(pointer:fine)").matches) return;
    const cg = glowRef.current;
    if (!cg) return;
    const move = (e: MouseEvent) => {
      cg.style.opacity = "1";
      cg.style.left = e.clientX + "px";
      cg.style.top = e.clientY + "px";
    };
    addEventListener("mousemove", move, { passive: true });
    return () => removeEventListener("mousemove", move);
  }, []);

  // particle constellation
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    let w = 0, h = 0, dpr = 1, raf = 0;
    let pts: { x: number; y: number; vx: number; vy: number }[] = [];
    const mouse = { x: -9999, y: -9999 };

    function size() {
      dpr = Math.min(devicePixelRatio || 1, 2);
      w = cv!.width = innerWidth * dpr;
      h = cv!.height = innerHeight * dpr;
      cv!.style.width = innerWidth + "px";
      cv!.style.height = innerHeight + "px";
      const n = Math.min(88, Math.floor((innerWidth * innerHeight) / 16500));
      pts = Array.from({ length: n }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.26 * dpr, vy: (Math.random() - 0.5) * 0.26 * dpr,
      }));
    }
    function draw() {
      ctx!.clearRect(0, 0, w, h);
      const R = 132 * dpr;
      for (const p of pts) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
        const dx = p.x - mouse.x, dy = p.y - mouse.y, md = Math.hypot(dx, dy);
        if (md < 120 * dpr) { p.x += (dx / md) * 1.1; p.y += (dy / md) * 1.1; }
      }
      for (let i = 0; i < pts.length; i++)
        for (let j = i + 1; j < pts.length; j++) {
          const a = pts[i], b = pts[j], d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < R) {
            ctx!.strokeStyle = `rgba(79,227,208,${(1 - d / R) * 0.2})`;
            ctx!.lineWidth = dpr;
            ctx!.beginPath(); ctx!.moveTo(a.x, a.y); ctx!.lineTo(b.x, b.y); ctx!.stroke();
          }
        }
      for (const p of pts) {
        ctx!.fillStyle = "rgba(150,190,255,.5)";
        ctx!.beginPath(); ctx!.arc(p.x, p.y, 1.3 * dpr, 0, 7); ctx!.fill();
      }
      raf = requestAnimationFrame(draw);
    }

    const onMove = (e: MouseEvent) => { mouse.x = e.clientX * dpr; mouse.y = e.clientY * dpr; };
    const onLeave = () => { mouse.x = mouse.y = -9999; };
    let to: ReturnType<typeof setTimeout>;
    const onResize = () => { clearTimeout(to); to = setTimeout(size, 200); };
    const onVis = () => { if (document.hidden) cancelAnimationFrame(raf); else draw(); };

    addEventListener("mousemove", onMove, { passive: true });
    addEventListener("mouseleave", onLeave);
    addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVis);
    size(); draw();

    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("mousemove", onMove);
      removeEventListener("mouseleave", onLeave);
      removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return (
    <>
      <div className="bg-layer bg-base" />
      <div className="aurora"><i className="a1" /><i className="a2" /><i className="a3" /></div>
      <canvas id="particles" ref={canvasRef} />
      <div className="cursor-glow" ref={glowRef} />
    </>
  );
}

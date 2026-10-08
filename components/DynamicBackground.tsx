/**
 * DynamicBackground - Ambient ember field behind the console.
 *
 * Three layers, all decorative (aria-hidden, pointer-events: none):
 *   1. a canvas of five large radial glows that orbit the full viewport,
 *   2. a faint grid that drifts one tile every 44s (seamless loop),
 *   3. a light beam that crosses the screen every 26s.
 *
 * The canvas keeps its 25fps budget, pauses while the tab is hidden, and draws a
 * single static frame when the user prefers reduced motion; the two CSS layers
 * are switched off in the matching @media block in styles/index.css.
 */

import React, { useEffect, useRef } from 'react';

export function DynamicBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frameId = 0;
    let previousFrame = 0;
    let running = false;
    let width = window.innerWidth;
    let height = window.innerHeight;

    // Each glow gets its own orbit centre, ellipse and two speeds, so the field
    // never repeats as a single wash. Amplitudes are viewport-relative, which is
    // what makes the light travel *around* the page instead of shimmering in place.
    const blobs = Array.from({ length: 5 }, (_, index) => ({
      cx: 0.5 + (index - 2) * 0.09,
      cy: 0.44 + (index % 2) * 0.17,
      ax: 0.3 + (index % 3) * 0.07,
      ay: 0.26 + ((index + 1) % 3) * 0.06,
      sx: 0.000082 + index * 0.0000085,
      sy: 0.000067 + index * 0.000011,
      phase: index * 1.31,
      radius: 300 + index * 46,
      breath: 0.000053 + index * 0.000009,
      color: [
        'rgba(249, 115, 22, 0.14)',
        'rgba(245, 158, 11, 0.10)',
        'rgba(220, 71, 45, 0.10)',
        'rgba(45, 212, 191, 0.07)',
        'rgba(146, 168, 199, 0.09)',
      ][index],
    }));

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (time: number) => {
      ctx.fillStyle = '#0b0d12';
      ctx.fillRect(0, 0, width, height);
      blobs.forEach(blob => {
        const x = width * (blob.cx + Math.sin(time * blob.sx + blob.phase) * blob.ax);
        const y = height * (blob.cy + Math.cos(time * blob.sy + blob.phase * 1.7) * blob.ay);
        const radius = blob.radius * (1 + Math.sin(time * blob.breath + blob.phase) * 0.14);
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, blob.color);
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      });
    };

    const animate = (time: number) => {
      if (!running) return;
      frameId = requestAnimationFrame(animate);
      if (time - previousFrame < 40) return;
      previousFrame = time;
      draw(time);
    };

    const stop = () => {
      running = false;
      cancelAnimationFrame(frameId);
      frameId = 0;
    };

    const start = () => {
      if (running || motionPreference.matches || document.visibilityState !== 'visible') return;
      running = true;
      frameId = requestAnimationFrame(animate);
    };

    const handleMotionChange = () => {
      if (motionPreference.matches) {
        stop();
        draw(0);
      } else {
        start();
      }
    };
    const handleVisibilityChange = () => document.visibilityState === 'visible' ? start() : stop();
    const handleResize = () => {
      resize();
      draw(0);
    };

    resize();
    draw(0);
    start();
    window.addEventListener('resize', handleResize);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    motionPreference.addEventListener('change', handleMotionChange);

    return () => {
      stop();
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      motionPreference.removeEventListener('change', handleMotionChange);
    };
  }, []);

  return (
    <div className="bg-field" aria-hidden="true">
      <canvas ref={canvasRef} className="dynamic-background" />
      <div className="bg-field__grid" />
      <div className="bg-field__beam" />
    </div>
  );
}

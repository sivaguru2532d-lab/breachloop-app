/**
 * DynamicBackground - Low-motion ambient ember gradients behind the console
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

    const blobs = Array.from({ length: 4 }, (_, index) => ({
      x: width * (0.18 + index * 0.22),
      y: height * (0.22 + (index % 2) * 0.46),
      radius: 300 + index * 38,
      phase: index * 1.8,
      color: [
        'rgba(249, 115, 22, 0.14)',
        'rgba(245, 158, 11, 0.10)',
        'rgba(220, 71, 45, 0.10)',
        'rgba(45, 212, 191, 0.07)',
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
        const x = blob.x + Math.sin(time * 0.00012 + blob.phase) * 34;
        const y = blob.y + Math.cos(time * 0.0001 + blob.phase) * 28;
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, blob.radius);
        gradient.addColorStop(0, blob.color);
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, blob.radius, 0, Math.PI * 2);
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

  return <canvas ref={canvasRef} className="dynamic-background" aria-hidden="true" />;
}

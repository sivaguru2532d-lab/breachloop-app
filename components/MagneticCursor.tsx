/**
 * MagneticCursor - Custom magnetic cursor that snaps to interactive elements
 */

import React, { useEffect, useRef, useState } from 'react';

export function MagneticCursor() {
  const cursorRef = useRef<HTMLDivElement>(null);
  const cursorDotRef = useRef<HTMLDivElement>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    const cursor = cursorRef.current;
    const cursorDot = cursorDotRef.current;
    const finePointer = window.matchMedia('(pointer: fine)');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!cursor || !cursorDot || !finePointer.matches || reducedMotion.matches) return;
    document.body.classList.add('has-magnetic-cursor');

    const removeCursorMode = () => document.body.classList.remove('has-magnetic-cursor');
    finePointer.addEventListener('change', removeCursorMode, { once: true });
    reducedMotion.addEventListener('change', removeCursorMode, { once: true });

    const resetCursorMode = () => {
      finePointer.removeEventListener('change', removeCursorMode);
      reducedMotion.removeEventListener('change', removeCursorMode);
      removeCursorMode();
    };

    let mouseX = 0;
    let mouseY = 0;
    let cursorX = 0;
    let cursorY = 0;
    let dotX = 0;
    let dotY = 0;
    let frameId = 0;
    let magneticTarget: HTMLElement | null = null;

    const clearMagneticTarget = () => {
      if (!magneticTarget) return;
      magneticTarget.removeAttribute('data-magnetic-target');
      magneticTarget.style.removeProperty('--magnetic-x');
      magneticTarget.style.removeProperty('--magnetic-y');
      magneticTarget = null;
    };

    const animate = () => {
      cursorX += (mouseX - cursorX) * 0.2;
      cursorY += (mouseY - cursorY) * 0.2;
      dotX += (mouseX - dotX) * 0.34;
      dotY += (mouseY - dotY) * 0.34;
      cursor.style.transform = `translate3d(${cursorX}px, ${cursorY}px, 0)`;
      cursorDot.style.transform = `translate3d(${dotX}px, ${dotY}px, 0)`;

      if (Math.abs(mouseX - cursorX) > 0.1 || Math.abs(mouseY - cursorY) > 0.1 || Math.abs(mouseX - dotX) > 0.1 || Math.abs(mouseY - dotY) > 0.1) {
        frameId = requestAnimationFrame(animate);
      } else {
        frameId = 0;
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      mouseX = event.clientX;
      mouseY = event.clientY;
      setIsActive(true);
      const target = event.target instanceof Element ? event.target : null;
      const interactive = target?.closest<HTMLElement>('button, a, [role="button"], input, select, textarea') ?? null;
      if (interactive !== magneticTarget) {
        clearMagneticTarget();
        magneticTarget = interactive;
        magneticTarget?.setAttribute('data-magnetic-target', 'true');
      }
      setIsHovering(!!interactive);

      if (interactive) {
        const rect = interactive.getBoundingClientRect();
        const offsetX = Math.max(-4, Math.min(4, (event.clientX - (rect.left + rect.width / 2)) * 0.08));
        const offsetY = Math.max(-4, Math.min(4, (event.clientY - (rect.top + rect.height / 2)) * 0.08));
        interactive.style.setProperty('--magnetic-x', `${offsetX}px`);
        interactive.style.setProperty('--magnetic-y', `${offsetY}px`);
      }

      if (!frameId) frameId = requestAnimationFrame(animate);
    };

    const handlePointerLeave = () => {
      clearMagneticTarget();
      setIsActive(false);
      setIsHovering(false);
      cancelAnimationFrame(frameId);
      frameId = 0;
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.documentElement.addEventListener('pointerleave', handlePointerLeave);

    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.documentElement.removeEventListener('pointerleave', handlePointerLeave);
      cancelAnimationFrame(frameId);
      clearMagneticTarget();
      resetCursorMode();
    };
  }, []);

  return (
    <>
      <div
        ref={cursorRef}
        className={`magnetic-cursor${isHovering ? ' magnetic-cursor--hover' : ''}${isActive ? ' magnetic-cursor--active' : ''}`}
        aria-hidden="true"
      />
      <div
        ref={cursorDotRef}
        className={`magnetic-cursor-dot${isActive ? ' magnetic-cursor-dot--active' : ''}`}
        aria-hidden="true"
      />
    </>
  );
}

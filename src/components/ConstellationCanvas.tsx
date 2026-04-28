import { useEffect, useRef, useCallback } from 'react';
import type { Participant, ParticleEffect } from '../engine/types';

interface Props {
  participants: Participant[];
  effects: ParticleEffect[];
  highlightedId: string | null;
  captureGlowId: string | null;
  width: number;
  height: number;
  onHover: (id: string | null) => void;
  onClick: (id: string) => void;
}

const NODE_RADIUS = 6;
const HOVER_RADIUS = 16;
const CONNECTION_DIST = 220;
const PARTICLE_LIFETIME = 2000;

function updateParticles(effects: ParticleEffect[]): ParticleEffect[] {
  const now = Date.now();
  return effects
    .filter((e) => now - e.timestamp < PARTICLE_LIFETIME)
    .map((effect) => {
      const age = (now - effect.timestamp) / PARTICLE_LIFETIME;
      return {
        ...effect,
        particles: effect.particles.map((p) => ({
          ...p,
          x: p.x + p.vx,
          y: p.y + p.vy,
          vx: p.vx * 0.97,
          vy: p.vy * 0.97,
          alpha: Math.max(0, p.alpha * (1 - age * 0.8)),
        })),
      };
    });
}

function drawConstellation(
  ctx: CanvasRenderingContext2D,
  participants: Participant[],
  effects: ParticleEffect[],
  highlightedId: string | null,
  captureGlowId: string | null,
  captureGlowStart: number,
  faceImages: Map<string, HTMLImageElement>,
  nodePositions: Map<string, { x: number; y: number; vx: number; vy: number }>,
  w: number,
  h: number,
  time: number
) {
  ctx.clearRect(0, 0, w, h);

  // subtle grid
  ctx.save();
  ctx.strokeStyle = 'hsla(220, 20%, 30%, 0.03)';
  ctx.lineWidth = 0.5;
  const step = 80;
  for (let x = 0; x < w; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.restore();

  // connection lines between nearby nodes
  ctx.save();
  for (let i = 0; i < participants.length; i++) {
    for (let j = i + 1; j < participants.length; j++) {
      const a = participants[i];
      const b = participants[j];
      const posA = nodePositions.get(a.id);
      const posB = nodePositions.get(b.id);
      if (!posA || !posB) continue;
      const ax = posA.x * w, ay = posA.y * h;
      const bx = posB.x * w, by = posB.y * h;
      const dx = ax - bx;
      const dy = ay - by;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < CONNECTION_DIST) {
        const alpha = (1 - dist / CONNECTION_DIST) * 0.08;
        const grad = ctx.createLinearGradient(ax, ay, bx, by);
        grad.addColorStop(0, `hsla(${a.hue}, 50%, 60%, ${alpha})`);
        grad.addColorStop(1, `hsla(${b.hue}, 50%, 60%, ${alpha})`);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        const midX = (ax + bx) / 2;
        const midY = (ay + by) / 2 - 20;
        ctx.quadraticCurveTo(midX, midY, bx, by);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
    }
  }
  ctx.restore();

  // particle effects
  const now = Date.now();
  for (const effect of effects) {
    if (now - effect.timestamp >= PARTICLE_LIFETIME) continue;
    for (const p of effect.particles) {
      if (p.alpha <= 0) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${effect.hue}, 80%, 70%, ${p.alpha})`;
      ctx.fill();
    }
  }

  // nodes
  for (const p of participants) {
    const pos = nodePositions.get(p.id);
    const x = pos ? pos.x * w : p.nodeX * w;
    const y = pos ? pos.y * h : p.nodeY * h;
    const isHighlighted = p.id === highlightedId;
    const isCaptureGlow = p.id === captureGlowId;
    const pulse = Math.sin(time * 0.002 + p.hue) * 0.3 + 0.7;
    const r = isHighlighted ? NODE_RADIUS * 2 : NODE_RADIUS;

    // capture glow animation
    if (isCaptureGlow && captureGlowStart > 0) {
      const elapsed = time - captureGlowStart;
      const glowDuration = 1500;
      if (elapsed < glowDuration) {
        const progress = elapsed / glowDuration;
        const glowSize = 20 + progress * 60;
        const glowA = (1 - progress) * 0.6;
        const captureGlow = ctx.createRadialGradient(x, y, 0, x, y, glowSize);
        captureGlow.addColorStop(0, `hsla(${p.hue}, 90%, 80%, ${glowA})`);
        captureGlow.addColorStop(0.5, `hsla(${p.hue}, 80%, 70%, ${glowA * 0.4})`);
        captureGlow.addColorStop(1, `hsla(${p.hue}, 80%, 70%, 0)`);
        ctx.fillStyle = captureGlow;
        ctx.fillRect(x - glowSize, y - glowSize, glowSize * 2, glowSize * 2);
      }
    }

    // regular glow
    const glowAlpha = isHighlighted ? 0.4 : 0.1 * pulse;
    const glowR = isHighlighted ? 30 : 15;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, glowR);
    glow.addColorStop(0, `hsla(${p.hue}, 70%, 65%, ${glowAlpha})`);
    glow.addColorStop(1, `hsla(${p.hue}, 70%, 65%, 0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(x - glowR, y - glowR, glowR * 2, glowR * 2);

    // node circle
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${p.hue}, 60%, 65%, ${isHighlighted ? 0.9 : 0.5 * pulse})`;
    ctx.fill();

    // face photo on node
    if (faceImages.has(p.id)) {
      const img = faceImages.get(p.id)!;
      if (img.complete && img.naturalWidth > 0) {
        const imgSize = isHighlighted ? 48 : 20;
        const imgAlpha = isHighlighted ? 0.85 : 0.4 * pulse;
        ctx.save();
        ctx.globalAlpha = imgAlpha;
        ctx.beginPath();
        ctx.arc(x, y, imgSize / 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(img, x - imgSize / 2, y - imgSize / 2, imgSize, imgSize);
        ctx.restore();

        ctx.beginPath();
        ctx.arc(x, y, imgSize / 2, 0, Math.PI * 2);
        ctx.strokeStyle = `hsla(${p.hue}, 70%, 65%, ${isHighlighted ? 0.6 : 0.2 * pulse})`;
        ctx.lineWidth = isHighlighted ? 1.5 : 0.8;
        ctx.stroke();
      }
    } else if (p.landmarks && p.landmarks.length > 0) {
      const faceAlpha = isHighlighted ? 0.6 : 0.2 * pulse;
      drawMiniFace(ctx, p, x, y - (isHighlighted ? 0 : 2), isHighlighted ? 60 : 30, faceAlpha);
    }

    if (isHighlighted && !faceImages.has(p.id)) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.strokeStyle = `hsla(${p.hue}, 80%, 80%, 0.6)`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  // ambient floating particles
  ctx.save();
  for (let i = 0; i < 40; i++) {
    const px = ((Math.sin(time * 0.0003 + i * 1.7) + 1) / 2) * w;
    const py = ((Math.cos(time * 0.0002 + i * 2.3) + 1) / 2) * h;
    ctx.beginPath();
    ctx.arc(px, py, 0.8, 0, Math.PI * 2);
    ctx.fillStyle = 'hsla(200, 30%, 70%, 0.06)';
    ctx.fill();
  }
  ctx.restore();
}

function drawMiniFace(
  ctx: CanvasRenderingContext2D,
  p: Participant,
  cx: number,
  cy: number,
  scale: number = 60,
  alpha: number = 0.5
) {
  const lm = p.landmarks;
  if (!lm || lm.length < 468) return;
  const refX = lm[1].x;
  const refY = lm[1].y;
  const outline = [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365,
    379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93,
    234, 127, 162, 21, 54, 103, 67, 109, 10,
  ];
  const leftEye = [33, 160, 158, 133, 153, 144, 33];
  const rightEye = [362, 385, 387, 263, 373, 380, 362];
  const lips = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 61];

  ctx.save();
  ctx.globalAlpha = alpha;

  const drawPath = (indices: number[], color: string, lineW: number) => {
    ctx.beginPath();
    for (let i = 0; i < indices.length; i++) {
      const pt = lm[indices[i]];
      if (!pt) continue;
      const x = cx + (pt.x - refX) * scale;
      const y = cy + (pt.y - refY) * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = lineW;
    ctx.stroke();
  };

  drawPath(outline, `hsla(${p.hue}, 60%, 70%, 0.6)`, scale > 40 ? 1 : 0.6);
  drawPath(leftEye, `hsla(${p.hue}, 70%, 75%, 0.7)`, scale > 40 ? 0.8 : 0.4);
  drawPath(rightEye, `hsla(${p.hue}, 70%, 75%, 0.7)`, scale > 40 ? 0.8 : 0.4);
  drawPath(lips, `hsla(${p.hue}, 50%, 65%, 0.5)`, scale > 40 ? 0.6 : 0.3);

  ctx.restore();
}

export function createSplatterEffect(
  x: number,
  y: number,
  hue: number
): ParticleEffect {
  const particles = [];
  const count = 20 + Math.floor(Math.random() * 15);
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1 + Math.random() * 4;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 1 + Math.random() * 3,
      alpha: 0.6 + Math.random() * 0.4,
    });
  }
  return {
    id: Date.now() + Math.random(),
    x,
    y,
    hue,
    timestamp: Date.now(),
    particles,
  };
}

export default function ConstellationCanvas({
  participants,
  effects,
  highlightedId,
  captureGlowId,
  width,
  height,
  onHover,
  onClick,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animEffects = useRef<ParticleEffect[]>([]);
  const captureGlowStartRef = useRef(0);
  const faceImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const nodePositions = useRef<Map<string, { x: number; y: number; vx: number; vy: number }>>(new Map());

  useEffect(() => {
    if (captureGlowId) {
      captureGlowStartRef.current = performance.now();
    }
  }, [captureGlowId]);

  useEffect(() => {
    animEffects.current = effects;
  }, [effects]);

  useEffect(() => {
    for (const p of participants) {
      if (!nodePositions.current.has(p.id)) {
        nodePositions.current.set(p.id, {
          x: p.nodeX,
          y: p.nodeY,
          vx: (Math.random() - 0.5) * 0.0004,
          vy: (Math.random() - 0.5) * 0.0004,
        });
      }
      if (p.faceSnapshot && !faceImagesRef.current.has(p.id)) {
        const img = new Image();
        img.src = p.faceSnapshot;
        faceImagesRef.current.set(p.id, img);
      }
    }
  }, [participants]);

  const getNodePos = useCallback((p: Participant) => {
    let pos = nodePositions.current.get(p.id);
    if (!pos) {
      pos = {
        x: p.nodeX,
        y: p.nodeY,
        vx: (Math.random() - 0.5) * 0.0004,
        vy: (Math.random() - 0.5) * 0.0004,
      };
      nodePositions.current.set(p.id, pos);
    }
    return pos;
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      for (const p of participants) {
        const pos = getNodePos(p);
        const px = pos.x * width;
        const py = pos.y * height;
        const dist = Math.hypot(mx - px, my - py);
        if (dist < HOVER_RADIUS) {
          onHover(p.id);
          return;
        }
      }
      onHover(null);
    },
    [participants, width, height, onHover, getNodePos]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      for (const p of participants) {
        const pos = getNodePos(p);
        const px = pos.x * width;
        const py = pos.y * height;
        const dist = Math.hypot(mx - px, my - py);
        if (dist < HOVER_RADIUS) {
          onClick(p.id);
          return;
        }
      }
    },
    [participants, width, height, onClick, getNodePos]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf: number;
    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);

      animEffects.current = updateParticles(animEffects.current);

      for (const p of participants) {
        const pos = nodePositions.current.get(p.id);
        if (!pos) continue;
        pos.x += pos.vx;
        pos.y += pos.vy;
        if (pos.x < 0.05 || pos.x > 0.95) pos.vx *= -1;
        if (pos.y < 0.05 || pos.y > 0.95) pos.vy *= -1;
        pos.x = Math.max(0.03, Math.min(0.97, pos.x));
        pos.y = Math.max(0.03, Math.min(0.97, pos.y));
        pos.vx += (Math.random() - 0.5) * 0.00003;
        pos.vy += (Math.random() - 0.5) * 0.00003;
        pos.vx *= 0.999;
        pos.vy *= 0.999;
      }

      drawConstellation(
        ctx,
        participants,
        animEffects.current,
        highlightedId,
        captureGlowId,
        captureGlowStartRef.current,
        faceImagesRef.current,
        nodePositions.current,
        width,
        height,
        performance.now()
      );
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [participants, highlightedId, captureGlowId, width, height]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0"
      style={{ width, height, cursor: highlightedId ? 'pointer' : 'default' }}
      onPointerMove={handlePointerMove}
      onClick={handleClick}
    />
  );
}

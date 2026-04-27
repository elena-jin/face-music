import { useEffect, useRef, useCallback } from 'react';
import type { Participant, ParticleEffect } from '../engine/types';

interface Props {
  participants: Participant[];
  effects: ParticleEffect[];
  highlightedId: string | null;
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
      const dx = a.nodeX * w - b.nodeX * w;
      const dy = a.nodeY * h - b.nodeY * h;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < CONNECTION_DIST) {
        const alpha = (1 - dist / CONNECTION_DIST) * 0.08;
        const grad = ctx.createLinearGradient(
          a.nodeX * w, a.nodeY * h,
          b.nodeX * w, b.nodeY * h
        );
        grad.addColorStop(0, `hsla(${a.hue}, 50%, 60%, ${alpha})`);
        grad.addColorStop(1, `hsla(${b.hue}, 50%, 60%, ${alpha})`);
        ctx.beginPath();
        ctx.moveTo(a.nodeX * w, a.nodeY * h);
        const midX = (a.nodeX * w + b.nodeX * w) / 2;
        const midY = (a.nodeY * h + b.nodeY * h) / 2 - 20;
        ctx.quadraticCurveTo(midX, midY, b.nodeX * w, b.nodeY * h);
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
    const x = p.nodeX * w;
    const y = p.nodeY * h;
    const isHighlighted = p.id === highlightedId;
    const pulse = Math.sin(time * 0.002 + p.hue) * 0.3 + 0.7;
    const r = isHighlighted ? NODE_RADIUS * 2 : NODE_RADIUS;

    // glow
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

    if (isHighlighted) {
      ctx.strokeStyle = `hsla(${p.hue}, 80%, 80%, 0.6)`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // mini face outline from stored landmarks
      if (p.landmarks && p.landmarks.length > 0) {
        drawMiniFace(ctx, p, x, y);
      }
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
  cy: number
) {
  const lm = p.landmarks;
  if (!lm || lm.length < 468) return;
  const scale = 60;
  const refX = lm[1].x;
  const refY = lm[1].y;
  const outline = [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365,
    379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93,
    234, 127, 162, 21, 54, 103, 67, 109, 10,
  ];

  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  for (let i = 0; i < outline.length; i++) {
    const pt = lm[outline[i]];
    if (!pt) continue;
    const x = cx + (pt.x - refX) * scale;
    const y = cy + (pt.y - refY) * scale;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = `hsla(${p.hue}, 60%, 70%, 0.6)`;
  ctx.lineWidth = 1;
  ctx.stroke();
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
  width,
  height,
  onHover,
  onClick,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animEffects = useRef<ParticleEffect[]>([]);

  useEffect(() => {
    animEffects.current = effects;
  }, [effects]);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      for (const p of participants) {
        const px = p.nodeX * width;
        const py = p.nodeY * height;
        const dist = Math.hypot(mx - px, my - py);
        if (dist < HOVER_RADIUS) {
          onHover(p.id);
          return;
        }
      }
      onHover(null);
    },
    [participants, width, height, onHover]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      for (const p of participants) {
        const px = p.nodeX * width;
        const py = p.nodeY * height;
        const dist = Math.hypot(mx - px, my - py);
        if (dist < HOVER_RADIUS) {
          onClick(p.id);
          return;
        }
      }
    },
    [participants, width, height, onClick]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf: number;
    const render = () => {
      animEffects.current = updateParticles(animEffects.current);
      drawConstellation(
        ctx,
        participants,
        animEffects.current,
        highlightedId,
        width,
        height,
        performance.now()
      );
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [participants, highlightedId, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="absolute inset-0"
      style={{ cursor: highlightedId ? 'pointer' : 'default' }}
      onPointerMove={handlePointerMove}
      onClick={handleClick}
    />
  );
}

import { useEffect, useRef, useCallback, useState } from 'react';
import type { Participant, ExpressionSnapshot } from '../engine/types';

interface Props {
  participants: Participant[];
  width: number;
  height: number;
  onPlaySound: (id: string) => void;
  onStopSound: (id: string) => void;
}

const NODE_RADIUS = 8;
const HOVER_RADIUS = 24;
const CONNECTION_DIST = 200;

const FACE_OUTLINE = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365,
  379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93,
  234, 127, 162, 21, 54, 103, 67, 109, 10,
];
const LEFT_EYE = [33, 160, 158, 133, 153, 144, 33];
const RIGHT_EYE = [362, 385, 387, 263, 373, 380, 362];
const LIPS_OUTER = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 61];

function drawFaceFromLandmarks(
  ctx: CanvasRenderingContext2D,
  landmarks: { x: number; y: number; z: number }[],
  cx: number,
  cy: number,
  scale: number,
  hue: number,
  alpha: number
) {
  if (!landmarks || landmarks.length < 468) return;
  const refX = landmarks[1].x;
  const refY = landmarks[1].y;

  const drawPath = (indices: number[], color: string, lineW: number) => {
    ctx.beginPath();
    for (let i = 0; i < indices.length; i++) {
      const pt = landmarks[indices[i]];
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

  drawPath(FACE_OUTLINE, `hsla(${hue}, 50%, 65%, ${alpha * 0.7})`, 1.2);
  drawPath(LEFT_EYE, `hsla(${hue}, 70%, 75%, ${alpha * 0.9})`, 1);
  drawPath(RIGHT_EYE, `hsla(${hue}, 70%, 75%, ${alpha * 0.9})`, 1);
  drawPath(LIPS_OUTER, `hsla(${hue}, 45%, 60%, ${alpha * 0.6})`, 0.8);
}

function formatTime(ts: number, baseTs: number): string {
  const ms = ts - baseTs;
  const sec = (ms / 1000).toFixed(1);
  return `+${sec}s`;
}

export default function GalleryView({
  participants,
  width,
  height,
  onPlaySound,
  onStopSound,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoveredExprIdx, setHoveredExprIdx] = useState(0);
  const hoveredIdRef = useRef<string | null>(null);
  const hoveredExprIdxRef = useRef(0);
  const positionsRef = useRef<Map<string, { x: number; y: number; vx: number; vy: number }>>(new Map());

  useEffect(() => {
    for (const p of participants) {
      if (!positionsRef.current.has(p.id)) {
        positionsRef.current.set(p.id, {
          x: p.nodeX * width,
          y: p.nodeY * height,
          vx: (Math.random() - 0.5) * 0.3,
          vy: (Math.random() - 0.5) * 0.3,
        });
      }
    }
  }, [participants, width, height]);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      for (const p of participants) {
        const pos = positionsRef.current.get(p.id);
        if (!pos) continue;
        const dist = Math.hypot(mx - pos.x, my - pos.y);
        if (dist < HOVER_RADIUS) {
          if (hoveredIdRef.current !== p.id) {
            if (hoveredIdRef.current) onStopSound(hoveredIdRef.current);
            hoveredIdRef.current = p.id;
            setHoveredId(p.id);
            hoveredExprIdxRef.current = 0;
            setHoveredExprIdx(0);
            onPlaySound(p.id);
          }
          return;
        }
      }
      if (hoveredIdRef.current) {
        onStopSound(hoveredIdRef.current);
        hoveredIdRef.current = null;
        setHoveredId(null);
      }
    },
    [participants, onPlaySound, onStopSound]
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      if (!hoveredIdRef.current) return;
      const p = participants.find((pp) => pp.id === hoveredIdRef.current);
      if (!p || !p.expressions || p.expressions.length === 0) return;
      const dir = e.deltaY > 0 ? 1 : -1;
      const next = Math.max(0, Math.min(p.expressions.length - 1, hoveredExprIdxRef.current + dir));
      hoveredExprIdxRef.current = next;
      setHoveredExprIdx(next);
    },
    [participants]
  );

  const onStopSoundRef = useRef(onStopSound);
  onStopSoundRef.current = onStopSound;

  useEffect(() => {
    return () => {
      if (hoveredIdRef.current) {
        onStopSoundRef.current(hoveredIdRef.current);
      }
    };
  }, []);

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
      ctx.clearRect(0, 0, width, height);

      // update positions with slow drift
      for (const [id, pos] of positionsRef.current) {
        pos.x += pos.vx;
        pos.y += pos.vy;
        if (pos.x < 40 || pos.x > width - 40) pos.vx *= -1;
        if (pos.y < 40 || pos.y > height - 40) pos.vy *= -1;
        pos.x = Math.max(40, Math.min(width - 40, pos.x));
        pos.y = Math.max(40, Math.min(height - 40, pos.y));

        // gentle repulsion
        for (const [otherId, otherPos] of positionsRef.current) {
          if (id === otherId) continue;
          const dx = pos.x - otherPos.x;
          const dy = pos.y - otherPos.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 60 && dist > 0) {
            const force = 0.05 * (60 - dist) / dist;
            pos.vx += dx * force;
            pos.vy += dy * force;
          }
        }

        const speed = Math.hypot(pos.vx, pos.vy);
        if (speed > 0.5) {
          pos.vx *= 0.5 / speed;
          pos.vy *= 0.5 / speed;
        }
      }

      // connection lines
      ctx.save();
      const pList = participants;
      for (let i = 0; i < pList.length; i++) {
        const posA = positionsRef.current.get(pList[i].id);
        if (!posA) continue;
        for (let j = i + 1; j < pList.length; j++) {
          const posB = positionsRef.current.get(pList[j].id);
          if (!posB) continue;
          const dist = Math.hypot(posA.x - posB.x, posA.y - posB.y);
          if (dist < CONNECTION_DIST) {
            const alpha = (1 - dist / CONNECTION_DIST) * 0.06;
            ctx.beginPath();
            ctx.moveTo(posA.x, posA.y);
            ctx.lineTo(posB.x, posB.y);
            const grad = ctx.createLinearGradient(posA.x, posA.y, posB.x, posB.y);
            grad.addColorStop(0, `hsla(${pList[i].hue}, 40%, 55%, ${alpha})`);
            grad.addColorStop(1, `hsla(${pList[j].hue}, 40%, 55%, ${alpha})`);
            ctx.strokeStyle = grad;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
      ctx.restore();

      const time = performance.now();
      const currentHoveredId = hoveredIdRef.current;
      const currentExprIdx = hoveredExprIdxRef.current;

      // draw nodes
      for (const p of participants) {
        const pos = positionsRef.current.get(p.id);
        if (!pos) continue;
        const isHovered = p.id === currentHoveredId;
        const pulse = Math.sin(time * 0.002 + p.hue) * 0.3 + 0.7;
        const r = isHovered ? NODE_RADIUS * 1.8 : NODE_RADIUS * pulse;

        // glow
        const glowR = isHovered ? 40 : 16;
        const glowA = isHovered ? 0.35 : 0.08 * pulse;
        const glow = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, glowR);
        glow.addColorStop(0, `hsla(${p.hue}, 65%, 60%, ${glowA})`);
        glow.addColorStop(1, `hsla(${p.hue}, 65%, 60%, 0)`);
        ctx.fillStyle = glow;
        ctx.fillRect(pos.x - glowR, pos.y - glowR, glowR * 2, glowR * 2);

        // circle
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue}, 55%, 60%, ${isHovered ? 0.9 : 0.45 * pulse})`;
        ctx.fill();

        if (isHovered) {
          ctx.strokeStyle = `hsla(${p.hue}, 75%, 75%, 0.6)`;
          ctx.lineWidth = 1.5;
          ctx.stroke();

          // draw expression face
          const expressions = p.expressions ?? [];
          const exprToShow = expressions.length > 0
            ? expressions[Math.min(currentExprIdx, expressions.length - 1)]
            : null;
          const landmarksToUse = exprToShow ? exprToShow.landmarks : p.landmarks;
          drawFaceFromLandmarks(ctx, landmarksToUse, pos.x, pos.y - 50, 120, p.hue, 0.8);

          // expression info
          if (exprToShow) {
            ctx.save();
            ctx.font = '9px monospace';
            ctx.textAlign = 'center';
            ctx.fillStyle = `hsla(${p.hue}, 50%, 70%, 0.7)`;
            const timeLabel = formatTime(exprToShow.timestamp, p.timestamp);
            ctx.fillText(timeLabel, pos.x, pos.y + r + 14);
            if (expressions.length > 1) {
              ctx.fillStyle = `hsla(${p.hue}, 40%, 60%, 0.4)`;
              ctx.fillText(`${currentExprIdx + 1}/${expressions.length}  scroll to browse`, pos.x, pos.y + r + 26);
            }
            ctx.restore();
          }

          // expression bar indicators
          if (exprToShow) {
            const barY = pos.y + r + 32;
            const barW = 50;
            const bars = [
              { label: 'mouth', val: exprToShow.mouthOpen },
              { label: 'brow', val: exprToShow.eyebrowRaise },
              { label: 'smile', val: exprToShow.smile / 4 },
            ];
            ctx.save();
            for (let bi = 0; bi < bars.length; bi++) {
              const bx = pos.x - barW / 2;
              const by = barY + bi * 10;
              ctx.fillStyle = `hsla(${p.hue}, 30%, 50%, 0.15)`;
              ctx.fillRect(bx, by, barW, 4);
              ctx.fillStyle = `hsla(${p.hue}, 60%, 65%, 0.5)`;
              ctx.fillRect(bx, by, barW * Math.min(bars[bi].val, 1), 4);
              ctx.font = '7px monospace';
              ctx.fillStyle = `hsla(${p.hue}, 40%, 60%, 0.4)`;
              ctx.textAlign = 'right';
              ctx.fillText(bars[bi].label, bx - 4, by + 4);
            }
            ctx.restore();
          }
        }
      }

      // ambient particles
      ctx.save();
      for (let i = 0; i < 30; i++) {
        const px = ((Math.sin(time * 0.0002 + i * 1.7) + 1) / 2) * width;
        const py = ((Math.cos(time * 0.00015 + i * 2.3) + 1) / 2) * height;
        ctx.beginPath();
        ctx.arc(px, py, 0.7, 0, Math.PI * 2);
        ctx.fillStyle = 'hsla(200, 25%, 65%, 0.04)';
        ctx.fill();
      }
      ctx.restore();

      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [participants, width, height]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0"
      onPointerMove={handlePointerMove}
      onWheel={handleWheel}
      style={{ width, height, cursor: hoveredId ? 'pointer' : 'default' }}
    />
  );
}

import { useEffect, useRef, useCallback } from 'react';
import type { TrackedFace } from '../engine/types';

interface Props {
  faces: TrackedFace[];
  getFade: (face: TrackedFace) => number;
  width: number;
  height: number;
}

const FACE_MESH_OUTLINE = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379,
  378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127,
  162, 21, 54, 103, 67, 109, 10,
];

const LEFT_EYE = [33, 160, 158, 133, 153, 144, 33];
const RIGHT_EYE = [362, 385, 387, 263, 373, 380, 362];
const LIPS_OUTER = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 61];
const NOSE_BRIDGE = [168, 6, 197, 195, 5];

function drawFaceMesh(
  ctx: CanvasRenderingContext2D,
  face: TrackedFace,
  fade: number,
  w: number,
  h: number
) {
  const lm = face.landmarks;
  if (!lm || lm.length === 0) return;

  const alpha = fade * 0.8;
  const hue = face.hue;

  ctx.save();

  const drawPath = (indices: number[], stroke: string, lineW: number, fill?: string) => {
    ctx.beginPath();
    for (let i = 0; i < indices.length; i++) {
      const pt = lm[indices[i]];
      if (!pt) continue;
      const x = pt.x * w;
      const y = pt.y * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineW;
    ctx.stroke();
  };

  drawPath(FACE_MESH_OUTLINE, `hsla(${hue}, 60%, 70%, ${alpha * 0.6})`, 1.5);
  drawPath(LEFT_EYE, `hsla(${hue}, 80%, 80%, ${alpha * 0.9})`, 1.2);
  drawPath(RIGHT_EYE, `hsla(${hue}, 80%, 80%, ${alpha * 0.9})`, 1.2);
  drawPath(LIPS_OUTER, `hsla(${hue}, 50%, 60%, ${alpha * 0.5})`, 1);
  drawPath(NOSE_BRIDGE, `hsla(${hue}, 40%, 60%, ${alpha * 0.4})`, 0.8);

  const keyPoints = [1, 33, 263, 61, 291, 10, 152];
  for (const idx of keyPoints) {
    const pt = lm[idx];
    if (!pt) continue;
    const x = pt.x * w;
    const y = pt.y * h;
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${hue}, 90%, 85%, ${alpha})`;
    ctx.fill();
  }

  const scatterIndices = [0, 4, 5, 6, 8, 9, 13, 14, 17, 33, 46, 52, 55, 61, 64,
    70, 78, 80, 82, 87, 91, 93, 95, 103, 105, 107, 109, 127, 132, 133,
    136, 144, 148, 149, 150, 152, 153, 154, 155, 157, 158, 159, 160, 161,
    162, 163, 168, 172, 176, 178, 181, 185, 195, 197, 234, 249, 251, 259,
    263, 267, 269, 270, 276, 282, 284, 288, 291, 293, 295, 297, 300, 308,
    310, 312, 314, 317, 321, 323, 324, 332, 334, 336, 338, 340, 346, 352,
    356, 361, 362, 365, 373, 375, 377, 378, 379, 380, 381, 382, 384, 385,
    386, 387, 388, 389, 390, 397, 398, 400, 402, 405, 409, 413, 454];

  for (const idx of scatterIndices) {
    const pt = lm[idx];
    if (!pt) continue;
    ctx.beginPath();
    ctx.arc(pt.x * w, pt.y * h, 0.8, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${hue}, 50%, 70%, ${alpha * 0.25})`;
    ctx.fill();
  }

  ctx.restore();
}

function drawConnectionLines(
  ctx: CanvasRenderingContext2D,
  faces: TrackedFace[],
  getFade: (f: TrackedFace) => number,
  w: number,
  h: number
) {
  const active = faces.filter((f) => f.active);
  if (active.length < 2) return;

  ctx.save();
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      const fadeA = getFade(a);
      const fadeB = getFade(b);
      const alpha = Math.min(fadeA, fadeB) * 0.15;

      const x1 = a.centerX * w;
      const y1 = a.centerY * h;
      const x2 = b.centerX * w;
      const y2 = b.centerY * h;

      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;

      const grad = ctx.createLinearGradient(x1, y1, x2, y2);
      grad.addColorStop(0, `hsla(${a.hue}, 60%, 60%, ${alpha})`);
      grad.addColorStop(1, `hsla(${b.hue}, 60%, 60%, ${alpha})`);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(midX, midY - 30, x2, y2);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 0.8;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(midX, midY - 15, 2, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(0, 0%, 100%, ${alpha * 0.5})`;
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawScanLine(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  time: number
) {
  const y = (time * 0.03) % h;
  const grad = ctx.createLinearGradient(0, y - 40, 0, y + 40);
  grad.addColorStop(0, 'hsla(200, 80%, 70%, 0)');
  grad.addColorStop(0.5, 'hsla(200, 80%, 70%, 0.04)');
  grad.addColorStop(1, 'hsla(200, 80%, 70%, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, y - 40, w, 80);
}

export default function SignalCanvas({
  faces,
  getFade,
  width,
  height,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timeRef = useRef(0);
  const rafRef = useRef<number>(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    drawScanLine(ctx, width, height, timeRef.current);
    drawConnectionLines(ctx, faces, getFade, width, height);

    for (const face of faces) {
      const fade = getFade(face);
      if (fade > 0) {
        drawFaceMesh(ctx, face, fade, width, height);
      }
    }

    timeRef.current++;
    rafRef.current = requestAnimationFrame(draw);
  }, [faces, getFade, width, height]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height }}
      className="absolute inset-0 pointer-events-none z-10"
    />
  );
}

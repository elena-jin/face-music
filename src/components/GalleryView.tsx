import { useEffect, useRef, useCallback, useState } from 'react';
import type { Participant, ExpressionSnapshot } from '../engine/types';
import { HandTracker, type HandPoint } from '../engine/HandTracker';

interface Props {
  participants: Participant[];
  width: number;
  height: number;
  onPlaySound: (id: string) => void;
  onStopSound: (id: string) => void;
  videoStream: MediaStream | null;
}

const NODE_RADIUS = 10;
const HOVER_RADIUS = 32;
const CONNECTION_DIST = 250;
const CONDUCT_RADIUS = 80;

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
  videoStream,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoveredExprIdx, setHoveredExprIdx] = useState(0);
  const hoveredIdRef = useRef<string | null>(null);
  const hoveredExprIdxRef = useRef(0);
  const positionsRef = useRef<Map<string, { x: number; y: number; vx: number; vy: number }>>(new Map());
  const handTrackerRef = useRef<HandTracker | null>(null);
  const fingertipsRef = useRef<HandPoint[]>([]);
  const conductedIdsRef = useRef<Set<string>>(new Set());
  const faceImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const handTrackingActiveRef = useRef(false);

  // Initialize hand tracker
  useEffect(() => {
    const tracker = new HandTracker();
    handTrackerRef.current = tracker;
    tracker.init().then(() => {
      handTrackingActiveRef.current = true;
    }).catch(() => {
      // hand tracking not available, fall back to mouse
    });
    return () => {
      handTrackingActiveRef.current = false;
      tracker.destroy();
    };
  }, []);

  // Connect video stream
  useEffect(() => {
    if (videoRef.current && videoStream) {
      videoRef.current.srcObject = videoStream;
      videoRef.current.play().catch(() => {});
    }
  }, [videoStream]);

  // Initialize positions with spatial splattering
  useEffect(() => {
    for (const p of participants) {
      if (!positionsRef.current.has(p.id)) {
        // Golden angle distribution for organic spread
        const idx = positionsRef.current.size;
        const angle = idx * 2.399963; // golden angle in radians
        const radius = 0.15 + Math.sqrt(idx / Math.max(participants.length, 10)) * 0.32;
        const cx = 0.5 + Math.cos(angle) * radius;
        const cy = 0.5 + Math.sin(angle) * radius;
        positionsRef.current.set(p.id, {
          x: Math.max(60, Math.min(width - 60, cx * width)),
          y: Math.max(60, Math.min(height - 60, cy * height)),
          vx: (Math.random() - 0.5) * 0.2,
          vy: (Math.random() - 0.5) * 0.2,
        });
      }
      if (p.faceSnapshot && !faceImagesRef.current.has(p.id)) {
        const img = new Image();
        img.src = p.faceSnapshot;
        faceImagesRef.current.set(p.id, img);
      }
    }
  }, [participants, width, height]);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (handTrackingActiveRef.current) return; // hand tracking handles interaction
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
  const onPlaySoundRef = useRef(onPlaySound);
  onPlaySoundRef.current = onPlaySound;

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
    let lastHandDetect = 0;

    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      // Hand tracking every ~50ms
      const now = performance.now();
      if (
        handTrackingActiveRef.current &&
        handTrackerRef.current?.isReady() &&
        videoRef.current &&
        videoRef.current.readyState >= 2 &&
        now - lastHandDetect > 50
      ) {
        lastHandDetect = now;
        try {
          fingertipsRef.current = handTrackerRef.current.detect(videoRef.current, now);
        } catch {
          fingertipsRef.current = [];
        }
      }

      // Convert fingertip normalized coords to canvas coords (mirrored)
      const fingers = fingertipsRef.current.map(fp => ({
        x: (1 - fp.x) * width,
        y: fp.y * height,
      }));

      // Conduct: fingers grab and move nearby nodes
      const newConducted = new Set<string>();
      for (const finger of fingers) {
        for (const p of participants) {
          const pos = positionsRef.current.get(p.id);
          if (!pos) continue;
          const dx = pos.x - finger.x;
          const dy = pos.y - finger.y;
          const dist = Math.hypot(dx, dy);
          if (dist < CONDUCT_RADIUS) {
            newConducted.add(p.id);
            if (dist < 30) {
              // Very close: drag node with finger
              pos.x += (finger.x - pos.x) * 0.3;
              pos.y += (finger.y - pos.y) * 0.3;
              pos.vx *= 0.5;
              pos.vy *= 0.5;
            } else if (dist > 0) {
              // Push node away from finger
              const force = (CONDUCT_RADIUS - dist) / CONDUCT_RADIUS * 3;
              pos.vx += (dx / dist) * force;
              pos.vy += (dy / dist) * force;
            }
          }
        }
      }

      // Trigger/stop sounds based on conducting
      for (const id of newConducted) {
        if (!conductedIdsRef.current.has(id)) {
          onPlaySoundRef.current(id);
        }
      }
      for (const id of conductedIdsRef.current) {
        if (!newConducted.has(id)) {
          onStopSoundRef.current(id);
        }
      }
      conductedIdsRef.current = newConducted;

      // Update positions with drift
      for (const [id, pos] of positionsRef.current) {
        pos.x += pos.vx;
        pos.y += pos.vy;
        if (pos.x < 50 || pos.x > width - 50) pos.vx *= -0.8;
        if (pos.y < 50 || pos.y > height - 50) pos.vy *= -0.8;
        pos.x = Math.max(50, Math.min(width - 50, pos.x));
        pos.y = Math.max(50, Math.min(height - 50, pos.y));

        // Gentle repulsion between nodes
        for (const [otherId, otherPos] of positionsRef.current) {
          if (id === otherId) continue;
          const dx = pos.x - otherPos.x;
          const dy = pos.y - otherPos.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 80 && dist > 0) {
            const force = 0.03 * (80 - dist) / dist;
            pos.vx += dx * force;
            pos.vy += dy * force;
          }
        }

        // Damping
        pos.vx *= 0.96;
        pos.vy *= 0.96;
        // Random gentle drift
        pos.vx += (Math.random() - 0.5) * 0.02;
        pos.vy += (Math.random() - 0.5) * 0.02;
      }

      // Connection lines
      ctx.save();
      for (let i = 0; i < participants.length; i++) {
        const posA = positionsRef.current.get(participants[i].id);
        if (!posA) continue;
        for (let j = i + 1; j < participants.length; j++) {
          const posB = positionsRef.current.get(participants[j].id);
          if (!posB) continue;
          const dist = Math.hypot(posA.x - posB.x, posA.y - posB.y);
          if (dist < CONNECTION_DIST) {
            const alpha = (1 - dist / CONNECTION_DIST) * 0.06;
            ctx.beginPath();
            ctx.moveTo(posA.x, posA.y);
            ctx.lineTo(posB.x, posB.y);
            const grad = ctx.createLinearGradient(posA.x, posA.y, posB.x, posB.y);
            grad.addColorStop(0, `hsla(${participants[i].hue}, 40%, 55%, ${alpha})`);
            grad.addColorStop(1, `hsla(${participants[j].hue}, 40%, 55%, ${alpha})`);
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

      // Draw nodes
      for (const p of participants) {
        const pos = positionsRef.current.get(p.id);
        if (!pos) continue;
        const isConducted = conductedIdsRef.current.has(p.id);
        const isHovered = p.id === currentHoveredId || isConducted;
        const pulse = Math.sin(time * 0.002 + p.hue) * 0.3 + 0.7;

        // Glow
        const glowR = isHovered ? 50 : 20;
        const glowA = isHovered ? 0.5 : 0.1 * pulse;
        const glow = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, glowR);
        glow.addColorStop(0, `hsla(${p.hue}, 65%, 60%, ${glowA})`);
        glow.addColorStop(1, `hsla(${p.hue}, 65%, 60%, 0)`);
        ctx.fillStyle = glow;
        ctx.fillRect(pos.x - glowR, pos.y - glowR, glowR * 2, glowR * 2);

        // Face photo or circle
        const img = faceImagesRef.current.get(p.id);
        if (img && img.complete && img.naturalWidth > 0) {
          const imgSize = isHovered ? 56 : 36;
          const imgAlpha = isHovered ? 0.95 : 0.7;
          ctx.save();
          ctx.globalAlpha = imgAlpha;
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, imgSize / 2, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(img, pos.x - imgSize / 2, pos.y - imgSize / 2, imgSize, imgSize);
          ctx.restore();
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, imgSize / 2, 0, Math.PI * 2);
          ctx.strokeStyle = `hsla(${p.hue}, 80%, 70%, ${isHovered ? 0.8 : 0.35})`;
          ctx.lineWidth = isHovered ? 2 : 1;
          ctx.stroke();
        } else {
          const r = isHovered ? NODE_RADIUS * 2 : NODE_RADIUS * pulse;
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
          ctx.fillStyle = `hsla(${p.hue}, 55%, 60%, ${isHovered ? 0.9 : 0.45 * pulse})`;
          ctx.fill();
          if (isHovered) {
            ctx.strokeStyle = `hsla(${p.hue}, 75%, 75%, 0.6)`;
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        }

        // Hovered: show expression details
        if (p.id === currentHoveredId && !isConducted) {
          const expressions = p.expressions ?? [];
          const exprToShow = expressions.length > 0
            ? expressions[Math.min(currentExprIdx, expressions.length - 1)]
            : null;
          const landmarksToUse = exprToShow ? exprToShow.landmarks : p.landmarks;
          drawFaceFromLandmarks(ctx, landmarksToUse, pos.x, pos.y - 50, 120, p.hue, 0.8);

          if (exprToShow) {
            ctx.save();
            ctx.font = '9px monospace';
            ctx.textAlign = 'center';
            ctx.fillStyle = `hsla(${p.hue}, 50%, 70%, 0.7)`;
            const timeLabel = formatTime(exprToShow.timestamp, p.timestamp);
            ctx.fillText(timeLabel, pos.x, pos.y + 30);
            if (expressions.length > 1) {
              ctx.fillStyle = `hsla(${p.hue}, 40%, 60%, 0.4)`;
              ctx.fillText(`${currentExprIdx + 1}/${expressions.length}  scroll to browse`, pos.x, pos.y + 42);
            }
            ctx.restore();
          }
        }
      }

      // Draw finger cursors
      for (const finger of fingers) {
        ctx.save();
        const fingerGlow = ctx.createRadialGradient(finger.x, finger.y, 0, finger.x, finger.y, CONDUCT_RADIUS);
        fingerGlow.addColorStop(0, 'hsla(40, 80%, 75%, 0.15)');
        fingerGlow.addColorStop(0.5, 'hsla(40, 70%, 65%, 0.05)');
        fingerGlow.addColorStop(1, 'hsla(40, 60%, 60%, 0)');
        ctx.fillStyle = fingerGlow;
        ctx.fillRect(finger.x - CONDUCT_RADIUS, finger.y - CONDUCT_RADIUS, CONDUCT_RADIUS * 2, CONDUCT_RADIUS * 2);

        ctx.beginPath();
        ctx.arc(finger.x, finger.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = 'hsla(40, 80%, 80%, 0.6)';
        ctx.fill();
        ctx.restore();
      }

      // Ambient particles
      ctx.save();
      for (let i = 0; i < 40; i++) {
        const px = ((Math.sin(time * 0.00015 + i * 1.7) + 1) / 2) * width;
        const py = ((Math.cos(time * 0.00012 + i * 2.3) + 1) / 2) * height;
        ctx.beginPath();
        ctx.arc(px, py, 0.8, 0, Math.PI * 2);
        ctx.fillStyle = 'hsla(200, 25%, 65%, 0.04)';
        ctx.fill();
      }
      ctx.restore();

      // Hand tracking hint
      if (fingers.length === 0 && participants.length > 0) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.font = '11px monospace';
        ctx.fillStyle = 'hsla(220, 20%, 70%, 0.25)';
        ctx.fillText('move your hands to conduct the sounds', width / 2, height - 30);
        ctx.restore();
      }

      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [participants, width, height]);

  return (
    <div className="absolute inset-0">
      {/* Hidden video for hand tracking */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover opacity-[0.12] grayscale scale-x-[-1] pointer-events-none"
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        onPointerMove={handlePointerMove}
        onWheel={handleWheel}
        style={{ width, height, cursor: hoveredId ? 'pointer' : 'default' }}
      />
    </div>
  );
}

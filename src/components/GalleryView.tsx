import { useEffect, useRef } from 'react';
import type { Participant } from '../engine/types';
import { HandTracker, type HandResult } from '../engine/HandTracker';

interface Props {
  participants: Participant[];
  width: number;
  height: number;
  onPlaySound: (id: string) => void;
  onStopSound: (id: string) => void;
  videoStream: MediaStream | null;
}

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const PUSH_RADIUS = 100;
const NODE_SIZE = 14;
const NODE_SIZE_ACTIVE = 20;

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
  const nodesRef = useRef<Map<string, Node>>(new Map());
  const handTrackerRef = useRef<HandTracker | null>(null);
  const handResultRef = useRef<HandResult>({ hands: [], fingertips: [] });
  const handActiveRef = useRef(false);
  const faceImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const activeSoundsRef = useRef<Set<string>>(new Set());
  const boxHoldStartRef = useRef<number>(0);

  const onPlayRef = useRef(onPlaySound);
  onPlayRef.current = onPlaySound;
  const onStopRef = useRef(onStopSound);
  onStopRef.current = onStopSound;

  // Init hand tracker
  useEffect(() => {
    const tracker = new HandTracker();
    handTrackerRef.current = tracker;
    tracker.init().then(() => { handActiveRef.current = true; }).catch(() => {});
    return () => { handActiveRef.current = false; tracker.destroy(); };
  }, []);

  // Connect video
  useEffect(() => {
    if (videoRef.current && videoStream) {
      videoRef.current.srcObject = videoStream;
      videoRef.current.play().catch(() => {});
    }
  }, [videoStream]);

  // Init nodes — spread like a curtain across the entire screen
  useEffect(() => {
    const count = participants.length;
    if (count === 0) return;
    for (let i = 0; i < count; i++) {
      const p = participants[i];
      if (nodesRef.current.has(p.id)) continue;

      // Grid-like curtain spread with randomness
      const cols = Math.ceil(Math.sqrt(count * (width / height)));
      const rows = Math.ceil(count / cols);
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cellW = 1 / (cols + 1);
      const cellH = 1 / (rows + 1);

      nodesRef.current.set(p.id, {
        x: cellW * (col + 1) + (Math.random() - 0.5) * cellW * 0.6,
        y: cellH * (row + 1) + (Math.random() - 0.5) * cellH * 0.6,
        vx: (Math.random() - 0.5) * 0.15,
        vy: (Math.random() - 0.5) * 0.15,
      });

      if (p.faceSnapshot && !faceImagesRef.current.has(p.id)) {
        const img = new Image();
        img.src = p.faceSnapshot;
        faceImagesRef.current.set(p.id, img);
      }
    }
  }, [participants, width, height]);

  // Cleanup sounds on unmount
  useEffect(() => {
    return () => {
      for (const id of activeSoundsRef.current) onStopRef.current(id);
    };
  }, []);

  // Main render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf: number;
    let lastHandDetect = 0;

    const render = () => {
      const now = performance.now();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      // Hand tracking ~20fps
      if (
        handActiveRef.current &&
        handTrackerRef.current?.isReady() &&
        videoRef.current &&
        videoRef.current.readyState >= 2 &&
        now - lastHandDetect > 50
      ) {
        lastHandDetect = now;
        try {
          handResultRef.current = handTrackerRef.current.detect(videoRef.current, now);
        } catch {
          handResultRef.current = { hands: [], fingertips: [] };
        }
      }

      const hands = handResultRef.current.hands;

      // Two hands → box
      let box: Box | null = null;
      if (hands.length >= 2) {
        const ax = (1 - hands[0].indexTip.x) * width;
        const ay = hands[0].indexTip.y * height;
        const bx = (1 - hands[1].indexTip.x) * width;
        const by = hands[1].indexTip.y * height;
        box = {
          x1: Math.min(ax, bx),
          y1: Math.min(ay, by),
          x2: Math.max(ax, bx),
          y2: Math.max(ay, by),
        };
      }

      // Single hand fingertips in canvas coords
      const fingerPts: { x: number; y: number }[] = [];
      if (hands.length >= 1) {
        for (const hand of hands) {
          fingerPts.push(
            { x: (1 - hand.indexTip.x) * width, y: hand.indexTip.y * height },
            { x: (1 - hand.middleTip.x) * width, y: hand.middleTip.y * height },
            { x: (1 - hand.thumbTip.x) * width, y: hand.thumbTip.y * height },
          );
        }
      }

      // --- Physics: push nodes with fingers + gentle drift ---
      for (const [, node] of nodesRef.current) {
        // Finger push
        for (const fp of fingerPts) {
          const dx = node.x * width - fp.x;
          const dy = node.y * height - fp.y;
          const dist = Math.hypot(dx, dy);
          if (dist < PUSH_RADIUS && dist > 0) {
            const force = ((PUSH_RADIUS - dist) / PUSH_RADIUS) * 1.5;
            node.vx += (dx / dist) * force;
            node.vy += (dy / dist) * force;
          }
        }

        // Apply velocity
        node.x += node.vx / width;
        node.y += node.vy / height;

        // Damping
        node.vx *= 0.94;
        node.vy *= 0.94;

        // Gentle random drift
        node.vx += (Math.random() - 0.5) * 0.03;
        node.vy += (Math.random() - 0.5) * 0.03;

        // Wrap around edges (curtain feel)
        if (node.x < -0.02) node.x = 1.02;
        if (node.x > 1.02) node.x = -0.02;
        if (node.y < -0.02) node.y = 1.02;
        if (node.y > 1.02) node.y = -0.02;
      }

      // Repulsion between nearby nodes
      const entries = [...nodesRef.current.entries()];
      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          const a = entries[i][1];
          const b = entries[j][1];
          const dx = (a.x - b.x) * width;
          const dy = (a.y - b.y) * height;
          const dist = Math.hypot(dx, dy);
          if (dist < 40 && dist > 0) {
            const f = 0.15 * (40 - dist) / dist;
            a.vx += (dx / dist) * f;
            a.vy += (dy / dist) * f;
            b.vx -= (dx / dist) * f;
            b.vy -= (dy / dist) * f;
          }
        }
      }

      // --- Draw lace connections ---
      ctx.save();
      for (let i = 0; i < participants.length; i++) {
        const nA = nodesRef.current.get(participants[i].id);
        if (!nA) continue;
        const ax = nA.x * width;
        const ay = nA.y * height;

        for (let j = i + 1; j < participants.length; j++) {
          const nB = nodesRef.current.get(participants[j].id);
          if (!nB) continue;
          const bx = nB.x * width;
          const by = nB.y * height;
          const dist = Math.hypot(ax - bx, ay - by);
          if (dist < 150) {
            const alpha = (1 - dist / 150) * 0.08;
            const mx = (ax + bx) / 2 + Math.sin(now * 0.0003 + i + j) * 8;
            const my = (ay + by) / 2 + Math.cos(now * 0.0004 + i * j) * 8;
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.quadraticCurveTo(mx, my, bx, by);
            ctx.strokeStyle = `rgba(180, 190, 210, ${alpha})`;
            ctx.lineWidth = 0.4;
            ctx.stroke();
          }
        }
      }
      ctx.restore();

      // --- Draw face nodes ---
      const newActive = new Set<string>();

      for (const p of participants) {
        const node = nodesRef.current.get(p.id);
        if (!node) continue;
        const nx = node.x * width;
        const ny = node.y * height;

        // Is it inside the box?
        const insideBox = box !== null &&
          nx >= box.x1 && nx <= box.x2 &&
          ny >= box.y1 && ny <= box.y2;

        // Is a finger near it?
        let fingerNear = false;
        for (const fp of fingerPts) {
          if (Math.hypot(nx - fp.x, ny - fp.y) < PUSH_RADIUS * 0.6) {
            fingerNear = true;
            break;
          }
        }

        const activated = insideBox || fingerNear;
        if (activated) newActive.add(p.id);

        const size = activated ? NODE_SIZE_ACTIVE : NODE_SIZE;
        const pulse = 1 + Math.sin(now * 0.003 + p.hue * 0.1) * 0.04;
        const s = size * pulse;

        // Tiny glow
        if (activated) {
          const gR = s * 3;
          const glow = ctx.createRadialGradient(nx, ny, s * 0.3, nx, ny, gR);
          glow.addColorStop(0, `hsla(${p.hue}, 30%, 60%, 0.15)`);
          glow.addColorStop(1, `hsla(${p.hue}, 20%, 50%, 0)`);
          ctx.fillStyle = glow;
          ctx.fillRect(nx - gR, ny - gR, gR * 2, gR * 2);
        }

        // Face image — small like asterisks
        const img = faceImagesRef.current.get(p.id);
        if (img && img.complete && img.naturalWidth > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(nx, ny, s, 0, Math.PI * 2);
          ctx.clip();

          if (insideBox) {
            ctx.filter = 'invert(1) grayscale(0.2)';
          } else {
            ctx.filter = 'grayscale(0.5)';
          }
          ctx.globalAlpha = activated ? 0.9 : 0.55;
          ctx.drawImage(img, nx - s, ny - s, s * 2, s * 2);
          ctx.filter = 'none';
          ctx.restore();
        } else {
          // Tiny asterisk dot
          ctx.save();
          ctx.beginPath();
          ctx.arc(nx, ny, s * 0.4, 0, Math.PI * 2);
          ctx.fillStyle = `hsla(${p.hue}, 20%, 55%, ${activated ? 0.6 : 0.2})`;
          ctx.fill();
          // Cross lines for asterisk feel
          ctx.strokeStyle = `hsla(${p.hue}, 15%, 50%, ${activated ? 0.4 : 0.1})`;
          ctx.lineWidth = 0.5;
          for (let a = 0; a < 3; a++) {
            const ang = (a / 3) * Math.PI;
            ctx.beginPath();
            ctx.moveTo(nx + Math.cos(ang) * s * 0.8, ny + Math.sin(ang) * s * 0.8);
            ctx.lineTo(nx - Math.cos(ang) * s * 0.8, ny - Math.sin(ang) * s * 0.8);
            ctx.stroke();
          }
          ctx.restore();
        }
      }

      // --- Sound management ---
      for (const id of newActive) {
        if (!activeSoundsRef.current.has(id)) {
          onPlayRef.current(id);
        }
      }
      for (const id of activeSoundsRef.current) {
        if (!newActive.has(id)) {
          onStopRef.current(id);
        }
      }
      activeSoundsRef.current = newActive;

      // --- Web connections between faces inside box ---
      if (box && newActive.size > 1) {
        // Track hold duration
        if (boxHoldStartRef.current === 0) boxHoldStartRef.current = now;
        const holdSec = (now - boxHoldStartRef.current) / 1000;
        const holdIntensity = Math.min(holdSec / 3, 1); // ramps up over 3 seconds
        const pulseWave = 1 + Math.sin(now * 0.004 * (1 + holdIntensity)) * 0.3 * holdIntensity;

        const activeList = participants.filter(p => newActive.has(p.id));
        ctx.save();
        for (let i = 0; i < activeList.length; i++) {
          const nA = nodesRef.current.get(activeList[i].id);
          if (!nA) continue;
          const ax = nA.x * width;
          const ay = nA.y * height;
          for (let j = i + 1; j < activeList.length; j++) {
            const nB = nodesRef.current.get(activeList[j].id);
            if (!nB) continue;
            const bx = nB.x * width;
            const by = nB.y * height;
            const dist = Math.hypot(ax - bx, ay - by);
            const baseAlpha = Math.min(0.5, 100 / Math.max(dist, 1));
            const alpha = baseAlpha * (0.4 + holdIntensity * 0.6) * pulseWave;

            // Curved aesthetic web line
            const mx = (ax + bx) / 2 + Math.sin(now * 0.001 + i * 0.7 + j * 1.3) * 15;
            const my = (ay + by) / 2 + Math.cos(now * 0.0012 + j * 0.9 + i * 1.1) * 15;
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.quadraticCurveTo(mx, my, bx, by);
            const hue = (activeList[i].hue + activeList[j].hue) / 2;
            ctx.strokeStyle = `hsla(${hue}, 40%, 68%, ${alpha})`;
            ctx.lineWidth = 0.6 + holdIntensity * 1.8;
            ctx.stroke();

            // Dot at midpoint grows with hold
            const dotR = 1 + holdIntensity * 2.5;
            ctx.beginPath();
            ctx.arc(mx, my, dotR, 0, Math.PI * 2);
            ctx.fillStyle = `hsla(${hue}, 35%, 72%, ${alpha * 0.7})`;
            ctx.fill();
          }
        }
        ctx.restore();
      } else {
        boxHoldStartRef.current = 0;
      }

      // Hand fingertip glows
      for (const fp of fingerPts) {
        ctx.save();
        const g = ctx.createRadialGradient(fp.x, fp.y, 0, fp.x, fp.y, 18);
        g.addColorStop(0, 'rgba(200, 215, 240, 0.1)');
        g.addColorStop(1, 'rgba(200, 215, 240, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(fp.x - 18, fp.y - 18, 36, 36);
        ctx.restore();
      }

      // Ambient dust
      ctx.save();
      for (let i = 0; i < 25; i++) {
        const t = now * 0.000015;
        const px = ((Math.sin(t * (1.1 + i * 0.09) + i * 2.1) + 1) / 2) * width;
        const py = ((Math.cos(t * (0.8 + i * 0.07) + i * 3.3) + 1) / 2) * height;
        ctx.beginPath();
        ctx.arc(px, py, 0.4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(180, 190, 210, 0.025)';
        ctx.fill();
      }
      ctx.restore();

      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [participants, width, height]);

  return (
    <div className="absolute inset-0 bg-black">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover opacity-[0.18] grayscale scale-x-[-1] pointer-events-none"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/60 pointer-events-none" />
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{ width, height }}
      />
    </div>
  );
}

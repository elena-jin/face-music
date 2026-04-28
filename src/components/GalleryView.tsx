import { useEffect, useRef } from 'react';
import type { Participant } from '../engine/types';
import { HandTracker, type HandData, type HandResult } from '../engine/HandTracker';

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
  angle: number;
  orbitR: number;
  orbitSpeed: number;
}

interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
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
  const nodesRef = useRef<Map<string, Node>>(new Map());
  const handTrackerRef = useRef<HandTracker | null>(null);
  const handResultRef = useRef<HandResult>({ hands: [], fingertips: [] });
  const handActiveRef = useRef(false);
  const faceImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const boxSoundsRef = useRef<Set<string>>(new Set());

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

  // Init nodes in lace pattern
  useEffect(() => {
    const count = participants.length;
    for (let i = 0; i < count; i++) {
      const p = participants[i];
      if (nodesRef.current.has(p.id)) continue;

      // Lace: concentric rings with offset
      const ring = Math.floor(Math.sqrt(i));
      const posInRing = i - ring * ring;
      const ringCount = Math.max(1, 2 * ring + 1);
      const angleBase = (posInRing / ringCount) * Math.PI * 2;
      const angleOffset = ring % 2 === 0 ? 0 : Math.PI / ringCount;
      const angle = angleBase + angleOffset;
      const radius = 0.08 + ring * 0.08;

      nodesRef.current.set(p.id, {
        x: 0.5 + Math.cos(angle) * Math.min(radius, 0.4),
        y: 0.5 + Math.sin(angle) * Math.min(radius, 0.4),
        vx: 0,
        vy: 0,
        angle,
        orbitR: Math.min(radius, 0.4),
        orbitSpeed: (0.0001 + Math.random() * 0.0002) * (Math.random() > 0.5 ? 1 : -1),
      });

      if (p.faceSnapshot && !faceImagesRef.current.has(p.id)) {
        const img = new Image();
        img.src = p.faceSnapshot;
        faceImagesRef.current.set(p.id, img);
      }
    }
  }, [participants]);

  // Cleanup conducted sounds on unmount
  useEffect(() => {
    return () => {
      for (const id of boxSoundsRef.current) onStopRef.current(id);
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

      // Hand tracking
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

      // Determine box from two hands (use index fingertips as corners)
      let box: Box | null = null;
      if (hands.length >= 2) {
        const h0 = hands[0];
        const h1 = hands[1];
        // Use index fingertip of each hand as opposite corners of the box
        const ax = (1 - h0.indexTip.x) * width;
        const ay = h0.indexTip.y * height;
        const bx = (1 - h1.indexTip.x) * width;
        const by = h1.indexTip.y * height;
        box = {
          x1: Math.min(ax, bx),
          y1: Math.min(ay, by),
          x2: Math.max(ax, bx),
          y2: Math.max(ay, by),
        };
      }

      // Update node positions — gentle drift + lace connections
      for (const [_id, node] of nodesRef.current) {
        // Orbital drift
        node.angle += node.orbitSpeed;
        const tx = 0.5 + Math.cos(node.angle) * node.orbitR;
        const ty = 0.5 + Math.sin(node.angle) * node.orbitR;
        node.vx += (tx - node.x) * 0.0005;
        node.vy += (ty - node.y) * 0.0005;

        // Gentle random drift
        node.vx += (Math.random() - 0.5) * 0.00005;
        node.vy += (Math.random() - 0.5) * 0.00005;

        node.x += node.vx;
        node.y += node.vy;
        node.vx *= 0.99;
        node.vy *= 0.99;

        node.x = Math.max(0.05, Math.min(0.95, node.x));
        node.y = Math.max(0.05, Math.min(0.95, node.y));
      }

      // Repulsion between nodes
      const nodeEntries = [...nodesRef.current.entries()];
      for (let i = 0; i < nodeEntries.length; i++) {
        for (let j = i + 1; j < nodeEntries.length; j++) {
          const [, a] = nodeEntries[i];
          const [, b] = nodeEntries[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 0.08 && dist > 0) {
            const f = 0.00005 * (0.08 - dist) / dist;
            a.vx += dx * f;
            a.vy += dy * f;
            b.vx -= dx * f;
            b.vy -= dy * f;
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

        // Connect to nearby nodes
        for (let j = i + 1; j < participants.length; j++) {
          const nB = nodesRef.current.get(participants[j].id);
          if (!nB) continue;
          const bx = nB.x * width;
          const by = nB.y * height;
          const dist = Math.hypot(ax - bx, ay - by);
          const threshold = 200;
          if (dist < threshold) {
            const alpha = (1 - dist / threshold) * 0.12;
            // Curved lace line
            const mx = (ax + bx) / 2 + Math.sin(now * 0.0003 + i + j) * 15;
            const my = (ay + by) / 2 + Math.cos(now * 0.0004 + i * j) * 15;
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.quadraticCurveTo(mx, my, bx, by);
            ctx.strokeStyle = `rgba(180, 190, 210, ${alpha})`;
            ctx.lineWidth = 0.6;
            ctx.stroke();
          }
        }
      }
      ctx.restore();

      // --- Draw face nodes ---
      const newBoxSounds = new Set<string>();

      for (const p of participants) {
        const node = nodesRef.current.get(p.id);
        if (!node) continue;
        const nx = node.x * width;
        const ny = node.y * height;

        // Check if inside box
        const insideBox = box &&
          nx >= box.x1 && nx <= box.x2 &&
          ny >= box.y1 && ny <= box.y2;

        if (insideBox) {
          newBoxSounds.add(p.id);
        }

        const size = insideBox ? 34 : 26;
        const pulse = 1 + Math.sin(now * 0.002 + p.hue) * 0.03;
        const finalSize = size * pulse;

        // Glow halo
        const glowR = finalSize * 2;
        const glow = ctx.createRadialGradient(nx, ny, finalSize * 0.3, nx, ny, glowR);
        glow.addColorStop(0, `hsla(${p.hue}, 25%, 55%, ${insideBox ? 0.2 : 0.06})`);
        glow.addColorStop(1, `hsla(${p.hue}, 20%, 45%, 0)`);
        ctx.fillStyle = glow;
        ctx.fillRect(nx - glowR, ny - glowR, glowR * 2, glowR * 2);

        // Face image
        const img = faceImagesRef.current.get(p.id);
        if (img && img.complete && img.naturalWidth > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(nx, ny, finalSize, 0, Math.PI * 2);
          ctx.clip();

          if (insideBox) {
            // Inverted colors
            ctx.filter = 'invert(1) grayscale(0.3)';
          } else {
            ctx.filter = 'grayscale(0.6)';
          }
          ctx.globalAlpha = insideBox ? 0.95 : 0.7;
          ctx.drawImage(img, nx - finalSize, ny - finalSize, finalSize * 2, finalSize * 2);
          ctx.filter = 'none';
          ctx.restore();

          // Soft border ring
          ctx.save();
          ctx.beginPath();
          ctx.arc(nx, ny, finalSize, 0, Math.PI * 2);
          ctx.strokeStyle = `hsla(${p.hue}, 20%, 60%, ${insideBox ? 0.4 : 0.1})`;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.restore();
        } else {
          // Fallback orb
          ctx.save();
          ctx.beginPath();
          ctx.arc(nx, ny, finalSize * 0.6, 0, Math.PI * 2);
          ctx.fillStyle = `hsla(${p.hue}, 20%, 50%, ${insideBox ? 0.6 : 0.25})`;
          ctx.fill();
          ctx.restore();
        }
      }

      // --- Sound triggering from box ---
      for (const id of newBoxSounds) {
        if (!boxSoundsRef.current.has(id)) {
          onPlayRef.current(id);
        }
      }
      for (const id of boxSoundsRef.current) {
        if (!newBoxSounds.has(id)) {
          onStopRef.current(id);
        }
      }
      boxSoundsRef.current = newBoxSounds;

      // --- Draw box between two hands ---
      if (box && hands.length >= 2) {
        const bw = box.x2 - box.x1;
        const bh = box.y2 - box.y1;

        // Box outline with subtle glow
        ctx.save();
        ctx.strokeStyle = 'rgba(200, 210, 230, 0.25)';
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(box.x1, box.y1, bw, bh);
        ctx.setLineDash([]);

        // Subtle fill inside box
        ctx.fillStyle = 'rgba(180, 200, 230, 0.03)';
        ctx.fillRect(box.x1, box.y1, bw, bh);
        ctx.restore();

        // Draw palm points as soft glows
        for (const hand of hands) {
          const px = (1 - hand.indexTip.x) * width;
          const py = hand.indexTip.y * height;
          ctx.save();
          const hGlow = ctx.createRadialGradient(px, py, 0, px, py, 25);
          hGlow.addColorStop(0, 'rgba(200, 210, 230, 0.15)');
          hGlow.addColorStop(1, 'rgba(200, 210, 230, 0)');
          ctx.fillStyle = hGlow;
          ctx.fillRect(px - 25, py - 25, 50, 50);
          ctx.restore();
        }

        // Draw connecting lines between hand points
        ctx.save();
        const corners = [
          { x: box.x1, y: box.y1 },
          { x: box.x2, y: box.y1 },
          { x: box.x2, y: box.y2 },
          { x: box.x1, y: box.y2 },
        ];
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i <= 4; i++) {
          ctx.lineTo(corners[i % 4].x, corners[i % 4].y);
        }
        ctx.strokeStyle = 'rgba(200, 220, 250, 0.12)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
        ctx.restore();
      } else if (hands.length === 1) {
        // Single hand: show soft glow at fingertips
        const hand = hands[0];
        const tips = [hand.indexTip, hand.middleTip, hand.thumbTip];
        for (const tip of tips) {
          const tx = (1 - tip.x) * width;
          const ty = tip.y * height;
          ctx.save();
          const tGlow = ctx.createRadialGradient(tx, ty, 0, tx, ty, 20);
          tGlow.addColorStop(0, 'rgba(200, 210, 230, 0.1)');
          tGlow.addColorStop(1, 'rgba(200, 210, 230, 0)');
          ctx.fillStyle = tGlow;
          ctx.fillRect(tx - 20, ty - 20, 40, 40);
          ctx.restore();
        }
      }

      // Ambient dust particles
      ctx.save();
      for (let i = 0; i < 30; i++) {
        const t = now * 0.00002;
        const px = ((Math.sin(t * (1.2 + i * 0.08) + i * 1.9) + 1) / 2) * width;
        const py = ((Math.cos(t * (0.9 + i * 0.06) + i * 3.1) + 1) / 2) * height;
        ctx.beginPath();
        ctx.arc(px, py, 0.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(180, 190, 210, 0.03)';
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
      {/* Camera background — visible but dark */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover opacity-[0.15] grayscale scale-x-[-1] pointer-events-none"
      />
      {/* Dark overlay to deepen camera feed */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/50 to-black/70 pointer-events-none" />
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{ width, height }}
      />
    </div>
  );
}

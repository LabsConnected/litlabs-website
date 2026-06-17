'use client';
import { useEffect, useState } from 'react';

/**
 * Shared synthwave animated background — stars, orbs, grid, vignette.
 * Used on Home, Social, and any full-screen retro-style pages.
 */
export default function RetroBackground() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const stars = Array.from({ length: 50 }, (_, i) => ({
    id: i,
    left: `${((i * 1973) % 100)}%`,
    top: `${((i * 3119) % 60)}%`,
    size: (i % 3) + 1,
    delay: (i % 3),
    duration: (i % 2) + 2,
  }));

  const orbs = [
    { color: '#ff00a0', size: 300, left: '10%', top: '20%', duration: 15 },
    { color: '#00f0ff', size: 250, left: '70%', top: '60%', duration: 18 },
    { color: '#00ff41', size: 200, left: '40%', top: '80%', duration: 20 },
    { color: '#ff6b6b', size: 180, left: '85%', top: '10%', duration: 12 },
  ];

  if (!mounted) return null;

  return (
    <div
      className="fixed inset-0 pointer-events-none z-0 overflow-hidden"
      style={{ background: 'linear-gradient(180deg, #0a0a12 0%, #151520 50%, #1a0a1a 100%)' }}
    >
      {/* Stars */}
      {stars.map((star) => (
        <div
          key={star.id}
          className="absolute rounded-full"
          style={{
            left: star.left,
            top: star.top,
            width: star.size,
            height: star.size,
            background: '#fff',
            boxShadow: `0 0 ${star.size * 4}px ${star.size}px rgba(255,255,255,0.5)`,
            animation: `retro-twinkle ${star.duration}s ease-in-out ${star.delay}s infinite`,
            opacity: 0.3,
          }}
        />
      ))}

      {/* Gradient orbs */}
      {orbs.map((orb, i) => (
        <div
          key={i}
          className="absolute rounded-full"
          style={{
            width: orb.size,
            height: orb.size,
            left: orb.left,
            top: orb.top,
            background: `radial-gradient(circle, ${orb.color}40 0%, ${orb.color}10 40%, transparent 70%)`,
            filter: 'blur(40px)',
            animation: `retro-float ${orb.duration}s ease-in-out infinite`,
          }}
        />
      ))}

      {/* Synthwave grid */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `
            linear-gradient(to bottom, transparent 0%, #0a0a12 100%),
            linear-gradient(rgba(0,240,255,0.4) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,0,160,0.3) 1px, transparent 1px)
          `,
          backgroundSize: '100% 100%, 60px 60px, 60px 60px',
          perspective: '500px',
          transform: 'rotateX(60deg) translateY(-100px)',
          transformOrigin: 'center top',
          animation: 'retro-grid 8s linear infinite',
          opacity: 0.4,
        }}
      />

      {/* Subtle overlay grid */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
          backgroundSize: '100px 100px',
        }}
      />

      {/* Vignette */}
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at center, transparent 0%, rgba(10,10,18,0.8) 100%)' }}
      />

      <style jsx>{`
        @keyframes retro-twinkle {
          0%, 100% { opacity: 0.2; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(1.5); }
        }
        @keyframes retro-float {
          0%, 100% { transform: translate(0, 0) scale(1); }
          25% { transform: translate(30px, -30px) scale(1.1); }
          50% { transform: translate(0, -60px) scale(1); }
          75% { transform: translate(-30px, -30px) scale(0.9); }
        }
        @keyframes retro-grid {
          0% { background-position: 0 0, 0 0, 0 0; }
          100% { background-position: 0 0, 0 60px, 0 60px; }
        }
      `}</style>
    </div>
  );
}

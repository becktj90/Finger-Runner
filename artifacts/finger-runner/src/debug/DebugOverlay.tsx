import React from 'react';

interface DebugMetrics {
  fps: number;
  gameRunning: boolean;
  lane: number;
  laneVisual: number;
  score: number;
  activeEntities: number;
}

export function DebugOverlay({ metrics }: { metrics: DebugMetrics }) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 10,
        left: 10,
        background: 'rgba(0, 0, 0, 0.8)',
        color: '#00ff00',
        fontFamily: 'monospace',
        fontSize: '12px',
        padding: '10px',
        zIndex: 1000,
        lineHeight: '1.6',
        pointerEvents: 'none',
      }}
    >
      <div>FPS: {metrics.fps}</div>
      <div>Running: {metrics.gameRunning ? 'YES' : 'NO'}</div>
      <div>Lane: {metrics.lane}</div>
      <div>Lane Visual: {metrics.laneVisual.toFixed(2)}</div>
      <div>Score: {Math.floor(metrics.score)}</div>
      <div>Entities: {metrics.activeEntities}</div>
      <div style={{ marginTop: '10px', fontSize: '10px', color: '#ffff00' }}>
        Arrow Keys / A/D to move
      </div>
    </div>
  );
}

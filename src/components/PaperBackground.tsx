import React from 'react';
import type { PaperType } from '../types';

interface PaperBackgroundProps {
  type: PaperType;
  lineHeightPx: number;
  paddingTop: number;
  marginLeft: number;
}

const PaperBackground: React.FC<PaperBackgroundProps> = ({
  type,
  lineHeightPx,
  paddingTop,
  marginLeft,
}) => {
  if (type === 'plain') return null;

  if (type === 'lined') {
    // Generate horizontal lines from paddingTop, spaced lineHeightPx apart
    const lineCount = 80;
    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          overflow: 'hidden',
        }}
      >
        {/* Margin line */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: marginLeft,
            width: 2,
            backgroundColor: 'rgba(239, 68, 68, 0.4)',
          }}
        />
        {/* Ruled lines */}
        {Array.from({ length: lineCount }).map((_, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: paddingTop + i * lineHeightPx,
              height: 1,
              backgroundColor: 'rgba(147, 197, 253, 0.7)',
            }}
          />
        ))}
      </div>
    );
  }

  if (type === 'grid') {
    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          backgroundImage: `
            linear-gradient(rgba(147,197,253,0.4) 1px, transparent 1px),
            linear-gradient(90deg, rgba(147,197,253,0.4) 1px, transparent 1px)
          `,
          backgroundSize: `${lineHeightPx}px ${lineHeightPx}px`,
          backgroundPosition: `0 ${paddingTop}px`,
        }}
      />
    );
  }

  if (type === 'cream') {
    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          backgroundColor: 'rgba(254,249,235,0.6)',
        }}
      />
    );
  }

  return null;
};

export default PaperBackground;

import React from 'react';

/* Halfsies. A receipt torn across the middle: the lower half slides right and
   tips over, so the two edges no longer line up. Both tear edges are cut on the
   same phase, which keeps the gap between them even down at favicon size. */

const TOP = 'M17 9a5 5 0 0 1 5-5h14a5 5 0 0 1 5 5v22l-4 2-4-2-4 2-4-2-4 2-4-2z';
const BOTTOM = 'M17 35l4 2 4-2 4 2 4-2 4 2 4-2v17a5 5 0 0 1-5 5H22a5 5 0 0 1-5-5z';

const TONES = {
  dark: { top: '#1D4ED8', bottom: '#3B82F6', line: '#ffffff', lineOpacity: 0.7, fade: 1 },
  light: { top: '#ffffff', bottom: '#ffffff', line: '#1D4ED8', lineOpacity: 0.5, fade: 0.82 }
};

export function Mark({ size = 32, tone = 'dark', className }) {
  const c = TONES[tone] || TONES.dark;
  const rule = { stroke: c.line, strokeOpacity: c.lineOpacity, strokeWidth: 4, strokeLinecap: 'round', fill: 'none' };
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role="img" aria-label="Halfsies">
      <path d={TOP} fill={c.top} />
      <path d="M22 13h14M22 22h8" {...rule} />
      <g transform="translate(5 1) rotate(4 29 46)" opacity={c.fade}>
        <path d={BOTTOM} fill={c.bottom} />
        <path d="M22 43h14M22 50h8" {...rule} />
      </g>
    </svg>
  );
}

export function Wordmark({ onClick, tone = 'dark' }) {
  return (
    <button className="wordmark" onClick={onClick} type="button">
      <Mark size={26} tone={tone} />
      Halfsies
    </button>
  );
}

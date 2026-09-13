import React from 'react';
export { Mark, Wordmark } from './Logo.jsx';

/* Small pieces shared by every screen: avatars, icons, brand marks. */

// Eight fixed colors, picked so white initials stay legible on each.
export const PALETTE = [
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#dc2626',
  '#ea580c',
  '#a16207',
  '#059669',
  '#0891b2'
];

export function colorFor(index) {
  return PALETTE[((index % PALETTE.length) + PALETTE.length) % PALETTE.length];
}

export function initials(name) {
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0][0].toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export function Avatar({ name, index = 0, size }) {
  return (
    <span className={'av' + (size ? ' ' + size : '')} style={{ background: colorFor(index) }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export function AvatarStack({ people, max = 5 }) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className="avstack">
      {shown.map((p, i) => (
        <Avatar key={p.id || p.name + i} name={p.name} index={p.colorIndex ?? i} />
      ))}
      {rest > 0 && (
        <span className="av" style={{ background: 'var(--muted)' }} aria-hidden="true">
          +{rest}
        </span>
      )}
    </span>
  );
}

/* ---- icons. Stroked, 20px, they take the color of what they sit in. ---- */

const stroke = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true'
};

export const IconCamera = () => (
  <svg {...stroke}>
    <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.7l1.2-2h6.2l1.2 2h1.7A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z" />
    <circle cx="12" cy="12.5" r="3.4" />
  </svg>
);

export const IconType = () => (
  <svg {...stroke}>
    <rect x="3" y="6" width="18" height="12" rx="2.5" />
    <path d="M7 10h.01M11 10h.01M15 10h.01M8 14h8" />
  </svg>
);

export const IconShare = () => (
  <svg {...stroke}>
    <path d="M12 3v12M8 7l4-4 4 4" />
    <path d="M5 13v6a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-6" />
  </svg>
);

export const IconBack = () => (
  <svg {...stroke}>
    <path d="M15 5l-7 7 7 7" />
  </svg>
);

export const IconChevron = ({ open }) => (
  <svg {...stroke} width="16" height="16" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms ease-out' }}>
    <path d="M6 9.5l6 6 6-6" />
  </svg>
);

export const IconCheck = () => (
  <svg {...stroke} width="16" height="16" strokeWidth="2.4">
    <path d="M4.5 12.5l5 5 10-11" />
  </svg>
);

export const IconPlus = () => (
  <svg {...stroke}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

/* ---- payment brand marks. Drawn here, nothing is fetched. ---- */

const badge = (bg, glyph, letterSize = 12) => (
  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
    <rect width="20" height="20" rx="5" fill={bg} />
    {typeof glyph === 'string' ? (
      <text
        x="10"
        y="14.4"
        textAnchor="middle"
        fontFamily="Inter, sans-serif"
        fontSize={letterSize}
        fontWeight="700"
        fill="#ffffff"
      >
        {glyph}
      </text>
    ) : (
      glyph
    )}
  </svg>
);

export const MarkVenmo = () => badge('#008cff', 'V');
export const MarkCashApp = () => badge('#00d632', '$', 12.5);
export const MarkZelle = () => badge('#6d1ed4', 'Z');
export const MarkApplePay = () =>
  badge(
    '#000000',
    <path
      d="M13.1 11.3c0-1.4 1.1-2 1.2-2.1-.7-1-1.7-1.1-2.1-1.1-.9-.1-1.7.5-2.2.5s-1.1-.5-1.9-.5c-1 0-1.9.6-2.4 1.5-1 1.8-.3 4.4.7 5.8.5.7 1.1 1.5 1.8 1.5s1-.4 1.9-.4 1.1.4 1.9.4 1.2-.7 1.7-1.4c.5-.8.7-1.5.7-1.6 0 0-1.3-.5-1.3-2.6zM11.6 7.2c.4-.5.7-1.2.6-1.9-.6 0-1.3.4-1.7.9-.4.4-.7 1.2-.6 1.8.7.1 1.3-.3 1.7-.8z"
      fill="#ffffff"
    />
  );

export const BRANDS = [
  { key: 'venmo', label: 'Venmo', Mark: MarkVenmo },
  { key: 'cashapp', label: 'Cash App', Mark: MarkCashApp },
  { key: 'zelle', label: 'Zelle', Mark: MarkZelle },
  { key: 'applepay', label: 'Apple Pay', Mark: MarkApplePay }
];

/* ---- shell ---- */

export function Progress({ step, total = 5 }) {
  return (
    <div className="progress" role="progressbar" aria-valuenow={step} aria-valuemin={1} aria-valuemax={total} aria-label={`Step ${step} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < step ? 'on' : ''} />
      ))}
    </div>
  );
}

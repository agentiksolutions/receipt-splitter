import React from 'react';

const stroke = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  width: 18,
  height: 18,
  'aria-hidden': 'true'
};

// Fixed list. The key is what goes in rs_receipts.category.
export const CATEGORIES = [
  ['food', 'Food', () => (
    <svg {...stroke}>
      <path d="M5 3v8a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V3M7 13v8M17 3c-1.5 1.2-2 3-2 5s.5 2.5 2 2.5V21" />
    </svg>
  )],
  ['drinks', 'Drinks', () => (
    <svg {...stroke}>
      <path d="M5 4h14l-6 7v7M13 18h4M13 18H9" />
    </svg>
  )],
  ['groceries', 'Groceries', () => (
    <svg {...stroke}>
      <path d="M4 7h16l-1.5 11a2 2 0 0 1-2 1.8H7.5a2 2 0 0 1-2-1.8L4 7ZM9 7V5a3 3 0 0 1 6 0v2" />
    </svg>
  )],
  ['transportation', 'Transportation', () => (
    <svg {...stroke}>
      <path d="M4 15h16M6 15V9l2-4h8l2 4v6M7 19v-2M17 19v-2M8 12h1M15 12h1" />
    </svg>
  )],
  ['lodging', 'Lodging', () => (
    <svg {...stroke}>
      <path d="M3 20V9l9-5 9 5v11M9 20v-6h6v6" />
    </svg>
  )],
  ['activities', 'Activities', () => (
    <svg {...stroke}>
      <path d="M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6L3.4 9.4l6-.8L12 3Z" />
    </svg>
  )],
  ['other', 'Other', () => (
    <svg {...stroke}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2" />
    </svg>
  )]
];

const BY_KEY = new Map(CATEGORIES.map(([key, label, Glyph]) => [key, { label, Glyph }]));

export function categoryLabel(key) {
  return BY_KEY.get(key)?.label || 'Other';
}

export function CategoryGlyph({ category }) {
  const found = BY_KEY.get(category) || BY_KEY.get('other');
  const Glyph = found.Glyph;
  return <Glyph />;
}

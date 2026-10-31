import React from 'react';

// The five quick buttons. Always in reach on the screens you land on, so the
// thing you want next is one tap away instead of behind a menu.
//
// It is deliberately NOT shown inside a split or inside a trip. Those screens
// end in a bar naming the single next step ("Add people", "Photograph the
// receipt"), and that bar is the best part of the flow. Two bars stacked on a
// phone would bury it and leave the real action below the fold. Getting out is
// the back arrow those screens already carry.

const IconHome = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 10.5 12 3l9 7.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M5.5 9.5V20h13V9.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconTrips = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="7" width="18" height="13" rx="2.5" />
    <path d="M8.5 7V5.5A1.5 1.5 0 0 1 10 4h4a1.5 1.5 0 0 1 1.5 1.5V7" strokeLinecap="round" />
  </svg>
);

const IconFriends = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="9" cy="8.5" r="3.5" />
    <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" strokeLinecap="round" />
    <path d="M16.5 5.2a3.5 3.5 0 0 1 0 6.6M17.5 14.4c2.4.6 4 2.7 4 5.6" strokeLinecap="round" />
  </svg>
);

const IconMe = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 20c0-4 3.4-6.5 7.5-6.5s7.5 2.5 7.5 6.5" strokeLinecap="round" />
  </svg>
);

const TABS = [
  ['home', 'Home', IconHome],
  ['trips', 'Trips', IconTrips],
  ['friends', 'Friends', IconFriends],
  ['me', 'Me', IconMe]
];

/**
 * @param {string}   tab    which of home/trips/friends/me is showing
 * @param {function} onTab  called with the tab key
 * @param {function} onNew  the raised middle button: start a split
 */
export default function TabBar({ tab, onTab, onNew }) {
  // The middle button sits between the second and third tab, so the row is
  // built as two halves rather than five even columns.
  // createElement rather than <Glyph />: this repo's eslint has no React plugin,
  // so a component referenced only from JSX reads as an unused variable.
  const cell = ([key, label, Glyph]) => (
    <button
      key={key}
      type="button"
      className={'tab' + (tab === key ? ' on' : '')}
      aria-current={tab === key ? 'page' : undefined}
      onClick={() => onTab(key)}
    >
      {React.createElement(Glyph)}
      <span>{label}</span>
    </button>
  );

  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.slice(0, 2).map(cell)}
      <button type="button" className="tab-new" onClick={onNew} aria-label="New split">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2.4">
          <path d="M12 5v14M5 12h14" strokeLinecap="round" />
        </svg>
      </button>
      {TABS.slice(2).map(cell)}
    </nav>
  );
}

import React, { useCallback, useEffect, useRef, useState } from 'react';
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

export const IconMenu = () => (
  <svg {...stroke}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);

export const IconClose = () => (
  <svg {...stroke}>
    <path d="M6 6l12 12M18 6L6 18" />
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

export const IconPencil = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
);
export const IconPlus = () => (
  <svg {...stroke}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconUsers = () => (
  <svg {...stroke}>
    <circle cx="9.5" cy="8.5" r="3.2" />
    <path d="M3.5 19.5c0-3 2.7-4.8 6-4.8s6 1.8 6 4.8" />
    <path d="M16.2 6.1a3.2 3.2 0 0 1 0 5.6M17.5 15.2c2 .6 3.3 2.1 3.3 4.3" />
  </svg>
);

export const IconList = () => (
  <svg {...stroke}>
    <path d="M9 7h11M9 12h11M9 17h11" />
    <path d="M4.5 7h.01M4.5 12h.01M4.5 17h.01" />
  </svg>
);

/* ---- payment services ----------------------------------------------------
   No marks. Drawing a rounded square with a "V" in it is not Venmo's logo, it
   just looks enough like one to be wrong. The name in the brand colour is
   honest, reads at a glance, and costs nothing to render. The colour comes
   from a token so dark mode can lift it off a dark card. */

export const BRANDS = [
  { key: 'venmo', label: 'Venmo' },
  { key: 'cashapp', label: 'Cash App' },
  { key: 'paypal', label: 'PayPal' },
  { key: 'zelle', label: 'Zelle' },
  { key: 'applepay', label: 'Apple Cash' }
];

/* ---- shell ---- */


/* ---- toast ----------------------------------------------------------- */

// One toast at a time, addressed from anywhere. A context would mean threading
// a provider through five components to say one sentence.
let sink = null;

export function toast(text, action = null) {
  if (sink) sink({ text, action, key: Date.now() });
}

/**
 * The one chip. Plain is a button you turn on and off; removable is a container
 * carrying its own remove button. Both are 44 tall, both take on and disabled,
 * and a removable chip never loses its x.
 *
 * @param {boolean}  on        the pressed state
 * @param {boolean}  disabled  greyed and inert, remove button included
 * @param {?function} onClick  omit for a chip that is not itself a button
 * @param {?function} onRemove present makes the chip removable
 */
export function Chip({ on, disabled = false, onClick, onRemove, removeLabel, className = '', children, ...rest }) {
  const cls = 'chip' + (on ? ' on' : '') + (className ? ' ' + className : '');
  if (!onRemove) {
    return (
      <button
        type="button"
        className={cls}
        // A chip that is a plain action, like "Rest to Jordan", is not a toggle
        // and must not claim a pressed state it does not have.
        aria-pressed={on === undefined ? undefined : Boolean(on)}
        disabled={disabled}
        onClick={onClick}
        {...rest}
      >
        {children}
      </button>
    );
  }
  return (
    <span className={cls} {...rest}>
      {children}
      <button
        type="button"
        className="chip-x"
        disabled={disabled}
        onClick={onRemove}
        aria-label={removeLabel}
      >
        &times;
      </button>
    </span>
  );
}

export function Toaster() {
  const [note, setNote] = useState(null);
  const timer = useRef(null);

  useEffect(() => {
    sink = setNote;
    return () => {
      sink = null;
      clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    if (!note) return undefined;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setNote(null), 3000);
    return () => clearTimeout(timer.current);
  }, [note]);

  if (!note) return null;
  return (
    <div className="toast" role="status" aria-live="polite">
      <span>{note.text}</span>
      {note.action && (
        <button
          className="toast-do"
          onClick={() => {
            note.action.run();
            setNote(null);
          }}
        >
          {note.action.label}
        </button>
      )}
    </div>
  );
}

/* ---------- confirm sheet ---------------------------------------------- */

let asker = null;

/**
 * Stands in for window.confirm, which iOS draws as a system alert with the
 * site's domain across the top. Resolves true only when the action button is
 * pressed, so a call site reads `if (!(await confirmSheet(...))) return;`.
 *
 * @param {{title:string, line:string, confirm?:string, destructive?:boolean}} opts
 * @returns {Promise<boolean>}
 */
export function confirmSheet({ title, line, confirm = 'Delete', destructive = true }) {
  return new Promise((resolve) => {
    // No host mounted means nothing can be asked, and silently going ahead with
    // a delete would be the worst possible answer.
    if (!asker) {
      resolve(false);
      return;
    }
    asker({ title, line, confirm, destructive, resolve, key: Date.now() });
  });
}

export function ConfirmHost() {
  const [ask, setAsk] = useState(null);

  useEffect(() => {
    asker = setAsk;
    return () => {
      asker = null;
    };
  }, []);

  // Every way out of the sheet answers the promise. An unresolved one would
  // leave the caller awaiting for the life of the page.
  const answer = useCallback(
    (yes) => {
      ask?.resolve(yes);
      setAsk(null);
    },
    [ask]
  );

  useEffect(() => {
    if (!ask) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') answer(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ask, answer]);

  if (!ask) return null;
  return (
    <div className="ask-wrap" role="dialog" aria-modal="true" aria-label={ask.title}>
      <button className="ask-veil" aria-label="Cancel" onClick={() => answer(false)} />
      <div className="ask">
        <h2>{ask.title}</h2>
        <p>{ask.line}</p>
        <button
          className={'btn wide tall ' + (ask.destructive ? 'danger' : 'primary')}
          autoFocus
          onClick={() => answer(true)}
        >
          {ask.confirm}
        </button>
        <button className="btn ghost wide tall" onClick={() => answer(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Nothing here yet, and the one thing to do about it. An empty screen that just
 * says "none" leaves somebody stuck.
 */
export function EmptyState({ icon, line, action, onAction }) {
  return (
    <div className="empty-state">
      {icon && <span className="empty-icon">{icon}</span>}
      <p>{line}</p>
      {action && onAction && (
        <button className="btn outline" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  );
}

/** Grey bars in the shape of the rows that are coming, instead of the word
 *  "Loading". Decorative, so screen readers get the status line instead. */
export function Skeleton({ rows = 3, className = '' }) {
  return (
    <div className={'skeleton' + (className ? ' ' + className : '')} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div className="sk-row" key={i} aria-hidden="true">
          <span className="sk-line wide" />
          <span className="sk-line" />
        </div>
      ))}
    </div>
  );
}

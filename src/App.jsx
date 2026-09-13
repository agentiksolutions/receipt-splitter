import React, { useCallback, useEffect, useRef, useState } from 'react';
import Landing, { HowPage } from './components/Landing.jsx';
import Receipt from './components/Receipt.jsx';
import Trip from './components/Trip.jsx';
import Profile from './components/Profile.jsx';
import { historyIds, profile } from './lib/history.js';
import { ConfirmHost, IconClose, Toaster } from './components/ui.jsx';

// Vercel gives every branch its own permanent address, so the branch name is
// sitting in the hostname and nothing has to be configured to read it. The bar
// only appears off main. On the live site the test is false and this renders
// nothing, which is why it is safe to carry in the same code as production.
const STAGING = /-git-(?!main-)/.test(
  typeof window === 'undefined' ? '' : window.location.hostname
);

const readRoute = () => {
  const q = new URLSearchParams(window.location.search);
  return { id: q.get('receipt'), trip: q.get('trip'), page: q.get('page') };
};

export default function App() {
  // One page per split, so the route only ever carries which split, which trip,
  // or which marketing page, plus why we got here.
  const [route, setRoute] = useState(() => ({ ...readRoute(), intent: null, nonce: 0 }));
  const [menu, setMenu] = useState(false);
  // The very first open asks for a name, once. After that the profile is a menu
  // row. A split never waits on it: with no name you go on as "Me".
  const [showProfile, setShowProfile] = useState(() => !profile().name && historyIds().length === 0);
  const firstRun = useRef(!profile().name && historyIds().length === 0);

  useEffect(() => {
    const onPop = () => setRoute({ ...readRoute(), intent: null, nonce: Date.now() });
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    if (!menu) return undefined;
    const onKey = (e) => e.key === 'Escape' && setMenu(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);

  // One navigator for both parameters, so opening a split clears the page and
  // opening a page clears the split. Leaving either behind shows two screens.
  const go = useCallback((id, opts = {}) => {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('receipt', id);
    else url.searchParams.delete('receipt');
    if (opts.page) url.searchParams.set('page', opts.page);
    else url.searchParams.delete('page');
    if (opts.trip) url.searchParams.set('trip', opts.trip);
    else url.searchParams.delete('trip');
    window.history.pushState({}, '', url);
    setRoute({
      id: id || null,
      trip: opts.trip || null,
      page: opts.page || null,
      intent: opts.intent || null,
      // A fresh nonce remounts the home screen, so picking the same menu row
      // twice acts twice instead of going quiet the second time.
      nonce: Date.now()
    });
    window.scrollTo(0, 0);
    setMenu(false);
  }, []);

  const openMenu = useCallback(() => setMenu(true), []);

  // A split with no id yet is a split that has not been typed into. It is the
  // same page; the row appears under it on the first keystroke.
  const starting = !route.id && route.intent === 'new';

  let screen;
  if (route.id || starting) {
    screen = (
      <Receipt
        key={route.id ? 'r' + route.id : 'new' + route.nonce}
        receiptId={route.id}
        presetTrip={starting ? route.trip : null}
        onExit={() => go(null)}
        onMenu={openMenu}
        onOpenTrip={(t) => go(null, { trip: t })}
        onCreated={(id) => {
          // replaceState, not push, so Back from a brand new split goes home
          // rather than to the blank page it was a second ago.
          const url = new URL(window.location.href);
          url.searchParams.set('receipt', id);
          url.searchParams.delete('page');
          url.searchParams.delete('trip');
          window.history.replaceState({}, '', url);
        }}
      />
    );
  } else if (route.trip && route.intent !== 'new') {
    screen = (
      <Trip
        key={route.trip}
        tripId={route.trip}
        onExit={() => go(null)}
        onMenu={openMenu}
        onOpenSplit={(id) => go(id)}
        onNewSplit={(tripId) => go(null, { intent: 'new', trip: tripId })}
      />
    );
  } else if (route.page === 'how') {
    screen = <HowPage onStart={() => go(null, { intent: 'new' })} onHome={() => go(null)} onMenu={openMenu} />;
  } else {
    screen = (
      <Landing key={route.intent ? 'i' + route.nonce : 'home'} onOpen={go} onMenu={openMenu} intent={route.intent} />
    );
  }

  return (
    <div className={'app' + (STAGING ? ' app-staging' : '')}>
      {STAGING && (
        <div className="staging-bar" role="status">
          Test version. Bills here are not on the real app.
        </div>
      )}
      {screen}
      {showProfile && <Profile firstRun={firstRun.current} onClose={() => setShowProfile(false)} />}
      <Toaster />
      <ConfirmHost />
      <div className={'sheet-wrap' + (menu ? ' open' : '')} aria-hidden={!menu}>
        <button className="sheet-veil" tabIndex={-1} aria-label="Close menu" onClick={() => setMenu(false)} />
        <nav className="sheet" aria-label="Menu">
          <button className="icon-btn sheet-x" onClick={() => setMenu(false)} aria-label="Close menu">
            <IconClose />
          </button>
          <button className="sheet-row" onClick={() => go(null, { intent: 'new' })}>
            New split
          </button>
          <button className="sheet-row" onClick={() => go(null)}>
            My splits
          </button>
          <button className="sheet-row" onClick={() => go(null, { intent: 'archived' })}>
            Archived
          </button>
          <button
            className="sheet-row"
            onClick={() => {
              firstRun.current = false;
              setShowProfile(true);
              setMenu(false);
            }}
          >
            Your profile
          </button>
          <button className="sheet-row" onClick={() => go(null, { page: 'how' })}>
            How it works
          </button>
        </nav>
      </div>
    </div>
  );
}

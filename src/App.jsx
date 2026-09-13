import React, { useCallback, useEffect, useState } from 'react';
import Landing, { HowPage } from './components/Landing.jsx';
import Receipt from './components/Receipt.jsx';
import { IconClose } from './components/ui.jsx';

const readRoute = () => {
  const q = new URLSearchParams(window.location.search);
  return { id: q.get('receipt'), page: q.get('page') };
};

export default function App() {
  // wizard is true only for the tab that just created this receipt. Anyone
  // arriving on the link lands on the finished split instead of a stepper.
  const [route, setRoute] = useState(() => ({ ...readRoute(), wizard: false, intent: null }));
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    const onPop = () => setRoute({ ...readRoute(), wizard: false, intent: null });
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
    window.history.pushState({}, '', url);
    setRoute({
      id: id || null,
      page: opts.page || null,
      wizard: Boolean(opts.wizard),
      intent: opts.intent || null,
      // A fresh nonce remounts the home screen, so picking the same menu row
      // twice acts twice instead of going quiet the second time.
      nonce: Date.now()
    });
    window.scrollTo(0, 0);
    setMenu(false);
  }, []);

  const openMenu = useCallback(() => setMenu(true), []);

  let screen;
  if (route.id) {
    screen = (
      <Receipt
        key={route.id}
        receiptId={route.id}
        startWizard={route.wizard}
        onExit={() => go(null)}
        onMenu={openMenu}
      />
    );
  } else if (route.page === 'how') {
    screen = <HowPage onStart={() => go(null, { intent: 'new' })} onHome={() => go(null)} onMenu={openMenu} />;
  } else {
    screen = <Landing key={route.intent ? 'i' + route.nonce : 'home'} onOpen={go} onMenu={openMenu} intent={route.intent} />;
  }

  return (
    <div className="app">
      {screen}
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
          <button className="sheet-row" onClick={() => go(null, { page: 'how' })}>
            How it works
          </button>
        </nav>
      </div>
    </div>
  );
}

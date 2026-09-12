import React, { useCallback, useEffect, useState } from 'react';
import Landing from './components/Landing.jsx';
import Receipt from './components/Receipt.jsx';

const readId = () => new URLSearchParams(window.location.search).get('receipt');

export default function App() {
  // wizard is true only for the tab that just created this receipt. Anyone
  // arriving on the link lands on the finished split instead of a stepper.
  const [route, setRoute] = useState(() => ({ id: readId(), wizard: false }));

  useEffect(() => {
    const onPop = () => setRoute({ id: readId(), wizard: false });
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const go = useCallback((id, opts = {}) => {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('receipt', id);
    else url.searchParams.delete('receipt');
    window.history.pushState({}, '', url);
    setRoute({ id: id || null, wizard: Boolean(opts.wizard) });
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="app">
      {route.id ? (
        <Receipt key={route.id} receiptId={route.id} startWizard={route.wizard} onExit={() => go(null)} />
      ) : (
        <Landing onOpen={go} />
      )}
    </div>
  );
}

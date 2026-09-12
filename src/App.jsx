import React, { useCallback, useEffect, useState } from 'react';
import Landing from './components/Landing.jsx';
import Receipt from './components/Receipt.jsx';

const readId = () => new URLSearchParams(window.location.search).get('receipt');

export default function App() {
  const [receiptId, setReceiptId] = useState(readId);

  useEffect(() => {
    const onPop = () => setReceiptId(readId());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const go = useCallback((id) => {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('receipt', id);
    else url.searchParams.delete('receipt');
    window.history.pushState({}, '', url);
    setReceiptId(id || null);
    window.scrollTo(0, 0);
  }, []);

  return receiptId ? (
    <Receipt receiptId={receiptId} onExit={() => go(null)} />
  ) : (
    <Landing onOpen={go} />
  );
}

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { remember } from '../lib/history.js';
import { splitReceipt, money } from '../lib/money.js';
import { IconShare, Progress, Wordmark } from './ui.jsx';
import PeopleStep from './PeopleStep.jsx';
import ItemsStep from './ItemsStep.jsx';
import AssignStep from './AssignStep.jsx';
import SettleStep from './SettleStep.jsx';

// Which splits this device has already walked through the stepper. Reopening
// one lands on Settle instead of restarting the wizard.
const DONE_KEY = 'rs.done';

function doneIds() {
  try {
    const raw = JSON.parse(localStorage.getItem(DONE_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function markDone(id) {
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify([id, ...doneIds().filter((x) => x !== id)].slice(0, 100)));
  } catch {
    /* private mode: the wizard just runs again */
  }
}

const TABS = [
  ['items', 'Items'],
  ['people', 'People'],
  ['settle', 'Settle']
];

export default function Receipt({ receiptId, startWizard, onExit }) {
  const [receipt, setReceipt] = useState(null);
  const [people, setPeople] = useState([]);
  const [items, setItems] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | missing
  const [view, setView] = useState(null); // {mode:'wizard',step} | {mode:'tabs',tab}
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);

  const timer = useRef(null);
  const pending = useRef(0); // local writes in flight
  const itemIds = useRef(new Set());
  const flashTimer = useRef(null);

  const loadAll = useCallback(async () => {
    const [rec, ppl, its, asg] = await Promise.all([
      supabase.from('rs_receipts').select('*').eq('id', receiptId).maybeSingle(),
      supabase.from('rs_people').select('*').eq('receipt_id', receiptId).order('created_at'),
      supabase.from('rs_items').select('*').eq('receipt_id', receiptId).order('created_at'),
      supabase
        .from('rs_item_assignments')
        .select('item_id, person_id, rs_items!inner(receipt_id)')
        .eq('rs_items.receipt_id', receiptId)
    ]);
    if (rec.error) {
      setError(rec.error.message);
      setStatus('ready');
      return;
    }
    if (!rec.data) {
      setStatus('missing');
      return;
    }
    const itemRows = its.data || [];
    itemIds.current = new Set(itemRows.map((i) => i.id));
    setReceipt(rec.data);
    setPeople(ppl.data || []);
    setItems(itemRows);
    setAssignments((asg.data || []).map((a) => ({ item_id: a.item_id, person_id: a.person_id })));
    setStatus('ready');
    return { receipt: rec.data, people: ppl.data || [], items: itemRows };
  }, [receiptId]);

  // Realtime and bulk writes both arrive in bursts. One trailing refetch covers
  // the burst, and it waits while this device still has writes in flight.
  const refresh = useCallback(() => {
    clearTimeout(timer.current);
    const tick = () => {
      if (pending.current > 0) {
        timer.current = setTimeout(tick, 250);
        return;
      }
      loadAll();
    };
    timer.current = setTimeout(tick, 400);
  }, [loadAll]);

  // Every write goes through here so the debounced refetch can see it.
  const write = useCallback(async (fn) => {
    pending.current += 1;
    try {
      const { error: e } = (await fn()) || {};
      if (e) setError(e.message);
      return !e;
    } finally {
      pending.current -= 1;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    loadAll().then((first) => {
      if (!alive || !first) return;
      setView(decideView(receiptId, startWizard, first.people, first.items));
    });
    return () => {
      alive = false;
      clearTimeout(timer.current);
      clearTimeout(flashTimer.current);
    };
  }, [loadAll, receiptId, startWizard]);

  useEffect(() => {
    const channel = supabase
      .channel('rs:' + receiptId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rs_receipts', filter: 'id=eq.' + receiptId }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rs_people', filter: 'receipt_id=eq.' + receiptId }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rs_items', filter: 'receipt_id=eq.' + receiptId }, refresh)
      // Assignments carry no receipt_id, so this one cannot be filtered on the
      // server. Drop events for items that are not on this receipt.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rs_item_assignments' }, (payload) => {
        const id = payload.new?.item_id || payload.old?.item_id;
        if (id && !itemIds.current.has(id)) return;
        refresh();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [receiptId, refresh]);

  useEffect(() => {
    if (receipt?.id) remember(receipt.id);
  }, [receipt?.id]);

  const say = useCallback((text) => {
    setFlash(text);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 2600);
  }, []);

  /* ---- derived ---- */

  const crowd = useMemo(() => people.map((p, i) => ({ ...p, colorIndex: i })), [people]);

  const split = useMemo(
    () =>
      splitReceipt({
        people: crowd,
        items,
        assignments,
        taxAmount: receipt?.tax_amount,
        tipAmount: receipt?.tip_amount
      }),
    [crowd, items, assignments, receipt?.tax_amount, receipt?.tip_amount]
  );

  // One pass instead of a filter per item per render. 25 items and 3 people
  // used to mean thousands of array scans on every keystroke.
  const claimed = useMemo(() => {
    const map = new Map();
    for (const a of assignments) {
      let set = map.get(a.item_id);
      if (!set) map.set(a.item_id, (set = new Set()));
      set.add(a.person_id);
    }
    return map;
  }, [assignments]);

  const byPerson = useMemo(() => new Map(split.perPerson.map((s) => [s.id, s])), [split]);

  // payer_name is free text, so a rename or a duplicate name can leave it
  // pointing at nobody. Only treat it as a person when exactly one matches.
  const payerName = (receipt?.payer_name || '').trim();
  const payerMatches = crowd.filter((p) => p.name === payerName);
  const payer = payerMatches.length === 1 ? payerMatches[0] : null;

  const unassignedCount = split.unassignedItems.length;

  /* ---- actions ---- */

  const patchReceipt = useCallback(
    async (patch) => {
      setReceipt((r) => ({ ...r, ...patch }));
      await write(() => supabase.from('rs_receipts').update(patch).eq('id', receiptId));
      refresh();
    },
    [receiptId, refresh, write]
  );

  const addPeople = useCallback(
    async (names) => {
      const rows = names
        .map((n) => n.trim())
        .filter(Boolean)
        .map((name) => ({ receipt_id: receiptId, name }));
      if (!rows.length) return;
      await write(() => supabase.from('rs_people').insert(rows));
      refresh();
    },
    [receiptId, refresh, write]
  );

  const removePerson = useCallback(
    async (id) => {
      setPeople((prev) => prev.filter((p) => p.id !== id));
      setAssignments((prev) => prev.filter((a) => a.person_id !== id));
      await write(() => supabase.from('rs_people').delete().eq('id', id));
      refresh();
    },
    [refresh, write]
  );

  // One insert with an array, never a loop. A 25 line receipt is one round trip.
  const addItems = useCallback(
    async (rows) => {
      if (!rows.length) return false;
      const ok = await write(() =>
        supabase.from('rs_items').insert(rows.map((r) => ({ receipt_id: receiptId, name: r.name, price: r.price })))
      );
      refresh();
      return ok;
    },
    [receiptId, refresh, write]
  );

  const removeItem = useCallback(
    async (id) => {
      setItems((prev) => prev.filter((i) => i.id !== id));
      setAssignments((prev) => prev.filter((a) => a.item_id !== id));
      await write(() => supabase.from('rs_items').delete().eq('id', id));
      refresh();
    },
    [refresh, write]
  );

  const toggleAssign = useCallback(
    async (itemId, personId) => {
      const on = claimed.get(itemId)?.has(personId);
      setAssignments((prev) =>
        on
          ? prev.filter((a) => !(a.item_id === itemId && a.person_id === personId))
          : [...prev, { item_id: itemId, person_id: personId }]
      );
      await write(() =>
        on
          ? supabase.from('rs_item_assignments').delete().eq('item_id', itemId).eq('person_id', personId)
          : supabase.from('rs_item_assignments').insert({ item_id: itemId, person_id: personId })
      );
      refresh();
    },
    [claimed, refresh, write]
  );

  // Bulk assign. The primary key is (item_id, person_id), so a second press
  // would be a duplicate key and would fail the whole batch. Rows already held
  // are dropped locally, and the insert ignores anything that slipped through.
  const bulkAssign = useCallback(
    async (rows) => {
      const fresh = rows.filter((r) => !claimed.get(r.item_id)?.has(r.person_id));
      if (!fresh.length) return;
      setAssignments((prev) => [...prev, ...fresh]);
      await write(() =>
        supabase.from('rs_item_assignments').upsert(fresh, { onConflict: 'item_id,person_id', ignoreDuplicates: true })
      );
      refresh();
    },
    [claimed, refresh, write]
  );

  const splitEvenly = useCallback(() => {
    const rows = [];
    for (const it of items) for (const p of crowd) rows.push({ item_id: it.id, person_id: p.id });
    return bulkAssign(rows);
  }, [items, crowd, bulkAssign]);

  const restToPayer = useCallback(() => {
    if (!payer) return;
    return bulkAssign(split.unassignedItems.map((it) => ({ item_id: it.id, person_id: payer.id })));
  }, [payer, split.unassignedItems, bulkAssign]);

  const savePersonField = useCallback(
    async (id, key, value) => {
      const current = people.find((p) => p.id === id);
      if (!current || (current[key] || '') === value) return;
      setPeople((prev) => prev.map((p) => (p.id === id ? { ...p, [key]: value } : p)));
      await write(() => supabase.from('rs_people').update({ [key]: value }).eq('id', id));
      refresh();
    },
    [people, refresh, write]
  );

  const setSettled = useCallback(
    async (id, settled, via) => {
      setPeople((prev) => prev.map((p) => (p.id === id ? { ...p, settled, settled_via: via } : p)));
      await write(() => supabase.from('rs_people').update({ settled, settled_via: via }).eq('id', id));
      refresh();
    },
    [refresh, write]
  );

  const savePhoto = useCallback(
    async (blob) => {
      const path = receiptId + '/' + Date.now() + '.jpg';
      const up = await supabase.storage.from('receipt-photos').upload(path, blob, {
        upsert: true,
        contentType: 'image/jpeg'
      });
      if (up.error) {
        setError(up.error.message);
        return null;
      }
      const { data } = supabase.storage.from('receipt-photos').getPublicUrl(path);
      await patchReceipt({ photo_url: data.publicUrl });
      return data.publicUrl;
    },
    [receiptId, patchReceipt]
  );

  const shareUrl = typeof window === 'undefined' ? '' : window.location.href;

  const shareSplit = useCallback(async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: receipt?.title || 'Splitly', url: shareUrl });
      } catch {
        /* the sheet was closed */
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      say('Link copied.');
    } catch {
      say(shareUrl);
    }
  }, [receipt?.title, shareUrl, say]);

  const goStep = useCallback(
    (step) => {
      if (step > 5) {
        markDone(receiptId);
        setView({ mode: 'tabs', tab: 'settle' });
      } else {
        if (step === 5) markDone(receiptId);
        setView({ mode: 'wizard', step });
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [receiptId]
  );

  /* ---- render ---- */

  if (status === 'loading' || !view) {
    return (
      <div className="col plain">
        <header className="topbar">
          <Wordmark onClick={onExit} />
        </header>
        <p className="empty">Loading</p>
      </div>
    );
  }

  if (status === 'missing') {
    return (
      <div className="col plain">
        <header className="topbar">
          <Wordmark onClick={onExit} />
        </header>
        <div className="step">
          <h1>No split here</h1>
          <p className="sub">That link points at a split that does not exist, or one that has been deleted.</p>
          <button className="btn primary wide tall" style={{ marginTop: 20 }} onClick={onExit}>
            Back to my splits
          </button>
        </div>
      </div>
    );
  }

  const shared = {
    receipt,
    people: crowd,
    items,
    claimed,
    split,
    byPerson,
    payer,
    payerName,
    shareUrl,
    say,
    api: {
      patchReceipt,
      addPeople,
      removePerson,
      addItems,
      removeItem,
      toggleAssign,
      splitEvenly,
      restToPayer,
      savePersonField,
      setSettled,
      savePhoto
    }
  };

  const banner = (
    <>
      {flash && <p className="banner">{flash}</p>}
      {error && <p className="banner bad">{error}</p>}
    </>
  );

  const header = (
    <header className="topbar">
      <Wordmark onClick={onExit} />
      <button className="icon-btn" onClick={shareSplit} aria-label="Share this split">
        <IconShare />
      </button>
    </header>
  );

  if (view.mode === 'wizard') {
    return (
      <div className="col">
        {header}
        <Progress step={view.step} />
        {banner}
        <div className="step" key={view.step}>
          {view.step === 2 && <PeopleStep {...shared} onNext={() => goStep(3)} onBack={() => goStep(2)} />}
          {view.step === 3 && <ItemsStep {...shared} onNext={() => goStep(4)} onBack={() => goStep(2)} />}
          {view.step === 4 && <AssignStep {...shared} onNext={() => goStep(5)} onBack={() => goStep(3)} />}
          {view.step === 5 && <SettleStep {...shared} onDone={() => goStep(6)} onBack={() => goStep(4)} />}
        </div>
      </div>
    );
  }

  return (
    <div className="col">
      {header}
      <div className="step-head" style={{ marginBottom: 14 }}>
        <h1>{receipt.title || 'Untitled split'}</h1>
        <p className="sub">
          <span className="num">{money(split.grandCents)}</span> across {crowd.length}{' '}
          {crowd.length === 1 ? 'person' : 'people'}
          {unassignedCount > 0 ? ` with ${unassignedCount} unassigned` : ''}
        </p>
      </div>
      <div className="tabs" role="tablist">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={view.tab === key}
            className={view.tab === key ? 'on' : ''}
            onClick={() => setView({ mode: 'tabs', tab: key })}
          >
            {label}
          </button>
        ))}
      </div>
      {banner}
      <div className="step" key={view.tab}>
        {view.tab === 'items' && <AssignStep {...shared} embedded />}
        {view.tab === 'people' && <PeopleStep {...shared} embedded />}
        {view.tab === 'settle' && <SettleStep {...shared} embedded />}
      </div>
    </div>
  );
}

// Where to drop someone when the page opens.
function decideView(receiptId, startWizard, people, items) {
  if (startWizard) return { mode: 'wizard', step: 2 };
  if (doneIds().includes(receiptId)) return { mode: 'tabs', tab: 'settle' };
  // Somebody else already built this one out, so show the finished split.
  if (people.length >= 2 && items.length > 0) return { mode: 'tabs', tab: 'settle' };
  return { mode: 'wizard', step: people.length >= 2 ? 3 : 2 };
}

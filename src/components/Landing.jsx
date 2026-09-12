import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { splitReceipt, money } from '../lib/money.js';
import { historyIds, remember, forget } from '../lib/history.js';
import { AvatarStack, Progress, Wordmark } from './ui.jsx';

// Local calendar date. toISOString would hand back tomorrow after 8pm Eastern.
export function today() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function prettyDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return String(iso);
  const label = MONTHS[m - 1] + ' ' + d;
  return y === new Date().getFullYear() ? label : label + ', ' + y;
}

const RECENT_LIMIT = 12;

export default function Landing({ onOpen }) {
  const [splits, setSplits] = useState(null);
  const [naming, setNaming] = useState(false);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(today);
  const [payer, setPayer] = useState('Me');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const ids = historyIds().slice(0, RECENT_LIMIT);
    if (!ids.length) {
      setSplits([]);
      return;
    }
    const { data: receipts, error: e } = await supabase.from('rs_receipts').select('*').in('id', ids);
    if (e) {
      setError(e.message);
      setSplits([]);
      return;
    }
    const found = receipts || [];
    // Anything the database no longer has is gone for good, so stop listing it.
    for (const id of ids) if (!found.some((r) => r.id === id)) forget(id);

    const liveIds = found.map((r) => r.id);
    const [items, people] = await Promise.all([
      supabase.from('rs_items').select('id, receipt_id, name, price').in('receipt_id', liveIds),
      supabase.from('rs_people').select('id, receipt_id, name, settled').in('receipt_id', liveIds)
    ]);
    const itemRows = items.data || [];
    const peopleRows = people.data || [];
    const itemIds = itemRows.map((i) => i.id);
    const asg = itemIds.length
      ? await supabase.from('rs_item_assignments').select('item_id, person_id').in('item_id', itemIds)
      : { data: [] };
    const assignments = asg.data || [];

    const byId = new Map(found.map((r) => [r.id, r]));
    setSplits(
      ids
        .filter((id) => byId.has(id))
        .map((id) => {
          const receipt = byId.get(id);
          const mine = itemRows.filter((i) => i.receipt_id === id);
          const crowd = peopleRows.filter((p) => p.receipt_id === id);
          const owing = crowd.filter((p) => p.name !== (receipt.payer_name || '').trim());
          return {
            receipt,
            people: crowd,
            owing: owing.length,
            paid: owing.filter((p) => p.settled).length,
            split: splitReceipt({
              people: crowd,
              items: mine,
              assignments,
              taxAmount: receipt.tax_amount,
              tipAmount: receipt.tip_amount
            })
          };
        })
    );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    setBusy(true);
    setError(null);
    const name = payer.trim() || 'Me';
    const { data, error: e } = await supabase
      .from('rs_receipts')
      .insert({
        title: title.trim() || "Dinner at Joe's",
        event_date: date || today(),
        payer_name: name
      })
      .select()
      .single();
    if (e) {
      setBusy(false);
      setError(e.message);
      return;
    }
    // The payer is matched by name text, so the person row and payer_name have
    // to be the same bytes. Written here, once, from the same variable.
    const p = await supabase.from('rs_people').insert({ receipt_id: data.id, name });
    setBusy(false);
    if (p.error) {
      setError(p.error.message);
      return;
    }
    remember(data.id);
    onOpen(data.id, { wizard: true });
  }

  if (naming) {
    return (
      <div className="col">
        <header className="topbar">
          <Wordmark onClick={() => setNaming(false)} />
        </header>
        <Progress step={1} />
        <div className="step">
          <div className="step-head">
            <p className="step-count">Step 1 of 5</p>
            <h1>Name it</h1>
            <p className="sub">A name and a date, so you can find this again later.</p>
          </div>

          {error && <p className="banner bad">{error}</p>}

          <div className="card">
            <label className="field">
              <span>What was it</span>
              <input
                type="text"
                value={title}
                placeholder="Dinner at Joe's"
                autoFocus
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Date</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="field">
              <span>Who paid</span>
              <input
                type="text"
                value={payer}
                placeholder="Me"
                onChange={(e) => setPayer(e.target.value)}
              />
            </label>
          </div>
          <p className="tiny">Whoever paid gets added to the split, and everyone else settles up with them.</p>
        </div>

        <div className="dock">
          <button className="btn primary wide tall" onClick={create} disabled={busy}>
            {busy ? 'Setting up' : 'Continue'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="col">
      <header className="topbar">
        <Wordmark onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} />
      </header>

      <div className="splash">
        <h1 className="h-xl">Everyone pays for what they ordered.</h1>
        <p className="sub">
          Snap the receipt or type it in, tap who had what, and everyone gets their own number with tax and tip
          already worked in.
        </p>
      </div>

      {error && <p className="banner bad">{error}</p>}

      <h2 style={{ margin: '8px 0 12px' }}>Recent splits</h2>
      <RecentList splits={splits} onOpen={onOpen} />

      <div className="dock">
        <button className="btn primary wide tall" onClick={() => setNaming(true)}>
          New split
        </button>
      </div>
    </div>
  );
}

function RecentList({ splits, onOpen }) {
  const rows = useMemo(() => splits || [], [splits]);

  if (splits === null) return <p className="empty">Loading</p>;
  if (!rows.length) return <p className="empty">Your splits show up here once you start one.</p>;

  return (
    <div className="recent">
      {rows.map((t) => (
        <a
          key={t.receipt.id}
          className="recent-card"
          href={'?receipt=' + t.receipt.id}
          onClick={(e) => {
            e.preventDefault();
            onOpen(t.receipt.id);
          }}
        >
          <div className="top">
            <span className="title">{t.receipt.title || 'Untitled split'}</span>
            <span className="total num">{money(t.split.grandCents)}</span>
          </div>
          <div className="when">{prettyDate(t.receipt.event_date)}</div>
          <div className="bottom">
            <AvatarStack people={t.people} />
            {t.owing > 0 ? (
              <span className={'paid' + (t.paid === t.owing ? ' all' : '')}>
                {t.paid === t.owing ? 'All settled' : `${t.paid} of ${t.owing} paid`}
              </span>
            ) : (
              <span className="paid">
                {t.people.length} {t.people.length === 1 ? 'person' : 'people'}
              </span>
            )}
          </div>
        </a>
      ))}
    </div>
  );
}

import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { splitReceipt, money } from '../lib/money.js';
import { historyIds, remember, forget } from '../lib/history.js';

const today = () => new Date().toISOString().slice(0, 10);

// Three shares that actually add up, so the sample tally is not a lie.
const DEMO = [
  ['Lee', 2418],
  ['Dana', 1944],
  ['Phil', 3102]
];

export default function Landing({ onOpen }) {
  const [trips, setTrips] = useState(null);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(today);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const ids = historyIds();
    if (!ids.length) {
      setTrips([]);
      return;
    }
    const { data: receipts, error: e } = await supabase.from('rs_receipts').select('*').in('id', ids);
    if (e) {
      setError(e.message);
      setTrips([]);
      return;
    }

    const found = receipts || [];
    // Anything the database no longer has is gone for good, so stop listing it.
    for (const id of ids) if (!found.some((r) => r.id === id)) forget(id);

    const liveIds = found.map((r) => r.id);
    const [items, people] = await Promise.all([
      supabase.from('rs_items').select('id, receipt_id, name, price').in('receipt_id', liveIds),
      supabase.from('rs_people').select('*').in('receipt_id', liveIds)
    ]);
    const itemRows = items.data || [];
    const itemIds = itemRows.map((i) => i.id);
    const asg = itemIds.length
      ? await supabase.from('rs_item_assignments').select('item_id, person_id').in('item_id', itemIds)
      : { data: [] };
    const assignments = asg.data || [];

    // Device order decides the list, so the most recent one is on top.
    const byId = new Map(found.map((r) => [r.id, r]));
    setTrips(
      ids
        .filter((id) => byId.has(id))
        .map((id) => {
          const receipt = byId.get(id);
          const mine = itemRows.filter((i) => i.receipt_id === id);
          const crowd = (people.data || []).filter((p) => p.receipt_id === id);
          return {
            receipt,
            people: crowd,
            itemCount: mine.length,
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

  async function start() {
    setBusy(true);
    setError(null);
    const { data, error: e } = await supabase
      .from('rs_receipts')
      .insert({ title: title.trim() || 'Untitled receipt', event_date: date || today() })
      .select()
      .single();
    setBusy(false);
    if (e) {
      setError(e.message);
      return;
    }
    remember(data.id);
    onOpen(data.id);
  }

  function removeFromList(id) {
    forget(id);
    setTrips((prev) => prev.filter((t) => t.receipt.id !== id));
  }

  return (
    <div className="slip">
      <div className="hero">
        <p className="eyebrow">Receipt splitter</p>
        <h1>Split a receipt</h1>
        <p className="lede">
          Type in what was ordered, tap who had what, and everyone gets their own number with tax and tip
          already worked in. Send the link and they can claim their own items from their phone.
        </p>

        <div className="tally demo">
          <div className="line muted">
            <span className="lbl">Nashville trip dinner</span>
            <span className="dots" />
            <span className="val">3 people</span>
          </div>
          {DEMO.map(([name, cents]) => (
            <div className="line" key={name}>
              <span className="lbl">{name}</span>
              <span className="dots" />
              <span className="val">{money(cents)}</span>
            </div>
          ))}
          <div className="line grand">
            <span className="lbl">Total</span>
            <span className="dots" />
            <span className="val">{money(DEMO.reduce((s, [, c]) => s + c, 0))}</span>
          </div>
        </div>
      </div>

      {error && <p className="msg bad">{error}</p>}

      <div className="tear" />

      <section>
        <h2>Start a new split</h2>
        <label className="field">
          <span>What was it</span>
          <input
            type="text"
            value={title}
            placeholder="Nashville trip dinner"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && start()}
          />
        </label>
        <label className="field">
          <span>Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <div className="cta-stack">
          <button className="btn primary wide" onClick={start} disabled={busy}>
            Start a new split
          </button>
        </div>
      </section>

      <div className="tear" />

      <section>
        <h2>On this device</h2>

        {trips === null && <p className="center">Loading</p>}
        {trips?.length === 0 && (
          <p className="empty">
            Nothing here yet. Every split you start or open on this device gets listed here. There is no account,
            so the list lives on the device and the link is what you share.
          </p>
        )}

        {trips && trips.length > 0 && (
          <>
            <ul className="history">
              {trips.map((t) => (
                <li key={t.receipt.id}>
                  <div className="trip">
                    <div className="grow">
                      <a
                        href={`?receipt=${t.receipt.id}`}
                        onClick={(e) => {
                          e.preventDefault();
                          onOpen(t.receipt.id);
                        }}
                      >
                        <span className="trip-name">{t.receipt.title || 'Untitled receipt'}</span>
                        <span className="trip-meta">
                          {t.receipt.event_date || ''} · {t.itemCount} item{t.itemCount === 1 ? '' : 's'} ·{' '}
                          {t.people.length} {t.people.length === 1 ? 'person' : 'people'}
                        </span>
                      </a>
                      {t.people.length > 0 && (
                        <div className="pills">
                          {t.people.map((p) => (
                            <span className={'pill' + (p.settled ? ' done' : '')} key={p.id}>
                              {p.name} {p.settled ? 'paid' : 'open'}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <span className="trip-amt">{money(t.split.grandCents)}</span>
                    <button
                      className="drop"
                      onClick={() => removeFromList(t.receipt.id)}
                      aria-label={`Remove ${t.receipt.title} from this list`}
                    >
                      &times;
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <p className="note">
              Removing one takes it off this device only. The link keeps working for anyone who still has it.
            </p>
          </>
        )}
      </section>
    </div>
  );
}

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { money, shownTotal, splitReceipt } from '../lib/money.js';
import { personKey, settleUp, tripBalances } from '../lib/trip.js';
import { myName } from '../lib/history.js';
import { moveLinks } from '../lib/pay.js';
import { buildTripPdf, deliverPdf, slugify } from '../lib/statement-pdf.js';
import { CategoryGlyph } from './categories.jsx';
import { prettyDate } from './Landing.jsx';
import { Avatar, AvatarStack, EmptyState, IconBack, IconMenu, IconPlus, Skeleton, Wordmark } from './ui.jsx';

const BRANDS = [
  ['venmo', 'Venmo'],
  ['cashapp', 'Cash App'],
  ['paypal', 'PayPal'],
  ['zelle', 'Zelle'],
  ['applepay', 'Apple Cash']
];

export default function Trip({ tripId, onExit, onMenu, onOpenSplit, onNewSplit }) {
  const [trip, setTrip] = useState(null);
  const [rows, setRows] = useState(null);
  const [status, setStatus] = useState('loading');
  const timer = useRef(null);

  const load = useCallback(async () => {
    const [tripRes, receiptRes] = await Promise.all([
      supabase.from('rs_trips').select('*').eq('id', tripId).maybeSingle(),
      supabase.from('rs_receipts').select('*').eq('trip_id', tripId).order('event_date')
    ]);
    if (!tripRes.data) {
      setStatus('missing');
      return;
    }
    setTrip(tripRes.data);

    const receipts = receiptRes.data || [];
    const ids = receipts.map((r) => r.id);
    if (!ids.length) {
      setRows([]);
      setStatus('ready');
      return;
    }
    const [peopleRes, itemRes] = await Promise.all([
      supabase.from('rs_people').select('*').in('receipt_id', ids),
      supabase.from('rs_items').select('*').in('receipt_id', ids)
    ]);
    const people = peopleRes.data || [];
    const items = itemRes.data || [];
    const itemIds = items.map((i) => i.id);
    const asg = itemIds.length
      ? await supabase.from('rs_item_assignments').select('*').in('item_id', itemIds)
      : { data: [] };
    const assignments = asg.data || [];

    setRows(
      receipts.map((receipt) => {
        const crowd = people.filter((p) => p.receipt_id === receipt.id);
        const mine = items.filter((i) => i.receipt_id === receipt.id);
        return {
          receipt,
          people: crowd,
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
    setStatus('ready');
  }, [tripId]);

  useEffect(() => {
    load();
  }, [load]);

  // Any split in this trip changing anywhere reloads the roll-up, on the same
  // trailing debounce the split page uses.
  useEffect(() => {
    const bump = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(load, 400);
    };
    const channel = supabase
      .channel('trip-' + tripId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rs_receipts' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rs_people' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rs_items' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rs_item_assignments' }, bump)
      .subscribe();
    return () => {
      clearTimeout(timer.current);
      supabase.removeChannel(channel);
    };
  }, [tripId, load]);

  const me = myName();

  const roll = useMemo(() => {
    const list = rows || [];
    const balances = tripBalances(
      list.map((r) => ({
        payerName: r.receipt.payer_id
          ? r.people.find((p) => p.id === r.receipt.payer_id)?.name || r.receipt.payer_name
          : r.receipt.payer_name,
        grandCents: r.split.grandCents,
        perPerson: r.split.perPerson
      }))
    );
    // Handles come off the people rows. A later split wins, so updating your
    // Venmo on the newest split is enough for the whole trip.
    const handles = new Map();
    for (const r of list) {
      for (const p of r.people) {
        const key = personKey(p.name);
        handles.set(key, { ...(handles.get(key) || {}), ...clean(p) });
      }
    }
    return {
      balances: balances.sort((a, b) => b.netCents - a.netCents),
      moves: settleUp(balances),
      handles,
      totalCents: list.reduce((sum, r) => sum + shownTotal(r.split).cents, 0)
    };
  }, [rows]);

  if (status === 'loading') {
    return (
      <div className="col plain">
        <Bar onExit={onExit} onMenu={onMenu} />
        <Skeleton rows={3} />
      </div>
    );
  }

  if (status === 'missing') {
    return (
      <div className="col plain">
        <Bar onExit={onExit} onMenu={onMenu} />
        <div className="step">
          <h1>Trip not found</h1>
          <p className="sub">This trip does not exist, or it was deleted.</p>
          <button className="btn primary wide tall" style={{ marginTop: 20 }} onClick={onExit}>
            Back to my splits
          </button>
        </div>
      </div>
    );
  }

  const dates = (rows || []).map((r) => r.receipt.event_date).filter(Boolean).sort();
  const span =
    dates.length === 0
      ? prettyDate(trip.start_date)
      : dates[0] === dates[dates.length - 1]
        ? prettyDate(dates[0])
        : prettyDate(dates[0]) + ' to ' + prettyDate(dates[dates.length - 1]);

  const everyone = [];
  const seenPeople = new Set();
  for (const r of rows || []) {
    for (const p of r.people) {
      if (seenPeople.has(personKey(p.name))) continue;
      seenPeople.add(personKey(p.name));
      everyone.push(p);
    }
  }

  const label = (name) => (me && personKey(name) === personKey(me) ? 'You' : name);

  function tripPdf(forKey) {
    const blob = buildTripPdf({
      trip,
      rows,
      balances: roll.balances,
      moves: roll.moves,
      totalCents: roll.totalCents,
      forKey: forKey || null,
      shareUrl: typeof window === 'undefined' ? '' : window.location.href
    });
    const who = forKey ? roll.balances.find((b) => b.key === forKey) : null;
    const name = 'halfsies-' + slugify(trip.title) + (who ? '-' + slugify(who.name) : '-trip') + '.pdf';
    deliverPdf(blob, name, trip.title);
  }

  return (
    <div className="col">
      <Bar onExit={onExit} onMenu={onMenu} />

      <div className="step-head" style={{ marginBottom: 14 }}>
        <button className="btn ghost sm" style={{ padding: 0, marginBottom: 2 }} onClick={onExit}>
          <IconBack /> Back
        </button>
        <h1>{trip.title}</h1>
        <p className="sub">
          {span}
          {rows.length > 0 && (
            <>
              {' '}
              · <span className="num">{money(roll.totalCents)}</span> across {rows.length}{' '}
              {rows.length === 1 ? 'split' : 'splits'}
            </>
          )}
        </p>
      </div>

      <div className="head-actions">
        <button className="btn ghost sm" onClick={() => tripPdf(null)} disabled={!rows.length}>
          Trip PDF
        </button>
      </div>

      {everyone.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <AvatarStack people={everyone} />
        </div>
      )}

      <button className="btn outline wide" onClick={() => onNewSplit(tripId)}>
        New split in this trip
      </button>

      {rows.length === 0 ? (
        <EmptyState icon={<IconPlus />} line="No splits in this trip yet. Add the first one above." />
      ) : (
        <>
          <h2 style={{ margin: '22px 0 10px' }}>The log</h2>
          <div className="recent">
            {rows.map((r) => (
              <a
                key={r.receipt.id}
                className="recent-card"
                href={'?receipt=' + r.receipt.id}
                onClick={(e) => {
                  e.preventDefault();
                  onOpenSplit(r.receipt.id);
                }}
              >
                <div className="top">
                  <span className="cat" aria-hidden="true">
                    <CategoryGlyph category={r.receipt.category} />
                  </span>
                  <span className="title">{r.receipt.title || 'Untitled split'}</span>
                  <span className="total num">{money(shownTotal(r.split).cents)}</span>
                </div>
                <div className="when">{prettyDate(r.receipt.event_date)}</div>
                {shownTotal(r.split).nobodyCharged && <div className="when">Nobody is charged yet</div>}
                <div className="log-people">
                  {r.split.perPerson.map((p) => (
                    <span key={p.id}>
                      {label(p.name)} <b className="num">{money(p.totalCents)}</b>
                    </span>
                  ))}
                </div>
              </a>
            ))}
          </div>

          <h2 style={{ margin: '22px 0 10px' }}>Trip totals</h2>
          <div className="card flush">
            <div className="rows">
              {roll.balances.map((b) => (
                <div className="line" key={b.key}>
                  <Avatar name={b.name} index={0} />
                  <span className="grow name">{label(b.name)}</span>
                  <span className="two-up">
                    <span className="tiny">paid {money(b.paidCents)}</span>
                    <span className="amt num">owed {money(b.owedCents)}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <h2 style={{ margin: '22px 0 10px' }}>Who owes who</h2>
          {roll.moves.length === 0 ? (
            <p className="empty">Everyone is square.</p>
          ) : (
            roll.moves.map((m) => (
              <Owed
                key={m.fromKey + m.toKey}
                move={m}
                label={label}
                handles={roll.handles}
                title={trip.title}
                onPdf={() => tripPdf(m.fromKey)}
              />
            ))
          )}
        </>
      )}
    </div>
  );
}

// Only the handle columns, so a spread cannot drag a null over a saved value.
function clean(person) {
  const out = {};
  for (const key of ['venmo', 'cashapp', 'paypal', 'zelle', 'phone', 'email']) {
    if ((person[key] || '').trim()) out[key] = person[key].trim();
  }
  return out;
}

function Bar({ onExit, onMenu }) {
  return (
    <header className="topbar">
      <Wordmark onClick={onExit} />
      <button className="icon-btn" onClick={onMenu} aria-label="Menu">
        <IconMenu />
      </button>
    </header>
  );
}

function Owed({ move, label, handles, title, onPdf }) {
  // Both halves of this were wrong: the two people were the wrong way round and
  // the whole {links, apps, bodies} object was being read as if it were links,
  // so every button on this card was dead. moveLinks exists so neither can recur.
  const { links } = moveLinks(move, handles, title);

  return (
    <div className="card">
      <div className="owed">
        <Avatar name={move.from} index={1} size="lg" />
        <span className="grow">
          <span className="who-name">{label(move.from)}</span>
          <span className="owes">
            {label(move.from) === 'You' ? 'owe' : 'owes'} {label(move.to)}
          </span>
        </span>
        <span className="big num">{money(move.cents)}</span>
      </div>
      <div className="pays">
        {BRANDS.map(([key, text]) => {
          const href = links[key];
          return (
            <a
              key={key}
              className={'pay v-' + key + (href ? '' : ' off')}
              href={href || undefined}
              target={href && href.startsWith('http') ? '_blank' : undefined}
              rel="noreferrer"
              aria-disabled={href ? undefined : 'true'}
            >
              {text}
            </a>
          );
        })}
      </div>
      <button className="btn outline sm" style={{ marginTop: 8 }} onClick={onPdf}>
        Send PDF
      </button>
    </div>
  );
}

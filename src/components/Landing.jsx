import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { splitReceipt, money } from '../lib/money.js';
import { historyIds, remember, forget } from '../lib/history.js';
import { AvatarStack, BRANDS, IconCheck, Progress, Wordmark } from './ui.jsx';
import { Mark } from './Logo.jsx';

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
            <h1>What do you want to go halfsies on?</h1>
            <p className="sub">Give it a name and a date so you can find it later.</p>
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

  // Nothing on this device means nobody has used the app yet, so the page is
  // the pitch. Once there is history the list comes first and keeps the dock it
  // has always had, and the pitch sits underneath it.
  //
  // Loading counts as having history on purpose. historyIds is a synchronous
  // localStorage read, so an empty device is already settled on the first
  // paint, and a device with splits would otherwise flash the whole marketing
  // page and then have the list shoved in above it.
  const showRecent = splits === null || splits.length > 0;

  return (
    <div className={'col market-col' + (showRecent ? '' : ' plain')}>
      <header className="topbar">
        <Wordmark onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} />
      </header>

      {error && <p className="banner bad">{error}</p>}

      {showRecent && (
        <>
          <h2 style={{ margin: '8px 0 12px' }}>Recent splits</h2>
          <RecentList splits={splits} onOpen={onOpen} />
          <div className="dock">
            <button className="btn primary wide tall" onClick={() => setNaming(true)}>
              New split
            </button>
          </div>
        </>
      )}

      <Marketing onStart={() => setNaming(true)} />
    </div>
  );
}

const STEPS = [
  ['Snap the receipt', 'The lines are read off the photo. No receipt? Type them in.'],
  ['Tap who had what', "Shared plates split evenly. Tax and tip follow each person's share."],
  ['Send the link', 'Each person sees what they owe and a button to pay you. No app to download.']
];

const QUESTIONS = [
  ['Do my friends need the app?', 'No. They open a link on their phone.'],
  ['Do I need an account?', 'No. Your splits are saved on your phone.'],
  ['What does it cost?', 'Nothing.']
];

function Marketing({ onStart }) {
  return (
    <div className="market">
      <div className="mk-hero">
        <Mark size={56} tone="light" />
        <h1>Split the receipt. Everyone pays their part.</h1>
        <p>
          Take a photo of the receipt, tap who had what, and everyone gets their number with tax and tip included.
          Then they pay you with Venmo, Cash App, Zelle or Apple Pay.
        </p>
        <button className="btn tall" onClick={onStart}>
          Start a split
        </button>
      </div>

      <SettleMock />

      <section>
        <h2>How it works</h2>
        <div className="mk-steps">
          {STEPS.map(([title, body], i) => (
            <div className="mk-step" key={title}>
              <span className="n" aria-hidden="true">
                {i + 1}
              </span>
              <div>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2>Works with</h2>
        <div className="mk-brands">
          {BRANDS.map(({ key, label, Mark: BrandMark }) => (
            <span className="mk-brand" key={key}>
              <BrandMark />
              {label}
            </span>
          ))}
        </div>
      </section>

      <section>
        <h2>Questions</h2>
        <dl className="mk-qa">
          {QUESTIONS.map(([q, a]) => (
            <div key={q}>
              <dt>{q}</dt>
              <dd>{a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <p className="mk-foot">Halfsies. Made in Lexington, Kentucky.</p>
    </div>
  );
}

/* A still of the settle screen, built from the same classes the real one uses
   so it cannot drift away from the product. Decorative, so it is hidden from
   assistive tech rather than described twice. */
function SettleMock() {
  const { Mark: VenmoMark } = BRANDS[0];
  return (
    <div className="mk-frame" aria-hidden="true">
      <div className="mk-screen">
        <div className="hero">
          <p className="label">Total</p>
          <p className="amount num">$61.74</p>
          <div className="facts">
            <div>
              Tax
              <b className="num">$4.32</b>
            </div>
            <div>
              Tip
              <b className="num">$11.00</b>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="owed">
            <span className="av" style={{ background: '#2563eb' }}>
              L
            </span>
            <span className="grow">
              <span className="who-name">Lee</span>
              <span className="owes">owes Phil</span>
            </span>
            <span className="big num">$24.18</span>
          </div>
          <div className="pays">
            <span className="pay v-venmo">
              <VenmoMark />
              Venmo
            </span>
          </div>
        </div>

        <div className="card paid" style={{ marginBottom: 0 }}>
          <div className="owed">
            <span className="tick">
              <IconCheck />
            </span>
            <span className="grow">
              <span className="who-name">Sam</span>
              <span className="owes">Paid by Cash</span>
            </span>
            <span className="num" style={{ fontWeight: 600 }}>
              $18.56
            </span>
          </div>
        </div>
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

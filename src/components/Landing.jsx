import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { splitReceipt, money } from '../lib/money.js';
import { archive, archivedIds, forget, historyIds, remember, unarchive } from '../lib/history.js';
import { AvatarStack, BRANDS, IconBack, IconCheck, IconChevron, IconMenu, Progress, Wordmark } from './ui.jsx';
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

export default function Landing({ onOpen, onMenu, intent }) {
  const [splits, setSplits] = useState(null);
  const [showArchive, setShowArchive] = useState(false);
  const [naming, setNaming] = useState(false);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(today);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const filed = new Set(archivedIds());
    const active = historyIds().filter((id) => !filed.has(id)).slice(0, RECENT_LIMIT);
    const ids = [...active, ...historyIds().filter((id) => filed.has(id))];
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
          // The payer is stored as free text, so it only counts when exactly one
          // person on the split carries that name. An older receipt naming
          // somebody who was never added has no payer, and everybody owes.
          const wanted = (receipt.payer_name || '').trim();
          const matches = wanted ? crowd.filter((p) => p.name === wanted) : [];
          const payerId = matches.length === 1 ? matches[0].id : null;
          const owing = crowd.filter((p) => p.id !== payerId);
          return {
            archived: filed.has(id),
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

  useEffect(() => {
    if (intent === 'new') setNaming(true);
    if (intent === 'archived') {
      setShowArchive(true);
      // Waits a frame so the section exists before we scroll to it.
      requestAnimationFrame(() => document.getElementById('archived')?.scrollIntoView({ behavior: 'smooth' }));
    }
  }, [intent]);

  async function removeSplit(id) {
    if (!window.confirm('Delete this split for everyone who has the link?')) return;
    const { error: e } = await supabase.from('rs_receipts').delete().eq('id', id);
    if (e) {
      setError(e.message);
      return;
    }
    forget(id);
    load();
  }

  function fileAway(id, put) {
    if (put) archive(id);
    else unarchive(id);
    load();
  }

  // Who paid is chosen on the settle screen, from the people already added, so
  // nothing here writes payer_name and nobody is added to the split yet.
  async function create() {
    setBusy(true);
    setError(null);
    const { data, error: e } = await supabase
      .from('rs_receipts')
      .insert({
        title: title.trim() || "Dinner at Joe's",
        event_date: date || today()
      })
      .select()
      .single();
    setBusy(false);
    if (e) {
      setError(e.message);
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
            <button className="btn ghost sm" style={{ padding: 0, marginBottom: 2 }} onClick={() => setNaming(false)}>
              <IconBack /> Back
            </button>
            <p className="step-count">Step 1 of 5</p>
            <h1>What do you want to go halfsies on?</h1>
          </div>

          {error && <p className="banner bad">{error}</p>}

          <div className="card">
            <label className="field">
              <span>Name</span>
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
          </div>
        </div>

        <div className="dock">
          <button className="btn primary wide tall" onClick={create} disabled={busy}>
            {busy ? 'Saving' : 'Continue'}
          </button>
        </div>
      </div>
    );
  }

  // The pitch shows only on a device that has never made a split. After that
  // home is the app itself. historyIds is a synchronous localStorage read, so
  // this is settled on the first paint and nothing flashes.
  const hasHistory = historyIds().length > 0;
  const live = (splits || []).filter((t) => !t.archived);
  const filed = (splits || []).filter((t) => t.archived);

  const bar = (
    <header className="topbar">
      <Wordmark onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} />
      <button className="icon-btn" onClick={onMenu} aria-label="Menu">
        <IconMenu />
      </button>
    </header>
  );

  if (!hasHistory) {
    return (
      <div className="col market-col plain">
        {bar}
        {error && <p className="banner bad">{error}</p>}
        <Marketing onStart={() => setNaming(true)} />
      </div>
    );
  }

  return (
    <div className="col">
      {bar}

      {error && <p className="banner bad">{error}</p>}

      <h2 style={{ margin: '8px 0 12px' }}>Recent splits</h2>
      <RecentList
        splits={splits === null ? null : live}
        onOpen={onOpen}
        onArchive={(id) => fileAway(id, true)}
        onDelete={removeSplit}
      />

      {filed.length > 0 && (
        <section id="archived" style={{ marginTop: 22 }}>
          <button className="disclose" onClick={() => setShowArchive((v) => !v)} aria-expanded={showArchive}>
            <IconChevron open={showArchive} />
            Archived ({filed.length})
          </button>
          {showArchive && (
            <RecentList splits={filed} onOpen={onOpen} onUnarchive={(id) => fileAway(id, false)} onDelete={removeSplit} />
          )}
        </section>
      )}

      <div className="dock">
        <button className="btn primary wide tall" onClick={() => setNaming(true)}>
          New split
        </button>
      </div>
    </div>
  );
}

// The same pitch, reachable from the menu once the device has splits of its own.
export function HowPage({ onStart, onHome, onMenu }) {
  return (
    <div className="col market-col plain">
      <header className="topbar">
        <Wordmark onClick={onHome} />
        <button className="icon-btn" onClick={onMenu} aria-label="Menu">
          <IconMenu />
        </button>
      </header>
      <Marketing onStart={onStart} />
      <button className="btn primary wide tall" style={{ marginTop: 8 }} onClick={onStart}>
        Start a split
      </button>
    </div>
  );
}

const STEPS = [
  ['Take a photo of the receipt', 'The lines are read off the photo. No receipt? Type them in.'],
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
        <h1>When your math isn't mathing, go halfsies.</h1>
        <p>
          Take a photo of the receipt, tap who had what, and everyone gets their number with tax and tip included.
          Then they pay you with Venmo, Cash App, Zelle or Apple Cash.
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
              C
            </span>
            <span className="grow">
              <span className="who-name">Casey</span>
              <span className="owes">owes Jordan</span>
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
              <span className="who-name">Riley</span>
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

function RecentList({ splits, onOpen, onArchive, onUnarchive, onDelete }) {
  const rows = useMemo(() => splits || [], [splits]);

  if (splits === null) return <p className="empty">Loading</p>;
  if (!rows.length) return <p className="empty">No splits yet.</p>;

  return (
    <div className="recent">
      {rows.map((t) => (
        <div className="recent-item" key={t.receipt.id}>
        <a
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
        <div className="row-actions">
          {onUnarchive ? (
            <button className="btn ghost sm" onClick={() => onUnarchive(t.receipt.id)}>
              Unarchive
            </button>
          ) : (
            <button className="btn ghost sm" onClick={() => onArchive(t.receipt.id)}>
              Archive
            </button>
          )}
          <button className="btn ghost sm" onClick={() => onDelete(t.receipt.id)}>
            Delete
          </button>
        </div>
        </div>
      ))}
    </div>
  );
}

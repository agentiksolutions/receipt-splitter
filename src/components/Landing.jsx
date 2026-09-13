import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { splitReceipt, money, shownTotal } from '../lib/money.js';
import {
  archive,
  archivedIds,
  forget,
  historyIds,
  archiveTrip,
  archivedTripIds,
  forgetTrip,
  unarchive,
  unarchiveTrip
} from '../lib/history.js';
import { deleteHandler, owns, tokenFor } from '../lib/owner.js';
import {
  AvatarStack,
  BRANDS,
  confirmSheet,
  EmptyState,
  IconCheck,
  IconChevron,
  IconMenu,
  IconPlus,
  Skeleton,
  Wordmark
} from './ui.jsx';
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
  const [trips, setTrips] = useState([]);
  const [error, setError] = useState(null);

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

    const tripIdsOn = [...new Set(found.map((r) => r.trip_id).filter(Boolean))];
    const tripRes = tripIdsOn.length
      ? await supabase.from('rs_trips').select('*').in('id', tripIdsOn)
      : { data: [] };
    setTrips(tripRes.data || []);

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
          const onSplit = crowd.some((p) => p.id === receipt.payer_id) ? receipt.payer_id : null;
          const payerId = onSplit || (matches.length === 1 ? matches[0].id : null);
          const owing = crowd.filter((p) => p.id !== payerId);
          return {
            archived: filed.has(id),
            tripId: receipt.trip_id || null,
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
    if (intent === 'archived') {
      setShowArchive(true);
      // Waits a frame so the section exists before we scroll to it.
      requestAnimationFrame(() => document.getElementById('archived')?.scrollIntoView({ behavior: 'smooth' }));
    }
  }, [intent]);

  async function removeSplit(id) {
    const yes = await confirmSheet({
      title: 'Delete this split?',
      line: 'It disappears for everyone who has the link, and it cannot be brought back.',
      confirm: 'Delete split'
    });
    if (!yes) return;
    const { data: gone, error: e } = await supabase.rpc('rs_delete_receipt', { p_id: id, p_token: tokenFor(id) });
    if (e || !gone) {
      setError(e ? e.message : 'This split can only be deleted on the phone that made it.');
      return;
    }
    forget(id); // also drops the token and the other per-receipt keys
    load();
  }

  async function removeTrip(t) {
    // The server decides what goes: it removes the splits carrying this trip's
    // token, takes anyone else's out of the trip, and leaves those alone. The
    // copy only mentions that when it is actually going to happen.
    const mine = t.splits.filter((row) => owns(row.receipt.id));
    const foreign = t.splits.length - mine.length;
    const yes = await confirmSheet({
      title: 'Delete this trip?',
      line:
        `Its ${mine.length} ${mine.length === 1 ? 'split goes' : 'splits go'} too, for everyone who has the links.` +
        (foreign
          ? ` ${foreign} made on another phone ${foreign === 1 ? 'is' : 'are'} kept and taken out of the trip.`
          : ' This cannot be undone.'),
      confirm: 'Delete trip'
    });
    if (!yes) return;

    // Each split carries its OWN token, so its hash never equals the trip's.
    // rs_delete_trip therefore cannot remove them: left to itself it detaches
    // every split and deletes an empty trip, which is not what the sheet just
    // promised. The client holds the per-split tokens, so it deletes those
    // first and lets the RPC sweep up and take the trip.
    for (const row of mine) {
      const rid = row.receipt.id;
      const { data: went } = await supabase.rpc('rs_delete_receipt', { p_id: rid, p_token: tokenFor(rid) });
      if (!went) continue;
      const path = (row.receipt.photo_url || '').trim();
      if (path && !/^https?:/i.test(path)) await supabase.storage.from('receipt-photos').remove([path]);
      forget(rid);
    }

    const { data: gone, error: e } = await supabase.rpc('rs_delete_trip', {
      p_id: t.trip.id,
      p_token: tokenFor(t.trip.id)
    });
    if (e || !gone) {
      setError(e ? e.message : 'This trip can only be deleted on the phone that made it.');
      load();
      return;
    }
    forgetTrip(t.trip.id);
    load();
  }

  function fileTrip(id, put) {
    if (put) archiveTrip(id);
    else unarchiveTrip(id);
    load();
  }

  function fileAway(id, put) {
    if (put) archive(id);
    else unarchive(id);
    load();
  }

  // The pitch shows only on a device that has never made a split. After that
  // home is the app itself. historyIds is a synchronous localStorage read, so
  // this is settled on the first paint and nothing flashes.
  const hasHistory = historyIds().length > 0;
  const live = (splits || []).filter((t) => !t.archived);
  const filed = (splits || []).filter((t) => t.archived);
  const tripFiled = new Set(archivedTripIds());
  const tripById = new Map(trips.map((t) => [t.id, t]));

  function group(list) {
    const loose = [];
    const grouped = new Map();
    for (const row of list) {
      const trip = row.tripId ? tripById.get(row.tripId) : null;
      if (!trip) {
        loose.push(row);
        continue;
      }
      if (!grouped.has(trip.id)) grouped.set(trip.id, { trip, splits: [] });
      grouped.get(trip.id).splits.push(row);
    }
    return { loose, trips: [...grouped.values()] };
  }

  const shown = group(live.filter((r) => !r.tripId || !tripFiled.has(r.tripId)));
  const shelved = group(filed);
  const shelvedTrips = group(live.filter((r) => r.tripId && tripFiled.has(r.tripId))).trips;

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
          <Marketing onStart={() => onOpen(null, { intent: 'new' })} />
      </div>
    );
  }

  return (
    <div className="col">
      {bar}

      {error && <p className="banner bad">{error}</p>}


      <h2 style={{ margin: '8px 0 12px' }}>Recent splits</h2>

      {shown.trips.map((t) => (
        <TripCard
          key={t.trip.id}
          group={t}
          onOpen={() => onOpen(null, { trip: t.trip.id })}
          onArchive={() => fileTrip(t.trip.id, true)}
          onDelete={deleteHandler(t.trip.id, () => removeTrip(t))}
        />
      ))}

      <RecentList
        splits={splits === null ? null : shown.loose}
        onOpen={onOpen}
        onArchive={(id) => fileAway(id, true)}
        onDelete={removeSplit}
        showEmpty={shown.trips.length === 0}
      />

      {filed.length + shelvedTrips.length > 0 && (
        <section id="archived" style={{ marginTop: 22 }}>
          <button className="disclose" onClick={() => setShowArchive((v) => !v)} aria-expanded={showArchive}>
            <IconChevron open={showArchive} />
            Archived ({filed.length + shelvedTrips.length})
          </button>
          {showArchive && (
            <>
              {shelvedTrips.map((t) => (
                <TripCard
                  key={t.trip.id}
                  group={t}
                  onOpen={() => onOpen(null, { trip: t.trip.id })}
                  onUnarchive={() => fileTrip(t.trip.id, false)}
                  onDelete={deleteHandler(t.trip.id, () => removeTrip(t))}
                />
              ))}
              <RecentList
                splits={shelved.loose}
                onOpen={onOpen}
                onUnarchive={(id) => fileAway(id, false)}
                onDelete={removeSplit}
                showEmpty={shelvedTrips.length === 0}
              />
            </>
          )}
        </section>
      )}

      <div className="dock">
        <button className="btn primary wide tall" onClick={() => onOpen(null, { intent: 'new' })}>
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
          {BRANDS.map(({ key, label }) => (
            <span className={'mk-brand v-' + key} key={key}>
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
            <span className="pay v-venmo">Venmo</span>
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


// Past this share of the card's width, letting go commits the action.
const COMMIT_AT = 0.4;

function RecentList({ splits, onOpen, onArchive, onUnarchive, onDelete, showEmpty = true }) {
  const rows = useMemo(() => splits || [], [splits]);

  if (splits === null) return <Skeleton rows={3} />;
  // "No splits yet" printed underneath a trip card full of splits. The empty
  // state belongs to the whole list, so the caller says whether it applies.
  //
  // No action button here on purpose. New split is in the sticky bar a thumb's
  // width away, and two buttons doing the same thing is worse than one.
  if (!rows.length) {
    return showEmpty ? <EmptyState icon={<IconPlus />} line="No splits yet. Start one and send the link." /> : null;
  }

  return (
    <div className="recent">
      {rows.map((t) => (
        <SwipeRow
          key={t.receipt.id}
          row={t}
          onOpen={onOpen}
          onArchive={onArchive}
          onUnarchive={onUnarchive}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

// One card that slides under the finger. Green behind the right edge to file it
// away, red behind the left edge to delete it, the way Mail does it.
// The gesture, once, for both a split row and a trip card. Right archives,
// left deletes, matching what is already shipped.
function Swipeable({ fileLabel, onFile, onDelete, onOpen, children }) {
  const [dx, setDx] = useState(0);
  const [leaving, setLeaving] = useState(0);
  const [menu, setMenu] = useState(false);
  const box = useRef(null);
  const drag = useRef(null);
  const swiped = useRef(false);

  const width = box.current ? box.current.offsetWidth : 320;
  const armed = Math.abs(dx) >= width * COMMIT_AT;

  function askDelete() {
    if (!onDelete) return;
    setMenu(false);
    setDx(0);
    onDelete();
  }

  function down(e) {
    swiped.current = false;
    drag.current = { x: e.clientX, y: e.clientY, axis: null, id: e.pointerId, dx: 0 };
  }

  // The axis is decided once and then kept. Until it is, nothing moves, so a
  // vertical flick scrolls the page normally instead of dragging a card.
  function move(e) {
    const d = drag.current;
    if (!d) return;
    const mx = e.clientX - d.x;
    const my = e.clientY - d.y;
    if (!d.axis) {
      if (Math.abs(mx) - Math.abs(my) > 8) {
        d.axis = 'x';
        try {
          e.currentTarget.setPointerCapture(d.id);
        } catch {
          /* mouse without capture support: the drag still works */
        }
      } else if (Math.abs(my) > 8) {
        d.axis = 'y';
      }
    }
    if (d.axis !== 'x') return;
    swiped.current = true;
    // The ref is the truth. A flick can end before React commits the state, and
    // then a real past-threshold swipe would snap back for no visible reason.
    d.dx = mx;
    setDx(mx);
  }

  function up() {
    const d = drag.current;
    drag.current = null;
    if (!d || d.axis !== 'x') return;
    const moved = d.dx;
    if (Math.abs(moved) < width * COMMIT_AT) {
      setDx(0);
      return;
    }
    if (moved > 0) {
      setLeaving(1);
      setTimeout(onFile, 200);
      return;
    }
    askDelete();
  }

  const shift = leaving ? leaving * width * 1.05 : dx;

  return (
    <div className="recent-item">
      <div className="swipe" ref={box}>
        {shift !== 0 && (shift > 0 || onDelete) && (
          <span className={'swipe-bg ' + (shift > 0 ? 'arch' : 'del')} aria-hidden="true">
            {armed
              ? shift > 0
                ? 'Release to ' + fileLabel.toLowerCase()
                : 'Release to delete'
              : shift > 0
                ? fileLabel
                : 'Delete'}
          </span>
        )}
        <div
          className={'swipe-hold' + (drag.current && drag.current.axis === 'x' ? '' : ' glide')}
          style={{ transform: 'translateX(' + shift + 'px)' }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onClick={() => {
            if (swiped.current) return;
            onOpen();
          }}
        >
          {children}
        </div>
      </div>

      <div className="row-actions">
        <button className="btn ghost sm" onClick={onFile}>
          {fileLabel}
        </button>
        {onDelete && (
          <button className="btn ghost sm" onClick={askDelete}>
            Delete
          </button>
        )}
      </div>

      <button className="offscreen" onClick={() => setMenu((v) => !v)} aria-expanded={menu}>
        More actions
      </button>
      {menu && (
        <div className="row-menu">
          <button
            className="sheet-row"
            onClick={() => {
              setMenu(false);
              onFile();
            }}
          >
            {fileLabel}
          </button>
          {onDelete && (
            <button
              className="sheet-row"
              onClick={() => {
                setMenu(false);
                askDelete();
              }}
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SwipeRow({ row, onOpen, onArchive, onUnarchive, onDelete }) {
  const id = row.receipt.id;
  const total = shownTotal(row.split);

  return (
    <Swipeable
      fileLabel={onUnarchive ? 'Unarchive' : 'Archive'}
      onFile={() => (onUnarchive || onArchive)(id)}
      // A split opened from someone else's link has no token on this device,
      // so there is nothing to delete with and no control to offer.
      onDelete={deleteHandler(id, () => onDelete(id))}
      onOpen={() => onOpen(id)}
    >
      <div className="recent-card">
        <div className="top">
          <span className="title">{row.receipt.title || 'Untitled split'}</span>
          <span className="total num">{money(total.cents)}</span>
        </div>
        <div className="when">{prettyDate(row.receipt.event_date)}</div>
        <div className="bottom">
          <AvatarStack people={row.people} />
          {total.nobodyCharged ? (
            <span className="paid">Nobody is charged yet</span>
          ) : row.owing > 0 ? (
            <span className={'paid' + (row.paid === row.owing ? ' all' : '')}>
              {row.paid === row.owing ? 'All settled' : row.paid + ' of ' + row.owing + ' paid'}
            </span>
          ) : (
            <span className="paid">
              {row.people.length} {row.people.length === 1 ? 'person' : 'people'}
            </span>
          )}
        </div>
      </div>
    </Swipeable>
  );
}

// Every split in one trip, as a single card on home.
function TripCard({ group, onOpen, onArchive, onUnarchive, onDelete }) {
  const { trip, splits } = group;
  const totalCents = splits.reduce((sum, r) => sum + shownTotal(r.split).cents, 0);
  const dates = splits.map((r) => r.receipt.event_date).filter(Boolean).sort();
  const span =
    dates.length === 0
      ? prettyDate(trip.start_date)
      : dates[0] === dates[dates.length - 1]
        ? prettyDate(dates[0])
        : prettyDate(dates[0]) + ' to ' + prettyDate(dates[dates.length - 1]);

  const seen = new Set();
  const crowd = [];
  for (const r of splits) {
    for (const p of r.people) {
      const key = p.name.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      crowd.push(p);
    }
  }

  return (
    <Swipeable
      fileLabel={onUnarchive ? 'Unarchive' : 'Archive'}
      onFile={onUnarchive || onArchive}
      onDelete={onDelete}
      onOpen={onOpen}
    >
      <div className="recent-card trip-card">
        <div className="top">
          <span className="title">{trip.title}</span>
          <span className="total num">{money(totalCents)}</span>
        </div>
        <div className="when">{span}</div>
        <div className="bottom">
          <AvatarStack people={crowd} />
          <span className="paid">
            {splits.length} {splits.length === 1 ? 'split' : 'splits'}
          </span>
        </div>
      </div>
    </Swipeable>
  );
}

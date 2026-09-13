import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { fromCents, money, parseBulkLines, reconcile, shownTotal, splitEvenCents, toCents } from '../lib/money.js';
import { photoSrc, prepare } from '../lib/photo.js';
import {
  meRemoved,
  minePersonId,
  myName,
  profile,
  profileHandles,
  saveProfile,
  SERVICES,
  rememberTrip,
  setMeRemoved,
  setMinePersonId,
  setMyName,
  setViewerId,
  tripIds,
  viewerId
} from '../lib/history.js';
import { mintToken, owns, saveToken } from '../lib/owner.js';
import { acceptsKey } from '../lib/pay.js';
import { findMe, personKey } from '../lib/trip.js';
import { findFriendByName, handlesOf, rememberFromPerson, samePerson, searchFriends, touchFriend } from '../lib/friends.js';
import { buildStatementPdf, deliverPdf, selfName, slugify } from '../lib/statement-pdf.js';
import AmountField, { forceDollars } from './AmountField.jsx';
import ItemRow, { AssignHeader } from './ItemRow.jsx';
import PersonCard from './PersonCard.jsx';
import { CATEGORIES, CategoryGlyph } from './categories.jsx';
import { Avatar, Chip, confirmSheet, EmptyState, IconCamera, IconList, IconPlus, IconType, toast, IconPencil } from './ui.jsx';
import { prettyDate, today } from './Landing.jsx';

const SAMPLE = [
  ['Bubly 12z 8pk', 3.97], ['Applewood bacon', 9.12], ['Bell peppers', 2.97],
  ['Potatoes', 4.08], ['Boneless chops', 12.41], ['Mushrooms', 2.32],
  ['GV 24pk water', 3.68], ['Siete tortillas', 4.84], ['Oikos yogurt', 4.97],
  ['Organic bananas', 1.49], ['Kodiak Cakes butter', 4.96], ['Wonderful pistachios', 11.94]
];

const EMPTY = new Set();

// The three tips worth a one-tap chip. Anything else is typed.
const TIPS = [18, 20, 22];

// The sample list is for screenshots and demos. ?demo=1 puts the button back.
const DEMO = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('demo');
const DEFAULT_TITLES = ['', 'untitled split', 'untitled receipt', "dinner at joe's"];

// The five sections, in the order they unlock. `seen` is one number that only
// ever climbs, so removing a person or clearing the list never takes a section
// back off the page.
const SECTIONS = ['sec-a', 'sec-b', 'sec-c', 'sec-d', 'sec-e'];

// What the bar says when the split is not finished. It is never a dead disabled
// button: pressing it walks to the section that is waiting and focuses it.
const NEXT = ['Name the split', 'Add one more person', 'Pick how you are splitting', 'Add the receipt', 'Settle up'];

// Paying the bill is what makes the rest of somebody's handles useful, since
// now everyone else needs somewhere to send money. Fill them from the roster at
// that moment rather than publishing them on the chance it happens: there is no
// login, so every rs_people column is readable by anybody holding the link.
//
// findFriendByName returns null both when nobody matches AND when two friends
// share the name. Both mean "do not guess", and both correctly fill nothing,
// leaving the pay buttons to ask. Do not "improve" this into picking one.
//
// ⛔ A NAME MATCH IS NOT PROOF OF THE SAME PERSON, which is why samePerson has
// to agree as well. One David Ruiz in the roster and a different David Chen at
// tonight's table share a name and nothing else. Without the second check,
// Ruiz's Cash App tag was written onto Chen's rs_people row, which is SHARED:
// every other guest opens the link and sees a live button paying Ruiz, with no
// name beside it to catch. Chen never gets paid. Filling a blank was the whole
// failure, and blank is the normal state for a payer at the moment this runs.
function markPayer(api, person) {
  api.setPayer(person);
  const friend = findFriendByName(person.name);
  if (!friend || !samePerson(friend, person)) return;
  for (const key of ['cashapp', 'paypal', 'zelle']) {
    if (!person[key] && friend[key]) api.savePersonField(person.id, key, friend[key]);
  }
}

// What to print on a suggestion chip so two friends with the same name can be
// told apart at the moment you pick one. The Venmo username first, since that
// is what most of these carry, then whatever else is filled in. Falls back to
// the word "saved" only when the roster entry has a name and nothing else.
function suggestLabel(friend) {
  const row = handlesOf(friend);
  const value = row.venmo || row.cashapp || row.paypal || row.zelle || row.phone || row.venmo_link;
  if (!value) return '';
  return value.length > 18 ? value.slice(0, 17) + '…' : value;
}

function goToSection(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // The receipt section is read before it is typed into, and focusing its first
  // field there would throw the keyboard over the list somebody asked to see.
  if (id === 'sec-d') return;
  const focusable = el.querySelector('input:not([type=file]), select, button');
  if (focusable) setTimeout(() => focusable.focus({ preventScroll: true }), 320);
}

function waitingOn(seen, itemsCount, unassigned) {
  if (seen === 4 && itemsCount > 0 && unassigned > 0) {
    return `${unassigned} ${unassigned === 1 ? 'line' : 'lines'} left to assign`;
  }
  return NEXT[seen - 1];
}

function ladder({ hasTitle, peopleCount, modePicked, itemsCount, unassigned }) {
  if (!hasTitle) return 1;
  if (peopleCount < 2) return 2;
  if (!modePicked && itemsCount === 0) return 3;
  if (itemsCount === 0 || unassigned > 0) return 4;
  return 5;
}

let seq = 0;
const rowKey = () => 'r' + ++seq;

// A quantity line arrives as the LINE total, so 3 at 12.41 is one row of 12.41
// with qty 3. Each copy becomes its own row so it can be assigned separately,
// and the cents are split rather than divided so the three still sum to 12.41.
function expandRead(readItems) {
  const rows = [];
  for (const it of readItems || []) {
    const name = String(it.name || '').trim();
    if (!name) continue;
    const cents = toCents(it.price);
    const qty = Math.max(1, Math.min(40, Math.round(Number(it.qty) || 1)));
    if (qty === 1) {
      rows.push({ key: rowKey(), name, price: fromCents(cents) });
      continue;
    }
    splitEvenCents(cents, qty).forEach((c, i) => {
      rows.push({ key: rowKey(), name: `${name} (${i + 1} of ${qty})`, price: fromCents(c) });
    });
  }
  return rows;
}

export function prettyTime(hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''));
  if (!m) return '';
  const h = Number(m[1]);
  if (h > 23) return '';
  const suffix = h < 12 ? 'am' : 'pm';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${m[2]} ${suffix}`;
}

export function readLine({ merchant, event_date: date, receipt_time: time }) {
  if (!(merchant || '').trim()) return '';
  const bits = [merchant.trim()];
  if (date) bits.push(prettyDate(date));
  const t = prettyTime(time);
  if (t) bits.push(t);
  return bits.length ? 'Read from ' + bits.join(', ') : '';
}

/**
 * The whole split on one scrolling page. Every section is live the moment it
 * appears, and nothing here navigates: the only movement is a scroll.
 */
export default function Split({
  receipt,
  people,
  items,
  assignments,
  claimed,
  split,
  byPerson,
  payer,
  payerName,
  shareUrl,
  trip,
  onOpenTrip,
  api,
  onDelete
}) {
  // No profile name yet means you go on as "Me" and rename the chip in place.
  const [meName, setMe] = useState(() => myName() || 'Me');
  // How the split divides is on the receipt row, so everyone holding the link
  // reads the same answer. 'items' is the column default.
  const how = receipt.split_mode || 'items';
  // Whether anybody has actually chosen. The column is NOT NULL with a default,
  // so a fresh row and a deliberate "by item" look identical; once there are
  // items the question no longer gates anything.
  const [picked, setPicked] = useState(() => how !== 'items' || items.length > 0);

  const unassigned = split.unassignedItems.length;
  const hasTitle = Boolean((receipt.title || '').trim());

  const [seen, setSeen] = useState(() =>
    ladder({
      hasTitle,
      peopleCount: people.length,
      modePicked: picked,
      itemsCount: items.length,
      unassigned
    })
  );
  const firstPaint = useRef(true);

  useEffect(() => {
    const want = ladder({
      hasTitle,
      peopleCount: people.length,
      modePicked: picked,
      itemsCount: items.length,
      unassigned
    });
    setSeen((prev) => (want > prev ? want : prev));
  }, [hasTitle, people.length, picked, items.length, unassigned]);

  // A newly unlocked section fades in and the page walks down to it. The very
  // first paint is skipped so somebody opening a finished split lands at the top.
  useEffect(() => {
    if (firstPaint.current) {
      firstPaint.current = false;
      return;
    }
    document.getElementById(SECTIONS[seen - 1])?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [seen]);

  // Halfsies and Split evenly put every line on everybody. Anything that lands
  // later, a new item or a new person, is covered the moment it arrives.
  useEffect(() => {
    if (how === 'items' || !items.length || !people.length) return;
    const rows = [];
    for (const it of items) {
      for (const p of people) if (!claimed.get(it.id)?.has(p.id)) rows.push({ item_id: it.id, person_id: p.id });
    }
    if (rows.length) api.bulkAssign(rows);
  }, [how, items, people, claimed, api]);

  // Halfsies is only offered for two. Adding a third leaves a mode with no
  // button and the choice stranded, so move it on and say so.
  const grew = useRef('');
  useEffect(() => {
    if (how !== 'halfsies' || people.length <= 2) return;
    if (grew.current === receipt.id) return;
    grew.current = receipt.id;
    api.patchReceipt({ split_mode: 'evenly' });
    toast('Three people now, so this is split evenly.');
  }, [how, people.length, receipt.id, api]);

  async function pickMode(next) {
    if (next === how && picked) return;
    if (next !== how && items.length > 0 && picked) {
      const yes = await confirmSheet({
        title: 'Reassign every item?',
        line: 'Every line goes back to this new way of splitting, and any taps you have made are lost.',
        confirm: 'Reassign',
        destructive: false
      });
      if (!yes) return;
    }
    setPicked(true);
    api.patchReceipt({ split_mode: next });
    if (next === 'items') api.clearAssignments();
  }


  // The one primary action lives in the sticky bar and nowhere else, so it can
  // never end up below the fold on a phone. Section D lends the bar its own
  // button while a photo is being checked or a single total is being typed.
  const [billAction, setBillAction] = useState(null);
  const action =
    billAction ||
    (seen >= 5
      ? { label: 'Settle up', run: () => goToSection('sec-e') }
      : { label: waitingOn(seen, items.length, unassigned), run: () => goToSection(SECTIONS[seen - 1]) });

  return (
    <>
      <SectionWho receipt={receipt} trip={trip} onOpenTrip={onOpenTrip} api={api} fresh={seen === 1} />

      {seen >= 2 && (
        <SectionPeople
          receiptId={receipt.id}
          people={people}
          payer={payer}
          meName={meName}
          onRename={(n) => {
            setMyName(n);
            setMe(n);
          }}
          api={api}
          fresh={seen === 2}
        />
      )}

      {seen >= 3 && <SectionHow people={people} how={how} picked={picked} onPick={pickMode} fresh={seen === 3} />}

      {seen >= 4 && (
        <SectionBill
          receipt={receipt}
          people={people}
          items={items}
          claimed={claimed}
          split={split}
          how={how}
          payer={payer}
          meName={meName}
          api={api}
          onAction={setBillAction}
          fresh={seen === 4}
        />
      )}

      {seen >= 5 && (
        <SectionSettle
          receipt={receipt}
          people={people}
          items={items}
          assignments={assignments}
          split={split}
          byPerson={byPerson}
          payer={payer}
          payerName={payerName}
          shareUrl={shareUrl}
          api={api}
          onDelete={onDelete}
          fresh={seen === 5}
        />
      )}

      <div className="dock">
        <div className="meter">
          <span>
            {items.length} {items.length === 1 ? 'line' : 'lines'}
            {unassigned > 0 ? `, ${unassigned} unassigned` : ''}
          </span>
          <b className="num">{money(split.billCents)}</b>
        </div>
        <button className="btn primary wide tall" onClick={action.run} disabled={action.disabled}>
          {action.label}
        </button>
      </div>
    </>
  );
}

function Section({ id, fresh, children }) {
  return (
    <section id={id} className={'sec' + (fresh ? ' sec-new' : '')}>
      {children}
    </section>
  );
}

/* ---------- A. the split itself -------------------------------------- */

function SectionWho({ receipt, trip, onOpenTrip, api, fresh }) {
  // The field follows the row, so a merchant read off a photo or a rename from
  // another phone shows up here. While somebody is typing their keystrokes win;
  // once the debounce lands the row is the truth again. Seeding useState from
  // the prop and never re-syncing is what let the next keystroke overwrite a
  // merchant the reader had just saved.
  const [typing, setTyping] = useState(null); // null means "show the row"
  const title = typing ?? (receipt.title || '');
  const edit = useRef(0);
  const [trips, setTrips] = useState([]);
  const [newTrip, setNewTrip] = useState('');
  const [wantTrip, setWantTrip] = useState(receipt.trip_id ? 'has' : '');
  const timer = useRef(null);

  // The row is written on the first keystroke, half a second after typing
  // stops. Nothing else on the page can act until it exists.
  useEffect(() => () => clearTimeout(timer.current), []);

  function onTitle(value) {
    setTyping(value);
    clearTimeout(timer.current);
    const mine = ++edit.current;
    timer.current = setTimeout(async () => {
      if (value.trim() !== (receipt.title || '').trim()) await api.patchReceipt({ title: value.trim() });
      // Only the newest edit hands control back. An older patch resolving late
      // must not throw away what is on screen now.
      if (mine === edit.current) setTyping(null);
    }, 500);
  }

  useEffect(() => {
    // The split's OWN trip has to be in the list even when this device has
    // never heard of it. Without it the select matched no option, painted
    // "Not part of a trip", and one tap detached the split for everybody.
    const want = [...new Set([...tripIds(), receipt.trip_id].filter(Boolean))];
    if (!want.length) return undefined;
    let alive = true;
    supabase
      .from('rs_trips')
      .select('*')
      .in('id', want)
      .then(({ data }) => {
        if (alive) setTrips(data || []);
      });
    return () => {
      alive = false;
    };
  }, [receipt.trip_id]);

  async function chooseTrip(value) {
    setWantTrip(value);
    if (value === 'new') return;
    await api.patchReceipt({ trip_id: value || null });
  }

  async function makeTrip() {
    const label = newTrip.trim();
    if (!label) return;
    // Same ownership proof as a receipt: the hash goes on the row, the token
    // stays here, and only a device holding it can delete the trip.
    const { token, hash } = await mintToken();
    const { data } = await supabase
      .from('rs_trips')
      .insert({ title: label, start_date: receipt.event_date || today(), owner_token_hash: hash })
      .select()
      .single();
    if (!data) return;
    saveToken(data.id, token);
    rememberTrip(data.id);
    setTrips((prev) => [...prev, data]);
    setNewTrip('');
    setWantTrip(data.id);
    await api.patchReceipt({ trip_id: data.id });
  }

  const from = readLine(receipt);
  const tripValue = wantTrip === 'new' ? 'new' : receipt.trip_id || '';
  // A split with no row yet is yours: you are the one making it. Only the owner
  // gets the control; everyone else reads the trip off the line below, which
  // already names it and links to the totals.
  const mine = !receipt.id || owns(receipt.id);

  return (
    <Section id="sec-a" fresh={fresh}>
      <h1>What are you splitting?</h1>
      <div className="card" style={{ marginTop: 16 }}>
        <label className="field">
          <span>Name</span>
          <input type="text" value={title} placeholder="Dinner at Joe&apos;s" autoFocus={!receipt.id} onChange={(e) => onTitle(e.target.value)} />
        </label>
        <label className="field">
          <span>Date</span>
          <input
            type="date"
            value={receipt.event_date || today()}
            onChange={(e) => api.patchReceipt({ event_date: e.target.value })}
          />
        </label>

        <span className="field-label">What kind</span>
        <div className="chips cats">
          {CATEGORIES.map(([key, label]) => (
            <Chip
              key={key}
              on={(receipt.category || 'food') === key}
              onClick={() => api.patchReceipt({ category: key })}
            >
              <CategoryGlyph category={key} />
              {label}
            </Chip>
          ))}
        </div>

        {mine && (
          <>
            <label className="field" style={{ marginTop: 12 }}>
              <span>Part of a trip?</span>
              <select value={tripValue} onChange={(e) => chooseTrip(e.target.value)}>
                <option value="">Not part of a trip</option>
                {trips.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
                <option value="new">New trip</option>
              </select>
            </label>

            {wantTrip === 'new' && (
              <div className="inline">
                <input
                  type="text"
                  value={newTrip}
                  placeholder="Nashville weekend"
                  autoComplete="off"
                  onChange={(e) => setNewTrip(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && makeTrip()}
                />
                <button className="btn soft" onClick={makeTrip} disabled={!newTrip.trim()}>
                  Add
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {from && <p className="tiny">{from}</p>}

      {trip && (
        <p className="tiny">
          Part of {trip.title}.{' '}
          <button className="btn ghost sm" style={{ padding: 0 }} onClick={() => onOpenTrip?.(trip.id)}>
            See trip totals
          </button>
        </p>
      )}
    </Section>
  );
}

/* ---------- B. who's in ----------------------------------------------- */

function SectionPeople({ receiptId, people, payer, meName, onRename, api, fresh }) {
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(null);
  const [draftName, setDraftName] = useState('');
  const [realName, setRealName] = useState('');
  // Which name this device has already put on the split. A boolean would either
  // never reopen after a rename or reopen during one, and a rename briefly
  // leaves the new name on the person before `meName` catches up.
  const seededFor = useRef('');

  // The recorded id wins over the name. Matching on the profile name alone
  // inserted a SECOND you the moment the profile was renamed without spreading
  // the change, and evenly or halfsies then moved every line onto the new row.
  const mine = findMe(people, minePersonId(receiptId), meName);

  // You are on the split from the moment this section appears. The test is
  // "nobody here is me", never "the split is empty": adding a friend first used
  // to skip the add for good and leave no way back on.
  useEffect(() => {
    const key = personKey(meName);
    if (!key || mine || seededFor.current === key || meRemoved(receiptId)) return;
    // Only on a split this device started. Opening a friend's link must not put
    // a new person on their bill; an empty split is one that has just been made.
    if (!owns(receiptId) && people.length > 0) return;
    seededFor.current = key;
    api.addPeople([meName], profileHandles());
    api.patchReceipt({ payer_name: meName });
  }, [mine, meName, receiptId, people.length, api]);

  // Once the insert lands, remember which row is ours. A later profile edit
  // writes to this id and to nothing matched by name.
  useEffect(() => {
    // owns() as well as the seed, or a remove-and-retype across a reload never
    // records the row and adding a handle silently goes nowhere.
    if (mine && (seededFor.current || owns(receiptId)) && !minePersonId(receiptId)) {
      setMinePersonId(receiptId, mine.id);
    }
  }, [mine, receiptId]);

  // Already on this split, so the suggestion list should not offer them again.
  // Two people with the same name would each get their own share and the payer
  // lookup, which matches on the name, would then match nobody.
  const onSplit = (n) => people.some((p) => personKey(p.name) === personKey(n));

  const suggestions = useMemo(() => {
    const q = name.trim();
    if (!q) return [];
    return searchFriends(q)
      .filter((f) => !onSplit(f.name))
      .slice(0, 4);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, people]);

  function add() {
    const v = name.trim();
    if (!v) return;
    setName('');
    if (onSplit(v)) return;
    api.addPeople([v]);
  }

  // Adding a saved friend copies their handles onto this split's row. It is a
  // copy, not a link: editing the roster later must never rewrite a split that
  // has already been shared or settled.
  //
  // Only the two an ower's row is ever read for. There is no login, so every
  // rs_people column is readable by anybody holding the split link, and a
  // friend's Cash App, PayPal and Zelle have no job on a split where they only
  // owe. Those arrive through payerHandles below if they turn out to have paid.
  function addFriend(friend) {
    setName('');
    if (onSplit(friend.name)) return;
    touchFriend(friend.id);
    const { venmo, venmo_link: link, phone } = handlesOf(friend);
    api.addPeople([friend.name], { ...(venmo && { venmo }), ...(link && { venmo_link: link }), ...(phone && { phone }) });
  }


  // True only while you are on your own split under a name that means nothing
  // to anybody else. selfName is the same list the PDF strips, deliberately:
  // when the statement refuses to print a name, this is what asks for one, and
  // two separate lists would leave "You" or "Self" printing nowhere and being
  // asked for never.
  const myRow = people.find((p) => personKey(p.name) === personKey(meName));
  const needsRealName = Boolean(myRow) && !selfName(meName);

  // The same write the pencil rename does, from a field that says what it is
  // for. It renames the row, moves payer_name with it, and saves the name to
  // the profile so no later split starts as "Me" again.
  async function nameMyself() {
    const v = realName.trim();
    if (!v || !myRow) return;
    // Refusing in silence, having already cleared the field, reads as the Save
    // button being broken. Keep what was typed and say what happened.
    if (people.some((p) => p.id !== myRow.id && personKey(p.name) === personKey(v))) {
      toast(v + ' is already on this split.');
      return;
    }
    setRealName('');
    const wasPayer = payer && payer.id === myRow.id;
    await api.savePersonField(myRow.id, 'name', v);
    if (wasPayer) api.patchReceipt({ payer_name: v });
    onRename(v);
  }

  function drop(person) {
    if (personKey(person.name) === personKey(meName)) setMeRemoved(receiptId, true);
    api.removePerson(person.id);
  }

  async function commitRename(person) {
    const v = draftName.trim();
    setEditing(null);
    if (!v || v === person.name) return;
    if (people.some((p) => p.id !== person.id && personKey(p.name) === personKey(v))) {
      toast(v + ' is already on this split.');
      return;
    }
    const wasMe = personKey(person.name) === personKey(meName);
    const wasPayer = payer && payer.id === person.id;
    await api.savePersonField(person.id, 'name', v);
    // payer_name is free text, so renaming the payer has to move it too or the
    // split loses its payer.
    if (wasPayer) api.patchReceipt({ payer_name: v });
    if (wasMe) onRename(v);
  }

  return (
    <Section id="sec-b" fresh={fresh}>
      <h2>Who&apos;s in?</h2>

      <div className="card" style={{ marginTop: 10 }}>
        <div className="inline">
          <input
            type="text"
            value={name}
            placeholder="Add a person"
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
          <button className="btn soft" onClick={add} disabled={!name.trim()} aria-label="Add this person">
            <IconPlus />
          </button>
        </div>

        {suggestions.length > 0 && (
          <div className="chips" style={{ marginTop: 8 }}>
            {suggestions.map((f) => (
              <button
                type="button"
                className="chip"
                key={f.id}
                onClick={() => addFriend(f)}
                aria-label={'Add ' + f.name + ' with their saved payment details'}
              >
                <Avatar name={f.name} />
                <span className="chip-name">{f.name}</span>
                {/* The handle, not the word "saved". Two friends called David
                    rendered as two identical chips, and this is the tap that
                    decides whose Venmo goes on the split. */}
                {suggestLabel(f) && <span className="tag">{suggestLabel(f)}</span>}
              </button>
            ))}
          </div>
        )}

        {/* You go on your own split as the literal word "Me" until you give a
            name, and that word is what every friend sees on the link and on the
            PDF statement: "Total owed to Me". Nothing used to say so. Renaming
            the chip already saves the name to your profile for every split
            after this one, so this asks once and then never appears again. */}
        {needsRealName && (
          <div className="inline" style={{ marginTop: 12 }}>
            <input
              type="text"
              value={realName}
              placeholder="Your name"
              aria-label="Your name, which your friends see"
              autoComplete="off"
              onChange={(e) => setRealName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  nameMyself();
                }
              }}
            />
            <button className="btn soft" onClick={nameMyself} disabled={!realName.trim()} aria-label="Save your name">
              <IconPlus />
            </button>
          </div>
        )}
        {needsRealName && (
          <p className="tiny" style={{ marginTop: 8 }}>
            You are on this split as Me. Your friends see that on the link and on the statement.
          </p>
        )}

        {people.length > 0 && <p className="tiny" style={{ marginTop: 12 }}>Tap the person who paid the bill.</p>}
        {people.length > 0 && (
          <div className="chips" style={{ marginTop: 8 }}>
            {people.map((p) => {
              const isPayer = payer && p.id === payer.id;
              // The row findMe settled on, not another name comparison, so the
              // tag agrees with the logic after a profile rename.
              const isMe = mine ? p.id === mine.id : personKey(p.name) === personKey(meName);
              if (editing === p.id) {
                return (
                  <span className="chip editing" key={p.id}>
                    <Avatar name={draftName || p.name} index={p.colorIndex} />
                    <input
                      className="chip-input"
                      type="text"
                      value={draftName}
                      autoFocus
                      aria-label={'Rename ' + p.name}
                      onChange={(e) => setDraftName(e.target.value)}
                      onBlur={() => commitRename(p)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitRename(p);
                        }
                        if (e.key === 'Escape') setEditing(null);
                      }}
                    />
                  </span>
                );
              }
              return (
                <Chip key={p.id} on={isPayer} onRemove={() => drop(p)} removeLabel={'Remove ' + p.name}>
                  <Avatar name={p.name} index={p.colorIndex} />
                  <button
                    className="chip-name"
                    onClick={() => markPayer(api, p)}
                    aria-pressed={Boolean(isPayer)}
                    aria-label={(isPayer ? p.name + ' paid the bill' : 'Mark ' + p.name + ' as the one who paid')}
                  >
                    {p.name}
                  </button>
                  {isMe && personKey(p.name) !== 'me' && <span className="tag">you</span>}
                  {isPayer && <span className="tag">paid the bill</span>}
                  <button
                    type="button"
                    className="chip-edit"
                    onClick={() => {
                      setDraftName(p.name);
                      setEditing(p.id);
                    }}
                    aria-label={'Rename ' + p.name}
                  >
                    <IconPencil />
                  </button>
                </Chip>
              );
            })}
          </div>
        )}
      </div>

      <p className="tiny">
      </p>
    </Section>
  );
}

/* ---------- C. how are you splitting ---------------------------------- */

function SectionHow({ people, how, picked, onPick, fresh }) {
  const modes = [
    people.length === 2 && ['halfsies', 'Halfsies', 'Straight down the middle'],
    ['evenly', 'Split evenly', 'Every item split between everyone'],
    ['items', 'By what each person had', 'Tap the people on each line']
  ].filter(Boolean);

  return (
    <Section id="sec-c" fresh={fresh}>
      <h2>How are you splitting?</h2>
      <div style={{ marginTop: 10 }}>
        {modes.map(([key, label, sub]) => (
          <button
            key={key}
            className={'choice' + (how === key ? ' on' : '')}
            aria-pressed={how === key}
            onClick={() => onPick(key)}
          >
            <span className="t">
              <b>{label}</b>
              <span>{sub}</span>
            </span>
          </button>
        ))}
      </div>
      {!picked && <p className="tiny">Pick one to carry on.</p>}
    </Section>
  );
}

/* ---------- D. the receipt -------------------------------------------- */

function SectionBill({ receipt, people, items, claimed, split, how, payer, meName, api, onAction, fresh }) {
  const [view, setView] = useState('choose'); // choose | reading | review | list | total
  // photo_url holds a storage path now, so the src has to be signed before an
  // <img> can load it. A blob from the camera is already showing by then.
  const [preview, setPreview] = useState(null);
  const [draft, setDraft] = useState([]);
  const [draftTax, setDraftTax] = useState(0);
  const [draftTip, setDraftTip] = useState(0);
  const [note, setNote] = useState(null);
  const [reader, setReader] = useState(null); // the receipt's own subtotal and total
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [bulk, setBulk] = useState('');
  const [totalRaw, setTotalRaw] = useState('');
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  const nameRef = useRef(null);

  // The camera's blob is handed back on unmount. Revoking it as soon as the
  // signed URL arrives would blank the image in between.
  const blobUrl = useRef(null);
  useEffect(
    () => () => {
      if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
    },
    []
  );

  const open = items.filter((it) => !(claimed?.get(it.id)?.size > 0));
  const unassigned = open.length;

  useEffect(() => {
    let alive = true;
    photoSrc(receipt.photo_url).then((url) => {
      if (alive && url) setPreview(url);
    });
    return () => {
      alive = false;
    };
  }, [receipt.photo_url]);
  // The filter turns itself off once there is nothing left to hide, so the list
  // can never end up empty with every line still on the receipt.
  const shownItems = onlyUnassigned && unassigned > 0 ? open : items;

  // Whatever nobody claimed goes on whoever paid, which is the usual answer for
  // the last two or three lines of a long receipt.
  function restToPayer() {
    if (!payer || !open.length) return;
    api.bulkAssign(open.map((it) => ({ item_id: it.id, person_id: payer.id })));
  }
  const listing = items.length > 0 && view !== 'reading' && view !== 'review';

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setNote(null);
    setView('reading');
    let shot;
    try {
      shot = await prepare(file);
    } catch (err) {
      setNote(err.message);
      setView(items.length ? 'list' : 'choose');
      return;
    }
    if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
    blobUrl.current = shot.previewUrl;
    setPreview(shot.previewUrl);
    api.savePhoto(shot.blob);

    const { data, error } = await supabase.functions.invoke('read-receipt', {
      body: { image: shot.base64, media_type: 'image/jpeg' }
    });

    if (error || !data || data.error || !data.items?.length) {
      setNote('Could not read that photo. Type the items instead.');
      setView('list');
      return;
    }

    // What the reader knows about the receipt itself. The merchant is kept
    // whatever else happens, and it only takes over the title when the title
    // is still blank or still the placeholder.
    const patch = {};
    const merchant = String(data.merchant || '').trim();
    if (merchant) patch.merchant = merchant;
    if (data.date) patch.event_date = data.date;
    if (data.time) patch.receipt_time = data.time;
    if (merchant && DEFAULT_TITLES.includes((receipt.title || '').trim().toLowerCase())) patch.title = merchant;
    if (Object.keys(patch).length) api.patchReceipt(patch);

    setDraft(expandRead(data.items));
    setDraftTax(data.tax == null ? 0 : toCents(data.tax));
    setDraftTip(data.tip == null ? 0 : toCents(data.tip));
    setReader({
      subtotalCents: data.subtotal == null ? null : toCents(data.subtotal),
      totalCents: data.total == null ? null : toCents(data.total)
    });
    setView('review');
  }

  async function commitDraft() {
    const rows = draft.map((r) => ({ name: r.name.trim(), price: toCents(r.price) / 100 })).filter((r) => r.name);
    if (!rows.length) {
      setNote('Every item needs a name.');
      return;
    }
    setBusy(true);
    const ok = await api.addItems(rows);
    const patch = {};
    // These came off the receipt as dollars. The list field below has to open in
    // dollars too, or a remembered percent unit reads 18.55 as 18.55 percent of
    // a subtotal that just grew.
    if (draftTax) {
      patch.tax_amount = draftTax / 100;
      forceDollars('tax');
    }
    if (draftTip) {
      patch.tip_amount = draftTip / 100;
      forceDollars('tip');
    }
    if (Object.keys(patch).length) await api.patchReceipt(patch);
    setBusy(false);
    if (!ok) return;
    setDraft([]);
    setReader(null);
    setView('list');
  }

  async function addOne() {
    const n = name.trim();
    if (!n || !price.trim()) return;
    setName('');
    setPrice('');
    nameRef.current?.focus();
    await api.addItems([{ name: n, price: toCents(price) / 100 }]);
  }

  async function addBulk() {
    const rows = parseBulkLines(bulk);
    if (!rows.length) {
      setNote('One item per line, as name, price.');
      return;
    }
    setBulk('');
    setNote(null);
    await api.addItems(rows);
  }

  async function saveTotal() {
    const cents = toCents(totalRaw);
    if (cents <= 0) return;
    setBusy(true);
    await api.addItems([{ name: (receipt.title || '').trim() || 'Bill', price: cents / 100 }]);
    const patch = {};
    if (draftTax) {
      patch.tax_amount = draftTax / 100;
      forceDollars('tax');
    }
    if (draftTip) {
      patch.tip_amount = draftTip / 100;
      forceDollars('tip');
    }
    if (Object.keys(patch).length) await api.patchReceipt(patch);
    setBusy(false);
    setTotalRaw('');
    setView('list');
  }

  const draftTotal = draft.reduce((s, r) => s + toCents(r.price), 0);
  const totalCents = toCents(totalRaw);

  // Did every line make it off the photo? The receipt's own subtotal is the
  // check, and the gap is almost always a line the reader skipped.
  const recon = reader
    ? reconcile({
        itemsCents: draftTotal,
        taxCents: draftTax,
        tipCents: draftTip,
        subtotalCents: reader.subtotalCents,
        totalCents: reader.totalCents
      })
    : null;

  // The sticky bar borrows this section's button while the photo is being
  // checked or a single total is being typed, and hands it back afterwards.
  const latest = useRef(null);
  latest.current = { commitDraft, saveTotal };
  useEffect(() => {
    if (view === 'review') {
      onAction({
        label: busy ? 'Adding' : `Add ${draft.length} ${draft.length === 1 ? 'item' : 'items'}`,
        disabled: busy || !draft.length,
        run: () => latest.current.commitDraft()
      });
    } else if (view === 'total' && items.length === 0) {
      onAction({
        label: busy ? 'Saving' : 'Add this total',
        disabled: busy || totalCents <= 0,
        run: () => latest.current.saveTotal()
      });
    } else {
      onAction(null);
    }
    return () => onAction(null);
  }, [view, busy, draft.length, totalCents, items.length, onAction]);

  return (
    <Section id="sec-d" fresh={fresh}>
      <h2>The receipt</h2>
      {note && <p className="banner warn">{note}</p>}

      {view === 'choose' && items.length === 0 && (
        <div style={{ marginTop: 10 }}>
          <label className="choice">
            <span className="glyph">
              <IconCamera />
            </span>
            <span className="t">
              <b>Take a photo of the receipt</b>
              <span>The items are read from the photo</span>
            </span>
            <input type="file" accept="image/*" capture="environment" onChange={onFile} />
          </label>

          <button className="choice" onClick={() => setView('list')}>
            <span className="glyph">
              <IconType />
            </span>
            <span className="t">
              <b>Type the items</b>
              <span>One at a time, or paste a list</span>
            </span>
          </button>

          <button className="choice" onClick={() => setView('total')}>
            <span className="glyph">
              <IconList />
            </span>
            <span className="t">
              <b>Just a total</b>
              <span>One amount for the whole bill</span>
            </span>
          </button>
        </div>
      )}

      {view === 'reading' && (
        <div className="card">
          <div className="reading">
            {preview && (
              <span className="shot tiny">
                <img className="thumb" src={preview} alt="Receipt photo" />
              </span>
            )}
            <div className="t">
              <b>Reading the receipt</b>
              <div className="track">
                <i />
              </div>
            </div>
          </div>
        </div>
      )}

      {view === 'review' && (
        <>
          <p className="tiny">Items read from the photo. Fix any mistakes before they go on.</p>
          {preview && (
            <div className="card" style={{ padding: 8 }}>
              <div className="shot">
                <img className="thumb" src={preview} alt="Receipt photo" />
              </div>
            </div>
          )}
          <div className="card flush">
            <div className="rows">
              {draft.map((r) => (
                <div className="edit-row" key={r.key}>
                  <input
                    type="text"
                    value={r.name}
                    aria-label="Item name"
                    onChange={(e) => setDraft((prev) => prev.map((x) => (x.key === r.key ? { ...x, name: e.target.value } : x)))}
                  />
                  <input
                    type="text"
                    inputMode="decimal"
                    className="price num"
                    value={r.price}
                    aria-label={'Price of ' + r.name}
                    onChange={(e) => setDraft((prev) => prev.map((x) => (x.key === r.key ? { ...x, price: e.target.value } : x)))}
                  />
                  <button
                    className="icon-btn bare"
                    onClick={() => setDraft((prev) => prev.filter((x) => x.key !== r.key))}
                    aria-label={'Remove ' + r.name}
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          </div>
          <button className="btn outline wide" onClick={() => setDraft((prev) => [...prev, { key: rowKey(), name: '', price: '' }])}>
            <IconPlus /> Add an item
          </button>
          <div className="card" style={{ marginTop: 12 }}>
            <AmountField label="Tax" unitKey="tax" baseCents={draftTotal} cents={draftTax} onChange={setDraftTax} />
            <AmountField label="Tip" unitKey="tip" baseCents={draftTotal} cents={draftTip} onChange={setDraftTip} />
          </div>
          {recon && (
            <p className={'recon' + (recon.matches ? ' ok' : '')}>
              {recon.matches
                ? 'Matches the receipt'
                : `Items read ${money(recon.readCents)}. Receipt says ${money(recon.saysCents)}. ` +
                  `${money(Math.abs(recon.gapCents))} ${recon.gapCents > 0 ? 'not accounted for' : 'more than the receipt'}.`}
            </p>
          )}
        </>
      )}

      {view === 'total' && items.length === 0 && (
        <>
          <div className="card">
            <label className="field">
              <span>Amount</span>
              <input
                type="text"
                inputMode="decimal"
                className="num"
                value={totalRaw}
                placeholder="0.00"
                autoFocus
                onChange={(e) => setTotalRaw(e.target.value)}
              />
            </label>
            <AmountField label="Tax" unitKey="tax" baseCents={totalCents} cents={draftTax} onChange={setDraftTax} />
            <AmountField label="Tip" unitKey="tip" baseCents={totalCents} cents={draftTip} onChange={setDraftTip} />
            <p className="tiny">Tax and tip are both optional.</p>
          </div>
          <p className="tiny" style={{ textAlign: 'center', marginTop: 8 }}>
            <button className="btn ghost sm" onClick={() => setView('choose')}>
              Use the item list instead
            </button>
          </p>
        </>
      )}

      {listing && (
        <>
          {how === 'items' && people.length > 0 && (
            <AssignHeader
              people={people}
              meName={meName}
              split={split}
              unassigned={unassigned}
              onlyUnassigned={onlyUnassigned}
              onFilter={() => setOnlyUnassigned((v) => !v)}
              payerName={payer ? payer.name : ''}
              onRest={payer ? restToPayer : null}
            />
          )}
          <div className="bill-lines">
            {shownItems.map((it) => (
              <ItemRow
                key={it.id}
                name={it.name}
                cents={toCents(it.price)}
                people={people}
                meName={meName}
                everyone={how !== 'items'}
                assigned={claimed?.get(it.id) || EMPTY}
                onToggle={(personId) => api.toggleAssign(it.id, personId)}
                onAll={(want) => api.assignAll(it.id, want)}
                onRemove={() => api.removeItem(it.id)}
              />
            ))}
          </div>
        </>
      )}

      {view === 'list' && items.length === 0 && (
        <EmptyState icon={<IconList />} line="No lines yet. Add them one at a time, or paste the whole list." />
      )}

      {(listing || view === 'list') && (
        <>
          <div className="card">
            <div className="inline">
              <input
                ref={nameRef}
                type="text"
                value={name}
                placeholder="Add a line"
                autoComplete="off"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addOne()}
              />
              <input
                type="text"
                inputMode="decimal"
                className="price num"
                value={price}
                placeholder="0.00"
                aria-label="Price"
                onChange={(e) => setPrice(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addOne()}
              />
              <button className="btn soft" onClick={addOne} disabled={!name.trim() || !price.trim()} aria-label="Add this line">
                <IconPlus />
              </button>
            </div>
          </div>

          <label className="choice">
            <span className="glyph">
              <IconCamera />
            </span>
            <span className="t">
              <b>Add more from a photo</b>
              <span>The lines are read and added to this list</span>
            </span>
            <input type="file" accept="image/*" capture="environment" onChange={onFile} />
          </label>

          <div className="card">
            <AmountField
              key={'tax' + String(receipt.tax_amount)}
              label="Tax"
              unitKey="tax"
              autoWrite={owns(receipt.id)}
              baseCents={split.itemsCents}
              cents={toCents(receipt.tax_amount)}
              onCommit={(c) => {
                if (c !== toCents(receipt.tax_amount)) api.patchReceipt({ tax_amount: c / 100 });
              }}
            />
            <AmountField
              key={'tip' + String(receipt.tip_amount)}
              label="Tip"
              unitKey="tip"
              autoWrite={owns(receipt.id)}
              baseCents={split.itemsCents}
              cents={toCents(receipt.tip_amount)}
              onCommit={(c) => {
                if (c !== toCents(receipt.tip_amount)) api.patchReceipt({ tip_amount: c / 100 });
              }}
            />
            <div className="chips tips">
              {TIPS.map((pct) => {
                const cents = Math.round((split.itemsCents * pct) / 100);
                const on = split.itemsCents > 0 && cents === toCents(receipt.tip_amount);
                return (
                  <Chip
                    key={pct}
                    on={on}
                    disabled={split.itemsCents === 0}
                    onClick={() => api.patchReceipt({ tip_amount: cents / 100 })}
                  >
                    {pct}%
                  </Chip>
                );
              })}
            </div>
            <p className="tiny">Percent of the pre-tax subtotal.</p>
            <p className="tiny">Tax and tip are split by what each person ordered.</p>
          </div>

          <details className="card">
            <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 15 }}>Paste a list</summary>
            <label className="field" style={{ marginTop: 12 }}>
              <span>One item per line, as name, price</span>
              <textarea value={bulk} placeholder={'Bacon, 9.12\nPotatoes, 4.08'} onChange={(e) => setBulk(e.target.value)} />
            </label>
            <div className={DEMO ? 'two' : ''}>
              <button className={'btn outline' + (DEMO ? '' : ' wide')} onClick={addBulk}>
                Add these items
              </button>
              {DEMO && (
                <button className="btn outline" onClick={() => api.addItems(SAMPLE.map(([n, p]) => ({ name: n, price: p })))}>
                  Load sample
                </button>
              )}
            </div>
          </details>
        </>
      )}
    </Section>
  );
}

/* ---------- E. settle up ---------------------------------------------- */

function SectionSettle({
  receipt,
  people,
  items,
  assignments,
  split,
  byPerson,
  payer,
  payerName,
  shareUrl,
  api,
  onDelete,
  fresh
}) {
  // Bumped when a handle is added from a payment button, so the links rebuild
  // with it without waiting for a round trip.
  const [meRev, setMeRev] = useState(0);
  const me = useMemo(() => profile(), [meRev]); // eslint-disable-line react-hooks/exhaustive-deps
  const [savedAsFile, setSavedAsFile] = useState(false);
  const mePerson = useMemo(() => ({ name: me.name, ...profileHandles(me) }), [me]);

  // A greyed button on the host's own view is missing one of MY handles, since
  // the request link is built from them. It goes in the profile, and onto the
  // row this device owns on this split so a friend's phone can use it too.
  function addMyHandle(service, key, value) {
    const p = profile();
    const patch = { [key]: value };
    // Adding a handle means "yes, pay me this way". Without this the friend's
    // phone reads accepts.paypal as false and filters the new button back out,
    // which is the whole point of having added it.
    //
    // Only correct a map that already says something, though. Writing one from
    // nothing would turn "no answer given", which offers every service, into
    // "I take exactly this one".
    const answered = SERVICES.some((svc) => p.accepts?.[svc]);
    if (answered) patch.accepts = { ...p.accepts, [acceptsKey(service)]: true };
    const next = saveProfile(patch);
    setMeRev((n) => n + 1);
    const mineId = minePersonId(receipt.id);
    if (!mineId) return;
    api.savePersonField(mineId, key, value);
    if (patch.accepts) api.savePersonField(mineId, 'accepts', profileHandles(next).accepts);
  }

  // Who is holding this phone. The profile name is the usual answer; a device
  // whose name is on nobody gets asked once and remembered.
  const [chosen, setChosen] = useState(() => viewerId(receipt.id));
  const viewer = useMemo(() => {
    const byName = me.name && people.find((p) => personKey(p.name) === personKey(me.name));
    if (byName) return byName;
    return people.find((p) => p.id === chosen) || null;
  }, [people, me.name, chosen]);

  const host = !payer || !viewer || viewer.id === payer.id;

  // Anyone who owns this split, or is on it, can say who paid. Living only in
  // the host branch made a mis-tap permanent: choosing somebody else dropped
  // you into the friend view, which had no way back.
  const payerPicker = (owns(receipt.id) || Boolean(viewer)) && (
    <div className="card" style={{ marginTop: 10 }}>
      <h2 style={{ marginBottom: 10 }}>Who paid the bill?</h2>
      <div className="chips">
        {people.map((p) => (
          <Chip key={p.id} on={Boolean(payer && p.id === payer.id)} onClick={() => markPayer(api, p)}>
            <Avatar name={p.name} index={p.colorIndex} size="sm" />
            {p.name}
          </Chip>
        ))}
      </div>
    </div>
  );
  const others = payer ? people.filter((p) => p.id !== payer.id) : [];
  const owing = others.filter((p) => (byPerson.get(p.id)?.totalCents || 0) > 0);
  const paid = owing.filter((p) => p.settled).length;
  const outstanding = owing.filter((p) => !p.settled).reduce((s, p) => s + (byPerson.get(p.id)?.totalCents || 0), 0);

  // Built and handed over inside the click, with no await in between, because
  // iOS only opens the share sheet while the user gesture is still live.
  function makePdf(forPersonId) {
    const who = forPersonId ? people.find((p) => p.id === forPersonId) : null;
    const blob = buildStatementPdf({ receipt, people, items, assignments, split, payer, forPersonId, shareUrl });
    const name = 'halfsies-' + slugify(receipt.title) + (who ? '-' + slugify(who.name) : '') + '.pdf';
    // A share that fails for any reason other than the sheet being closed has
    // to leave the file somewhere, and say where.
    const how = deliverPdf(blob, name, receipt.title || 'Halfsies', () => {
      toast('Saved as a file.');
      setSavedAsFile(true);
    });
    if (how === 'download') setSavedAsFile(true);
  }

  // Nothing assigned means nobody has been charged, but the bill is still real.
  // Showing grandCents there would print $0.00 straight above a tax line.
  const shown = shownTotal(split);
  const totals = (
    <div className="hero">
      <p className="label">Total</p>
      <p className="amount num">{money(shown.cents)}</p>
      {shown.nobodyCharged && <p className="hero-note">Nobody is charged yet</p>}
      <div className="facts">
        <div>
          Tax
          <b className="num">{money(split.taxCents)}</b>
        </div>
        <div>
          Tip
          <b className="num">{money(split.tipCents)}</b>
        </div>
        {payerName && (
          <div>
            Paid by
            <b>{payerName}</b>
          </div>
        )}
      </div>
    </div>
  );

  // A device that matches nobody on the split has to say who it is before the
  // pay buttons can point anywhere sensible.
  if (payer && !viewer && people.length > 1) {
    return (
      <Section id="sec-e" fresh={fresh}>
        <h2>Settle up</h2>
        {totals}
        {payerPicker}
        <div className="card">
          <h2 style={{ marginBottom: 10 }}>Who are you?</h2>
          <div className="chips">
            {people.map((p) => (
              <Chip
                key={p.id}
                onClick={() => {
                  setViewerId(receipt.id, p.id);
                  setChosen(p.id);
                }}
              >
                <Avatar name={p.name} index={p.colorIndex} size="sm" />
                {p.name}
              </Chip>
            ))}
          </div>
          <p className="tiny" style={{ marginTop: 10 }}>
            Only this phone remembers the answer.
          </p>
        </div>
      </Section>
    );
  }

  if (!host) {
    const share = byPerson.get(viewer.id);
    const rest = others.filter((p) => p.id !== viewer.id);
    return (
      <Section id="sec-e" fresh={fresh}>
        <h2>Settle up</h2>
        {totals}
        {payerPicker}
        {share && share.totalCents > 0 ? (
          <PersonCard
            person={viewer}
            share={share}
            title={receipt.title}
            shareUrl={shareUrl}
            payerName={payerName}
            mode="send"
            target={payer}
            savedAsFile={savedAsFile}
            onSaveField={api.savePersonField}
            // A greyed button only shows in send mode when the payer named no
            // services at all, so there is no accepts map here to correct.
            onAddHandle={(service, key, value) => {
              if (!payer) return;
              api.savePersonField(payer.id, key, value);
              // Learn it, so the next split with this person starts filled in.
              rememberFromPerson({ ...payer, [key]: value });
            }}
            onSettle={api.setSettled}
            onPdf={() => makePdf(viewer.id)}
          />
        ) : (
          <p className="empty">You owe nothing on this one.</p>
        )}

        {rest.length > 0 && (
          <div className="card">
            <h2 style={{ marginBottom: 10 }}>Everyone else</h2>
            {rest.map((p) => (
              <div className="owed" key={p.id} style={{ padding: '6px 0' }}>
                <Avatar name={p.name} index={p.colorIndex} size="sm" />
                <span className="grow">
                  <span className="who-name">{p.name}</span>
                </span>
                <span className="num">{money(byPerson.get(p.id)?.totalCents || 0)}</span>
              </div>
            ))}
          </div>
        )}

        <div className={onDelete ? 'two' : ''} style={{ marginTop: 20 }}>
          <button className={'btn outline' + (onDelete ? '' : ' wide')} onClick={() => makePdf(viewer.id)}>
            My statement PDF
          </button>
          {/* The person who started the split is not always the person who paid
              for it. Whoever holds the token can delete it from either view. */}
          {onDelete && (
            <button className="btn outline" onClick={onDelete}>
              Delete split
            </button>
          )}
        </div>
      </Section>
    );
  }

  return (
    <Section id="sec-e" fresh={fresh}>
      <h2>Settle up</h2>

      {payerPicker}

      {totals}

      {split.unassignedItems.length > 0 && (
        <p className="banner warn">
          {split.unassignedItems.length} {split.unassignedItems.length === 1 ? 'item is' : 'items are'} not assigned to
          anyone, so nobody is charged for {split.unassignedItems.length === 1 ? 'it' : 'them'}.
        </p>
      )}

      {payer && (
        <>
          <div className="card">
            <div className="owed">
              <Avatar name={payer.name} index={payer.colorIndex} size="lg" />
              <span className="grow">
                <span className="who-name">{payer.name}</span>
                <span className="owes">paid the bill, this is their share</span>
              </span>
              <span className="num" style={{ fontWeight: 600 }}>
                {money(byPerson.get(payer.id)?.totalCents || 0)}
              </span>
            </div>
          </div>

          {owing.length > 0 && (
            <p className="tiny" style={{ margin: '16px 0 10px' }}>
              {paid} of {owing.length} paid
              {outstanding > 0 ? `, ${money(outstanding)} outstanding` : ''}
            </p>
          )}

          {others.map((p) => (
            <PersonCard
              key={p.id}
              person={p}
              share={byPerson.get(p.id)}
              title={receipt.title}
              shareUrl={shareUrl}
              payerName={payerName}
              mode="request"
              me={mePerson}
              onSaveField={api.savePersonField}
              savedAsFile={savedAsFile}
              onAddHandle={addMyHandle}
              onSettle={api.setSettled}
              onPdf={() => makePdf(p.id)}
            />
          ))}

          {others.length === 0 && <p className="empty">Nobody else is on this split.</p>}
        </>
      )}

      <div className={onDelete ? 'two' : ''} style={{ marginTop: 20 }}>
        <button className={'btn outline' + (onDelete ? '' : ' wide')} onClick={() => makePdf(null)}>
          Full PDF
        </button>
        {onDelete && (
          <button className="btn outline" onClick={onDelete}>
            Delete split
          </button>
        )}
      </div>
    </Section>
  );
}

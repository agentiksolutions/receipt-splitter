import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { forget, remember } from '../lib/history.js';
import { deleteHandler, mintToken, saveToken, tokenFor } from '../lib/owner.js';
import { money, shownTotal, splitReceipt } from '../lib/money.js';
import { confirmSheet, IconBack, IconMenu, IconShare, Skeleton, Wordmark } from './ui.jsx';
import Split from './Split.jsx';
import { prettyDate, today } from './Landing.jsx';

// A split that has not been saved yet. The row is written the moment the title
// gets its first keystroke, and everything here is the shape the page reads
// until then.
const draftReceipt = (tripId) => ({
  id: null,
  title: '',
  event_date: today(),
  category: 'food',
  trip_id: tripId || null,
  payer_name: null,
  payer_id: null,
  split_mode: 'items',
  tax_amount: null,
  tip_amount: null,
  merchant: null,
  receipt_time: null,
  photo_url: null
});

export default function Receipt({ receiptId, presetTrip, onExit, onMenu, onOpenTrip, onCreated }) {
  const [id, setId] = useState(receiptId || null);
  const [receipt, setReceipt] = useState(() => (receiptId ? null : draftReceipt(presetTrip)));
  const [people, setPeople] = useState([]);
  const [items, setItems] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [trip, setTrip] = useState(null);
  const [status, setStatus] = useState(receiptId ? 'loading' : 'ready'); // loading | ready | missing
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);

  const timer = useRef(null);
  const pending = useRef(0); // local writes in flight
  const itemIds = useRef(new Set());
  const flashTimer = useRef(null);
  const idRef = useRef(receiptId || null);
  const draftRef = useRef(receiptId ? null : draftReceipt(presetTrip));
  const creating = useRef(null);
  const generation = useRef(0);

  const loadAll = useCallback(async () => {
    const rid = idRef.current;
    if (!rid) return null;
    // Four requests race each other and several loads can be in flight at once.
    // Only the newest may paint, or a slow early one overwrites what just came
    // back and the screen silently goes stale.
    const turn = ++generation.current;
    const [rec, ppl, its, asg] = await Promise.all([
      supabase.from('rs_receipts').select('*').eq('id', rid).maybeSingle(),
      supabase.from('rs_people').select('*').eq('receipt_id', rid).order('created_at'),
      supabase.from('rs_items').select('*').eq('receipt_id', rid).order('created_at'),
      supabase
        .from('rs_item_assignments')
        .select('item_id, person_id, rs_items!inner(receipt_id)')
        .eq('rs_items.receipt_id', rid)
    ]);
    if (turn !== generation.current) return null;
    if (rec.error) {
      setError(rec.error.message);
      setStatus('ready');
      return null;
    }
    if (!rec.data) {
      setStatus('missing');
      return null;
    }
    const itemRows = its.data || [];
    itemIds.current = new Set(itemRows.map((i) => i.id));
    draftRef.current = rec.data;
    setReceipt(rec.data);
    setPeople(ppl.data || []);
    setItems(itemRows);
    setAssignments((asg.data || []).map((a) => ({ item_id: a.item_id, person_id: a.person_id })));
    setStatus('ready');
    return { receipt: rec.data, people: ppl.data || [], items: itemRows };
  }, []);

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

  // The row is created once, on the first thing anybody types. Two edits landing
  // together share the one insert rather than racing to make two splits.
  const ensureReceipt = useCallback(async () => {
    if (idRef.current) return idRef.current;
    if (creating.current) return creating.current;
    creating.current = (async () => {
      const d = draftRef.current || draftReceipt(null);
      // Proof this device made the row. Only the hash is stored; the token
      // itself never leaves this phone, and the delete RPC compares the two.
      const { token, hash } = await mintToken();
      const { data, error: e } = await supabase
        .from('rs_receipts')
        .insert({
          // No invented title. The column is NOT NULL, so blank is an empty
          // string here and every reader shows "Untitled split" for it.
          title: (d.title || '').trim(),
          event_date: d.event_date || today(),
          category: d.category || 'food',
          trip_id: d.trip_id || null,
          payer_name: d.payer_name || null,
          // tax and tip are NOT NULL with a zero default, so a blank draft has
          // to leave them out rather than hand over a null.
          ...(d.tax_amount == null ? {} : { tax_amount: d.tax_amount }),
          ...(d.tip_amount == null ? {} : { tip_amount: d.tip_amount }),
          merchant: d.merchant || null,
          receipt_time: d.receipt_time || null,
          owner_token_hash: hash
        })
        .select()
        .single();
      if (e || !data) {
        creating.current = null;
        setError(e ? e.message : 'Could not start this split.');
        return null;
      }
      idRef.current = data.id;
      draftRef.current = data;
      setId(data.id);
      setReceipt(data);
      saveToken(data.id, token);
      remember(data.id);
      onCreated?.(data.id);
      return data.id;
    })();
    return creating.current;
  }, [onCreated]);

  // The trip name, for the line back to the roll-up.
  useEffect(() => {
    const tid = receipt?.trip_id;
    if (!tid) {
      setTrip(null);
      return undefined;
    }
    let alive = true;
    supabase
      .from('rs_trips')
      .select('*')
      .eq('id', tid)
      .maybeSingle()
      .then(({ data }) => {
        if (alive) setTrip(data || null);
      });
    return () => {
      alive = false;
    };
  }, [receipt?.trip_id]);

  useEffect(() => {
    loadAll();
    return () => {
      clearTimeout(timer.current);
      clearTimeout(flashTimer.current);
    };
  }, [loadAll]);

  useEffect(() => {
    if (!id) return undefined;
    const channel = supabase
      .channel('rs:' + id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rs_receipts', filter: 'id=eq.' + id }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rs_people', filter: 'receipt_id=eq.' + id }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rs_items', filter: 'receipt_id=eq.' + id }, refresh)
      // Assignments carry no receipt_id, so this one cannot be filtered on the
      // server. Drop events for items that are not on this receipt.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rs_item_assignments' }, (payload) => {
        const iid = payload.new?.item_id || payload.old?.item_id;
        if (iid && !itemIds.current.has(iid)) return;
        refresh();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, refresh]);

  useEffect(() => {
    if (id) remember(id);
  }, [id]);

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

  // The payer is a row id. payer_name is written alongside it for the PDFs and
  // is the only clue on a split made before the column existed: it is free
  // text, so it counts only when exactly one person carries that name.
  const storedPayer = (receipt?.payer_name || '').trim();
  const payerById = receipt?.payer_id ? crowd.find((p) => p.id === receipt.payer_id) : null;
  const payerMatches = storedPayer ? crowd.filter((p) => p.name === storedPayer) : [];
  const payer = payerById || (payerMatches.length === 1 ? payerMatches[0] : null);
  const payerName = payer ? payer.name : '';

  /* ---- actions ---- */

  const patchReceipt = useCallback(
    async (patch) => {
      draftRef.current = { ...(draftRef.current || {}), ...patch };
      setReceipt((r) => ({ ...r, ...patch }));
      // Only a real title starts the row. Picking a date or a category first is
      // held in the draft and written with the insert when the name lands, so
      // opening a new split and putting the phone down leaves nothing behind.
      // Once the insert is in flight this has to wait for it rather than return:
      // the insert already read the draft, so a patch dropped here is lost. That
      // is how the auto-added payer went missing.
      const named = 'title' in patch && (patch.title || '').trim();
      if (!idRef.current && !named && !creating.current) return;
      const rid = idRef.current || (await ensureReceipt());
      if (!rid) return;
      await write(() => supabase.from('rs_receipts').update(patch).eq('id', rid));
      refresh();
    },
    [ensureReceipt, refresh, write]
  );

  // `extra` carries the owner's saved handles when the person being added is
  // the owner, so a friend can pay them without anybody typing anything.
  const addPeople = useCallback(
    async (names, extra = null) => {
      const rows = names.map((n) => n.trim()).filter(Boolean);
      if (!rows.length) return;
      const rid = idRef.current || (await ensureReceipt());
      if (!rid) return;
      await write(() =>
        supabase.from('rs_people').insert(rows.map((name) => ({ receipt_id: rid, name, ...(extra || {}) })))
      );
      refresh();
    },
    [ensureReceipt, refresh, write]
  );

  const removePerson = useCallback(
    async (pid) => {
      setPeople((prev) => prev.filter((p) => p.id !== pid));
      setAssignments((prev) => prev.filter((a) => a.person_id !== pid));
      await write(() => supabase.from('rs_people').delete().eq('id', pid));
      refresh();
    },
    [refresh, write]
  );

  // One insert with an array, never a loop. A 25 line receipt is one round trip.
  // Returns the inserted rows, in the order they were supplied, so the caller
  // can assign them straight away.
  const addItems = useCallback(
    async (rows) => {
      if (!rows.length) return null;
      const rid = idRef.current || (await ensureReceipt());
      if (!rid) return null;
      let made = null;
      const ok = await write(async () => {
        const res = await supabase
          .from('rs_items')
          .insert(rows.map((r) => ({ receipt_id: rid, name: r.name, price: r.price })))
          .select();
        made = res.data || null;
        return res;
      });
      refresh();
      return ok ? made : null;
    },
    [ensureReceipt, refresh, write]
  );

  const removeItem = useCallback(
    async (iid) => {
      setItems((prev) => prev.filter((i) => i.id !== iid));
      setAssignments((prev) => prev.filter((a) => a.item_id !== iid));
      await write(() => supabase.from('rs_items').delete().eq('id', iid));
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
          : supabase
              .from('rs_item_assignments')
              // (item_id, person_id) is the primary key, so a double tap is a
              // duplicate and used to surface as a raw Postgres error.
              .upsert([{ item_id: itemId, person_id: personId }], {
                onConflict: 'item_id,person_id',
                ignoreDuplicates: true
              })
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

  const assignAll = useCallback(
    async (itemId, want) => {
      if (want) {
        await bulkAssign(crowd.map((p) => ({ item_id: itemId, person_id: p.id })));
        return;
      }
      setAssignments((prev) => prev.filter((a) => a.item_id !== itemId));
      await write(() => supabase.from('rs_item_assignments').delete().eq('item_id', itemId));
      refresh();
    },
    [bulkAssign, crowd, refresh, write]
  );

  const clearAssignments = useCallback(async () => {
    const ids = items.map((it) => it.id);
    if (!ids.length) return;
    setAssignments([]);
    await write(() => supabase.from('rs_item_assignments').delete().in('item_id', ids));
    refresh();
  }, [items, refresh, write]);

  // The id is what everything reads. The name rides along for the PDF header,
  // which has no people to look an id up in.
  const setPayer = useCallback(
    (person) => patchReceipt({ payer_id: person.id, payer_name: person.name }),
    [patchReceipt]
  );

  // An older split names its payer and has no id. Adopt one, once. A ref rather
  // than a flag: the write triggers a refetch that runs this again before the
  // new row lands, and a boolean would let the second pass through.
  const adopted = useRef('');
  useEffect(() => {
    if (!id || receipt?.payer_id || !payer || adopted.current === id) return;
    adopted.current = id;
    patchReceipt({ payer_id: payer.id });
  }, [id, receipt?.payer_id, payer, patchReceipt]);

  const savePersonField = useCallback(
    async (pid, key, value) => {
      const current = people.find((p) => p.id === pid);
      if (!current || (current[key] || '') === value) return;
      setPeople((prev) => prev.map((p) => (p.id === pid ? { ...p, [key]: value } : p)));
      await write(() => supabase.from('rs_people').update({ [key]: value }).eq('id', pid));
      refresh();
    },
    [people, refresh, write]
  );

  const setSettled = useCallback(
    async (pid, settled, via) => {
      setPeople((prev) => prev.map((p) => (p.id === pid ? { ...p, settled, settled_via: via } : p)));
      await write(() => supabase.from('rs_people').update({ settled, settled_via: via }).eq('id', pid));
      refresh();
    },
    [refresh, write]
  );

  const savePhoto = useCallback(
    async (blob) => {
      const rid = idRef.current || (await ensureReceipt());
      if (!rid) return null;
      const path = rid + '/' + Date.now() + '.jpg';
      const up = await supabase.storage.from('receipt-photos').upload(path, blob, {
        upsert: true,
        contentType: 'image/jpeg'
      });
      if (up.error) {
        setError(up.error.message);
        return null;
      }
      // The PATH, never a public URL. Reads go through a signed URL, so the
      // bucket can be private without breaking a link somebody already has.
      await patchReceipt({ photo_url: path });
      return path;
    },
    [ensureReceipt, patchReceipt]
  );

  const shareUrl = typeof window === 'undefined' ? '' : window.location.href;

  // A bare link in a group chat tells nobody what it is or why they should tap
  // it. Every route out of here carries the name, the date and the total.
  const shareName = (receipt?.title || '').trim() || 'Untitled split';
  const shareText =
    `${shareName}, ${prettyDate(receipt?.event_date)}. ` +
    `Total ${money(shownTotal(split).cents)}. Tap your name to see what you owe.`;

  const shareSplit = useCallback(async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: shareName, text: shareText, url: shareUrl });
      } catch {
        /* the sheet was closed */
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(shareText + '\n' + shareUrl);
      say('Copied. Paste it in the group chat.');
    } catch {
      say(shareUrl);
    }
  }, [shareName, shareText, shareUrl, say]);

  const api = useMemo(
    () => ({
      patchReceipt,
      addPeople,
      removePerson,
      addItems,
      removeItem,
      toggleAssign,
      assignAll,
      bulkAssign,
      clearAssignments,
      setPayer,
      savePersonField,
      setSettled,
      savePhoto
    }),
    [
      patchReceipt,
      addPeople,
      removePerson,
      addItems,
      removeItem,
      toggleAssign,
      assignAll,
      bulkAssign,
      clearAssignments,
      setPayer,
      savePersonField,
      setSettled,
      savePhoto
    ]
  );

  /* ---- render ---- */

  if (status === 'loading' || !receipt) {
    return (
      <div className="col plain">
        <header className="topbar">
          <Wordmark onClick={onExit} />
        </header>
        <Skeleton rows={4} />
      </div>
    );
  }

  if (status === 'missing') {
    return (
      <div className="col plain">
        <header className="topbar">
          <Wordmark onClick={onExit} />
        </header>
        <div className="sec">
          <h1>Split not found</h1>
          <p className="sub">This split does not exist, or it was deleted.</p>
          <button className="btn primary wide tall" style={{ marginTop: 20 }} onClick={onExit}>
            Back to my splits
          </button>
        </div>
      </div>
    );
  }

  async function deleteSplit() {
    if (!id) {
      onExit();
      return;
    }
    const yes = await confirmSheet({
      title: 'Delete this split?',
      line: 'It disappears for everyone who has the link, and it cannot be brought back.',
      confirm: 'Delete split'
    });
    if (!yes) return;
    // The table itself refuses deletes. Only this RPC can remove a row, and only
    // for a caller holding the token whose hash is on it.
    const { data: gone, error: e } = await supabase.rpc('rs_delete_receipt', { p_id: id, p_token: tokenFor(id) });
    if (e || !gone) {
      setError(e ? e.message : 'This split can only be deleted on the phone that made it.');
      return;
    }
    // The row is gone and nothing points at the photo any more. A legacy http
    // value is not a path, so there is nothing to remove for those.
    const path = (receipt?.photo_url || '').trim();
    if (path && !/^https?:/i.test(path)) await supabase.storage.from('receipt-photos').remove([path]);
    forget(id); // also drops the token and the other per-receipt keys
    onExit();
  }

  return (
    <div className="col">
      <header className="topbar">
        <Wordmark onClick={onExit} />
        <button className="icon-btn" onClick={shareSplit} aria-label="Share this split" disabled={!id}>
          <IconShare />
        </button>
        <button className="icon-btn" onClick={onMenu} aria-label="Menu">
          <IconMenu />
        </button>
      </header>

      <button className="btn ghost sm back-row" onClick={onExit}>
        <IconBack /> Back
      </button>

      {flash && <p className="banner">{flash}</p>}
      {error && <p className="banner bad">{error}</p>}

      <Split
        receipt={receipt}
        people={crowd}
        items={items}
        assignments={assignments}
        claimed={claimed}
        split={split}
        byPerson={byPerson}
        payer={payer}
        payerName={payerName}
        shareUrl={shareUrl}
        trip={trip}
        onOpenTrip={onOpenTrip}
        api={api}
        onDelete={id ? deleteHandler(id, deleteSplit) : null}
      />
    </div>
  );
}

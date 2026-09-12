import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { remember } from '../lib/history.js';
import { splitReceipt, money, toCents, fromCents } from '../lib/money.js';
import PersonCard from './PersonCard.jsx';
import Qr from './Qr.jsx';

const SAMPLE_ITEMS = [
  ['Bubly 12z 8pk', 3.97], ['Bubly 12z 8pk', 3.97], ['Applewood bacon', 9.12],
  ['Bell peppers', 2.97], ['Potatoes', 4.08], ['Boneless chops', 12.41],
  ['Mushrooms', 2.32], ['GV 24pk water', 3.68], ['Spread butter 4.4z', 3.47],
  ['Siete tortillas', 4.84], ['Glass cleaner', 3.48], ['Oikos yogurt', 4.97],
  ['Gum and mints', 4.82], ['GV mountain trail mix', 6.52], ['Orig 10oz', 5.66],
  ['Alani Nu WTC brew', 2.67], ['Alani Nu WTC brew', 2.67], ['Alani Nu WTC brew', 2.67],
  ['Alani Nu WTC brew', 2.67], ['Hefty freezer bags', 5.97], ['Raspberries', 2.77],
  ['Organic bananas', 1.49], ['Kodiak Cakes butter', 4.96], ["Snyder's honey pretzels", 3.87],
  ['Wonderful pistachios', 11.94]
];

export default function Receipt({ receiptId, onExit }) {
  const [receipt, setReceipt] = useState(null);
  const [people, setPeople] = useState([]);
  const [items, setItems] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | missing
  const [flash, setFlash] = useState(null);
  const [error, setError] = useState(null);
  const [newPerson, setNewPerson] = useState('');
  const [newItem, setNewItem] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [bulk, setBulk] = useState('');
  const [showShareQr, setShowShareQr] = useState(false);
  const timer = useRef(null);

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
    setReceipt(rec.data);
    setPeople(ppl.data || []);
    setItems(its.data || []);
    setAssignments((asg.data || []).map((a) => ({ item_id: a.item_id, person_id: a.person_id })));
    setStatus('ready');
  }, [receiptId]);

  // Several writes in a row (a pasted list, a sample) each fire a realtime
  // event. Coalesce them into one refetch.
  const refresh = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(loadAll, 220);
  }, [loadAll]);

  useEffect(() => {
    loadAll();
    return () => clearTimeout(timer.current);
  }, [loadAll]);

  // Two phones at the same table stay in step.
  useEffect(() => {
    const channel = supabase
      .channel(`rs:${receiptId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rs_receipts', filter: `id=eq.${receiptId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rs_people', filter: `receipt_id=eq.${receiptId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rs_items', filter: `receipt_id=eq.${receiptId}` }, refresh)
      // Assignments carry no receipt_id, so this one is unfiltered and the
      // refetch is what decides whether anything actually changed here.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rs_item_assignments' }, refresh)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [receiptId, refresh]);

  // Keyed on the id, not the row, so a realtime refetch does not rewrite
  // storage every time something on the receipt changes.
  useEffect(() => {
    if (receipt?.id) remember(receipt.id);
  }, [receipt?.id]);

  function say(text) {
    setFlash(text);
    setTimeout(() => setFlash(null), 2600);
  }

  async function patchReceipt(patch) {
    setReceipt((r) => ({ ...r, ...patch }));
    const { error: e } = await supabase.from('rs_receipts').update(patch).eq('id', receiptId);
    if (e) setError(e.message);
  }

  async function addPerson() {
    const name = newPerson.trim();
    if (!name) return;
    setNewPerson('');
    const { error: e } = await supabase.from('rs_people').insert({ receipt_id: receiptId, name });
    if (e) setError(e.message);
    refresh();
  }

  async function removePerson(id) {
    await supabase.from('rs_people').delete().eq('id', id);
    setPeople((prev) => prev.filter((p) => p.id !== id));
    setAssignments((prev) => prev.filter((a) => a.person_id !== id));
    refresh();
  }

  async function addRows(rows) {
    if (!rows.length) return;
    const { error: e } = await supabase.from('rs_items').insert(rows);
    if (e) setError(e.message);
    refresh();
  }

  async function addOneItem() {
    const name = newItem.trim();
    const price = parseFloat(newPrice);
    if (!name || !isFinite(price)) return;
    setNewItem('');
    setNewPrice('');
    await addRows([{ receipt_id: receiptId, name, price }]);
  }

  async function addBulk() {
    const rows = [];
    for (const line of bulk.split('\n')) {
      const cut = line.lastIndexOf(',');
      if (cut < 0) continue;
      const name = line.slice(0, cut).trim();
      const price = parseFloat(line.slice(cut + 1).replace(/[^0-9.-]/g, ''));
      if (name && isFinite(price)) rows.push({ receipt_id: receiptId, name, price });
    }
    if (!rows.length) {
      say('Nothing to add. Put one item per line as name, price.');
      return;
    }
    setBulk('');
    await addRows(rows);
  }

  async function removeItem(id) {
    await supabase.from('rs_items').delete().eq('id', id);
    setItems((prev) => prev.filter((i) => i.id !== id));
    setAssignments((prev) => prev.filter((a) => a.item_id !== id));
    refresh();
  }

  async function toggleAssign(itemId, personId) {
    const on = assignments.some((a) => a.item_id === itemId && a.person_id === personId);
    setAssignments((prev) =>
      on
        ? prev.filter((a) => !(a.item_id === itemId && a.person_id === personId))
        : [...prev, { item_id: itemId, person_id: personId }]
    );
    if (on) {
      await supabase.from('rs_item_assignments').delete().eq('item_id', itemId).eq('person_id', personId);
    } else {
      await supabase.from('rs_item_assignments').insert({ item_id: itemId, person_id: personId });
    }
    refresh();
  }

  async function savePersonField(id, key, value) {
    const current = people.find((p) => p.id === id);
    if (!current || (current[key] || '') === value) return;
    setPeople((prev) => prev.map((p) => (p.id === id ? { ...p, [key]: value } : p)));
    const { error: e } = await supabase.from('rs_people').update({ [key]: value }).eq('id', id);
    if (e) setError(e.message);
  }

  async function setSettled(id, settled, via) {
    setPeople((prev) => prev.map((p) => (p.id === id ? { ...p, settled, settled_via: via } : p)));
    const { error: e } = await supabase.from('rs_people').update({ settled, settled_via: via }).eq('id', id);
    if (e) setError(e.message);
  }

  async function uploadPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const path = `${receiptId}/${Date.now()}-${file.name.replace(/[^\w.-]/g, '_')}`;
    const up = await supabase.storage.from('receipt-photos').upload(path, file, { upsert: true });
    if (up.error) {
      setError(up.error.message);
      return;
    }
    const { data } = supabase.storage.from('receipt-photos').getPublicUrl(path);
    await patchReceipt({ photo_url: data.publicUrl });
  }

  async function shareLink() {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: receipt?.title || 'Receipt', url });
        return;
      } catch {
        return; // the person closed the sheet
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      say('Link copied.');
    } catch {
      say(url);
    }
  }

  if (status === 'loading') {
    return (
      <div className="slip">
        <p className="center">Loading</p>
      </div>
    );
  }

  if (status === 'missing') {
    return (
      <div className="slip">
        <p className="eyebrow">Receipt splitter</p>
        <h1>No receipt here</h1>
        <p className="note">That link points at a receipt that does not exist, or one that has been deleted.</p>
        <div className="cta-stack">
          <button className="btn primary wide" onClick={onExit}>
            Go to my receipts
          </button>
        </div>
      </div>
    );
  }

  const split = splitReceipt({
    people,
    items,
    assignments,
    taxAmount: receipt.tax_amount,
    tipAmount: receipt.tip_amount
  });
  const byPerson = new Map(split.perPerson.map((s) => [s.id, s]));
  const orphanIds = new Set(split.unassignedItems.map((i) => i.id));

  // payer_name is free text, so a rename or a duplicate name can leave it
  // pointing at nobody. Only treat it as a person when exactly one matches.
  const payerName = (receipt.payer_name || '').trim();
  const payerMatches = people.filter((p) => p.name === payerName);
  const payerId = payerMatches.length === 1 ? payerMatches[0].id : null;
  const payerIsListed = payerMatches.length > 0;

  const owing = split.perPerson.filter((s) => s.id !== payerId && s.totalCents > 0);
  const unsettled = owing.filter((s) => !people.find((p) => p.id === s.id)?.settled);
  const outstanding = unsettled.reduce((sum, s) => sum + s.totalCents, 0);
  const shareUrl = window.location.href;

  return (
    <div className="slip">
      <header className="masthead">
        <div className="grow">
          <p className="eyebrow">Receipt splitter</p>
          <input
            className="title-input"
            aria-label="Receipt title"
            key={receipt.title}
            defaultValue={receipt.title || ''}
            placeholder="Name this one"
            onBlur={(e) => {
              const v = e.target.value.trim() || 'Untitled receipt';
              if (v !== receipt.title) patchReceipt({ title: v });
            }}
          />
        </div>
      </header>

      <div className="meta-row">
        <input
          type="date"
          aria-label="Date"
          key={receipt.event_date}
          defaultValue={receipt.event_date || ''}
          onBlur={(e) => {
            if (e.target.value && e.target.value !== receipt.event_date) patchReceipt({ event_date: e.target.value });
          }}
        />
        <button className="btn" onClick={shareLink}>
          {typeof navigator !== 'undefined' && navigator.share ? 'Share link' : 'Copy link'}
        </button>
        <button className="btn quiet" onClick={() => setShowShareQr((v) => !v)} aria-expanded={showShareQr}>
          {showShareQr ? 'Hide QR' : 'QR'}
        </button>
        <button className="btn quiet" onClick={onExit}>
          My receipts
        </button>
      </div>

      {showShareQr && (
        <div className="qr-share">
          <Qr value={shareUrl} size={108} alt="QR code for this receipt" />
          <p className="note">Anyone who scans this can see and edit the split. No account needed.</p>
        </div>
      )}

      {flash && <p className="msg">{flash}</p>}
      {error && <p className="msg bad">{error}</p>}

      <div className="photo">
        <label className="btn" htmlFor="photo-input">
          {receipt.photo_url ? 'Replace photo' : 'Add a photo of the receipt'}
        </label>
        <input id="photo-input" type="file" accept="image/*" hidden onChange={uploadPhoto} />
        {receipt.photo_url && <img src={receipt.photo_url} alt="The receipt" style={{ marginTop: 12 }} />}
      </div>

      <div className="tear" />

      <section>
        <h2>Who is splitting</h2>
        <div className="row">
          <input
            type="text"
            value={newPerson}
            placeholder="Add a name"
            onChange={(e) => setNewPerson(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addPerson()}
          />
          <button className="btn primary" onClick={addPerson}>
            Add
          </button>
        </div>
        {people.length > 0 && (
          <div className="chips">
            {people.map((p) => (
              <span className="chip" key={p.id}>
                {p.name}
                <button className="drop" onClick={() => removePerson(p.id)} aria-label={`Remove ${p.name}`}>
                  &times;
                </button>
              </span>
            ))}
          </div>
        )}
        {people.length === 0 && <p className="note">Add everyone at the table first, then tap names to claim items.</p>}
      </section>

      <div className="tear" />

      <section>
        <h2>Items</h2>
        <div className="row">
          <input type="text" value={newItem} placeholder="Item" onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addOneItem()} />
          <input
            type="text"
            inputMode="decimal"
            value={newPrice}
            placeholder="0.00"
            style={{ maxWidth: 96, flex: 'none' }}
            onChange={(e) => setNewPrice(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addOneItem()}
          />
          <button className="btn primary" onClick={addOneItem}>
            Add
          </button>
        </div>

        <label className="field">
          <span>Or paste a list, one item per line as name, price</span>
          <textarea value={bulk} placeholder={'Bacon, 9.12\nPotatoes, 4.08'} onChange={(e) => setBulk(e.target.value)} />
        </label>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn wide" onClick={addBulk}>
            Add pasted items
          </button>
          <button className="btn wide" onClick={() => addRows(SAMPLE_ITEMS.map(([name, price]) => ({ receipt_id: receiptId, name, price })))}>
            Load sample
          </button>
        </div>

        <div style={{ marginTop: 16 }}>
          {items.map((it) => {
            const who = assignments.filter((a) => a.item_id === it.id).map((a) => a.person_id);
            const orphan = orphanIds.has(it.id);
            return (
              <div className={'item' + (orphan ? ' orphan' : '')} key={it.id}>
                <div className="item-head">
                  <span className="item-name">{it.name}</span>
                  <span className="item-price">{money(toCents(it.price))}</span>
                  <button className="drop" onClick={() => removeItem(it.id)} aria-label={`Remove ${it.name}`}>
                    &times;
                  </button>
                </div>
                {people.length > 0 && (
                  <div className="assign">
                    {people.map((p) => (
                      <button
                        key={p.id}
                        className={'pick' + (who.includes(p.id) ? ' on' : '')}
                        aria-pressed={who.includes(p.id)}
                        onClick={() => toggleAssign(it.id, p.id)}
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                )}
                {orphan && people.length > 0 && <span className="orphan-note">Nobody claimed this</span>}
              </div>
            );
          })}
          {items.length === 0 && <p className="note">No items yet. Add them one at a time, paste a list, or load the sample.</p>}
        </div>

        <div className="handles" style={{ marginTop: 20 }}>
          <label className="field">
            <span>Tax ($)</span>
            <input
              type="text"
              inputMode="decimal"
              key={String(receipt.tax_amount)}
              defaultValue={fromCents(toCents(receipt.tax_amount))}
              onBlur={(e) => {
                const v = toCents(e.target.value) / 100;
                if (v !== Number(receipt.tax_amount)) patchReceipt({ tax_amount: v });
              }}
            />
          </label>
          <label className="field">
            <span>Tip ($)</span>
            <input
              type="text"
              inputMode="decimal"
              key={String(receipt.tip_amount)}
              defaultValue={fromCents(toCents(receipt.tip_amount))}
              onBlur={(e) => {
                const v = toCents(e.target.value) / 100;
                if (v !== Number(receipt.tip_amount)) patchReceipt({ tip_amount: v });
              }}
            />
          </label>
        </div>
        <p className="note">Tax and tip are split in proportion to what each person ordered.</p>
      </section>

      <div className="tear" />

      <section>
        <h2>The tally</h2>
        <div className="tally">
          <div className="line muted">
            <span className="lbl">Items ({items.length})</span>
            <span className="dots" />
            <span className="val">{money(split.itemsCents)}</span>
          </div>
          {split.unassignedCents > 0 && (
            <div className="line warn">
              <span className="lbl">Unclaimed ({split.unassignedItems.length})</span>
              <span className="dots" />
              <span className="val">-{money(split.unassignedCents)}</span>
            </div>
          )}
          {split.unassignedCents > 0 && (
            <div className="line muted">
              <span className="lbl">Claimed</span>
              <span className="dots" />
              <span className="val">{money(split.assignedCents)}</span>
            </div>
          )}
          <div className="line muted">
            <span className="lbl">Tax</span>
            <span className="dots" />
            <span className="val">{money(split.taxCents)}</span>
          </div>
          <div className="line muted">
            <span className="lbl">Tip</span>
            <span className="dots" />
            <span className="val">{money(split.tipCents)}</span>
          </div>
          {split.unallocatedTaxCents + split.unallocatedTipCents > 0 && (
            <div className="line warn">
              <span className="lbl">Tax and tip nobody can carry yet</span>
              <span className="dots" />
              <span className="val">-{money(split.unallocatedTaxCents + split.unallocatedTipCents)}</span>
            </div>
          )}
          <div className="line grand">
            <span className="lbl">Total</span>
            <span className="dots" />
            <span className="val">{money(split.grandCents)}</span>
          </div>
        </div>

        {split.unassignedCents > 0 && (
          <p className="note flag">
            {split.unassignedItems.length} item{split.unassignedItems.length === 1 ? ' is' : 's are'} in nobody&apos;s
            total. Assign {split.unassignedItems.length === 1 ? 'it' : 'them'} and the total rises to{' '}
            {money(split.itemsCents + split.taxCents + split.tipCents)}.
          </p>
        )}

        {people.length > 0 && (
          <div className="tally" style={{ marginTop: 16 }}>
            {split.perPerson.map((s) => {
              const p = people.find((x) => x.id === s.id);
              return (
                <div className={'line person' + (p?.settled ? ' done' : '')} key={s.id}>
                  <span className="lbl">
                    {s.name}
                    {s.id === payerId ? ' (paid the bill)' : ''}
                  </span>
                  <span className="dots" />
                  <span className="val">{money(s.totalCents)}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="tear" />

      <section>
        <h2>Settle up</h2>
        <label className="field">
          <span>Who paid the bill</span>
          <select value={payerName} onChange={(e) => patchReceipt({ payer_name: e.target.value })}>
            <option value="">Nobody yet</option>
            {people.map((p) => (
              <option key={p.id} value={p.name}>
                {p.name}
              </option>
            ))}
            {payerName && !payerIsListed && <option value={payerName}>{payerName} (no longer on the receipt)</option>}
          </select>
        </label>

        {payerName && owing.length > 0 && (
          <p className="note">
            {owing.map((s) => s.name).join(', ')} owe{owing.length === 1 ? 's' : ''} {payerName}{' '}
            {owing.length === 1 ? money(owing[0].totalCents) : money(owing.reduce((t, s) => t + s.totalCents, 0)) + ' between them'}.
          </p>
        )}
        {!payerName && people.length > 0 && <p className="note">Pick who paid and the requests below will name them.</p>}

        {people.length === 0 && <p className="note">Add people and items first.</p>}

        {people.map((p) => (
          <PersonCard
            key={p.id}
            person={p}
            share={byPerson.get(p.id)}
            title={receipt.title}
            shareUrl={shareUrl}
            isPayer={p.id === payerId}
            payerName={payerName}
            onSaveField={savePersonField}
            onSettle={setSettled}
          />
        ))}
      </section>

      <div className="bar">
        <div className="bar-in">
          <span className="k">Total</span>
          <span className="v">{money(split.grandCents)}</span>
          <span className={'side' + (split.unassignedCents > 0 ? ' warn' : '')}>
            {split.unassignedCents > 0
              ? `${split.unassignedItems.length} unclaimed`
              : outstanding > 0
                ? `${money(outstanding)} outstanding`
                : owing.length > 0
                  ? 'All settled'
                  : `${people.length} ${people.length === 1 ? 'person' : 'people'}`}
          </span>
        </div>
      </div>
    </div>
  );
}

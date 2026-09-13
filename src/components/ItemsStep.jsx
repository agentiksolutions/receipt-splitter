import React, { useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { fromCents, money, splitEvenCents, toCents } from '../lib/money.js';
import { prepare } from '../lib/photo.js';
import AmountField from './AmountField.jsx';
import { IconBack, IconCamera, IconList, IconPlus, IconType } from './ui.jsx';

const SAMPLE = [
  ['Bubly 12z 8pk', 3.97], ['Bubly 12z 8pk', 3.97], ['Applewood bacon', 9.12],
  ['Bell peppers', 2.97], ['Potatoes', 4.08], ['Boneless chops', 12.41],
  ['Mushrooms', 2.32], ['GV 24pk water', 3.68], ['Spread butter 4.4z', 3.47],
  ['Siete tortillas', 4.84], ['Glass cleaner', 3.48], ['Oikos yogurt', 4.97],
  ['Gum and mints', 4.82], ['GV mountain trail mix', 6.52], ['Orig 10oz', 5.66],
  ['Alani Nu WTC brew', 2.67], ['Alani Nu WTC brew', 2.67], ['Alani Nu WTC brew', 2.67],
  ['Alani Nu WTC brew', 2.67], ['Hefty freezer bags', 5.97], ['Raspberries', 2.77],
  ['Organic bananas', 1.49], ['Kodiak Cakes butter', 4.96], ['Snyder honey pretzels', 3.87],
  ['Wonderful pistachios', 11.94]
];

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

export default function ItemsStep({ receipt, items, split, api, onNext, onBack, embedded, compact }) {
  const [mode, setMode] = useState(items.length ? 'type' : 'choose');
  const [preview, setPreview] = useState(receipt.photo_url || null);
  const [draft, setDraft] = useState([]);
  const [draftTaxCents, setDraftTaxCents] = useState(0);
  const [draftTipCents, setDraftTipCents] = useState(0);
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [bulk, setBulk] = useState('');
  const [totalRaw, setTotalRaw] = useState('');
  const nameRef = useRef(null);

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setNote(null);
    setMode('reading');
    let shot;
    try {
      shot = await prepare(file);
    } catch (err) {
      setNote(err.message);
      setMode('choose');
      return;
    }
    setPreview(shot.previewUrl);

    // The photo is worth keeping whether or not the reader gets anything.
    api.savePhoto(shot.blob);

    const { data, error } = await supabase.functions.invoke('read-receipt', {
      body: { image: shot.base64, media_type: 'image/jpeg' }
    });

    if (error || !data || data.error || !data.items?.length) {
      setNote('Could not read that photo. Type the items instead.');
      setMode('type');
      return;
    }
    setDraft(expandRead(data.items));
    setDraftTaxCents(data.tax == null ? 0 : toCents(data.tax));
    setDraftTipCents(data.tip == null ? 0 : toCents(data.tip));
    setMode('review');
  }

  function editDraft(key, field, value) {
    setDraft((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  }

  async function commitDraft() {
    const rows = draft
      .map((r) => ({ name: r.name.trim(), price: toCents(r.price) / 100 }))
      .filter((r) => r.name);
    if (!rows.length) {
      setNote('Every item needs a name.');
      return;
    }
    setBusy(true);
    const ok = await api.addItems(rows);
    const patch = {};
    if (draftTaxCents) patch.tax_amount = draftTaxCents / 100;
    if (draftTipCents) patch.tip_amount = draftTipCents / 100;
    if (Object.keys(patch).length) await api.patchReceipt(patch);
    setBusy(false);
    if (ok) {
      setDraft([]);
      setMode('type');
    }
  }

  async function addOne() {
    const n = name.trim();
    const cents = toCents(price);
    if (!n || !price.trim()) return;
    setName('');
    setPrice('');
    nameRef.current?.focus();
    await api.addItems([{ name: n, price: cents / 100 }]);
  }

  async function addBulk() {
    const rows = [];
    for (const line of bulk.split('\n')) {
      const cut = line.lastIndexOf(',');
      if (cut < 0) continue;
      const n = line.slice(0, cut).trim();
      const p = parseFloat(line.slice(cut + 1).replace(/[^0-9.-]/g, ''));
      if (n && isFinite(p)) rows.push({ name: n, price: p });
    }
    if (!rows.length) {
      setNote('One item per line, as name, price.');
      return;
    }
    setBulk('');
    setNote(null);
    await api.addItems(rows);
  }

  const draftTotal = draft.reduce((s, r) => s + toCents(r.price), 0);

  /* ---------- reading ---------- */

  if (mode === 'reading') {
    return (
      <>
        <Head onBack={onBack} title="Reading the receipt" sub="This takes a few seconds." />
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
        <div className="dock">
          <button className="btn primary wide tall" disabled>
            Reading
          </button>
        </div>
      </>
    );
  }

  /* ---------- review ---------- */

  if (mode === 'review') {
    return (
      <>
        <Head onBack={() => setMode('choose')} title="Check the items" sub="Items read from the photo. Fix any mistakes." />
        {note && <p className="banner warn">{note}</p>}
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
                  onChange={(e) => editDraft(r.key, 'name', e.target.value)}
                />
                <input
                  type="text"
                  inputMode="decimal"
                  className="price num"
                  value={r.price}
                  aria-label={'Price of ' + r.name}
                  onChange={(e) => editDraft(r.key, 'price', e.target.value)}
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
        <button
          className="btn outline wide"
          onClick={() => setDraft((prev) => [...prev, { key: rowKey(), name: '', price: '' }])}
        >
          <IconPlus /> Add an item
        </button>

        <div className="card" style={{ marginTop: 12 }}>
          <AmountField
            label="Tax"
            unitKey="tax"
            baseCents={draftTotal}
            cents={draftTaxCents}
            onChange={setDraftTaxCents}
          />
          <AmountField
            label="Tip"
            unitKey="tip"
            baseCents={draftTotal}
            cents={draftTipCents}
            onChange={setDraftTipCents}
          />
        </div>

        <div className="dock">
          <div className="meter">
            <span>
              {draft.length} {draft.length === 1 ? 'item' : 'items'}
            </span>
            <b className="num">{money(draftTotal)}</b>
          </div>
          <button className="btn primary wide tall" onClick={commitDraft} disabled={busy || !draft.length}>
            {busy ? 'Adding' : 'Add items'}
          </button>
        </div>
      </>
    );
  }

  /* ---------- choose ---------- */

  if (mode === 'choose') {
    return (
      <>
        <Head onBack={onBack} title="Add the items" sub="Take a photo of the receipt, or type the items." />
        {note && <p className="banner warn">{note}</p>}

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

        <button className="choice" onClick={() => setMode('type')}>
          <span className="glyph">
            <IconType />
          </span>
          <span className="t">
            <b>Type the items</b>
            <span>One at a time, or paste a list</span>
          </span>
        </button>

        <button className="choice" onClick={() => setMode('total')}>
          <span className="glyph">
            <IconList />
          </span>
          <span className="t">
            <b>Just a total</b>
            <span>One amount for the whole bill</span>
          </span>
        </button>

        <p className="tiny" style={{ textAlign: 'center', marginTop: 6 }}>
          <button
            className="btn ghost sm"
            onClick={() => api.addItems(SAMPLE.map(([n, p]) => ({ name: n, price: p })))}
          >
            Load sample
          </button>
        </p>

        <div className="dock">
          <button className="btn primary wide tall" onClick={onNext} disabled={!items.length}>
            Continue
          </button>
        </div>
      </>
    );
  }

  /* ---------- just a total ---------- */

  if (mode === 'total') {
    const totalCents = toCents(totalRaw);
    const label = (receipt.title || '').trim() || 'Bill';

    async function saveTotal() {
      setBusy(true);
      await api.addItems([{ name: label, price: totalCents / 100 }]);
      const patch = {};
      if (draftTaxCents) patch.tax_amount = draftTaxCents / 100;
      if (draftTipCents) patch.tip_amount = draftTipCents / 100;
      if (Object.keys(patch).length) await api.patchReceipt(patch);
      setBusy(false);
      onNext?.();
    }

    return (
      <>
        <Head onBack={() => setMode('choose')} title="Just a total" sub={'The whole bill goes on one line, ' + label + '.'} />

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
        </div>

        <div className="card">
          <AmountField label="Tax" unitKey="tax" baseCents={totalCents} cents={draftTaxCents} onChange={setDraftTaxCents} />
          <AmountField label="Tip" unitKey="tip" baseCents={totalCents} cents={draftTipCents} onChange={setDraftTipCents} />
          <p className="tiny">Both are optional.</p>
        </div>

        <div className="dock">
          <div className="meter">
            <span>Total</span>
            <b className="num">{money(totalCents + draftTaxCents + draftTipCents)}</b>
          </div>
          <button className="btn primary wide tall" onClick={saveTotal} disabled={busy || totalCents <= 0}>
            {busy ? 'Saving' : 'Continue'}
          </button>
        </div>
      </>
    );
  }

  /* ---------- type the items ---------- */

  const body = (
    <>
      {note && <p className="banner warn">{note}</p>}

      <div className="card">
        <div className="inline">
          <input
            ref={nameRef}
            type="text"
            value={name}
            placeholder="Item"
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
          <button className="btn soft" onClick={addOne} disabled={!name.trim() || !price.trim()} aria-label="Add this item">
            <IconPlus />
          </button>
        </div>
      </div>

      {items.length > 0 && !compact && (
        <div className="card flush">
          <div className="rows">
            {items.map((it) => (
              <div className="line" key={it.id}>
                <span className="grow name">{it.name}</span>
                <span className="amt num">{money(toCents(it.price))}</span>
                <button className="icon-btn bare" onClick={() => api.removeItem(it.id)} aria-label={'Remove ' + it.name}>
                  &times;
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <AmountField
          key={'tax' + String(receipt.tax_amount)}
          label="Tax"
          unitKey="tax"
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
          baseCents={split.itemsCents}
          cents={toCents(receipt.tip_amount)}
          onCommit={(c) => {
            if (c !== toCents(receipt.tip_amount)) api.patchReceipt({ tip_amount: c / 100 });
          }}
        />
        <p className="tiny">Tax and tip are split by what each person ordered.</p>
      </div>

      <details className="card">
        <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 15 }}>Paste a list</summary>
        <label className="field" style={{ marginTop: 12 }}>
          <span>One item per line, as name, price</span>
          <textarea
            value={bulk}
            placeholder={'Bacon, 9.12' + '\n' + 'Potatoes, 4.08'}
            onChange={(e) => setBulk(e.target.value)}
          />
        </label>
        <div className="two">
          <button className="btn outline" onClick={addBulk}>
            Add these items
          </button>
          <button
            className="btn outline"
            onClick={() => api.addItems(SAMPLE.map(([n, p]) => ({ name: n, price: p })))}
          >
            Load sample
          </button>
        </div>
      </details>
    </>
  );

  if (embedded) return body;

  return (
    <>
      <Head
        onBack={items.length ? () => setMode('choose') : onBack}
        title="Add the items"
        sub="Tax and tip are below."
      />
      {body}
      <div className="dock">
        <div className="meter">
          <span>
            {items.length} {items.length === 1 ? 'item' : 'items'}
          </span>
          <b className="num">{money(split.itemsCents + split.taxCents + split.tipCents)}</b>
        </div>
        <button className="btn primary wide tall" onClick={onNext} disabled={!items.length}>
          Continue
        </button>
      </div>
    </>
  );
}

function Head({ onBack, title, sub }) {
  return (
    <div className="step-head">
      {onBack && (
        <button className="btn ghost sm" style={{ padding: 0, marginBottom: 2 }} onClick={onBack}>
          <IconBack /> Back
        </button>
      )}
      <p className="step-count">Step 3 of 5</p>
      <h1>{title}</h1>
      {sub && <p className="sub">{sub}</p>}
    </div>
  );
}

import React, { useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { fromCents, money, splitEvenCents, toCents } from '../lib/money.js';
import { prepare } from '../lib/photo.js';
import { IconBack, IconCamera, IconPlus, IconType } from './ui.jsx';

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
  const [draftTax, setDraftTax] = useState('');
  const [draftTip, setDraftTip] = useState('');
  const [merchant, setMerchant] = useState(null);
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [bulk, setBulk] = useState('');
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
      setNote('The reader could not pull the lines off that photo, so type them in below.');
      setMode('type');
      return;
    }
    setMerchant(data.merchant || null);
    setDraft(expandRead(data.items));
    setDraftTax(data.tax == null ? '' : fromCents(toCents(data.tax)));
    setDraftTip(data.tip == null ? '' : fromCents(toCents(data.tip)));
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
      setNote('Nothing to add. Every line needs a name.');
      return;
    }
    setBusy(true);
    const ok = await api.addItems(rows);
    const patch = {};
    if (draftTax !== '') patch.tax_amount = toCents(draftTax) / 100;
    if (draftTip !== '') patch.tip_amount = toCents(draftTip) / 100;
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
      setNote('Put one item per line, written as name, price.');
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
        <Head onBack={onBack} title="The receipt" sub="Hold on while the lines come off the photo." />
        <div className="card">
          <div className="reading">
            {preview && (
              <span className="shot tiny">
                <img className="thumb" src={preview} alt="The receipt you just took" />
              </span>
            )}
            <div className="t">
              <b>Reading your receipt</b>
              <span className="tiny">This takes a few seconds.</span>
              <div className="track">
                <i />
              </div>
            </div>
          </div>
        </div>
        <div className="dock">
          <button className="btn primary wide tall" disabled>
            Reading your receipt
          </button>
        </div>
      </>
    );
  }

  /* ---------- review ---------- */

  if (mode === 'review') {
    return (
      <>
        <Head
          onBack={() => setMode('choose')}
          title="Check the lines"
          sub={merchant ? `Read from ${merchant}. Fix anything that came out wrong.` : 'Fix anything that came out wrong.'}
        />
        {note && <p className="banner warn">{note}</p>}
        {preview && (
          <div className="card" style={{ padding: 8 }}>
            <div className="shot">
              <img className="thumb" src={preview} alt="The receipt you just took" />
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
                  aria-label={'Drop ' + r.name}
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
          <IconPlus /> Add a line
        </button>

        <div className="card" style={{ marginTop: 12 }}>
          <div className="two">
            <label className="field">
              <span>Tax</span>
              <input
                type="text"
                inputMode="decimal"
                className="num"
                value={draftTax}
                placeholder="0.00"
                onChange={(e) => setDraftTax(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Tip</span>
              <input
                type="text"
                inputMode="decimal"
                className="num"
                value={draftTip}
                placeholder="0.00"
                onChange={(e) => setDraftTip(e.target.value)}
              />
            </label>
          </div>
        </div>

        <div className="dock">
          <div className="meter">
            <span>
              {draft.length} {draft.length === 1 ? 'line' : 'lines'}
            </span>
            <b className="num">{money(draftTotal)}</b>
          </div>
          <button className="btn primary wide tall" onClick={commitDraft} disabled={busy || !draft.length}>
            {busy ? 'Adding' : 'Looks right'}
          </button>
        </div>
      </>
    );
  }

  /* ---------- choose ---------- */

  if (mode === 'choose') {
    return (
      <>
        <Head onBack={onBack} title="The receipt" sub="Take a photo of it, or type the lines in yourself." />
        {note && <p className="banner warn">{note}</p>}

        <label className="choice">
          <span className="glyph">
            <IconCamera />
          </span>
          <span className="t">
            <b>Snap the receipt</b>
            <span>The lines are read off the photo</span>
          </span>
          <input type="file" accept="image/*" capture="environment" onChange={onFile} />
        </label>

        <button className="choice" onClick={() => setMode('type')}>
          <span className="glyph">
            <IconType />
          </span>
          <span className="t">
            <b>Type it in</b>
            <span>One line at a time, or paste a list</span>
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

  /* ---------- type it in ---------- */

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
        <div className="two">
          <label className="field">
            <span>Tax</span>
            <input
              type="text"
              inputMode="decimal"
              className="num"
              key={'tax' + String(receipt.tax_amount)}
              defaultValue={fromCents(toCents(receipt.tax_amount))}
              onBlur={(e) => {
                const v = toCents(e.target.value) / 100;
                if (v !== Number(receipt.tax_amount)) api.patchReceipt({ tax_amount: v });
              }}
            />
          </label>
          <label className="field">
            <span>Tip</span>
            <input
              type="text"
              inputMode="decimal"
              className="num"
              key={'tip' + String(receipt.tip_amount)}
              defaultValue={fromCents(toCents(receipt.tip_amount))}
              onBlur={(e) => {
                const v = toCents(e.target.value) / 100;
                if (v !== Number(receipt.tip_amount)) api.patchReceipt({ tip_amount: v });
              }}
            />
          </label>
        </div>
        <p className="tiny">Tax and tip get split in proportion to what each person ordered.</p>
      </div>

      <details className="card">
        <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 15 }}>Paste a list</summary>
        <label className="field" style={{ marginTop: 12 }}>
          <span>One item per line, written as name, price</span>
          <textarea
            value={bulk}
            placeholder={'Bacon, 9.12' + '\n' + 'Potatoes, 4.08'}
            onChange={(e) => setBulk(e.target.value)}
          />
        </label>
        <div className="two">
          <button className="btn outline" onClick={addBulk}>
            Add pasted items
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
        title="The receipt"
        sub="Add every line, then tax and tip."
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
      <p className="sub">{sub}</p>
    </div>
  );
}

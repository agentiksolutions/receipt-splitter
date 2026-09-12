import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from './supabaseClient';

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

// --- helpers -----------------------------------------------------------

function getReceiptIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('receipt');
}

function setReceiptIdInUrl(id) {
  const url = new URL(window.location.href);
  url.searchParams.set('receipt', id);
  window.history.replaceState({}, '', url);
}

async function createReceipt() {
  const { data, error } = await supabase
    .from('rs_receipts')
    .insert({ tax_amount: 0 })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// --- main component ------------------------------------------------------

export default function App() {
  const [receipt, setReceipt] = useState(null);
  const [people, setPeople] = useState([]); // [{id, name}]
  const [items, setItems] = useState([]); // [{id, name, price}]
  const [assignments, setAssignments] = useState([]); // [{item_id, person_id}]
  const [loading, setLoading] = useState(true);
  const [newPersonName, setNewPersonName] = useState('');
  const [newItemName, setNewItemName] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');
  const [bulkPaste, setBulkPaste] = useState('');
  const [photoUrl, setPhotoUrl] = useState(null);
  const [personModes, setPersonModes] = useState({}); // {personId: 'request'|'send'}
  const [personFields, setPersonFields] = useState({}); // {personId: {venmo, cashapp, zelle, phone, email}}
  const [taxText, setTaxText] = useState('0'); // raw input; parsed + saved on blur

  // --- bootstrap: load or create the receipt ---
  useEffect(() => {
    (async () => {
      let id = getReceiptIdFromUrl();
      if (!id) {
        const created = await createReceipt();
        id = created.id;
        setReceiptIdInUrl(id);
      }
      await loadAll(id);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAll = useCallback(async (receiptId) => {
    const [{ data: receiptRow }, { data: peopleRows }, { data: itemRows }, { data: assignmentRows }] =
      await Promise.all([
        supabase.from('rs_receipts').select('*').eq('id', receiptId).single(),
        supabase.from('rs_people').select('*').eq('receipt_id', receiptId).order('created_at'),
        supabase.from('rs_items').select('*').eq('receipt_id', receiptId).order('created_at'),
        supabase
          .from('rs_item_assignments')
          .select('item_id, person_id, rs_items!inner(receipt_id)')
          .eq('rs_items.receipt_id', receiptId)
      ]);
    setReceipt(receiptRow);
    setPeople(peopleRows || []);
    setItems(itemRows || []);
    setAssignments((assignmentRows || []).map((a) => ({ item_id: a.item_id, person_id: a.person_id })));
    if (receiptRow?.photo_url) setPhotoUrl(receiptRow.photo_url);
    setTaxText(String(receiptRow?.tax_amount ?? 0));
  }, []);

  // --- people ---
  async function addPerson() {
    const name = newPersonName.trim();
    if (!name || !receipt) return;
    setNewPersonName('');
    const { data, error } = await supabase
      .from('rs_people')
      .insert({ receipt_id: receipt.id, name })
      .select()
      .single();
    if (!error) setPeople((prev) => [...prev, data]);
  }

  async function removePerson(personId) {
    await supabase.from('rs_people').delete().eq('id', personId);
    setPeople((prev) => prev.filter((p) => p.id !== personId));
    setAssignments((prev) => prev.filter((a) => a.person_id !== personId));
  }

  // --- items ---
  async function addItem(name, price) {
    if (!name || isNaN(price) || !receipt) return;
    const { data, error } = await supabase
      .from('rs_items')
      .insert({ receipt_id: receipt.id, name, price })
      .select()
      .single();
    if (!error) setItems((prev) => [...prev, data]);
  }

  async function handleAddItem() {
    const name = newItemName.trim();
    const price = parseFloat(newItemPrice);
    setNewItemName('');
    setNewItemPrice('');
    await addItem(name, price);
  }

  async function handleBulkAdd() {
    const lines = bulkPaste.split('\n');
    for (const line of lines) {
      const parts = line.split(',');
      if (parts.length < 2) continue;
      const name = parts[0].trim();
      const price = parseFloat(parts[1]);
      if (name && !isNaN(price)) await addItem(name, price);
    }
    setBulkPaste('');
  }

  async function loadSample() {
    for (const [name, price] of SAMPLE_ITEMS) await addItem(name, price);
    await updateTax(1.5);
    setTaxText('1.5');
  }

  async function removeItem(itemId) {
    await supabase.from('rs_items').delete().eq('id', itemId);
    setItems((prev) => prev.filter((i) => i.id !== itemId));
    setAssignments((prev) => prev.filter((a) => a.item_id !== itemId));
  }

  async function toggleAssign(itemId, personId) {
    const exists = assignments.some((a) => a.item_id === itemId && a.person_id === personId);
    if (exists) {
      await supabase.from('rs_item_assignments').delete().eq('item_id', itemId).eq('person_id', personId);
      setAssignments((prev) => prev.filter((a) => !(a.item_id === itemId && a.person_id === personId)));
    } else {
      await supabase.from('rs_item_assignments').insert({ item_id: itemId, person_id: personId });
      setAssignments((prev) => [...prev, { item_id: itemId, person_id: personId }]);
    }
  }

  // --- tax ---
  async function updateTax(value) {
    if (!receipt) return;
    await supabase.from('rs_receipts').update({ tax_amount: value }).eq('id', receipt.id);
    setReceipt((prev) => ({ ...prev, tax_amount: value }));
  }

  // --- photo upload ---
  async function handlePhotoUpload(e) {
    const file = e.target.files[0];
    if (!file || !receipt) return;
    const path = `${receipt.id}/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from('receipt-photos').upload(path, file, { upsert: true });
    if (error) {
      console.error(error);
      return;
    }
    const { data } = supabase.storage.from('receipt-photos').getPublicUrl(path);
    await supabase.from('rs_receipts').update({ photo_url: data.publicUrl }).eq('id', receipt.id);
    setPhotoUrl(data.publicUrl);
  }

  // --- derived totals ---
  const subtotal = items.reduce((s, i) => s + Number(i.price), 0);
  const taxRate = subtotal > 0 ? (receipt?.tax_amount || 0) / subtotal : 0;

  function whoFor(itemId) {
    return assignments.filter((a) => a.item_id === itemId).map((a) => a.person_id);
  }

  function personSubtotal(personId) {
    let sum = 0;
    for (const item of items) {
      const who = whoFor(item.id);
      if (who.length && who.includes(personId)) sum += Number(item.price) / who.length;
    }
    return sum;
  }

  function personTotal(personId) {
    return personSubtotal(personId) * (1 + taxRate);
  }

  function itemSummaryFor(personId) {
    return items
      .map((it) => {
        const who = whoFor(it.id);
        if (!who.length) return null;
        if (!who.includes(personId)) return null;
        const share = who.length > 1 ? ` (split ${who.length} ways)` : '';
        return `${it.name} $${(Number(it.price) / who.length).toFixed(2)}${share}`;
      })
      .filter(Boolean)
      .join('\n');
  }

  function fieldsFor(personId) {
    return personFields[personId] || { venmo: '', cashapp: '', zelle: '', phone: '', email: '' };
  }

  function setField(personId, key, value) {
    setPersonFields((prev) => ({ ...prev, [personId]: { ...fieldsFor(personId), [key]: value } }));
  }

  function modeFor(personId) {
    return personModes[personId] || 'request';
  }

  function buildLinks(person) {
    const amt = personTotal(person.id).toFixed(2);
    const mode = modeFor(person.id);
    const f = fieldsFor(person.id);
    const links = {};

    if (f.venmo) {
      const txn = mode === 'request' ? 'charge' : 'pay';
      links.venmo = `https://venmo.com/${encodeURIComponent(f.venmo)}?txn=${txn}&amount=${amt}&note=${encodeURIComponent('Receipt split')}`;
    }
    if (f.cashapp) {
      if (mode === 'send') {
        links.cashapp = `https://cash.app/$${encodeURIComponent(f.cashapp.replace('$', ''))}/${amt}`;
      } else if (f.phone) {
        links.cashapp = `sms:${f.phone}?body=${encodeURIComponent(
          `Hey! Can you Cash App me $${amt} for the receipt split? My cashtag is $${f.cashapp}`
        )}`;
      }
    }
    if (f.zelle && f.phone) {
      const msg =
        mode === 'request'
          ? `Hey! Can you Zelle me $${amt} for the receipt split? My Zelle is ${f.zelle}`
          : `Hey! I'm sending you $${amt} via Zelle for the receipt split.`;
      links.zelle = `sms:${f.phone}?body=${encodeURIComponent(msg)}`;
    }
    const applePayMsg =
      mode === 'request'
        ? `Hey! Can you Apple Pay me $${amt} for the receipt split?`
        : `Hey! I'm sending you $${amt} via Apple Pay for the receipt split.`;
    links.applepay = f.phone ? `sms:${f.phone}?body=${encodeURIComponent(applePayMsg)}` : `sms:?body=${encodeURIComponent(applePayMsg)}`;

    const breakdown = itemSummaryFor(person.id);
    const textBody = `Receipt split:\n${breakdown}\n\n${person.name}'s share: $${amt}`;
    links.text = f.phone ? `sms:${f.phone}?body=${encodeURIComponent(textBody)}` : `sms:?body=${encodeURIComponent(textBody)}`;

    const emailBody = `Receipt split:\n\n${breakdown}\n\nSubtotal: $${subtotal.toFixed(2)}\nTax: $${(receipt?.tax_amount || 0).toFixed(
      2
    )}\n\n${person.name}'s share: $${amt}`;
    links.email = `mailto:${encodeURIComponent(f.email)}?subject=${encodeURIComponent('Receipt split')}&body=${encodeURIComponent(emailBody)}`;

    return links;
  }

  if (loading) return <div className="wrap">Loading...</div>;

  const shareUrl = window.location.href;

  return (
    <div className="wrap">
      <h1>Split a receipt</h1>
      <p className="sub">
        Shared link — anyone with this URL sees the same split. Copy it: <code>{shareUrl}</code>
      </p>

      <div className="card">
        <h2>Receipt photo (optional, for reference)</h2>
        <label className="file-btn" htmlFor="photo-input">Upload photo</label>
        <input id="photo-input" type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePhotoUpload} />
        {photoUrl && <img className="photo-preview" src={photoUrl} alt="Receipt" />}
        <p className="note">Stored in Supabase storage and visible to anyone with the link — it's just a visual reference, not auto-read.</p>
      </div>

      <div className="card">
        <h2>People splitting</h2>
        <div className="row">
          <input
            value={newPersonName}
            onChange={(e) => setNewPersonName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addPerson()}
            placeholder="Add a name"
          />
          <button className="addbtn" onClick={addPerson}>Add</button>
        </div>
        <div className="chip-row">
          {people.map((p) => (
            <div className="chip" key={p.id}>
              <span>{p.name}</span>
              <span className="x" onClick={() => removePerson(p.id)}>×</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Items</h2>
        <div className="row">
          <input value={newItemName} onChange={(e) => setNewItemName(e.target.value)} placeholder="Item name" />
          <input
            value={newItemPrice}
            onChange={(e) => setNewItemPrice(e.target.value)}
            placeholder="Price"
            style={{ maxWidth: 90 }}
            inputMode="decimal"
          />
          <button className="addbtn" onClick={handleAddItem}>Add</button>
        </div>
        <label style={{ marginTop: 14 }}>Or paste multiple lines (name, price per line)</label>
        <textarea rows={3} value={bulkPaste} onChange={(e) => setBulkPaste(e.target.value)} placeholder={'Bacon, 9.12\nPotatoes, 4.08'} />
        <div className="bulk">
          <button onClick={handleBulkAdd}>Add pasted items</button>
          <button onClick={loadSample}>Load sample receipt</button>
        </div>

        <label style={{ marginTop: 14 }}>Tax amount ($)</label>
        <input
          value={taxText}
          onChange={(e) => setTaxText(e.target.value)}
          onBlur={() => updateTax(parseFloat(taxText) || 0)}
          inputMode="decimal"
        />

        <div style={{ marginTop: 10 }}>
          {items.map((it) => {
            const who = whoFor(it.id);
            return (
              <div className="item-row" key={it.id}>
                <div className="item-top">
                  <div>
                    <div className="item-name">{it.name}</div>
                    <div className="item-price">${Number(it.price).toFixed(2)}</div>
                  </div>
                  <button className="del" onClick={() => removeItem(it.id)}>✕</button>
                </div>
                <div className="assign-chips">
                  {people.map((p) => (
                    <button
                      key={p.id}
                      className={'assign-chip' + (who.includes(p.id) ? ' active' : '')}
                      onClick={() => toggleAssign(it.id, p.id)}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <h2>Totals</h2>
        <div className="totals-grid">
          {people.map((p) => (
            <div className="stat" key={p.id}>
              <p className="label">{p.name} owes</p>
              <p className="value">${personTotal(p.id).toFixed(2)}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Request or send payment</h2>
        {people.map((p) => {
          const links = buildLinks(p);
          const f = fieldsFor(p.id);
          const mode = modeFor(p.id);
          return (
            <div className="person-card" key={p.id}>
              <div className="person-head">
                <span className="person-name">{p.name}</span>
                <span className="person-amt">${personTotal(p.id).toFixed(2)}</span>
              </div>
              <div className="toggle-row">
                <button
                  className={'toggle-btn' + (mode === 'request' ? ' active' : '')}
                  onClick={() => setPersonModes((prev) => ({ ...prev, [p.id]: 'request' }))}
                >
                  Request from them
                </button>
                <button
                  className={'toggle-btn' + (mode === 'send' ? ' active' : '')}
                  onClick={() => setPersonModes((prev) => ({ ...prev, [p.id]: 'send' }))}
                >
                  Send to them
                </button>
              </div>
              <label>Venmo username</label>
              <input value={f.venmo} onChange={(e) => setField(p.id, 'venmo', e.target.value)} />
              <label>Cash App $cashtag</label>
              <input value={f.cashapp} onChange={(e) => setField(p.id, 'cashapp', e.target.value)} />
              <label>Zelle phone or email</label>
              <input value={f.zelle} onChange={(e) => setField(p.id, 'zelle', e.target.value)} />
              <label>Their phone number</label>
              <input value={f.phone} onChange={(e) => setField(p.id, 'phone', e.target.value)} />
              <label>Their email</label>
              <input value={f.email} onChange={(e) => setField(p.id, 'email', e.target.value)} />

              <div className="pay-grid" style={{ marginTop: 10 }}>
                <a className={'pay-btn venmo' + (links.venmo ? '' : ' disabled')} href={links.venmo || '#'} target="_blank" rel="noreferrer">Venmo</a>
                <a className={'pay-btn cashapp' + (links.cashapp ? '' : ' disabled')} href={links.cashapp || '#'} target="_blank" rel="noreferrer">Cash App</a>
                <a className={'pay-btn zelle' + (links.zelle ? '' : ' disabled')} href={links.zelle || '#'} target="_blank" rel="noreferrer">Zelle</a>
                <a className="pay-btn applepay" href={links.applepay}>Apple Pay</a>
                <a
                  className="pay-btn cash"
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    alert(`Marked settled: $${personTotal(p.id).toFixed(2)} in cash for ${p.name}.`);
                  }}
                >
                  Mark settled in cash
                </a>
              </div>
              <div className="share-grid">
                <a className="share-btn" href={links.text}>Text {p.name} the breakdown</a>
                <a className="share-btn" href={links.email}>Email {p.name} the breakdown</a>
              </div>
              <p className="note">Cash App, Zelle, and Apple Pay can't carry a prefilled amount through a link either way, so those open a text with the number in it instead.</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

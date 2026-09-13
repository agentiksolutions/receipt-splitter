import React, { useState } from 'react';
import { supabase } from '../supabaseClient';
import {
  archivedIds,
  historyIds,
  minePersonIds,
  profile as readProfile,
  profileHandles,
  saveProfile
} from '../lib/history.js';
import { parseHandleCode } from '../lib/pay.js';
import { decodeQr } from '../lib/photo.js';
import { toast } from './ui.jsx';

// Every service that can be turned on, with the field that feeds it. Apple Cash
// has no handle at all: it is a text either way, so it is a toggle on its own.
const ROWS = [
  ['venmo', 'Venmo', 'Venmo username', true],
  ['cashapp', 'Cash App', 'Cash App cashtag', true],
  ['paypal', 'PayPal', 'PayPal.Me name', true],
  ['zelle', 'Zelle', 'Zelle phone or email', false],
  ['applecash', 'Apple Cash', null, false]
];

// The handle field each toggle reads, so turning one on can default from a value
// that is already saved.
const FIELD = { venmo: 'venmo', cashapp: 'cashapp', paypal: 'paypal', zelle: 'zelle', applecash: null };

/**
 * Your name and how people can pay you. Kept on this device, and copied onto the
 * "me" person of every split so a friend opening the link has somewhere to send
 * money without anybody being asked to type it again.
 */
export default function Profile({ firstRun = false, onClose }) {
  const [draft, setDraft] = useState(readProfile);
  const [spread, setSpread] = useState(true);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(null);

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  function toggle(service, on) {
    const accepts = { ...draft.accepts, [service]: on };
    let preferred = draft.preferred;
    if (!on && preferred === service) preferred = '';
    if (on && !preferred) preferred = service;
    set({ accepts, preferred });
  }

  // Typing a handle is the same statement as saying you use the service, so the
  // toggle follows the field rather than making somebody do it twice.
  function setHandle(service, value) {
    const field = FIELD[service];
    const patch = { [field]: value };
    if (value.trim() && !draft.accepts?.[service]) {
      patch.accepts = { ...draft.accepts, [service]: true };
      if (!draft.preferred) patch.preferred = service;
    }
    set(patch);
  }

  async function onScan(service, e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setScanning(service);
    let text = null;
    try {
      text = await decodeQr(file);
    } catch {
      text = null;
    }
    setScanning(null);
    applyCode(text);
  }

  function applyCode(text) {
    const found = parseHandleCode(text);
    if (!found) {
      toast('That code is not a Venmo, Cash App or PayPal code.');
      return;
    }
    const service = found.field === 'venmo_link' ? 'venmo' : found.field;
    set({
      [found.field]: found.value,
      accepts: { ...draft.accepts, [service]: true },
      preferred: draft.preferred || service
    });
    toast(found.label + ' added.');
  }

  function paste() {
    const text = window.prompt('Paste their Venmo, Cash App or PayPal link');
    if (text) applyCode(text);
  }

  // Handles already on this device's open splits go stale the moment the profile
  // changes, so the same edit can carry across them in one go. It writes only to
  // the rows this device created for its owner, never to rows matched by name: a
  // friend who shares your name would otherwise have their handles overwritten
  // on a split of theirs you happened to open.
  async function spreadToSplits(next) {
    const filed = new Set(archivedIds());
    const ids = minePersonIds(historyIds().filter((id) => !filed.has(id)));
    if (!ids.length) return 0;
    // profileHandles leaves blank fields out, so an empty box never nulls a
    // value that is already saved.
    const patch = { name: next.name, ...profileHandles(next) };
    const { error } = await supabase.from('rs_people').update(patch).in('id', ids);
    if (error) return 0;
    return ids.length;
  }

  async function save() {
    const name = (draft.name || '').trim();
    if (!name) return;
    setBusy(true);
    const next = saveProfile({ ...draft, name });
    let touched = 0;
    if (spread && !firstRun) touched = await spreadToSplits(next);
    setBusy(false);
    toast(touched ? `Saved, and updated ${touched} ${touched === 1 ? 'split' : 'splits'}.` : 'Profile saved.');
    onClose(next);
  }

  return (
    <div className="sheet-wrap open profile-wrap" role="dialog" aria-label="Your profile">
      <button className="sheet-veil" tabIndex={-1} aria-label="Close" onClick={() => onClose(null)} />
      <div className="sheet profile">
        <h2>Your profile</h2>
        <p className="tiny">Kept on this phone. Nobody signs in.</p>

        <label className="field" style={{ marginTop: 14 }}>
          <span>Your name</span>
          <input
            type="text"
            value={draft.name}
            placeholder="Jordan"
            autoFocus
            autoComplete="off"
            onChange={(e) => set({ name: e.target.value })}
          />
        </label>

        <p className="tiny">Add these so friends can pay you.</p>

        {ROWS.map(([service, label, placeholder]) => {
          const on = Boolean(draft.accepts?.[service]);
          const field = FIELD[service];
          return (
            <div className="svc" key={service}>
              <div className="svc-head">
                <label className="svc-use">
                  <input type="checkbox" checked={on} onChange={(e) => toggle(service, e.target.checked)} />
                  <span>{label}</span>
                </label>
                <label className={'svc-first' + (on ? '' : ' off')}>
                  <input
                    type="radio"
                    name="preferred"
                    checked={draft.preferred === service}
                    disabled={!on}
                    onChange={() => set({ preferred: service })}
                  />
                  <span>First choice</span>
                </label>
              </div>
              {field && (
                <div className="inline">
                  <input
                    type="text"
                    value={draft[field] || ''}
                    placeholder={placeholder}
                    autoComplete="off"
                    aria-label={placeholder}
                    onChange={(e) => setHandle(service, e.target.value)}
                  />
                  {service !== 'zelle' && (
                    <label className="btn outline sm scan-btn">
                      {scanning === service ? 'Reading' : 'Scan'}
                      <input type="file" accept="image/*" capture="environment" onChange={(e) => onScan(service, e)} />
                    </label>
                  )}
                </div>
              )}
              {service === 'venmo' && (draft.venmo_link || '').trim() && !(draft.venmo || '').trim() && (
                <p className="tiny">Scanned code saved.</p>
              )}
            </div>
          );
        })}

        <p className="tiny">
          <button className="btn ghost sm" style={{ padding: 0 }} onClick={paste}>
            Paste a link instead
          </button>
        </p>

        <label className="field">
          <span>Phone</span>
          <input type="tel" value={draft.phone || ''} autoComplete="off" onChange={(e) => set({ phone: e.target.value })} />
        </label>
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            value={draft.email || ''}
            autoComplete="off"
            onChange={(e) => set({ email: e.target.value })}
          />
        </label>

        {!firstRun && (
          <label className="svc-use" style={{ marginBottom: 14 }}>
            <input type="checkbox" checked={spread} onChange={(e) => setSpread(e.target.checked)} />
            <span>Update on my open splits too</span>
          </label>
        )}

        <div className="two">
          {!firstRun && (
            <button className="btn outline" onClick={() => onClose(null)}>
              Cancel
            </button>
          )}
          <button className="btn primary" onClick={save} disabled={busy || !(draft.name || '').trim()}>
            {busy ? 'Saving' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

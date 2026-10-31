import React, { useState } from 'react';
import { supabase } from '../supabaseClient';
import { saveFriend } from '../lib/friends.js';
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
// The last column is the symbol the service prints in front of a handle.
// pay.js strips a leading @ or $ before building any link, so typing one is
// harmless either way. Showing it fixed in the box is about removing the doubt:
// "@" for Venmo and "$" for Cash App are what people read off a phone screen,
// and without it nobody knows whether to type it. PayPal takes a plain name in
// paypal.me/<name>, and Zelle takes a phone or an email, so neither has one.
const ROWS = [
  ['venmo', 'Venmo', 'username', true, '@'],
  ['cashapp', 'Cash App', 'cashtag', true, '$'],
  ['paypal', 'PayPal', 'PayPal.Me name', true, ''],
  ['zelle', 'Zelle', 'phone or email', false, ''],
  ['applecash', 'Apple Cash', null, false, '']
];

// The handle field each toggle reads, so turning one on can default from a value
// that is already saved.
const FIELD = { venmo: 'venmo', cashapp: 'cashapp', paypal: 'paypal', zelle: 'zelle', applecash: null };

// The services a saved friend can have a handle for. Apple Cash is not one:
// there is no handle to hold, and a friend has not said what they take.
const FRIEND_ROWS = ROWS.filter(([, , placeholder]) => placeholder);

// Which services a friend has, read off the handles that are filled in. A
// scanned Venmo code counts, since it opens Venmo at the same person.
export function friendServices(friend) {
  const filled = { ...friend, venmo: friend.venmo || friend.venmo_link };
  // The handle goes next to the label on purpose. Two friends both called David
  // with only a Venmo each rendered as two identical rows, and the only way to
  // tell them apart was to open both. "Venmo david-ruiz" tells them apart here.
  return FRIEND_ROWS.filter(([service]) => (filled[FIELD[service]] || '').trim()).map(([service, label]) => {
    const value = String(filled[FIELD[service]] || '').trim();
    return value && value.length < 30 ? label + ' ' + value : label;
  });
}

/**
 * One saved friend, over the profile. Its own form and its own Save, so nothing
 * here can reach the profile draft underneath or the rs_people rows the profile
 * Save writes to. It writes to this device only.
 */
export function FriendSheet({ friend, onClose }) {
  const [form, setForm] = useState(friend);
  const name = (form.name || '').trim();
  const title = friend.id ? 'Edit friend' : 'Add a friend';
  const edit = (patch) => setForm((f) => ({ ...f, ...patch }));

  return (
    <div className="sheet-wrap open profile-wrap" role="dialog" aria-label={title}>
      <button className="sheet-veil" tabIndex={-1} aria-label="Close" onClick={() => onClose(false)} />
      <div className="sheet profile">
        <h2>{title}</h2>
        <p className="tiny">
          Kept on this phone. A split takes a copy, so changes here do not reach a split you have
          already sent.
        </p>

        <label className="field" style={{ marginTop: 14 }}>
          <span>Name</span>
          <input
            type="text"
            value={form.name || ''}
            placeholder="Casey"
            autoFocus
            autoComplete="off"
            onChange={(e) => edit({ name: e.target.value })}
          />
        </label>

        {FRIEND_ROWS.map(([service, label, placeholder]) => (
          <label className="field" key={service}>
            <span>{label}</span>
            <input
              type="text"
              value={form[FIELD[service]] || ''}
              placeholder={placeholder}
              autoComplete="off"
              onChange={(e) => edit({ [FIELD[service]]: e.target.value })}
            />
          </label>
        ))}

        <label className="field">
          <span>Phone</span>
          <input type="tel" value={form.phone || ''} autoComplete="off" onChange={(e) => edit({ phone: e.target.value })} />
        </label>

        <div className="two">
          <button className="btn outline" onClick={() => onClose(false)}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!name}
            onClick={() => {
              saveFriend({ ...form, name });
              onClose(true);
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

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
          {/* firstRun, not the leftover `focus` prop that went away when Friends
              moved to its own screen. `focus` resolved to the global
              window.focus, so the test was permanently true and every visit from
              the Me button threw the keyboard over the payment fields. */}
          <input
            type="text"
            value={draft.name}
            placeholder="Jordan"
            autoFocus={firstRun}
            autoComplete="off"
            onChange={(e) => set({ name: e.target.value })}
          />
        </label>

        <p className="tiny">
          Tick the ones you take. Photograph the QR code in your Venmo or Cash App
          and Scan code fills it in, so you do not have to type it.
        </p>

        {ROWS.map(([service, label, placeholder, , mark]) => {
          const on = Boolean(draft.accepts?.[service]);
          const field = FIELD[service];
          return (
            <div className={'svc' + (on ? ' on' : '')} key={service}>
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
              {field && on && (
                <div className="inline">
                  <div className={'handle-box' + (mark ? ' marked' : '')}>
                    {mark && <span className="handle-mark">{mark}</span>}
                    <input
                      type="text"
                      value={draft[field] || ''}
                      placeholder={placeholder}
                      autoComplete="off"
                      aria-label={label + ' ' + placeholder}
                      onChange={(e) => setHandle(service, e.target.value)}
                    />
                  </div>
                  {service !== 'zelle' && (
                    <label className="btn outline sm scan-btn">
                      {scanning === service ? 'Reading' : 'Scan code'}
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

import React, { useEffect, useRef, useState } from 'react';
import { fromCents, money } from '../lib/money.js';
import {
  buildPaymentLinks,
  buildShareLinks,
  SERVICE_LABELS,
  SERVICE_ORDER,
  servicesFor,
  venmoProfileLink
} from '../lib/pay.js';
import Qr from './Qr.jsx';
import { Avatar, IconCheck, IconChevron, toast } from './ui.jsx';

// Apple Cash exists on Apple hardware and nowhere else. Offering it as the one
// button on an Android phone is a dead end, so that case gets a plain text.
const APPLE =
  typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Macintosh|Mac OS X/.test(navigator.userAgent || '');

const METHODS = ['Venmo', 'Cash App', 'PayPal', 'Zelle', 'Apple Cash', 'Cash'];

const HANDLES = [
  { key: 'venmo', label: 'Venmo username', type: 'text' },
  { key: 'cashapp', label: 'Cash App cashtag', type: 'text' },
  { key: 'paypal', label: 'PayPal.Me name', type: 'text' },
  { key: 'zelle', label: 'Zelle phone or email', type: 'text' },
  { key: 'phone', label: 'Phone', type: 'tel' },
  { key: 'email', label: 'Email', type: 'email' }
];

// Which single field a greyed payment button is missing, so tapping it can ask
// for that one thing instead of opening a form of six.
const ADD_FIELD = {
  venmo: { key: 'venmo', label: 'Venmo username', hint: 'The name on the Venmo profile.', type: 'text' },
  cashapp: { key: 'cashapp', label: 'Cash App cashtag', hint: 'With or without the $.', type: 'text' },
  paypal: { key: 'paypal', label: 'PayPal.Me name', hint: 'The last part of a paypal.me link.', type: 'text' },
  zelle: { key: 'zelle', label: 'Zelle phone or email', hint: 'Whatever the bank has on file.', type: 'text' },
  applepay: { key: 'phone', label: 'Phone number', hint: 'Apple Cash goes over iMessage.', type: 'tel' }
};

async function copy(text, said) {
  try {
    await navigator.clipboard.writeText(text);
    toast(said);
  } catch {
    toast('Could not copy. Long press the amount instead.');
  }
}

/**
 * One person's line on the settle screen. Collapsed by default to a name, an
 * amount, the one way they are most likely to pay, and Mark as paid. Everything
 * else is one tap away behind More.
 *
 * @param {object}  person   whose row this is, the one who owes
 * @param {'request'|'send'} mode
 *   request: the payer asking this person for money
 *   send:    this person paying the payer, using the payer's handles
 * @param {?object} target   in send mode, who the money goes to
 * @param {?object} me       in request mode, the requester's own handles
 * @param {boolean} savedAsFile  a PDF has actually come down as a file, so the
 *   note about email attachments is a fact rather than a guess.
 * @param {function} onAddHandle (service, fieldKey, value) for a service with no
 *   handle. The service key is separate because applepay writes the phone
 *   column, so the column alone cannot say which service was asked for.
 *   Which side is missing depends on the mode: a REQUEST link is built from the
 *   requester's handles, a SEND link from the target's, so the caller owns
 *   deciding where the answer is written.
 */
export default function PersonCard({
  person,
  share,
  title,
  shareUrl,
  payerName,
  mode = 'request',
  target = null,
  me = null,
  onSaveField,
  onAddHandle,
  onSettle,
  onPdf,
  savedAsFile = false
}) {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState(person.settled_via || '');
  const [showQr, setShowQr] = useState(false);
  const [showItems, setShowItems] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [adding, setAdding] = useState(null);
  const venmoTimer = useRef(null);

  // The fallback fires 1.2s after we try the app scheme. Marking someone paid
  // collapses this card, so the timer has to die with it or it navigates the
  // page out from under whoever is still here.
  useEffect(() => () => clearTimeout(venmoTimer.current), []);

  if (person.settled) {
    return (
      <div className="card paid">
        <div className="owed">
          <span className="tick">
            <IconCheck />
          </span>
          <span className="grow">
            <span className="who-name">{person.name}</span>
            <span className="owes">{person.settled_via ? 'Paid by ' + person.settled_via : 'Paid'}</span>
          </span>
          <span className="num" style={{ fontWeight: 600 }}>
            {money(share.totalCents)}
          </span>
          <button className="btn ghost sm" onClick={() => onSettle(person.id, false, null)} aria-label={'Undo, ' + person.name + ' has not paid'}>
            Undo
          </button>
        </div>
      </div>
    );
  }

  const other = mode === 'send' ? target : person;
  const { links, apps, bodies } = buildPaymentLinks(other || person, share.totalCents, mode, title, me);
  // A friend paying the payer sees only what the payer takes, first choice
  // first. A request is built from MY handles, so it follows MY profile the
  // same way, which is what makes First choice mean anything on this screen.
  // Either way the list stays non-strict when nobody has said what they take,
  // so the greyed buttons that add a handle are still there.
  const picked = servicesFor(mode === 'send' ? target : me);
  const list = picked.list;
  const strict = picked.strict;
  const amount = fromCents(share.totalCents);
  const touch = typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches;

  // The one button on the collapsed card: the first service they can actually
  // be paid through. SERVICE_ORDER starts at Venmo, and a person who named a
  // first choice has it moved to the front by servicesFor.
  //
  // Naming services and having a handle for none of them would otherwise leave
  // a friend with no button at all, so fall back to anything that does work.
  // The payer's own view is non-strict and can still add the missing one.
  const offer = strict && !list.some((key) => links[key]) ? SERVICE_ORDER.filter((key) => links[key]) : list;
  const wanted = offer.find((key) => links[key]) || (strict ? null : offer[0]) || null;
  // Apple Cash as the ONLY way to pay, on a phone that has never had it.
  const appleOnly = wanted === 'applepay' && !APPLE;
  const primary = appleOnly ? null : wanted;
  const rest = offer.filter((key) => key !== primary);

  // A request link is "text them asking for money", built from MY handles. A
  // send link is built from theirs. So a greyed button is missing a different
  // person's handle in each mode, and the sheet has to say whose.
  const handleOwner = mode === 'send' ? target?.name || 'They' : 'You';

  // Marking somebody paid should not need a second decision. Whatever button
  // was just tapped is the answer, and the picker under More overrides it.
  const settledAs = method || (primary ? SERVICE_LABELS[primary] : 'Cash');

  // On a phone, try to open the Venmo app first. If it opened, the page is
  // hidden by the time the timer runs and we leave it alone. If it did not, the
  // universal link opens Venmo at that person, with the amount in the text.
  function openVenmo(e) {
    if (!touch || !apps.venmo) return;
    e.preventDefault();
    clearTimeout(venmoTimer.current);
    venmoTimer.current = setTimeout(() => {
      if (document.visibilityState === 'visible' && links.venmo) window.location.href = links.venmo;
    }, 1200);
    window.location.href = apps.venmo;
  }

  function payCell(key) {
    const href = links[key];
    // Venmo cannot carry an amount in a link, and neither can a text. The
    // amount is one paste away instead of a retype.
    const copyable = key === 'venmo' || key === 'zelle' || key === 'applepay';
    const label = SERVICE_LABELS[key];
    if (!href) {
      // Nothing to open, so the button asks for the one thing that is missing.
      return (
        <div className="pay-cell" key={key}>
          <button
            className={'pay v-' + key + ' off'}
            onClick={() => setAdding(key)}
            aria-label={'Add a ' + label + ' handle'}
          >
            {label}
          </button>
        </div>
      );
    }
    return (
      <div className="pay-cell" key={key}>
        <a
          className={'pay v-' + key}
          href={href}
          target={href.startsWith('http') ? '_blank' : undefined}
          rel="noreferrer"
          aria-label={label + ', ' + money(share.totalCents) + ', ' + person.name}
          onClick={(e) => {
            setMethod(label);
            if (key === 'venmo') openVenmo(e);
          }}
        >
          {label}
        </a>
        {copyable && (
          <button className="copy-amt" onClick={() => copy('$' + amount, 'Copied $' + amount)} aria-label={'Copy ' + money(share.totalCents)}>
            Copy ${amount}
          </button>
        )}
      </div>
    );
  }

  const shareLinks = buildShareLinks({ ...share, phone: person.phone, email: person.email }, title);
  const copyBody = bodies[list.find((key) => bodies[key])] || '';
  // In request mode links.venmo is an sms: URI holding the other person's phone
  // number. Putting that in a QR leaks the number and opens a text composer.
  // What somebody across the table should scan is MY Venmo profile.
  const venmoQr = mode === 'send' ? links.venmo : venmoProfileLink(me || {});
  const qrValue = venmoQr || shareUrl;
  const owesLine = mode === 'send' ? 'you owe ' + (payerName || 'the payer') : 'owes ' + (payerName || 'the payer');
  const field = adding ? ADD_FIELD[adding] : null;

  return (
    <div className="card">
      <div className="owed">
        <Avatar name={person.name} index={person.colorIndex} size="lg" />
        <span className="grow">
          <span className="who-name">{person.name}</span>
          <span className="owes">{owesLine}</span>
        </span>
        <span className="big num">{money(share.totalCents)}</span>
      </div>

      {primary && <div className="pays one">{payCell(primary)}</div>}

      {appleOnly && (
        <>
          <a className="btn outline wide" style={{ marginTop: 10 }} href={shareLinks.text}>
            Text the amount
          </a>
          {copyBody && (
            <button
              className="btn outline wide"
              style={{ marginTop: 8 }}
              onClick={() => copy(copyBody, 'Copied. Paste it anywhere.')}
            >
              {mode === 'send' ? 'Copy message' : 'Copy request'}
            </button>
          )}
        </>
      )}

      <button
        className="btn soft wide"
        style={{ marginTop: 10 }}
        onClick={() => onSettle(person.id, true, settledAs)}
        aria-label={'Mark ' + person.name + ' paid by ' + settledAs}
      >
        Mark paid by {settledAs}
      </button>

      <button className="disclose" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <IconChevron open={open} />
        {open ? 'Less' : 'More'}
      </button>

      {open && (
        <div className="reveal">
          {rest.length > 0 && <div className="pays">{rest.map((key) => (strict && !links[key] ? null : payCell(key)))}</div>}

          <p className="tiny">
            Venmo and Cash App open the app with the amount filled in when the phone allows it. If the amount is
            blank, paste it.
          </p>

          <div className="three" style={{ marginTop: 8 }}>
            <a className="btn outline sm" href={shareLinks.text} aria-label={'Text ' + person.name}>
              Text
            </a>
            <a className="btn outline sm" href={shareLinks.email} aria-label={'Email ' + person.name}>
              Email
            </a>
            <button className="btn outline sm" onClick={onPdf} aria-label={"Send " + person.name + "'s statement as a PDF"}>
              Send PDF
            </button>
          </div>

          {copyBody && !appleOnly && (
            <button
              className="btn outline sm wide"
              style={{ marginTop: 8 }}
              onClick={() => copy(copyBody, 'Copied. Paste it anywhere.')}
            >
              {mode === 'send' ? 'Copy message' : 'Copy request'}
            </button>
          )}
          {savedAsFile && (
            <p className="tiny">An email link cannot carry an attachment, so the PDF was saved as a file instead.</p>
          )}

          <button className="disclose" onClick={() => setShowItems((v) => !v)} aria-expanded={showItems}>
            <IconChevron open={showItems} />
            {showItems ? 'Hide items' : `Show items (${share.lines.length})`}
          </button>

          {showItems && (
            <div className="breakdown reveal">
              {share.lines.map((l, i) => (
                <div key={i}>
                  <span>
                    {l.name}
                    {l.splitWays > 1 ? ` (split ${l.splitWays} ways)` : ''}
                  </span>
                  <span className="num">{money(l.shareCents)}</span>
                </div>
              ))}
              <div className="sub-line">
                <span>Tax</span>
                <span className="num">{money(share.taxCents)}</span>
              </div>
              <div className="sub-line">
                <span>Tip</span>
                <span className="num">{money(share.tipCents)}</span>
              </div>
            </div>
          )}

          <button className="disclose" onClick={() => setShowQr((v) => !v)} aria-expanded={showQr}>
            <IconChevron open={showQr} />
            {showQr ? 'Hide QR' : 'Show QR'}
          </button>

          {showQr && (
            <div className="qr reveal">
              <Qr value={qrValue} size={168} alt={'Payment code for ' + person.name} />
              <p className="tiny" style={{ textAlign: 'center' }}>
                {venmoQr ? 'Scan to open Venmo at this profile.' : 'Scan to open this split.'}
              </p>
            </div>
          )}

          <button className="disclose" onClick={() => setShowDetails((v) => !v)} aria-expanded={showDetails}>
            <IconChevron open={showDetails} />
            Payment details
          </button>

          {showDetails && (
            <div className="reveal" style={{ marginTop: 4 }}>
              {HANDLES.map((f) => (
                <label className="field" key={f.key}>
                  <span>{f.label}</span>
                  <input
                    type={f.type}
                    key={person[f.key] || ''}
                    defaultValue={person[f.key] || ''}
                    autoComplete="off"
                    onBlur={(e) => onSaveField(person.id, f.key, e.target.value.trim())}
                  />
                </label>
              ))}
            </div>
          )}

          <label className="field" style={{ marginTop: 12 }}>
            <span>Mark paid by something else</span>
            <select aria-label={'How ' + person.name + ' paid'} value={settledAs} onChange={(e) => setMethod(e.target.value)}>
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {field && (
        <HandleSheet
          field={field}
          who={handleOwner}
          onCancel={() => setAdding(null)}
          onSave={(value) => {
            onAddHandle?.(adding, field.key, value);
            setAdding(null);
          }}
        />
      )}
    </div>
  );
}

// One field, one Save. Tapping a payment button nobody has a handle for should
// ask for that handle and nothing else.
function HandleSheet({ field, who, onCancel, onSave }) {
  const [value, setValue] = useState('');

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  function save() {
    const v = value.trim();
    if (!v) return;
    onSave(v);
  }

  return (
    <div className="ask-wrap" role="dialog" aria-modal="true" aria-label={field.label}>
      <button className="ask-veil" aria-label="Cancel" onClick={onCancel} />
      <div className="ask">
        <h2>{field.label}</h2>
        <p>
          {who === 'You' ? 'Add yours' : 'Add ' + who + "'s"} and this button starts working. {field.hint}
        </p>
        <label className="field">
          <span>{field.label}</span>
          <input
            type={field.type}
            value={value}
            autoFocus
            autoComplete="off"
            autoCapitalize="none"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
        </label>
        <button className="btn primary wide tall" style={{ marginTop: 12 }} disabled={!value.trim()} onClick={save}>
          Save
        </button>
        <button className="btn ghost wide tall" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

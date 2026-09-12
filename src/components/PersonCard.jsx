import React, { useState } from 'react';
import { fromCents, money } from '../lib/money.js';
import { buildPaymentLinks, buildShareLinks } from '../lib/pay.js';
import Qr from './Qr.jsx';
import { Avatar, BRANDS, IconCheck, IconChevron } from './ui.jsx';

const METHODS = ['Venmo', 'Cash App', 'Zelle', 'Apple Pay', 'Cash'];

const HANDLES = [
  { key: 'venmo', label: 'Venmo username', type: 'text' },
  { key: 'cashapp', label: 'Cash App cashtag', type: 'text' },
  { key: 'zelle', label: 'Zelle phone or email', type: 'text' },
  { key: 'phone', label: 'Phone', type: 'tel' },
  { key: 'email', label: 'Email', type: 'email' }
];

export default function PersonCard({ person, share, title, shareUrl, payerName, onSaveField, onSettle }) {
  const [mode, setMode] = useState('request');
  const [method, setMethod] = useState(person.settled_via || 'Venmo');
  const [showQr, setShowQr] = useState(false);
  const [showItems, setShowItems] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

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
          <button className="btn ghost sm" onClick={() => onSettle(person.id, false, null)}>
            Undo
          </button>
        </div>
      </div>
    );
  }

  const links = buildPaymentLinks(person, share.totalCents, mode, title);
  const shareLinks = buildShareLinks({ ...share, phone: person.phone, email: person.email }, title);
  const qrValue = links.venmo || shareUrl;

  return (
    <div className="card">
      <div className="owed">
        <Avatar name={person.name} index={person.colorIndex} size="lg" />
        <span className="grow">
          <span className="who-name">{person.name}</span>
          <span className="owes">owes {payerName || 'the payer'}</span>
        </span>
        <span className="big num">{money(share.totalCents)}</span>
      </div>

      <button className="disclose" onClick={() => setShowItems((v) => !v)} aria-expanded={showItems}>
        <IconChevron open={showItems} />
        {showItems ? 'Hide the items' : `Show the ${share.lines.length} ${share.lines.length === 1 ? 'item' : 'items'}`}
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

      <div className="seg" style={{ marginTop: 12 }} role="group" aria-label={'Direction for ' + person.name}>
        <button className={mode === 'request' ? 'on' : ''} aria-pressed={mode === 'request'} onClick={() => setMode('request')}>
          Request
        </button>
        <button className={mode === 'send' ? 'on' : ''} aria-pressed={mode === 'send'} onClick={() => setMode('send')}>
          Send
        </button>
      </div>

      <div className="pays">
        {BRANDS.map(({ key, label, Mark }) => {
          const href = links[key];
          return (
            <a
              key={key}
              className={'pay v-' + key + (href ? '' : ' off')}
              href={href || undefined}
              target={href && href.startsWith('http') ? '_blank' : undefined}
              rel="noreferrer"
              aria-disabled={href ? undefined : 'true'}
            >
              <Mark />
              {label}
            </a>
          );
        })}
      </div>

      <div className="two" style={{ marginTop: 8 }}>
        <a className="btn outline sm" href={shareLinks.text}>
          Text the breakdown
        </a>
        <a className="btn outline sm" href={shareLinks.email}>
          Email the breakdown
        </a>
      </div>

      <button className="disclose" onClick={() => setShowQr((v) => !v)} aria-expanded={showQr}>
        <IconChevron open={showQr} />
        {showQr ? 'Hide QR' : 'Show QR'}
      </button>

      {showQr && (
        <div className="qr reveal">
          <Qr value={qrValue} size={168} alt={'Payment code for ' + person.name} />
          <p className="tiny" style={{ textAlign: 'center' }}>
            {links.venmo
              ? `Scan to open Venmo with $${fromCents(share.totalCents)} already filled in.`
              : 'Scan to open this split. Add a Venmo username to turn this into a payment code.'}
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
          <p className="tiny">
            Venmo and Cash App carry the amount in the link. Zelle and Apple Pay cannot, so those open a text with
            the amount written into it.
          </p>
        </div>
      )}

      <div className="inline" style={{ marginTop: 12 }}>
        <select
          aria-label={'How ' + person.name + ' paid'}
          value={method}
          onChange={(e) => setMethod(e.target.value)}
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <button className="btn soft" onClick={() => onSettle(person.id, true, method)}>
          Mark paid
        </button>
      </div>
    </div>
  );
}

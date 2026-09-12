import React, { useState } from 'react';
import { money, fromCents } from '../lib/money.js';
import { buildPaymentLinks, buildShareLinks } from '../lib/pay.js';
import Qr from './Qr.jsx';

/* Brand marks, drawn here rather than fetched. Each is a plain shape in
   currentColor so it takes the contrast of the button it sits on. */

const Venmo = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2.6 2.6h3.7l2.2 7.7 2.3-7.7h3.6l-4.6 10.8H7.2z" fill="currentColor" />
  </svg>
);

const CashApp = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
    <path d="M11 4.3a3.1 3.1 0 0 0-4.7.4c-.7 1.2.2 2.4 1.8 2.8 1.6.4 2.5 1.6 1.8 2.8A3.1 3.1 0 0 1 5 10.7" />
    <path d="M8.6 1.9v1.6M7.4 12.5v1.6" />
  </svg>
);

const Zelle = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 1.2v2.1M8 12.7v2.1" />
    <path d="M4.6 3.9h6.8L4.6 12.1h6.8" />
  </svg>
);

const ApplePay = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <path d="M4.6 4.2a5.4 5.4 0 0 1 0 7.6M7.7 5.6a3.3 3.3 0 0 1 0 4.8M10.8 7a1.4 1.4 0 0 1 0 2" />
  </svg>
);

const Check = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.5 8.6l3.6 3.6 7.4-8.4" />
  </svg>
);

const METHODS = ['Cash', 'Venmo', 'Cash App', 'Zelle', 'Apple Pay', 'Other'];

const BRANDS = [
  { key: 'venmo', label: 'Venmo', Mark: Venmo },
  { key: 'cashapp', label: 'Cash App', Mark: CashApp },
  { key: 'zelle', label: 'Zelle', Mark: Zelle },
  { key: 'applepay', label: 'Apple Pay', Mark: ApplePay }
];

const HANDLE_FIELDS = [
  { key: 'venmo', label: 'Venmo username' },
  { key: 'cashapp', label: 'Cash App $cashtag' },
  { key: 'zelle', label: 'Zelle phone or email' },
  { key: 'phone', label: 'Their phone' },
  { key: 'email', label: 'Their email', full: true }
];

export default function PersonCard({ person, share, title, shareUrl, isPayer, payerName, onSaveField, onSettle }) {
  const [mode, setMode] = useState('request');
  const [method, setMethod] = useState(person.settled_via || 'Cash');
  const [showQr, setShowQr] = useState(false);

  const links = buildPaymentLinks(person, share.totalCents, mode, title);
  const shareLinks = buildShareLinks({ ...share, phone: person.phone, email: person.email }, title);
  const qrValue = links.venmo || shareUrl;
  const qrIsVenmo = Boolean(links.venmo);

  return (
    <div className={'stub' + (person.settled ? ' settled' : '')}>
      <div className="stub-head">
        <span className="stub-name">{person.name}</span>
        <span className="stub-amt">{money(share.totalCents)}</span>
        {person.settled && (
          <span className="settled-mark">
            <Check /> Settled{person.settled_via ? ` via ${person.settled_via}` : ''}
          </span>
        )}
      </div>

      {share.lines.length > 0 ? (
        <div className="stub-lines">
          {share.lines.map((l, i) => (
            <div className="line" key={i}>
              <span className="lbl">
                {l.name}
                {l.splitWays > 1 ? ` (split ${l.splitWays} ways)` : ''}
              </span>
              <span className="dots" />
              <span className="val">{money(l.shareCents)}</span>
            </div>
          ))}
          {share.taxCents > 0 && (
            <div className="line muted">
              <span className="lbl">Tax share</span>
              <span className="dots" />
              <span className="val">{money(share.taxCents)}</span>
            </div>
          )}
          {share.tipCents > 0 && (
            <div className="line muted">
              <span className="lbl">Tip share</span>
              <span className="dots" />
              <span className="val">{money(share.tipCents)}</span>
            </div>
          )}
        </div>
      ) : (
        <p className="note">No items assigned yet, so nothing is owed.</p>
      )}

      {isPayer ? (
        <p className="note">
          {person.name} paid the bill. This is their own share of it, so there is nothing to collect.
        </p>
      ) : (
        <>
          <div className="toggle" role="group" aria-label={`Direction for ${person.name}`}>
            <button className={mode === 'request' ? 'on' : ''} onClick={() => setMode('request')} aria-pressed={mode === 'request'}>
              Request from them
            </button>
            <button className={mode === 'send' ? 'on' : ''} onClick={() => setMode('send')} aria-pressed={mode === 'send'}>
              Send to them
            </button>
          </div>

          <div className="handles">
            {HANDLE_FIELDS.map((f) => (
              <label className={'field' + (f.full ? ' full' : '')} key={f.key}>
                <span>{f.label}</span>
                <input
                  type={f.key === 'email' ? 'email' : 'text'}
                  key={person[f.key] || ''}
                  defaultValue={person[f.key] || ''}
                  autoComplete="off"
                  onBlur={(e) => onSaveField(person.id, f.key, e.target.value.trim())}
                />
              </label>
            ))}
          </div>

          <div className="pays">
            {BRANDS.map(({ key, label, Mark }) => {
              const href = links[key];
              return (
                <a
                  key={key}
                  className={`pay v-${key}` + (href ? '' : ' off')}
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

          <div className="stub-actions">
            <a className="btn quiet" href={shareLinks.text}>
              Text
            </a>
            <a className="btn quiet" href={shareLinks.email}>
              Email
            </a>
            <button className="btn quiet" onClick={() => setShowQr((v) => !v)} aria-expanded={showQr}>
              {showQr ? 'Hide QR' : 'Show QR'}
            </button>
          </div>

          {showQr && (
            <div className="qr-open">
              <Qr value={qrValue} size={168} alt={`QR code for ${person.name}`} />
              <p className="note">
                {qrIsVenmo
                  ? `Scan to open Venmo with $${fromCents(share.totalCents)} already filled in.`
                  : 'Scan to open this receipt. Add a Venmo username to get a payment code instead.'}
              </p>
            </div>
          )}

          <div className="stub-actions">
            {person.settled ? (
              <button className="btn quiet wide" onClick={() => onSettle(person.id, false, null)}>
                Mark unsettled
              </button>
            ) : (
              <>
                <select
                  aria-label={`How ${person.name} settled`}
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                >
                  {METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <button className="btn primary" onClick={() => onSettle(person.id, true, method)}>
                  Mark settled
                </button>
              </>
            )}
          </div>

          <p className="note">
            Venmo and Cash App carry the amount in the link. Zelle and Apple Pay do not, so those open a
            text with the amount written in it.{payerName ? ` Money goes to ${payerName}.` : ''}
          </p>
        </>
      )}
    </div>
  );
}

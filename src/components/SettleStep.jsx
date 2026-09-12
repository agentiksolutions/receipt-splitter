import React from 'react';
import { money } from '../lib/money.js';
import { Avatar, IconBack } from './ui.jsx';
import PersonCard from './PersonCard.jsx';

export default function SettleStep({
  receipt,
  people,
  split,
  byPerson,
  payer,
  payerName,
  shareUrl,
  api,
  onDone,
  onBack,
  embedded
}) {
  const others = people.filter((p) => !payer || p.id !== payer.id);
  const owing = others.filter((p) => (byPerson.get(p.id)?.totalCents || 0) > 0);
  const paid = owing.filter((p) => p.settled).length;
  const outstanding = owing
    .filter((p) => !p.settled)
    .reduce((sum, p) => sum + (byPerson.get(p.id)?.totalCents || 0), 0);

  const body = (
    <>
      <div className="hero">
        <p className="label">Total</p>
        <p className="amount num">{money(split.grandCents)}</p>
        <div className="facts">
          <div>
            Tax
            <b className="num">{money(split.taxCents)}</b>
          </div>
          <div>
            Tip
            <b className="num">{money(split.tipCents)}</b>
          </div>
          <div>
            Paid by
            <b>{payerName || 'nobody yet'}</b>
          </div>
        </div>
      </div>

      {split.unassignedItems.length > 0 && (
        <p className="banner warn">
          {split.unassignedItems.length} {split.unassignedItems.length === 1 ? 'item has' : 'items have'} nobody on
          them, so they are held out of every share.
        </p>
      )}

      {!payerName && <p className="banner warn">Nobody is set as the payer, so there is no one to collect.</p>}

      {payer && (
        <div className="card">
          <div className="owed">
            <Avatar name={payer.name} index={payer.colorIndex} size="lg" />
            <span className="grow">
              <span className="who-name">{payer.name}</span>
              <span className="owes">paid the bill, this is their own share</span>
            </span>
            <span className="num" style={{ fontWeight: 600 }}>
              {money(byPerson.get(payer.id)?.totalCents || 0)}
            </span>
          </div>
        </div>
      )}

      {owing.length > 0 && (
        <p className="tiny" style={{ margin: '16px 0 10px' }}>
          {paid} of {owing.length} paid
          {outstanding > 0 ? `, ${money(outstanding)} outstanding` : ''}
        </p>
      )}

      {others.map((p) => (
        <PersonCard
          key={p.id}
          person={p}
          share={byPerson.get(p.id)}
          title={receipt.title}
          shareUrl={shareUrl}
          payerName={payerName}
          onSaveField={api.savePersonField}
          onSettle={api.setSettled}
        />
      ))}

      {others.length === 0 && <p className="empty">Nobody else is on this split yet.</p>}
    </>
  );

  if (embedded) return body;

  return (
    <>
      <div className="step-head">
        <button className="btn ghost sm" style={{ padding: 0, marginBottom: 2 }} onClick={onBack}>
          <IconBack /> Back
        </button>
        <p className="step-count">Step 5 of 5</p>
        <h1>Settle up</h1>
        <p className="sub">Send each person their number, then mark them off as the money lands.</p>
      </div>
      {body}
      <div className="dock">
        <button className="btn primary wide tall" onClick={onDone}>
          Done
        </button>
      </div>
    </>
  );
}

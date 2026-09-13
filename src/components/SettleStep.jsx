import React from 'react';
import { money } from '../lib/money.js';
import { buildStatementPdf, deliverPdf, slugify } from '../lib/statement-pdf.js';
import { Avatar, IconBack } from './ui.jsx';
import PersonCard from './PersonCard.jsx';

export default function SettleStep({
  receipt,
  people,
  items,
  assignments,
  split,
  byPerson,
  payer,
  payerName,
  shareUrl,
  api,
  onDone,
  onBack,
  onDelete,
  embedded
}) {
  const others = payer ? people.filter((p) => p.id !== payer.id) : [];

  // Built and handed over inside the click, with no await in between, because
  // iOS only opens the share sheet while the user gesture is still live.
  function makePdf(forPersonId) {
    const who = forPersonId ? people.find((p) => p.id === forPersonId) : null;
    const blob = buildStatementPdf({
      receipt,
      people,
      items,
      assignments,
      split,
      payer,
      forPersonId,
      shareUrl
    });
    const name = 'halfsies-' + slugify(receipt.title) + (who ? '-' + slugify(who.name) : '') + '.pdf';
    deliverPdf(blob, name, receipt.title || 'Halfsies');
  }
  const owing = others.filter((p) => (byPerson.get(p.id)?.totalCents || 0) > 0);
  const paid = owing.filter((p) => p.settled).length;
  const outstanding = owing
    .filter((p) => !p.settled)
    .reduce((sum, p) => sum + (byPerson.get(p.id)?.totalCents || 0), 0);

  // The payer is stored by name, so an older split can name somebody who is not
  // on the list. That resolves to no payer and the picker comes back.
  const picker = (
    <div className="card">
      <h2 style={{ marginBottom: 10 }}>Who paid the bill?</h2>
      {people.length === 0 ? (
        <p className="tiny">Add people first.</p>
      ) : (
        <div className="chips">
          {people.map((p) => (
            <button
              key={p.id}
              className={'tap' + (payer && p.id === payer.id ? ' on' : '')}
              aria-pressed={Boolean(payer && p.id === payer.id)}
              onClick={() => api.setPayer(p)}
            >
              <Avatar name={p.name} index={p.colorIndex} size="sm" />
              {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const total = (
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
        {payerName && (
          <div>
            Paid by
            <b>{payerName}</b>
          </div>
        )}
      </div>
    </div>
  );

  const body = (
    <>
      <div className="head-actions">
        <button className="btn ghost sm" onClick={() => makePdf(null)}>
          Full PDF
        </button>
      </div>
      {picker}
      {total}

      {split.unassignedItems.length > 0 && (
        <p className="banner warn">
          {split.unassignedItems.length} {split.unassignedItems.length === 1 ? 'item is' : 'items are'} not assigned
          to anyone, so nobody is charged for {split.unassignedItems.length === 1 ? 'it' : 'them'}.
        </p>
      )}

      {payer && (
        <>
          <div className="card">
            <div className="owed">
              <Avatar name={payer.name} index={payer.colorIndex} size="lg" />
              <span className="grow">
                <span className="who-name">{payer.name}</span>
                <span className="owes">paid the bill, this is their share</span>
              </span>
              <span className="num" style={{ fontWeight: 600 }}>
                {money(byPerson.get(payer.id)?.totalCents || 0)}
              </span>
            </div>
          </div>

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
              onPdf={() => makePdf(p.id)}
            />
          ))}

          {others.length === 0 && <p className="empty">Nobody else is on this split.</p>}
        </>
      )}

      <div style={{ marginTop: 24, textAlign: 'center' }}>
        <button className="btn ghost sm" onClick={onDelete}>
          Delete split
        </button>
      </div>
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
        <p className="sub">Send each person their amount. Mark them as paid when they pay.</p>
      </div>
      {body}
      <div className="dock">
        <button className="btn primary wide tall" onClick={onDone} disabled={!payer}>
          Done
        </button>
      </div>
    </>
  );
}

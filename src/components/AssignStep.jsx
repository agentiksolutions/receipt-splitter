import React from 'react';
import { money, toCents } from '../lib/money.js';
import { Avatar, IconBack } from './ui.jsx';
import ItemsStep from './ItemsStep.jsx';

export default function AssignStep(props) {
  const { people, items, claimed, split, payer, api, onNext, onBack, embedded } = props;
  const open = split.unassignedItems.length;
  const assigned = items.length - open;

  const list = (
    <>
      {items.length > 1 && (
        <div className="two" style={{ marginBottom: 12 }}>
          <button className="btn outline" onClick={api.splitEvenly}>
            Split everything evenly
          </button>
          <button className="btn outline" onClick={api.restToPayer} disabled={!payer || !open}>
            Rest to {payer ? payer.name : 'the payer'}
          </button>
        </div>
      )}

      {items.length === 0 && <p className="empty">No items yet. Add them below.</p>}

      {items.length > 0 && (
        <div className="card flush">
          <div className="rows">
            {items.map((it) => {
              const who = claimed.get(it.id);
              const orphan = !who || who.size === 0;
              return (
                <div className={'item' + (orphan ? ' open' : '')} key={it.id}>
                  <div className="item-top">
                    <span className="name">{it.name}</span>
                    <span className="amt num">{money(toCents(it.price))}</span>
                    {embedded && (
                      <button className="icon-btn bare" onClick={() => api.removeItem(it.id)} aria-label={'Remove ' + it.name}>
                        &times;
                      </button>
                    )}
                  </div>
                  <div className="who">
                    {people.map((p) => {
                      const on = who?.has(p.id);
                      return (
                        <button
                          key={p.id}
                          className={'tap' + (on ? ' on' : '')}
                          aria-pressed={Boolean(on)}
                          onClick={() => api.toggleAssign(it.id, p.id)}
                        >
                          <Avatar name={p.name} index={p.colorIndex} size="sm" />
                          {p.name}
                        </button>
                      );
                    })}
                  </div>
                  {orphan && <span className="flag">Nobody has this yet</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );

  if (embedded) {
    return (
      <>
        {list}
        <details className="card" style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 15 }}>Add items, tax and tip</summary>
          <div style={{ marginTop: 12 }}>
            <ItemsStep {...props} embedded compact />
          </div>
        </details>
      </>
    );
  }

  return (
    <>
      <div className="step-head">
        <button className="btn ghost sm" style={{ padding: 0, marginBottom: 2 }} onClick={onBack}>
          <IconBack /> Back
        </button>
        <p className="step-count">Step 4 of 5</p>
        <h1>Who had what</h1>
        <p className="sub">Tap a name on every line. Tap again to take it back off.</p>
      </div>
      {list}
      <div className="dock">
        <div className="meter">
          <span>
            {assigned} of {items.length} {items.length === 1 ? 'item' : 'items'} assigned
          </span>
          {open > 0 ? <span className="warn">{open} left</span> : <b className="num">{money(split.grandCents)}</b>}
        </div>
        <button className="btn primary wide tall" onClick={onNext} disabled={!items.length || open > 0}>
          Continue
        </button>
      </div>
    </>
  );
}

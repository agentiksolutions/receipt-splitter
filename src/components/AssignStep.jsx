import React, { useState } from 'react';
import { money, toCents } from '../lib/money.js';
import { Avatar, IconBack, IconList, IconUsers, Mark } from './ui.jsx';
import ItemsStep from './ItemsStep.jsx';

export default function AssignStep(props) {
  const { people, items, claimed, split, payer, api, onNext, onBack, embedded } = props;
  const open = split.unassignedItems.length;
  const assigned = items.length - open;
  const [picked, setPicked] = useState(null);
  const [busy, setBusy] = useState(false);

  // The three cards are the way in. Once anything is assigned they step aside,
  // because the split already has a shape and the list is what you want.
  const showModes = items.length > 0 && assigned === 0 && picked !== 'byitem';
  const showList = items.length > 0 && (embedded || assigned > 0 || picked === 'byitem');

  async function assignToEveryone() {
    setBusy(true);
    await api.splitEvenly();
    setBusy(false);
    onNext?.();
  }

  const modes = (
    <div style={{ marginBottom: 12 }}>
      {people.length === 2 && (
        <button className="choice" onClick={assignToEveryone} disabled={busy}>
          <span className="glyph">
            <Mark size={24} />
          </span>
          <span className="t">
            <b>Halfsies</b>
            <span>Every item split between the two of you</span>
          </span>
        </button>
      )}

      <button className="choice" onClick={assignToEveryone} disabled={busy}>
        <span className="glyph">
          <IconUsers />
        </span>
        <span className="t">
          <b>Split evenly</b>
          <span>Every item split between everyone</span>
        </span>
      </button>

      <button className="choice" onClick={() => setPicked('byitem')} disabled={busy}>
        <span className="glyph">
          <IconList />
        </span>
        <span className="t">
          <b>By what each person had</b>
          <span>Tap the people who had each item</span>
        </span>
      </button>
    </div>
  );

  const list = (
    <>
      {payer && open > 0 && items.length > 1 && (
        <button className="btn outline wide" style={{ marginBottom: 12 }} onClick={api.restToPayer}>
          Rest to {payer.name}
        </button>
      )}

      {items.length === 0 && <p className="empty">No items yet.</p>}

      {showList && (
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
        {showModes && modes}
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
        <h1>{showModes ? 'How do you want to split it?' : 'Who had what'}</h1>
        <p className="sub">{showModes ? 'Pick one.' : 'Tap the people who had each item.'}</p>
      </div>
      {showModes && modes}
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

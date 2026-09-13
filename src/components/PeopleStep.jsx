import React, { useState } from 'react';
import { Avatar, IconBack, IconPlus } from './ui.jsx';

export default function PeopleStep({ people, payer, api, onNext, onBack, embedded }) {
  const [name, setName] = useState('');

  function add() {
    const v = name.trim();
    if (!v) return;
    setName('');
    api.addPeople([v]);
  }

  const card = (
    <>
      <div className="card">
        <div className="inline">
          <input
            type="text"
            value={name}
            placeholder="Name"
            autoComplete="off"
            autoFocus={!embedded}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
          <button className="btn soft" onClick={add} disabled={!name.trim()} aria-label="Add this person">
            <IconPlus />
          </button>
        </div>

        {people.length > 0 && (
          <div className="chips" style={{ marginTop: 14 }}>
            {people.map((p) => {
              // The payer is picked on the settle screen, so it can be nobody
              // here. Anyone can still be removed; the picker comes back if the
              // person it pointed at is gone.
              const isPayer = payer && p.id === payer.id;
              return (
                <span className={'chip' + (isPayer ? ' payer' : '')} key={p.id}>
                  <Avatar name={p.name} index={p.colorIndex} />
                  {p.name}
                  {isPayer && <span className="tag">paid</span>}
                  <button className="x" onClick={() => api.removePerson(p.id)} aria-label={'Remove ' + p.name}>
                    &times;
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </div>
      {people.length < 2 && <p className="tiny">Add at least two people.</p>}
    </>
  );

  if (embedded) return card;

  return (
    <>
      <div className="step-head">
        <button className="btn ghost sm" style={{ padding: 0, marginBottom: 2 }} onClick={onBack}>
          <IconBack /> Back
        </button>
        <p className="step-count">Step 2 of 5</p>
        <h1>Add people</h1>
        <p className="sub">Type a name and press enter.</p>
      </div>
      {card}
      <div className="dock">
        <button className="btn primary wide tall" onClick={onNext} disabled={people.length < 2}>
          Continue
        </button>
      </div>
    </>
  );
}

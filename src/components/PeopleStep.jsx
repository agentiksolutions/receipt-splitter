import React, { useState } from 'react';
import { Avatar, IconPlus } from './ui.jsx';

export default function PeopleStep({ people, payer, api, onNext, embedded }) {
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
            placeholder="Add a name"
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
              const isPayer = payer && p.id === payer.id;
              return (
                <span className={'chip' + (isPayer ? ' payer' : '')} key={p.id}>
                  <Avatar name={p.name} index={p.colorIndex} />
                  {p.name}
                  {isPayer ? (
                    <span className="tag">paid</span>
                  ) : (
                    <button className="x" onClick={() => api.removePerson(p.id)} aria-label={'Remove ' + p.name}>
                      &times;
                    </button>
                  )}
                </span>
              );
            })}
          </div>
        )}
      </div>
      {people.length < 2 && (
        <p className="tiny">Add at least one more person. Whoever paid is already on the list.</p>
      )}
    </>
  );

  if (embedded) return card;

  return (
    <>
      <div className="step-head">
        <p className="step-count">Step 2 of 5</p>
        <h1>Who is splitting</h1>
        <p className="sub">Type a name and press enter. You can add more later.</p>
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

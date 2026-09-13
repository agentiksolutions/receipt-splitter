import React, { useState } from 'react';

// Asks once for the owner's name. Used on the first split and again from the
// menu when they want to change it.
export default function NameCard({ value, sub, onSave, onCancel }) {
  const [name, setName] = useState(value || 'Me');
  const clean = name.trim();

  return (
    <div className="card">
      <h2 style={{ marginBottom: sub ? 4 : 10 }}>Your name</h2>
      {sub && <p className="tiny" style={{ marginBottom: 10 }}>{sub}</p>}
      <div className="inline">
        <input
          type="text"
          value={name}
          placeholder="Me"
          autoComplete="off"
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && clean) {
              e.preventDefault();
              onSave(clean);
            }
          }}
        />
        <button className="btn soft" onClick={() => onSave(clean)} disabled={!clean}>
          Save
        </button>
      </div>
      {onCancel && (
        <button className="btn ghost sm" style={{ marginTop: 8, padding: 0 }} onClick={onCancel}>
          Cancel
        </button>
      )}
    </div>
  );
}

import React, { useState } from 'react';
import { listFriends, removeFriend } from '../lib/friends.js';
import { FriendSheet, friendServices } from './Profile.jsx';
import { Avatar, confirmSheet, EmptyState, IconMenu, IconPlus, Wordmark } from './ui.jsx';

// The roster, on its own screen.
//
// It used to sit at the bottom of the profile sheet, under your name, five
// payment services and a phone and email field. Two different things were
// sharing one page: who you are, and who you split with. Reaching a friend
// meant scrolling past every field you own.
//
// The list itself never leaves this phone. Adding a friend to a split copies
// their handles onto that split; nothing here syncs anywhere and no rs_people
// row points back at a roster entry.
export default function Friends({ onMenu }) {
  const [friends, setFriends] = useState(listFriends);
  // The friend being edited, or an empty object for a new one. Null is closed.
  const [editing, setEditing] = useState(null);

  async function drop(friend) {
    const ok = await confirmSheet({
      title: `Delete ${friend.name || 'this friend'}?`,
      line: 'Their handles come off this phone. Splits they are already on do not change.'
    });
    if (!ok) return;
    removeFriend(friend.id);
    setFriends(listFriends());
  }

  return (
    <div className="col">
      <header className="topbar">
        <Wordmark onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} />
        <button className="icon-btn" onClick={onMenu} aria-label="Menu">
          <IconMenu />
        </button>
      </header>

      <h2 style={{ margin: '14px 0 6px' }}>Friends</h2>
      <p className="tiny" style={{ marginBottom: 14 }}>
        Saved on this phone so you do not retype a Venmo username every time.
      </p>

      <button className="btn primary wide tall" onClick={() => setEditing({})}>
        Add a friend
      </button>

      {friends.length === 0 ? (
        <EmptyState icon={<IconPlus />} line="Nobody saved yet. Add the people you split with most." />
      ) : (
        <div className="card flush" style={{ flexShrink: 0, marginTop: 14 }}>
          <div className="rows">
            {friends.map((friend, i) => (
              <div className="line" key={friend.id}>
                <Avatar name={friend.name} index={i} />
                <div className="grow">
                  <div className="name">{friend.name}</div>
                  <div className="meta">{friendServices(friend).join(', ') || 'No handles saved'}</div>
                </div>
                <button className="btn ghost sm" onClick={() => setEditing(friend)}>
                  Edit
                </button>
                <button className="btn ghost sm" onClick={() => drop(friend)}>
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {editing && (
        <FriendSheet
          friend={editing}
          onClose={(saved) => {
            setEditing(null);
            if (saved) setFriends(listFriends());
          }}
        />
      )}
    </div>
  );
}

import React from 'react';
import { money } from '../lib/money.js';
import { personKey } from '../lib/trip.js';
import { Chip } from './ui.jsx';

// First name only, so the pills stay short. The owner reads as "You". Matched
// on the same normalised key the trip netting uses, so "casey" and "Casey " are
// one person on both screens.
export function pillName(person, meName) {
  if (meName && personKey(person.name) === personKey(meName)) return 'You';
  return person.name.trim().split(/\s+/)[0] || person.name;
}

/**
 * One line of the bill with a pill per person and a Split pill for everyone.
 * Used against draft rows before insert and against saved rows after, so it
 * takes plain values and callbacks rather than reaching for either store.
 * With `everyone` the pills go away: the line is already on the whole table.
 */
export default function ItemRow({ name, cents, people, meName, assigned, onToggle, onAll, onRemove, everyone }) {
  const all = people.length > 0 && people.every((p) => assigned.has(p.id));

  return (
    <div className="bill-line">
      <div className="bill-what">
        <span className="bill-name">{name || 'Untitled item'}</span>
        <span className="bill-price num">{money(cents)}</span>
        {everyone && <span className="bill-everyone">Everyone</span>}
      </div>
      {!everyone && (
        <div className="pills">
          {people.map((p) => {
            const on = assigned.has(p.id);
            return (
              <button
                key={p.id}
                className={'pill' + (on ? ' on' : '')}
                aria-pressed={on}
                aria-label={p.name + ', ' + (name || 'Untitled item')}
                onClick={() => onToggle(p.id)}
              >
                {pillName(p, meName)}
              </button>
            );
          })}
          <button
            className={'pill' + (all ? ' on' : '')}
            aria-pressed={all}
            aria-label={'Everyone, ' + (name || 'Untitled item')}
            onClick={() => onAll(!all)}
          >
            Split
          </button>
        </div>
      )}
      {onRemove && (
        <button className="icon-btn bare bill-x" onClick={onRemove} aria-label={'Remove ' + name}>
          &times;
        </button>
      )}
    </div>
  );
}

/**
 * The sticky running total above the list: what each person owes so far, how
 * much of the bill still has nobody on it, and the two shortcuts for finishing
 * it off, hiding the lines already done and putting the rest on the payer.
 */
export function AssignHeader({
  people,
  meName,
  split,
  unassigned,
  onlyUnassigned = false,
  onFilter,
  payerName,
  onRest
}) {
  const owed = new Map(split.perPerson.map((p) => [p.id, p.totalCents]));

  return (
    <div className="assign-head">
      <div className="owe-row">
        {people.map((p) => (
          <span className="owe" key={p.id}>
            <span className="who">{pillName(p, meName)} owe{pillName(p, meName) === 'You' ? '' : 's'}</span>
            <b className="num">{money(owed.get(p.id) || 0)}</b>
          </span>
        ))}
      </div>
      <p className="owe-note">
        {unassigned === 0
          ? 'All items assigned'
          : `${unassigned} ${unassigned === 1 ? 'item' : 'items'} not assigned yet`}
      </p>
      {(onFilter || onRest) && (
        <div className="assign-chips">
          {onFilter && (
            <Chip on={onlyUnassigned} disabled={unassigned === 0 && !onlyUnassigned} onClick={onFilter}>
              Unassigned only
            </Chip>
          )}
          {onRest && payerName && (
            <Chip disabled={unassigned === 0} onClick={onRest}>
              Rest to {payerName}
            </Chip>
          )}
        </div>
      )}
    </div>
  );
}

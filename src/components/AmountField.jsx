import React, { useEffect, useRef, useState } from 'react';
import { fromCents, money, toCents } from '../lib/money.js';

// Tax and tip are stored in the database as dollars, always. This field only
// changes how you type them. Percent mode reads the number as a percent of the
// item subtotal and converts before anything is saved.

const storeKey = (name) => 'rs.unit.' + name;

function readUnit(name) {
  try {
    return localStorage.getItem(storeKey(name)) === '%' ? '%' : '$';
  } catch {
    return '$';
  }
}

// A photo read hands over real dollars, so the field has to be in dollars when
// it lands. Otherwise a remembered "%" reads $18.55 as 18.55 percent.
export function forceDollars(name) {
  writeUnit(name, '$');
}

function writeUnit(name, unit) {
  try {
    localStorage.setItem(storeKey(name), unit);
  } catch {
    /* private mode: the unit just resets next time */
  }
}

function pctFromCents(cents, baseCents) {
  if (!baseCents || !cents) return '';
  // Three decimals is enough to round trip 8% of any normal subtotal.
  return String(Math.round((cents / baseCents) * 100000) / 1000);
}

function centsFromRaw(raw, unit, baseCents) {
  if (unit === '$') return toCents(raw);
  const pct = parseFloat(raw);
  if (!isFinite(pct) || !baseCents) return 0;
  return Math.round((baseCents * pct) / 100);
}

/**
 * @param {string} label      shown above the input
 * @param {string} unitKey    which unit to remember, "tax" or "tip"
 * @param {number} baseCents  item subtotal, what a percent is taken from
 * @param {number} cents      the dollar amount already stored, in cents
 * @param {function} onChange fires on every keystroke with the dollar cents
 * @param {function} onCommit fires on blur with the dollar cents
 * @param {boolean} autoWrite  may the base effect write a recomputed amount?
 *   Only the device that owns the split may. A viewer whose remembered unit is
 *   "%" would otherwise reprice somebody else's tip the moment a new item
 *   lands. Their own typing still commits; this is about the automatic write.
 */
export default function AmountField({
  label,
  unitKey,
  baseCents = 0,
  cents = 0,
  autoWrite = true,
  onChange,
  onCommit
}) {
  const [unit, setUnit] = useState(() => readUnit(unitKey));
  const [raw, setRaw] = useState(() => {
    if (readUnit(unitKey) === '%') return pctFromCents(cents, baseCents);
    return cents ? fromCents(cents) : '';
  });

  // A percent of nothing is nothing. With no items yet there is no subtotal to
  // take a percent of, so the field holds the number and saves nothing until
  // there is one.
  const canConvert = unit === '$' || baseCents > 0;
  const resultCents = centsFromRaw(raw, unit, baseCents);

  const send = (value) => {
    if (!canConvert) return;
    onChange?.(value);
    onCommit?.(value);
  };

  // A percent follows its base. Add an item and "8%" has to become a bigger
  // number of dollars, so the amount is recomputed and handed back up. The ref
  // keeps this from firing on the first render, where nothing has moved yet.
  const seenBase = useRef(baseCents);
  useEffect(() => {
    if (seenBase.current === baseCents) return;
    const hadNoBase = !seenBase.current;
    seenBase.current = baseCents;
    if (unit !== '%' || !baseCents) return;
    if (hadNoBase && raw === '') {
      // The percent could not be worked out while there were no items. It can now.
      setRaw(pctFromCents(cents, baseCents));
      return;
    }
    if (raw === '') return;
    if (!autoWrite) {
      // Not ours to rewrite. Show what the stored dollars come to against the
      // new subtotal and leave the row alone.
      setRaw(pctFromCents(cents, baseCents));
      return;
    }
    send(centsFromRaw(raw, unit, baseCents));
    // Only a change in the base should run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseCents]);

  function swap(next) {
    if (next === unit) return;
    // The money stays put across a unit change. Only the way it is written changes.
    const held = centsFromRaw(raw, unit, baseCents);
    const nextRaw = next === '%' ? pctFromCents(held, baseCents) : held ? fromCents(held) : '';
    setUnit(next);
    setRaw(nextRaw);
    writeUnit(unitKey, next);
    if (next === '$' || baseCents > 0) {
      const out = centsFromRaw(nextRaw, next, baseCents);
      onChange?.(out);
      onCommit?.(out);
    }
  }

  function type(value) {
    setRaw(value);
    if (canConvert) onChange?.(centsFromRaw(value, unit, baseCents));
  }

  return (
    <div className="field amount">
      <span>{label}</span>
      <div className="amount-row">
        <input
          type="text"
          inputMode="decimal"
          className="num"
          aria-label={label}
          value={raw}
          placeholder={unit === '%' ? '0' : '0.00'}
          onChange={(e) => type(e.target.value)}
          onBlur={() => canConvert && onCommit?.(centsFromRaw(raw, unit, baseCents))}
        />
        <div className="seg unit" role="group" aria-label={label + ' unit'}>
          <button type="button" className={unit === '$' ? 'on' : ''} aria-pressed={unit === '$'} onClick={() => swap('$')}>
            $
          </button>
          <button
            type="button"
            className={unit === '%' ? 'on' : ''}
            aria-pressed={unit === '%'}
            onClick={() => swap('%')}
          >
            %
          </button>
        </div>
      </div>
      {unit === '%' && (
        <div className="result num">{canConvert ? '= ' + money(resultCents) : 'Add items first'}</div>
      )}
    </div>
  );
}

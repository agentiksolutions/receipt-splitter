// All receipt math runs in integer cents. Floats are allowed at two edges
// only: parsing a typed price, and formatting for display.
//
// The invariant every caller depends on:
//   sum(perPerson[i].totalCents) === grandCents
//   grandCents === assignedCents + allocatedTaxCents + allocatedTipCents

export function toCents(value) {
  const n = typeof value === 'number' ? value : parseFloat(value);
  if (!isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function fromCents(cents) {
  return (cents / 100).toFixed(2);
}

export function money(cents) {
  return (cents < 0 ? '-$' : '$') + fromCents(Math.abs(cents));
}

// Hand out `extra` leftover cents one at a time, largest share first.
// Ties break by original order, so the result is stable across renders.
//
// Only somebody who actually ordered can take one. Three people where two split
// a plate and the tax is a single cent used to hand that cent to the third, who
// ordered nothing and owed nothing. Filter on the WEIGHT, never on the floored
// share: a real weight can floor to zero and is still owed its cent.
function allocateRemainder(shares, extra, weights) {
  const order = shares
    .map((cents, index) => ({ cents, index }))
    .filter(({ index }) => weights[index] > 0)
    .sort((a, b) => b.cents - a.cents || a.index - b.index);
  const out = shares.slice();
  if (!order.length) return out;
  for (let i = 0; i < extra; i++) out[order[i % order.length].index] += 1;
  return out;
}

// Split one amount across weights, exact to the cent.
// Returns an array of cents summing to exactly `amountCents`.
function splitProportionally(amountCents, weights) {
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  if (amountCents === 0 || totalWeight === 0) return weights.map(() => 0);
  const base = weights.map((w) => Math.floor((amountCents * w) / totalWeight));
  const used = base.reduce((s, c) => s + c, 0);
  return allocateRemainder(base, amountCents - used, weights);
}

/**
 * @param {{id:string, name:string}[]} people      order defines tie-breaks
 * @param {{id:string, name:string, price:number|string}[]} items
 * @param {{item_id:string, person_id:string}[]} assignments
 * @param {number|string} taxAmount  dollars
 * @param {number|string} tipAmount  dollars
 */
export function splitReceipt({ people = [], items = [], assignments = [], taxAmount = 0, tipAmount = 0 }) {
  const personIndex = new Map(people.map((p, i) => [p.id, i]));
  const perItems = people.map(() => 0);
  const lines = people.map(() => []);

  let itemsCents = 0;
  let assignedCents = 0;
  const unassignedItems = [];

  for (const item of items) {
    const cents = toCents(item.price);
    itemsCents += cents;

    // Only assignees still on the receipt count. Sorting by person order keeps
    // the leftover-cent handout stable no matter what order rows come back in.
    const who = assignments
      .filter((a) => a.item_id === item.id && personIndex.has(a.person_id))
      .map((a) => personIndex.get(a.person_id))
      .sort((a, b) => a - b);

    if (who.length === 0) {
      unassignedItems.push(item);
      continue;
    }

    assignedCents += cents;
    // Shares are equal, so leftover cents go to the earliest assignees.
    const base = Math.floor(cents / who.length);
    let extra = cents - base * who.length;
    for (const idx of who) {
      const share = base + (extra > 0 ? 1 : 0);
      if (extra > 0) extra -= 1;
      perItems[idx] += share;
      lines[idx].push({ name: item.name, shareCents: share, splitWays: who.length });
    }
  }

  const taxCents = toCents(taxAmount);
  const tipCents = toCents(tipAmount);

  // With nothing assigned there is no share to charge tax or tip against, so
  // both stay unallocated and get their own line rather than being folded into
  // a total nobody owes.
  const allocatedTaxCents = assignedCents > 0 ? taxCents : 0;
  const allocatedTipCents = assignedCents > 0 ? tipCents : 0;

  const taxShares = splitProportionally(allocatedTaxCents, perItems);
  const tipShares = splitProportionally(allocatedTipCents, perItems);

  const perPerson = people.map((p, i) => ({
    id: p.id,
    name: p.name,
    lines: lines[i],
    itemsCents: perItems[i],
    taxCents: taxShares[i],
    tipCents: tipShares[i],
    totalCents: perItems[i] + taxShares[i] + tipShares[i]
  }));

  return {
    perPerson,
    itemsCents,
    assignedCents,
    unassignedCents: itemsCents - assignedCents,
    unassignedItems,
    taxCents,
    tipCents,
    allocatedTaxCents,
    allocatedTipCents,
    unallocatedTaxCents: taxCents - allocatedTaxCents,
    unallocatedTipCents: tipCents - allocatedTipCents,
    grandCents: assignedCents + allocatedTaxCents + allocatedTipCents,
    // What the receipt comes to, whoever ends up paying for it. grandCents is
    // only what people have actually been charged.
    billCents: itemsCents + taxCents + tipCents
  };
}

/**
 * The number to print as "the total", and whether anybody is on the hook for it.
 * With lines on the receipt and nobody assigned to any of them, grandCents is
 * zero, and a $0.00 sitting above a real tax line reads as a free meal.
 */
export function shownTotal(split) {
  const nobodyCharged = split.itemsCents > 0 && split.assignedCents === 0;
  return { cents: nobodyCharged ? split.billCents : split.grandCents, nobodyCharged };
}

/**
 * Does what came off the photo add up to what the receipt says? The receipt's
 * own subtotal is the direct answer; without one it is backed out of the total.
 * Returns null when the reader gave neither, so there is nothing to compare.
 *
 * @param {{itemsCents:number, taxCents?:number, tipCents?:number,
 *          subtotalCents?:number|null, totalCents?:number|null}} args
 */
export function reconcile({ itemsCents, taxCents = 0, tipCents = 0, subtotalCents = null, totalCents = null }) {
  let saysCents = null;
  if (subtotalCents != null && subtotalCents > 0) saysCents = subtotalCents;
  else if (totalCents != null && totalCents > 0) saysCents = totalCents - taxCents - tipCents;
  if (saysCents == null || saysCents <= 0) return null;
  const gapCents = saysCents - itemsCents;
  // A cent either way is rounding on the reader's side, not a missing line.
  return { readCents: itemsCents, saysCents, gapCents, matches: Math.abs(gapCents) <= 1 };
}

/**
 * "Bacon, 9.12" a line at a time. The price is the trailing token, which is the
 * whole point: splitting on the last comma turned "Rug, 1,234.56" into a 56
 * cent rug. Thousands separators are stripped, a leading $ is allowed, and a
 * line that does not end in a price is skipped rather than guessed at.
 * @returns {{name:string, price:number}[]}
 */
export function parseBulkLines(text) {
  const rows = [];
  for (const line of String(text || '').split('\n')) {
    const m = /^(.*?),\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*$/.exec(line.trim());
    if (!m) continue;
    const name = m[1].trim();
    const price = parseFloat(m[2].replace(/,/g, ''));
    if (name && isFinite(price)) rows.push({ name, price });
  }
  return rows;
}

// Cut one amount into n equal-as-possible pieces, exact to the cent. A receipt
// line reading "3 @ 12.41" becomes three rows that still sum to 12.41, which
// dividing the float would not: 12.41/3 rounds to 4.14 three times, or 12.42.
export function splitEvenCents(amountCents, n) {
  if (!Number.isFinite(n) || n <= 0) return [];
  return splitProportionally(amountCents, new Array(n).fill(1));
}

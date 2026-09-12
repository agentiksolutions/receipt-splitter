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
function allocateRemainder(shares, extra) {
  const order = shares
    .map((cents, index) => ({ cents, index }))
    .sort((a, b) => b.cents - a.cents || a.index - b.index);
  const out = shares.slice();
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
  return allocateRemainder(base, amountCents - used);
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
    grandCents: assignedCents + allocatedTaxCents + allocatedTipCents
  };
}

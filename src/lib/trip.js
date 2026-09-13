// Rolling up a trip: what each person paid across every split, what they owed,
// and the shortest list of payments that squares everyone up.
//
// Integer cents throughout. Every owed figure comes from splitReceipt, never
// from arithmetic done here, so a trip can never disagree with its splits.

// People are matched across splits by name. Two splits that both say "casey"
// are the same person; nothing else links them, because rs_people rows are
// per receipt.
export const personKey = (name) => String(name || '').trim().toLowerCase();

/**
 * @param {Array<{payerName?:string, grandCents:number, perPerson:Array<{name:string,totalCents:number}>}>} splits
 * @returns {Array<{key:string, name:string, paidCents:number, owedCents:number, netCents:number}>}
 */
export function tripBalances(splits) {
  const seen = new Map();

  const touch = (name) => {
    const key = personKey(name);
    if (!key) return null;
    if (!seen.has(key)) {
      seen.set(key, { key, name: String(name).trim(), paidCents: 0, owedCents: 0, netCents: 0 });
    }
    return seen.get(key);
  };

  for (const split of splits || []) {
    const payerKey = personKey(split.payerName);
    let reimbursedCents = 0;

    for (const person of split.perPerson || []) {
      const row = touch(person.name);
      if (!row) continue;
      row.owedCents += person.totalCents || 0;
      // Somebody marked paid on one split has already handed that share over.
      // The trip has to see it. Without this the netting counts the same money
      // twice: Casey pays for Friday in cash, gets marked paid, and the trip
      // page still lists her share and tells the payer to collect it again at
      // the end of the weekend.
      //
      // The payer is never reimbursing themselves, so their own row is skipped
      // whatever it says.
      if (person.settled && row.key !== payerKey) {
        row.paidCents += person.totalCents || 0;
        reimbursedCents += person.totalCents || 0;
      }
    }

    const payer = touch(split.payerName);
    // With nobody named as payer the money is still owed, it just has no
    // counterparty, so it shows as owed with nothing paid against it. Anything
    // already handed back comes off what the payer is still out of pocket, so
    // paidCents reads as cash currently fronted rather than what the card rang
    // up.
    if (payer) payer.paidCents += (split.grandCents || 0) - reimbursedCents;
  }

  const rows = [...seen.values()];
  for (const row of rows) row.netCents = row.paidCents - row.owedCents;
  return rows;
}

/**
 * Largest creditor against largest debtor until everyone is flat. Returns the
 * transfers, never more than one per person per round.
 * @returns {Array<{fromKey:string, from:string, toKey:string, to:string, cents:number}>}
 */
export function settleUp(balances) {
  const owed = balances.filter((b) => b.netCents < 0).map((b) => ({ ...b, left: -b.netCents }));
  const due = balances.filter((b) => b.netCents > 0).map((b) => ({ ...b, left: b.netCents }));
  owed.sort((a, b) => b.left - a.left);
  due.sort((a, b) => b.left - a.left);

  const moves = [];
  let i = 0;
  let j = 0;
  while (i < owed.length && j < due.length) {
    const pay = Math.min(owed[i].left, due[j].left);
    if (pay > 0) {
      moves.push({
        fromKey: owed[i].key,
        from: owed[i].name,
        toKey: due[j].key,
        to: due[j].name,
        cents: pay
      });
    }
    owed[i].left -= pay;
    due[j].left -= pay;
    if (owed[i].left === 0) i += 1;
    if (due[j].left === 0) j += 1;
  }
  return moves;
}

/**
 * Which person row is this device's owner.
 *
 * The recorded id wins. Matching on the profile name alone inserts a SECOND you
 * the moment the profile is renamed without spreading the change, and in evenly
 * or halfsies the bulk assign then puts every line on the new row.
 *
 * @param {{id:string, name:string}[]} people
 * @param {string} recordedId  what rs.mine holds for this receipt
 * @param {string} meName      the current profile name
 */
export function findMe(people, recordedId, meName) {
  if (recordedId) {
    const byId = people.find((p) => p.id === recordedId);
    if (byId) return byId;
  }
  const key = personKey(meName);
  if (!key) return null;
  return people.find((p) => personKey(p.name) === key) || null;
}

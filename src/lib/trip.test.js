// node src/lib/trip.test.js
import assert from 'node:assert/strict';
import { findMe, personKey, settleUp, tripBalances } from './trip.js';

let checks = 0;
const check = (label, fn) => {
  fn();
  checks += 1;
  void label;
};

const byKey = (rows) => new Map(rows.map((r) => [r.key, r]));

// A settlement is only correct if it reproduces every net balance exactly.
function assertSettles(balances) {
  const moves = settleUp(balances);
  const moved = new Map(balances.map((b) => [b.key, 0]));
  for (const m of moves) {
    assert.ok(m.cents > 0, 'no zero or negative transfer');
    moved.set(m.fromKey, moved.get(m.fromKey) + m.cents);
    moved.set(m.toKey, moved.get(m.toKey) - m.cents);
  }
  for (const b of balances) {
    // `|| 0` folds -0 into 0; strict equality treats them as different.
    assert.equal(moved.get(b.key) || 0, -b.netCents || 0, `${b.name} settles to zero`);
  }
  return moves;
}

check('two people, one payer', () => {
  const splits = [
    {
      payerName: 'Jordan',
      grandCents: 6272,
      perPerson: [
        { name: 'Jordan', totalCents: 3136 },
        { name: 'Casey', totalCents: 3136 }
      ]
    }
  ];
  const rows = byKey(tripBalances(splits));
  assert.equal(rows.get('jordan').paidCents, 6272);
  assert.equal(rows.get('jordan').netCents, 3136);
  assert.equal(rows.get('casey').netCents, -3136);
  const moves = assertSettles([...rows.values()]);
  assert.equal(moves.length, 1);
  assert.equal(moves[0].from, 'Casey');
  assert.equal(moves[0].to, 'Jordan');
  assert.equal(moves[0].cents, 3136);
});

check('three people, two payers, matched case-insensitively', () => {
  const splits = [
    {
      payerName: 'Jordan',
      grandCents: 9000,
      perPerson: [
        { name: 'Jordan', totalCents: 3000 },
        { name: 'Casey', totalCents: 3000 },
        { name: 'Riley', totalCents: 3000 }
      ]
    },
    {
      payerName: 'casey',
      grandCents: 4500,
      perPerson: [
        { name: 'JORDAN', totalCents: 1500 },
        { name: ' Casey ', totalCents: 1500 },
        { name: 'Riley', totalCents: 1500 }
      ]
    }
  ];
  const rows = byKey(tripBalances(splits));
  assert.equal(rows.size, 3, 'three people, not six');
  assert.equal(rows.get('jordan').paidCents, 9000);
  assert.equal(rows.get('jordan').owedCents, 4500);
  assert.equal(rows.get('jordan').netCents, 4500);
  assert.equal(rows.get('casey').netCents, 0);
  assert.equal(rows.get('riley').netCents, -4500);

  const balances = [...rows.values()];
  assert.equal(
    balances.reduce((s, b) => s + b.netCents, 0),
    0,
    'net balances sum to zero'
  );
  const moves = assertSettles(balances);
  assert.equal(moves.length, 1, 'a person who is square gets no transfer');
  assert.equal(moves[0].from, 'Riley');
  assert.equal(moves[0].to, 'Jordan');
  assert.equal(moves[0].cents, 4500);
});

check('everyone even, nobody pays anybody', () => {
  const splits = [
    {
      payerName: 'Jordan',
      grandCents: 3000,
      perPerson: [
        { name: 'Jordan', totalCents: 1500 },
        { name: 'Casey', totalCents: 1500 }
      ]
    },
    {
      payerName: 'Casey',
      grandCents: 3000,
      perPerson: [
        { name: 'Jordan', totalCents: 1500 },
        { name: 'Casey', totalCents: 1500 }
      ]
    }
  ];
  const balances = tripBalances(splits);
  for (const b of balances) assert.equal(b.netCents, 0);
  assert.deepEqual(settleUp(balances), []);
});

check('odd cents still reconcile across many splits', () => {
  const splits = [];
  for (let i = 1; i <= 40; i += 1) {
    splits.push({
      payerName: i % 2 ? 'Jordan' : 'Casey',
      grandCents: i * 7 + 1,
      perPerson: [
        { name: 'Jordan', totalCents: Math.floor((i * 7 + 1) / 2) },
        { name: 'Casey', totalCents: i * 7 + 1 - Math.floor((i * 7 + 1) / 2) }
      ]
    });
  }
  const balances = tripBalances(splits);
  const paid = balances.reduce((s, b) => s + b.paidCents, 0);
  const owed = balances.reduce((s, b) => s + b.owedCents, 0);
  assert.equal(paid, owed, 'what was paid equals what was owed');
  assert.equal(
    balances.reduce((s, b) => s + b.netCents, 0),
    0
  );
  assertSettles(balances);
});

check('a name that is only whitespace is ignored', () => {
  assert.equal(personKey('  '), '');
  const rows = tripBalances([
    { payerName: '   ', grandCents: 500, perPerson: [{ name: 'Jordan', totalCents: 500 }] }
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].netCents, -500, 'no payer means the money is still owed');
});

check('the recorded row wins over the profile name', () => {
  // Renaming the profile without spreading the change used to make findMe miss,
  // which inserted a SECOND you and, in evenly or halfsies, moved every line
  // onto the new row.
  const people = [
    { id: 'p1', name: 'Jordan' },
    { id: 'p2', name: 'Casey' }
  ];
  assert.equal(findMe(people, 'p1', 'Jordan').id, 'p1');
  assert.equal(findMe(people, 'p1', 'Jordan Reyes').id, 'p1', 'the rename does not lose the row');
  // No id recorded yet: the name is all there is.
  assert.equal(findMe(people, '', 'Casey').id, 'p2');
  assert.equal(findMe(people, '', 'casey ').id, 'p2', 'matched on the normalised key');
  // A recorded id for a row that is gone falls back rather than returning null.
  assert.equal(findMe(people, 'deleted', 'Casey').id, 'p2');
  assert.equal(findMe(people, '', 'Nobody'), null);
  assert.equal(findMe(people, '', ''), null);
});

check('a share already paid does not get collected twice', () => {
  // Two nights away. Jordan fronts both. Casey squares up for Friday in cash on
  // the spot and gets marked paid; Riley does not. Before this, the trip netted
  // the whole weekend as though no money had moved, so Friday's cash was billed
  // to Casey a second time on Sunday.
  const friday = {
    payerName: 'Jordan',
    grandCents: 9000,
    perPerson: [
      { id: 'a', name: 'Jordan', totalCents: 3000 },
      { id: 'b', name: 'Casey', totalCents: 3000, settled: true },
      { id: 'c', name: 'Riley', totalCents: 3000 }
    ]
  };
  const saturday = {
    payerName: 'Jordan',
    grandCents: 6000,
    perPerson: [
      { id: 'd', name: 'Jordan', totalCents: 2000 },
      { id: 'e', name: 'Casey', totalCents: 2000 },
      { id: 'f', name: 'Riley', totalCents: 2000 }
    ]
  };

  const rows = byKey(tripBalances([friday, saturday]));
  assert.equal(rows.get('casey').netCents, -2000, 'Casey owes Saturday only');
  assert.equal(rows.get('riley').netCents, -5000, 'Riley owes both nights');
  assert.equal(rows.get('jordan').netCents, 7000, 'Jordan is out the other two shares');
  assert.equal(
    rows.get('jordan').paidCents,
    12000,
    'the $30 already handed back is not still fronted'
  );
  assertSettles([...rows.values()]);

  const moves = settleUp([...rows.values()]);
  assert.equal(moves.length, 2, 'one payment each, not one per night');
  assert.equal(moves.find((m) => m.fromKey === 'casey').cents, 2000);
});

check('the payer being marked settled changes nothing', () => {
  // The payer's own row can carry settled, since they plainly do not owe
  // themselves. Counting it would credit them their own share twice.
  const rows = byKey(
    tripBalances([
      {
        payerName: 'Jordan',
        grandCents: 4000,
        perPerson: [
          { id: 'a', name: 'Jordan', totalCents: 2000, settled: true },
          { id: 'b', name: 'Casey', totalCents: 2000 }
        ]
      }
    ])
  );
  assert.equal(rows.get('jordan').netCents, 2000);
  assert.equal(rows.get('jordan').paidCents, 4000);
  assert.equal(rows.get('casey').netCents, -2000);
});

console.log(`\n${checks} checks passed.`);

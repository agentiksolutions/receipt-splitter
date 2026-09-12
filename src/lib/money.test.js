// Self-check for the split math. Run it with plain node, no framework:
//   node src/lib/money.test.js
// It fails loudly if the cent reconciliation breaks.

import assert from 'node:assert/strict';
import { splitReceipt, toCents, money, splitEvenCents } from './money.js';

let checks = 0;
function check(label, fn) {
  fn();
  checks++;
  console.log('ok  ' + label);
}

// The one rule everything else rests on.
function reconciles(result, label) {
  const sum = result.perPerson.reduce((s, p) => s + p.totalCents, 0);
  assert.equal(
    sum,
    result.grandCents,
    `${label}: per-person totals ${sum} != grand ${result.grandCents}`
  );
  assert.equal(
    result.grandCents,
    result.assignedCents + result.allocatedTaxCents + result.allocatedTipCents,
    `${label}: grand total is not assigned + tax + tip`
  );
  assert.equal(
    result.perPerson.reduce((s, p) => s + p.itemsCents, 0),
    result.assignedCents,
    `${label}: item shares do not sum to the assigned subtotal`
  );
  assert.equal(
    result.perPerson.reduce((s, p) => s + p.taxCents, 0),
    result.allocatedTaxCents,
    `${label}: tax shares do not sum to the allocated tax`
  );
  assert.equal(
    result.perPerson.reduce((s, p) => s + p.tipCents, 0),
    result.allocatedTipCents,
    `${label}: tip shares do not sum to the allocated tip`
  );
  // Every line a person is shown must add up to what they are charged.
  for (const p of result.perPerson) {
    assert.equal(
      p.lines.reduce((s, l) => s + l.shareCents, 0),
      p.itemsCents,
      `${label}: ${p.name}'s printed lines do not sum to their item subtotal`
    );
  }
}

const people = [
  { id: 'a', name: 'Phil' },
  { id: 'b', name: 'Lee' },
  { id: 'c', name: 'Dana' }
];

check('cents parsing survives float noise', () => {
  assert.equal(toCents(0.1 + 0.2), 30);
  assert.equal(toCents('12.415'), 1242);
  assert.equal(toCents(''), 0);
  assert.equal(toCents('abc'), 0);
  assert.equal(money(1240), '$12.40');
  assert.equal(money(-5), '-$0.05');
});

check('a 3-way split of an odd amount loses no cent', () => {
  const r = splitReceipt({
    people,
    items: [{ id: 'i1', name: 'Pitcher', price: 10.0 }],
    assignments: [
      { item_id: 'i1', person_id: 'a' },
      { item_id: 'i1', person_id: 'b' },
      { item_id: 'i1', person_id: 'c' }
    ]
  });
  assert.deepEqual(r.perPerson.map((p) => p.itemsCents), [334, 333, 333]);
  assert.equal(r.assignedCents, 1000);
  reconciles(r, '3-way');
});

check('tax and tip land proportionally and reconcile to the cent', () => {
  const r = splitReceipt({
    people,
    items: [
      { id: 'i1', name: 'Steak', price: 30.0 },
      { id: 'i2', name: 'Salad', price: 10.0 },
      { id: 'i3', name: 'Pitcher', price: 10.0 }
    ],
    assignments: [
      { item_id: 'i1', person_id: 'a' },
      { item_id: 'i2', person_id: 'b' },
      { item_id: 'i3', person_id: 'a' },
      { item_id: 'i3', person_id: 'b' },
      { item_id: 'i3', person_id: 'c' }
    ],
    taxAmount: 1.5,
    tipAmount: 5.0
  });
  assert.equal(r.assignedCents, 5000);
  assert.equal(r.grandCents, 5000 + 150 + 500);
  reconciles(r, 'tax and tip');
});

check('a residual cent goes to the largest share', () => {
  // 1 cent of tax across shares of 30.00 / 10.00 / 10.00.
  const r = splitReceipt({
    people,
    items: [
      { id: 'i1', name: 'Big', price: 30.0 },
      { id: 'i2', name: 'Small', price: 10.0 },
      { id: 'i3', name: 'Small', price: 10.0 }
    ],
    assignments: [
      { item_id: 'i1', person_id: 'a' },
      { item_id: 'i2', person_id: 'b' },
      { item_id: 'i3', person_id: 'c' }
    ],
    taxAmount: 0.01
  });
  assert.deepEqual(r.perPerson.map((p) => p.taxCents), [1, 0, 0]);
  reconciles(r, 'residual cent');
});

check('a person with no items owes nothing, tax and tip included', () => {
  const r = splitReceipt({
    people,
    items: [{ id: 'i1', name: 'Coffee', price: 4.0 }],
    assignments: [{ item_id: 'i1', person_id: 'a' }],
    taxAmount: 1.0,
    tipAmount: 1.0
  });
  assert.equal(r.perPerson[1].totalCents, 0);
  assert.equal(r.perPerson[2].totalCents, 0);
  assert.equal(r.perPerson[0].totalCents, 600);
  reconciles(r, 'zero-share person');
});

check('unassigned items stay out of every total and are reported', () => {
  const r = splitReceipt({
    people,
    items: [
      { id: 'i1', name: 'Mine', price: 8.0 },
      { id: 'i2', name: 'Nobody claimed this', price: 12.0 }
    ],
    assignments: [{ item_id: 'i1', person_id: 'a' }],
    taxAmount: 1.0
  });
  assert.equal(r.itemsCents, 2000);
  assert.equal(r.assignedCents, 800);
  assert.equal(r.unassignedCents, 1200);
  assert.equal(r.unassignedItems.length, 1);
  assert.equal(r.unassignedItems[0].name, 'Nobody claimed this');
  assert.equal(r.grandCents, 900);
  reconciles(r, 'unassigned');
});

check('with nothing assigned, tax and tip are reported unallocated', () => {
  const r = splitReceipt({
    people,
    items: [{ id: 'i1', name: 'Fries', price: 5.0 }],
    assignments: [],
    taxAmount: 1.5,
    tipAmount: 5.0
  });
  assert.equal(r.assignedCents, 0);
  assert.equal(r.grandCents, 0);
  assert.equal(r.allocatedTaxCents, 0);
  assert.equal(r.unallocatedTaxCents, 150);
  assert.equal(r.unallocatedTipCents, 500);
  reconciles(r, 'nothing assigned');
});

check('an assignment to a removed person is ignored', () => {
  const r = splitReceipt({
    people: [{ id: 'a', name: 'Phil' }],
    items: [{ id: 'i1', name: 'Shared', price: 9.0 }],
    assignments: [
      { item_id: 'i1', person_id: 'a' },
      { item_id: 'i1', person_id: 'gone' }
    ],
    taxAmount: 1.0
  });
  assert.equal(r.perPerson[0].itemsCents, 900);
  assert.equal(r.unassignedCents, 0);
  reconciles(r, 'stale assignment');
});

check('awkward prices across many people still reconcile', () => {
  const many = Array.from({ length: 7 }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
  const items = Array.from({ length: 23 }, (_, i) => ({
    id: 'x' + i,
    name: 'Item ' + i,
    price: (i * 7.13 + 0.99) % 40
  }));
  const assignments = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = 0; j <= i % 4; j++) {
      assignments.push({ item_id: items[i].id, person_id: many[(i + j) % many.length].id });
    }
  }
  const r = splitReceipt({ people: many, items, assignments, taxAmount: 13.37, tipAmount: 19.42 });
  assert.ok(r.assignedCents > 0);
  reconciles(r, 'fuzz');
});

check('every 1-cent tax split across 2 to 9 people reconciles', () => {
  for (let n = 2; n <= 9; n++) {
    const crowd = Array.from({ length: n }, (_, i) => ({ id: 'q' + i, name: 'Q' + i }));
    const item = { id: 'only', name: 'Shared plate', price: 19.99 };
    const r = splitReceipt({
      people: crowd,
      items: [item],
      assignments: crowd.map((p) => ({ item_id: 'only', person_id: p.id })),
      taxAmount: 0.01,
      tipAmount: 0.02
    });
    reconciles(r, `crowd of ${n}`);
  }
});

check('a quantity line splits into rows that sum back to the line total', () => {
  // The reader reports the LINE total on a quantity line, so "3 @ 12.41"
  // arrives as 12.41 with qty 3. Dividing the float and rounding each row
  // would give 4.14 three times, which is 12.42.
  assert.deepEqual(splitEvenCents(1241, 3), [414, 414, 413]);
  assert.deepEqual(splitEvenCents(1000, 1), [1000]);
  assert.deepEqual(splitEvenCents(0, 4), [0, 0, 0, 0]);
  assert.deepEqual(splitEvenCents(500, 0), []);
  // Every line total up to $2, over every quantity up to 9, still closes.
  for (let cents = 1; cents <= 200; cents++) {
    for (let qty = 1; qty <= 9; qty++) {
      const rows = splitEvenCents(cents, qty);
      assert.equal(rows.length, qty);
      assert.equal(rows.reduce((s, c) => s + c, 0), cents, `${cents} cents over ${qty}`);
    }
  }
});

console.log(`\n${checks} checks passed.`);

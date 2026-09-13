// A statement is read by somebody who is not you, so a name that only means
// something on the phone that wrote it has to be dropped.
//
// selfName has a second caller: needsRealName in Split.jsx, which puts the
// "what should we call you" field on screen for exactly the names this drops.
// One list, both ends. Widening it to fix a PDF adds a name the split will now
// ask about; narrowing it stops asking about a name the PDF still refuses to
// print. Change the words here and read both.
//   node src/lib/statement-name.test.js

import assert from 'node:assert/strict';
import { selfName } from './statement-pdf.js';

let checks = 0;
function check(label, fn) {
  fn();
  checks++;
  console.log('ok  ' + label);
}

check('a self-name is dropped, in any casing or spacing', () => {
  // The real one: no profile name, so the row is literally "Me", and the PDF
  // read "Total owed to Me" and "How to pay Me" on the friend's copy.
  for (const word of ['Me', 'me', ' ME ', 'You', 'you', 'Myself', 'self']) {
    assert.equal(selfName(word), '', `"${word}" survived into a statement`);
  }
});

check('a real name is kept exactly, spacing trimmed', () => {
  assert.equal(selfName('Philip'), 'Philip');
  assert.equal(selfName('  Casey Kim  '), 'Casey Kim');
  // Names that merely contain a self-word are not self-names.
  assert.equal(selfName('Mel'), 'Mel');
  assert.equal(selfName('Youssef'), 'Youssef');
  assert.equal(selfName('Mehmet'), 'Mehmet');
});

check('nothing at all is empty rather than a crash', () => {
  assert.equal(selfName(''), '');
  assert.equal(selfName(null), '');
  assert.equal(selfName(undefined), '');
});

console.log('\n' + checks + ' checks passed.');

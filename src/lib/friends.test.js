// Self-check for the saved friends roster. Run it with plain node, no framework:
//   node src/lib/friends.test.js
// It fails loudly if an entry can be duplicated, merged with a namesake, or if
// a handle leaks a name or an id into a row it should not.

import assert from 'node:assert/strict';
import {
  listFriends,
  saveFriend,
  removeFriend,
  findFriendByName,
  searchFriends,
  touchFriend,
  handlesOf,
  rememberFromPerson,
  samePerson
} from './friends.js';

// The library runs in a browser. This is the smallest localStorage that
// behaves: strings in, strings out, null for a key that was never set, and a
// way to plant garbage under the key. It is assigned after the import above
// only because friends.js reads storage inside its functions and never while
// the module loads.
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear()
};

let checks = 0;
function check(label, fn) {
  store.clear();
  fn();
  checks++;
  console.log('ok  ' + label);
}

check('a saved friend comes back with an id and every field filled in', () => {
  const saved = saveFriend({ name: 'Jordan', venmo: ' jordan-p ' });
  assert.ok(saved.id, 'no id was minted');
  assert.equal(saved.name, 'Jordan');
  assert.equal(saved.venmo, 'jordan-p', 'the handle was not trimmed');
  assert.equal(saved.cashapp, '');
  assert.deepEqual(saved.accepts, {});
  assert.ok(saved.lastUsed > 0);
  assert.deepEqual(listFriends().map((f) => f.name), ['Jordan']);
});

check('saving the same id again edits that friend instead of adding one', () => {
  const first = saveFriend({ name: 'Jordan', venmo: 'jordan-p' });
  const second = saveFriend({ ...first, venmo: 'jordan-new' });
  assert.equal(second.id, first.id);
  assert.equal(listFriends().length, 1, 'the upsert duplicated the entry');
  assert.equal(listFriends()[0].venmo, 'jordan-new');
});

check('a patch that omits a field leaves that field alone', () => {
  const saved = saveFriend({ name: 'Jordan', venmo: 'jordan-p', accepts: { venmo: true } });
  // What the editor sends: the name changed, nothing else was on the form.
  const edited = saveFriend({ id: saved.id, name: 'Jordan P', accepts: undefined });
  assert.equal(edited.venmo, 'jordan-p');
  assert.deepEqual(edited.accepts, { venmo: true }, 'an absent field wiped a saved value');
});

check('two friends with the same name stay two friends', () => {
  const kim = saveFriend({ name: 'Casey', venmo: 'casey-kim' });
  const lee = saveFriend({ name: 'Casey', venmo: 'casey-lee' });
  assert.notEqual(kim.id, lee.id, 'the second Casey took the first one\'s id');
  assert.equal(listFriends().length, 2);
  assert.deepEqual(
    listFriends().map((f) => f.venmo).sort(),
    ['casey-kim', 'casey-lee']
  );
});

check('a name is found exactly and ignoring case, and never guessed at', () => {
  saveFriend({ name: 'Jordan', venmo: 'jordan-p' });
  assert.equal(findFriendByName('jordan').venmo, 'jordan-p');
  assert.equal(findFriendByName('  JORDAN  ').venmo, 'jordan-p');
  // A partial name is not a match. Only searchFriends does substrings.
  assert.equal(findFriendByName('Jord'), null);
  assert.equal(findFriendByName('Nobody'), null);
  assert.equal(findFriendByName(''), null);

  // Two Caseys and no way to tell them apart. Returning either one would put
  // the wrong person's Venmo on the split.
  saveFriend({ name: 'Casey', venmo: 'casey-kim' });
  saveFriend({ name: 'Casey', venmo: 'casey-lee' });
  assert.equal(findFriendByName('Casey'), null, 'an ambiguous name was guessed at');
});

check('the list and the search both put the most recent first', () => {
  saveFriend({ name: 'Jordan', venmo: 'jordan-p', lastUsed: 100 });
  saveFriend({ name: 'Casey', venmo: 'casey-k', lastUsed: 300 });
  saveFriend({ name: 'Riley', venmo: 'riley-b', lastUsed: 200 });
  assert.deepEqual(listFriends().map((f) => f.name), ['Casey', 'Riley', 'Jordan']);

  assert.deepEqual(searchFriends('e').map((f) => f.name), ['Casey', 'Riley']);
  assert.deepEqual(searchFriends('CAS').map((f) => f.name), ['Casey']);
  assert.deepEqual(searchFriends('zz'), []);
  assert.deepEqual(searchFriends(''), [], 'an empty query returned the whole roster');
  assert.deepEqual(searchFriends('   '), []);
});

check('touching a friend moves them up, and an unknown id mints nothing', () => {
  const jordan = saveFriend({ name: 'Jordan', lastUsed: 100, venmo: 'jordan-p' });
  saveFriend({ name: 'Casey', lastUsed: 300, venmo: 'casey-k' });
  assert.deepEqual(listFriends().map((f) => f.name), ['Casey', 'Jordan']);

  const touched = touchFriend(jordan.id);
  assert.ok(touched.lastUsed > 300);
  assert.deepEqual(listFriends().map((f) => f.name), ['Jordan', 'Casey']);

  assert.equal(touchFriend('not-a-friend'), null);
  assert.equal(listFriends().length, 2, 'an unknown id left a phantom entry');
});

check('deleting takes one friend and leaves the rest', () => {
  const jordan = saveFriend({ name: 'Jordan', venmo: 'jordan-p' });
  saveFriend({ name: 'Casey', venmo: 'casey-k' });
  removeFriend(jordan.id);
  assert.deepEqual(listFriends().map((f) => f.name), ['Casey']);
  removeFriend('not-a-friend');
  assert.equal(listFriends().length, 1);
});

check('handlesOf carries the payment fields and nothing else', () => {
  const saved = saveFriend({
    name: 'Jordan',
    venmo: 'jordan-p',
    cashapp: 'jordanp',
    zelle: '',
    preferred: 'venmo',
    accepts: { venmo: true, cashapp: false }
  });
  const row = handlesOf(saved);

  // The three fields that must never reach an rs_people row from here.
  assert.equal('id' in row, false, 'handlesOf leaked the roster id');
  assert.equal('name' in row, false, 'handlesOf leaked the name');
  assert.equal('lastUsed' in row, false, 'handlesOf leaked lastUsed');
  assert.equal(JSON.stringify(row).includes(saved.id), false);
  assert.equal(JSON.stringify(row).includes('Jordan'), false);

  assert.deepEqual(row, {
    venmo: 'jordan-p',
    cashapp: 'jordanp',
    accepts: { venmo: true, cashapp: false },
    preferred: 'venmo'
  });
  // A blank field is left out, so spreading this row cannot empty a handle that
  // is already on the split.
  assert.equal('zelle' in row, false);

  // Nothing turned on is not the same as "takes no payment at all".
  const quiet = handlesOf({ venmo: 'x', accepts: { venmo: false } });
  assert.equal('accepts' in quiet, false);
  assert.deepEqual(handlesOf(null), {});
});

check('a person with no handle is not remembered', () => {
  assert.equal(rememberFromPerson({ id: 'p1', name: 'Jordan' }), null);
  assert.equal(rememberFromPerson({ id: 'p1', name: 'Jordan', venmo: '   ' }), null);
  // accepts and preferred are not handles. There is still nothing to pay.
  assert.equal(rememberFromPerson({ name: 'Jordan', accepts: { venmo: true }, preferred: 'venmo' }), null);
  assert.equal(rememberFromPerson({ name: '', venmo: 'jordan-p' }), null);
  assert.equal(rememberFromPerson(null), null);
  assert.equal(listFriends().length, 0);
});

check('a person with a handle is remembered once, then updated', () => {
  const first = rememberFromPerson({ id: 'p1', name: 'Jordan', venmo: 'jordan-p' });
  assert.equal(first.name, 'Jordan');
  assert.equal(first.venmo, 'jordan-p');
  // The rs_people id is not the friend id, and no link between the two is kept.
  assert.notEqual(first.id, 'p1');

  const again = rememberFromPerson({ id: 'p2', name: 'jordan', cashapp: 'jordanp' });
  assert.equal(again.id, first.id, 'the same name was saved twice');
  assert.equal(again.venmo, 'jordan-p', 'the earlier handle was lost');
  assert.equal(again.cashapp, 'jordanp');
  assert.equal(listFriends().length, 1);
});

check('a person whose name the roster holds twice is left alone', () => {
  saveFriend({ name: 'Casey', venmo: 'casey-kim' });
  saveFriend({ name: 'Casey', venmo: 'casey-lee' });
  assert.equal(rememberFromPerson({ id: 'p9', name: 'Casey', venmo: 'casey-new' }), null);
  assert.equal(listFriends().length, 2, 'an ambiguous name added a third entry');
  assert.deepEqual(
    listFriends().map((f) => f.venmo).sort(),
    ['casey-kim', 'casey-lee'],
    'an ambiguous name overwrote somebody'
  );
});

check('a namesake with a different handle is refused, not merged', () => {
  // One David is already saved. A second David turns up on another split with
  // his own Venmo. Merging them would put Chen's username beside Ruiz's phone,
  // and a later split would text Ruiz asking him to pay Chen.
  saveFriend({ name: 'David', venmo: 'david-ruiz', phone: '555-0100' });
  assert.equal(
    rememberFromPerson({ id: 'p4', name: 'David', venmo: 'david-chen', cashapp: 'davidchen' }),
    null,
    'a conflicting handle was written anyway'
  );
  const after = listFriends();
  assert.equal(after.length, 1, 'the refusal added an entry');
  assert.equal(after[0].venmo, 'david-ruiz', "the stranger's Venmo overwrote the saved one");
  assert.ok(!after[0].cashapp, "the stranger's Cash App was grafted on");
  assert.equal(after[0].phone, '555-0100', 'the saved phone was disturbed');
});

check('the same person on a second split still fills in a blank field', () => {
  // The case rememberFromPerson exists for. Nothing conflicts, so it fills.
  saveFriend({ name: 'Riley', venmo: 'riley-b' });
  const got = rememberFromPerson({ id: 'p5', name: 'Riley', venmo: 'riley-b', cashapp: 'rileyb' });
  assert.ok(got, 'a non-conflicting handle was refused');
  assert.equal(listFriends().length, 1, 'filling a blank added a second entry');
  assert.equal(got.venmo, 'riley-b');
  assert.equal(got.cashapp, 'rileyb', 'the blank field did not fill in');
});

check('the same handle spelled differently is still the same person', () => {
  // Venmo and Cash App names are case-insensitive, pay.js strips a leading @ or
  // $ before building a link, and nobody types a phone the same way twice. None
  // of those is a different person, so none should block the learn.
  saveFriend({ name: 'Casey', venmo: 'Casey-Kim', cashapp: 'caseyk', phone: '(555) 010-0200' });
  const got = rememberFromPerson({
    id: 'p7',
    name: 'Casey',
    venmo: 'casey-kim',
    cashapp: '$caseyk',
    phone: '5550100200'
  });
  assert.ok(got, 'a spelling difference was treated as a different person');
  assert.equal(listFriends().length, 1, 'a spelling difference added an entry');
  // The newest spelling wins, which is fine: it is the same account either way,
  // and pay.js strips the case and the sigil before building any link.
  assert.equal(got.venmo, 'casey-kim');
  assert.equal(got.phone, '5550100200');
});

check('samePerson needs positive agreement, never just a shared name', () => {
  // The exact scenario that shipped broken twice. My roster holds my roommate
  // David Ruiz. Tonight's payer is a different David Chen. Without this check,
  // Ruiz's Cash App landed on Chen's SHARED row and every other guest saw a
  // live button paying Ruiz.
  const ruiz = saveFriend({ name: 'David', venmo: 'david-ruiz', cashapp: 'davidruiz', zelle: 'ruiz@example.com' });
  const chen = { id: 'p8', name: 'David', venmo: 'david-chen' };
  assert.equal(samePerson(ruiz, chen), false, "a shared name alone was treated as the same person");

  // The same man on a second split. He arrived from the roster chip, so his row
  // carries the seeded Venmo, and that agreement is the proof.
  assert.equal(samePerson(ruiz, { id: 'p8', name: 'David', venmo: 'david-ruiz' }), true);
  // Spelling is not a difference.
  assert.equal(samePerson(ruiz, { name: 'David', venmo: '@David-Ruiz' }), true);

  // Typed in by hand, so nothing to agree on. No proof, no fill.
  assert.equal(samePerson(ruiz, { id: 'p8', name: 'David' }), false, 'absence of conflict was read as proof');
  assert.equal(samePerson(ruiz, null), false);
  assert.equal(samePerson(null, chen), false);
});

check('a malformed stored value never throws and never yields a friend', () => {
  for (const planted of [null, '', '{', 'not json', '{"a":1}', '"a string"', '42', '[]']) {
    store.clear();
    if (planted !== null) store.set('rs.friends', planted);
    assert.deepEqual(listFriends(), [], `listFriends on ${JSON.stringify(planted)}`);
    assert.equal(findFriendByName('Jordan'), null);
    assert.deepEqual(searchFriends('jo'), []);
    assert.equal(touchFriend('x'), null);
    removeFriend('x');
    // Writing over the garbage still works.
    assert.equal(saveFriend({ name: 'Jordan', venmo: 'jordan-p' }).name, 'Jordan');
    assert.equal(listFriends().length, 1);
  }

  // An array with junk in it keeps the entries that are friends.
  store.clear();
  store.set(
    'rs.friends',
    JSON.stringify([1, null, 'x', { no: 'id' }, { id: 'f1', name: 'Jordan', venmo: 'jordan-p' }])
  );
  assert.deepEqual(listFriends().map((f) => f.name), ['Jordan']);

  // A friend whose fields are the wrong types comes back usable.
  store.clear();
  store.set(
    'rs.friends',
    JSON.stringify([{ id: 'f2', name: { bad: 1 }, venmo: ['x'], accepts: 'yes', lastUsed: 'soon' }])
  );
  const [odd] = listFriends();
  assert.equal(odd.name, '');
  assert.equal(odd.venmo, '');
  assert.deepEqual(odd.accepts, {});
  assert.equal(odd.lastUsed, 0);
  assert.deepEqual(handlesOf(odd), {});
});

console.log(`\n${checks} checks passed.`);

// node src/lib/pay.test.js
// Pins the link shapes and the exact request wording, because both were checked
// against Venmo's and Cash App's own universal-link files and against a real
// iPhone. A silent change here sends somebody's money to the wrong place.
import assert from 'node:assert';
import { buildPaymentLinks, moveLinks, parseHandleCode, requestBody, servicesFor, venmoProfileLink } from './pay.js';

let n = 0;
const check = (name, fn) => {
  fn();
  n += 1;
  console.log('ok ', name);
};

const ME = {
  name: 'Jordan',
  venmo: 'jordan',
  cashapp: 'jordan',
  paypal: 'jordan',
  zelle: '555-555-0101',
  phone: '5555550101'
};

const THEM = {
  name: 'Casey',
  venmo: 'caseyq',
  cashapp: 'caseyq',
  paypal: 'caseyq',
  zelle: 'casey@example.com',
  phone: '5555550123'
};

const body = (link) => decodeURIComponent(String(link).replace(/^sms:[^?]*\?body=/, ''));

check('a request carries a tappable link to pay the requester', () => {
  const { links, bodies } = buildPaymentLinks(THEM, 2418, 'request', 'Dinner', ME);
  assert.equal(bodies.cashapp, 'Can you pay me $24.18 for Dinner?\nhttps://cash.app/$jordan/24.18');
  assert.equal(bodies.paypal, 'Can you pay me $24.18 for Dinner?\nhttps://www.paypal.com/paypalme/jordan/24.18USD');
  assert.equal(bodies.venmo, 'Can you Venmo me $24.18 for Dinner?\nhttps://venmo.com/u/jordan');
  assert.equal(bodies.zelle, 'Can you Zelle me $24.18 for Dinner?\nZelle: 555-555-0101');
  assert.equal(bodies.applepay, 'Can you Apple Cash me $24.18 for Dinner?');
  // Every one of them opens the composer addressed to the person who owes.
  for (const service of ['cashapp', 'paypal', 'venmo', 'zelle', 'applepay']) {
    assert.ok(links[service].startsWith('sms:5555550123?body='), service + ' is a text');
    assert.equal(body(links[service]), bodies[service]);
  }
});

check('the request link goes on its own line', () => {
  for (const service of ['cashapp', 'paypal', 'venmo']) {
    const text = requestBody(service, ME, '24.18', 'Dinner');
    const last = text.split('\n').pop();
    assert.ok(last.startsWith('https://'), service + ' ends on the bare link');
  }
});

check('a request still works with no phone number saved', () => {
  const { links } = buildPaymentLinks({ name: 'Casey' }, 2418, 'request', 'Dinner', ME);
  assert.ok(links.applepay.startsWith('sms:?body='), 'blank recipient');
});

check('a request only offers a service the requester actually has', () => {
  const { links } = buildPaymentLinks(THEM, 2418, 'request', 'Dinner', { name: 'Jordan' });
  assert.equal(links.cashapp, null);
  assert.equal(links.paypal, null);
  assert.equal(links.zelle, null);
  // Venmo with no profile to send them to is words with nothing to tap, which
  // is a dead end the friend cannot act on.
  assert.equal(links.venmo, null);
  // Apple Cash goes over iMessage and needs no handle from the requester.
  assert.ok(links.applepay);
});

check('a charge names the person being charged, never the requester', () => {
  // This opened Venmo asking Jordan to pay Jordan. The scheme is the only
  // place the two sides can be confused, because both people are in scope.
  const { apps } = buildPaymentLinks(THEM, 2418, 'request', 'Dinner', ME);
  assert.equal(apps.venmo, 'venmo://paycharge?txn=charge&recipients=caseyq&amount=24.18&note=Dinner');
  assert.ok(!apps.venmo.includes('jordan'), 'the requester is not the recipient of their own charge');
  // Nobody to charge means no scheme to try; the text is the whole offer.
  const { apps: none } = buildPaymentLinks({ name: 'Casey' }, 2418, 'request', 'Dinner', ME);
  assert.equal(none.venmo, null);
});

check('a trip move asks the debtor and pays the creditor', () => {
  // Both halves of this call were wrong at once: the people were reversed and
  // the whole {links, apps, bodies} object was read as if it were links, so
  // every button on the trip page was dead.
  const handles = new Map([
    ['casey', THEM],
    ['jordan', ME]
  ]);
  const move = { fromKey: 'casey', toKey: 'jordan', from: 'Casey', to: 'Jordan', cents: 2418 };
  const { links, bodies } = moveLinks(move, handles, 'Dinner');
  assert.ok(links.cashapp.startsWith('sms:5555550123?body='), 'addressed to the person who owes');
  assert.ok(bodies.cashapp.includes('cash.app/$jordan'), 'paying the person who is owed');
  assert.ok(!bodies.cashapp.includes('caseyq'), 'never the debtor handles');
  assert.ok(links.paypal && links.venmo && links.zelle, 'a creditor with handles gets real links');
});

check('a send uses the recipient handles and never the ?txn= web url', () => {
  const { links, apps } = buildPaymentLinks(THEM, 2418, 'send', 'Dinner', ME);
  assert.equal(links.venmo, 'https://venmo.com/u/caseyq');
  assert.ok(!links.venmo.includes('txn='), 'the web ?txn= url is not a universal link');
  assert.equal(apps.venmo, 'venmo://paycharge?txn=pay&recipients=caseyq&amount=24.18&note=Dinner');
  assert.equal(links.cashapp, 'https://cash.app/$caseyq/24.18');
  assert.equal(links.paypal, 'https://www.paypal.com/paypalme/caseyq/24.18USD');
});

check('a scanned venmo code stands in for a missing username', () => {
  const scanned = { name: 'Riley', venmo_link: 'https://venmo.com/code?user_id=123' };
  assert.equal(venmoProfileLink(scanned), 'https://venmo.com/code?user_id=123');
  const { links, apps } = buildPaymentLinks(scanned, 500, 'send', 'Coffee');
  assert.equal(links.venmo, 'https://venmo.com/code?user_id=123');
  // No username means no app scheme to try; the universal link opens the app anyway.
  assert.equal(apps.venmo, null);
});

check('a person who said what they take gets only those, first choice first', () => {
  const picky = { accepts: { venmo: true, cashapp: false, paypal: true, zelle: false, applecash: false }, preferred: 'paypal' };
  const { list, strict } = servicesFor(picky);
  assert.deepEqual(list, ['paypal', 'venmo']);
  assert.equal(strict, true);
});

check('a person who said nothing keeps the fixed order and the greyed buttons', () => {
  const { list, strict } = servicesFor({ name: 'Casey' });
  assert.deepEqual(list, ['venmo', 'cashapp', 'paypal', 'zelle', 'applepay']);
  assert.equal(strict, false);
  // An all-off map is treated the same way, never as "takes nothing".
  const off = servicesFor({ accepts: { venmo: false, cashapp: false, paypal: false, zelle: false, applecash: false } });
  assert.equal(off.strict, false);
});

check('sms keeps the RFC 5724 ?body= separator', () => {
  const { links } = buildPaymentLinks(THEM, 100, 'send', 'Tip', ME);
  assert.ok(/^sms:5555550123\?body=/.test(links.applepay));
  assert.ok(!links.applepay.includes('?&body='));
});

check('the amount appears once, written plainly', () => {
  const { bodies } = buildPaymentLinks(THEM, 2418, 'send', 'Dinner', ME);
  const words = bodies.applepay.split('\n');
  assert.equal(words[words.length - 1], '$24.18');
  assert.equal(bodies.applepay.split('$24.18').length - 1, 1);
});

check('a scanned code turns into the right handle', () => {
  assert.deepEqual(parseHandleCode('https://cash.app/$caseyq'), { field: 'cashapp', value: 'caseyq', label: 'Cash App' });
  assert.deepEqual(parseHandleCode('https://www.paypal.com/paypalme/caseyq'), { field: 'paypal', value: 'caseyq', label: 'PayPal' });
  assert.deepEqual(parseHandleCode('paypal.me/caseyq'), { field: 'paypal', value: 'caseyq', label: 'PayPal' });
  assert.deepEqual(parseHandleCode('https://venmo.com/u/caseyq'), { field: 'venmo', value: 'caseyq', label: 'Venmo' });
  // A code handed over from a signed-in page carries a subdomain.
  assert.deepEqual(parseHandleCode('https://account.venmo.com/u/jordan'), {
    field: 'venmo',
    value: 'jordan',
    label: 'Venmo'
  });
  assert.deepEqual(parseHandleCode('https://venmo.com/code?user_id=123'), {
    field: 'venmo_link',
    value: 'https://venmo.com/code?user_id=123',
    label: 'Venmo'
  });
  assert.equal(parseHandleCode('https://example.com/pay/me'), null);
  assert.equal(parseHandleCode(''), null);
});

console.log(`\n${n} checks passed.`);

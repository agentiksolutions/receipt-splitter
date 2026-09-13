// Payment link builders.
//
// What each app actually supports through a link, checked against Venmo's own
// apple-app-site-association file and Cash App's:
//   venmo://paycharge     undocumented, but it opens the app with the amount on
//                         the phones we have tested. Tried first, never relied on.
//   venmo.com/u/<user>    a registered universal link. Opens the app at that
//                         person. Carries no amount, so the amount goes in words.
//   venmo.com/?txn=...    NOT a universal link. It opens a web page on iPhone,
//                         which is why it is not used here at all.
//   cash.app/$tag/<amt>   registered by the app, amount included, send only.
//   paypal.com/paypalme   opens PayPal with the amount.
//   Zelle, Apple Cash     nothing. Both fall back to a prefilled text.
//
// A REQUEST carries the requester's own handle, because the person reading it
// needs somewhere to send money. A SEND uses the recipient's handle.

import { fromCents } from './money.js';

const DEFAULT_LABEL = 'the receipt';

export function reasonFor(title) {
  const t = (title || '').trim();
  const blank = ['untitled receipt', 'untitled split'];
  if (!t || blank.includes(t.toLowerCase())) return DEFAULT_LABEL;
  return t;
}

// RFC 5724 spells this `?body=`, and an iPhone fills the message from it.
// Do not "fix" it to `?&body=`.
function sms(phone, body) {
  return `sms:${phone ? encodeURIComponent(phone) : ''}?body=${encodeURIComponent(body)}`;
}

const clean = (handle) => (handle || '').trim().replace(/^[@$]/, '');

export const SERVICE_ORDER = ['venmo', 'cashapp', 'paypal', 'zelle', 'applepay'];

export const SERVICE_LABELS = {
  venmo: 'Venmo',
  cashapp: 'Cash App',
  paypal: 'PayPal',
  zelle: 'Zelle',
  applepay: 'Apple Cash'
};

// `accepts` is stored with the key `applecash`; every other layer says applepay.
export const acceptsKey = (service) => (service === 'applepay' ? 'applecash' : service);

/** The https link that opens Venmo at this person. No amount: Venmo links cannot carry one. */
export function venmoProfileLink(person) {
  const user = clean(person.venmo);
  if (user) return `https://venmo.com/u/${encodeURIComponent(user)}`;
  // Scanned from their QR code, which is already a real venmo.com URL.
  return (person.venmo_link || '').trim() || null;
}

export function cashAppLink(cashtag, amount) {
  return `https://cash.app/$${encodeURIComponent(clean(cashtag))}/${amount}`;
}

export function payPalLink(name, amount) {
  return `https://www.paypal.com/paypalme/${encodeURIComponent(clean(name))}/${amount}USD`;
}

/**
 * The text that asks somebody to pay you. The link is on its own line so
 * Messages renders it as a tappable link rather than running it into the words.
 * @param {string} service  venmo | cashapp | paypal | zelle | applepay
 * @param {object} me       the requester's handles
 */
export function requestBody(service, me, amount, reason) {
  const cashtag = clean(me.cashapp);
  const paypal = clean(me.paypal);
  const zelle = (me.zelle || '').trim();

  if (service === 'cashapp' && cashtag) {
    return `Can you pay me $${amount} for ${reason}?\n${cashAppLink(cashtag, amount)}`;
  }
  if (service === 'paypal' && paypal) {
    return `Can you pay me $${amount} for ${reason}?\n${payPalLink(paypal, amount)}`;
  }
  if (service === 'venmo') {
    const link = venmoProfileLink(me);
    // No profile to send them to means no request. The words alone give the
    // friend nothing to tap and no way to know where the money should go.
    return link ? `Can you Venmo me $${amount} for ${reason}?\n${link}` : null;
  }
  if (service === 'zelle' && zelle) {
    return `Can you Zelle me $${amount} for ${reason}?\nZelle: ${zelle}`;
  }
  if (service === 'applepay') {
    return `Can you Apple Cash me $${amount} for ${reason}?`;
  }
  return null;
}

function sendBody(service, person, amount, reason) {
  const zelle = (person.zelle || '').trim();
  if (service === 'zelle' && zelle) {
    return `Sending you Zelle for ${reason}\n$${amount}\nTo ${zelle}`;
  }
  if (service === 'applepay') {
    return `Sending you Apple Cash for ${reason}\n$${amount}`;
  }
  return null;
}

/**
 * @param {object}  person  the other party's rs_people row
 * @param {number}  cents   what is owed
 * @param {'request'|'send'} mode
 * @param {string}  title   receipt title, used as the note
 * @param {object}  [me]    the requester's own handles, needed for a request
 * @returns {{links:object, apps:object, bodies:object}}
 *   links  the href for each service, or null when there is nothing to open
 *   apps   the app scheme to try first, where one exists
 *   bodies the raw request text, for the copy action
 */
export function buildPaymentLinks(person, cents, mode, title, me = null) {
  const amount = fromCents(cents);
  const reason = reasonFor(title);
  const links = { venmo: null, cashapp: null, paypal: null, zelle: null, applepay: null };
  const apps = { venmo: null };
  const bodies = {};

  if (mode === 'request') {
    const from = me || {};
    const phone = (person.phone || '').trim();
    for (const service of SERVICE_ORDER) {
      const body = requestBody(service, from, amount, reason);
      if (!body) continue;
      bodies[service] = body;
      links[service] = sms(phone, body);
    }
    // Venmo's charge screen opens with the amount already in it on the phones
    // that support the scheme. The text above is the fallback.
    //
    // recipients is the person being CHARGED, not the one doing the charging.
    // Naming myself here opened Venmo asking me to pay myself. The send branch
    // below is the mirror of this and was always right.
    const theirVenmo = clean(person.venmo);
    if (theirVenmo) {
      apps.venmo =
        `venmo://paycharge?txn=charge&recipients=${encodeURIComponent(theirVenmo)}` +
        `&amount=${amount}&note=${encodeURIComponent(reason)}`;
    }
    return { links, apps, bodies };
  }

  // Send: their handles, their money.
  const venmo = clean(person.venmo);
  const venmoLink = venmoProfileLink(person);
  const cashtag = clean(person.cashapp);
  const paypal = clean(person.paypal);
  const phone = (person.phone || '').trim();

  if (venmoLink) {
    links.venmo = venmoLink;
    if (venmo) {
      apps.venmo =
        `venmo://paycharge?txn=pay&recipients=${encodeURIComponent(venmo)}` +
        `&amount=${amount}&note=${encodeURIComponent(reason)}`;
    }
  }
  if (cashtag) links.cashapp = cashAppLink(cashtag, amount);
  if (paypal) links.paypal = payPalLink(paypal, amount);
  for (const service of ['zelle', 'applepay']) {
    const body = sendBody(service, person, amount, reason);
    if (!body) continue;
    bodies[service] = body;
    links[service] = sms(phone, body);
  }

  return { links, apps, bodies };
}

/**
 * Read a payment handle out of a scanned QR code or a pasted link.
 * @returns {?{field:string, value:string, label:string}} null when it is not one we know
 */
/**
 * The links for one settle-up move in a trip: `from` owes `to`.
 *
 * This exists because the call site had both halves wrong at once. In request
 * mode the first argument supplies only the phone the text is addressed to and
 * `me` supplies the handles the money goes to, which is easy to reverse, and
 * the whole {links, apps, bodies} object was being read as if it were `links`.
 *
 * @returns {{links:object, apps:object, bodies:object}}
 */
export function moveLinks(move, handles, title) {
  const debtor = handles.get(move.fromKey) || {};
  const creditor = handles.get(move.toKey) || {};
  return buildPaymentLinks({ phone: debtor.phone }, move.cents, 'request', title, creditor);
}

export function parseHandleCode(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const url = raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '');

  let m = /^cash\.app\/\$?([A-Za-z0-9_.-]+)/i.exec(url);
  if (m) return { field: 'cashapp', value: m[1], label: 'Cash App' };

  m = /^paypal\.com\/paypalme\/([A-Za-z0-9_.-]+)/i.exec(url) || /^paypal\.me\/([A-Za-z0-9_.-]+)/i.exec(url);
  if (m) return { field: 'paypal', value: m[1], label: 'PayPal' };

  // Any venmo.com host, subdomains included: account.venmo.com/u/jordan is a
  // real link somebody can be handed.
  if (/^(?:[a-z0-9-]+\.)*venmo\.com\//i.test(url)) {
    // A /u/ code names the person outright, which is worth more than the raw
    // link: a username is what the app scheme needs to prefill the amount.
    const user = /^(?:[a-z0-9-]+\.)*venmo\.com\/u\/([A-Za-z0-9_.-]+)/i.exec(url);
    if (user) return { field: 'venmo', value: user[1], label: 'Venmo' };
    return { field: 'venmo_link', value: raw, label: 'Venmo' };
  }

  return null;
}

/**
 * Which services to show for a person, and in what order. A person who has said
 * which services they take gets only those, their first choice first. Anyone who
 * has not said keeps the fixed order and the greyed-out buttons.
 */
export function servicesFor(person) {
  const accepts = person?.accepts && typeof person.accepts === 'object' ? person.accepts : null;
  const on = accepts ? SERVICE_ORDER.filter((s) => accepts[acceptsKey(s)]) : null;
  if (!on || !on.length) return { list: SERVICE_ORDER, strict: false };
  const first = person.preferred && on.includes(person.preferred) ? [person.preferred] : [];
  return { list: [...first, ...on.filter((s) => !first.includes(s))], strict: true };
}

// The itemised breakdown, used by both the text and the email link.
function breakdown(lines) {
  return lines
    .map((l) => `  ${l.name} $${fromCents(l.shareCents)}${l.splitWays > 1 ? ` (split ${l.splitWays} ways)` : ''}`)
    .join('\n');
}

export function buildShareLinks(share, title) {
  const reason = reasonFor(title);
  const amount = fromCents(share.totalCents);
  const body =
    `${reason}\n\n${breakdown(share.lines)}\n\n` +
    `Items $${fromCents(share.itemsCents)}\n` +
    `Tax $${fromCents(share.taxCents)}\n` +
    `Tip $${fromCents(share.tipCents)}\n` +
    `${share.name} owes $${amount}`;

  return {
    text: sms(share.phone, body),
    email:
      `mailto:${encodeURIComponent(share.email || '')}` +
      `?subject=${encodeURIComponent(reason)}&body=${encodeURIComponent(body)}`
  };
}

// Builds the printable statement, either for one person or for the whole split.
//
// Everything here reads cents that money.js already worked out. Nothing in this
// file divides or rounds a dollar amount, so a PDF can never disagree with the
// screen it was generated from.

import { jsPDF } from 'jspdf';
import { money, shownTotal } from './money.js';

const PAGE_W = 215.9; // letter, millimetres
const PAGE_H = 279.4;
const MARGIN = 25;
const RIGHT = PAGE_W - MARGIN;
const WIDTH = RIGHT - MARGIN;
const BOTTOM = PAGE_H - 24; // leaves room for the footer
const BLUE = [29, 78, 216]; // #1D4ED8
const GRAY = [100, 116, 139];
const INK = [15, 23, 42];

// The icon is fetched once and kept as a data URL, because building the PDF has
// to be synchronous: iOS only opens a share sheet from the click that asked for
// it, and an await in between loses that permission.
let iconData = null;
let iconTried = false;

export async function preloadStatementIcon() {
  if (iconTried) return iconData;
  iconTried = true;
  try {
    const res = await fetch('/icon-512.png');
    if (!res.ok) return null;
    const blob = await res.blob();
    // The source icon is 512px and lands in every statement. It prints at 16mm,
    // so 192px is already past what a printer can show and keeps the file small.
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = 192;
    canvas.height = 192;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, 192, 192);
    iconData = canvas.toDataURL('image/png');
  } catch {
    iconData = null;
  }
  return iconData;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function prettyDate(value) {
  if (!value) return '';
  // A plain date column has no timezone, so read the parts rather than letting
  // the Date constructor shift it back a day.
  const iso = String(value).slice(0, 10).split('-');
  if (iso.length === 3) {
    const [y, m, d] = iso.map(Number);
    if (y && m && d) return `${MONTHS[m - 1]} ${d}, ${y}`;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return `${MONTHS[parsed.getMonth()]} ${parsed.getDate()}, ${parsed.getFullYear()}`;
}

export function slugify(value) {
  return (
    String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'split'
  );
}

const HANDLE_FIELDS = [
  ['venmo', 'Venmo', '@'],
  ['cashapp', 'Cash App', '$'],
  ['paypal', 'PayPal', 'paypal.me/'],
  ['zelle', 'Zelle', ''],
  ['phone', 'Phone', ''],
  ['email', 'Email', '']
];

/**
 * @param {object}   o
 * @param {object}   o.receipt      rs_receipts row
 * @param {object[]} o.people       rs_people rows
 * @param {object[]} o.items        rs_items rows
 * @param {object[]} o.assignments  rs_item_assignments rows
 * @param {object}   o.split        the splitReceipt() result, already computed
 * @param {?object}  o.payer        the resolved payer person, or null
 * @param {?string}  o.forPersonId  one person's statement, or null for the whole split
 * @param {string}   [o.shareUrl]   printed in the footer
 * @returns {Blob}
 */
export function buildStatementPdf({
  receipt,
  people = [],
  items = [],
  assignments = [],
  split,
  payer = null,
  forPersonId = null,
  shareUrl = ''
}) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  doc.setFont('helvetica', 'normal');

  const state = { y: MARGIN };
  // A statement is read by somebody else, so a name that only means anything on
  // the phone that wrote it is worse than no name. Somebody who never set a
  // profile name goes on their own split as the literal word "Me", and that
  // printed as "Total owed to Me" and "How to pay Me" on the copy the friend
  // received. Treated as unnamed, which is what the fallback copy already
  // handles. The person section on the split asks for a real name instead.
  const payerName = selfName(payer ? payer.name : '');
  const title = (receipt?.title || '').trim() || 'Untitled split';

  drawHeader(doc, state);
  drawTitleBlock(doc, state, {
    title,
    merchant: (receipt?.merchant || '').trim(),
    date: prettyDate(receipt?.event_date || receipt?.created_at),
    payerName
  });

  const person = forPersonId ? people.find((p) => p.id === forPersonId) : null;
  if (person) {
    drawPersonStatement(doc, state, { person, split, payer, payerName });
  } else {
    drawFullSplit(doc, state, { people, items, assignments, split, payer, payerName });
  }

  drawFooters(doc, shareUrl);
  return doc.output('blob');
}

// Names that mean "whoever is holding this phone". They are correct on screen
// and meaningless in a document handed to somebody else.
const SELF_WORDS = new Set(['me', 'you', 'myself', 'self']);
export function selfName(name) {
  const clean = String(name || '').trim();
  return SELF_WORDS.has(clean.toLowerCase()) ? '' : clean;
}

// --- layout helpers ---------------------------------------------------------

function ensure(doc, state, height) {
  if (state.y + height <= BOTTOM) return;
  doc.addPage();
  state.y = MARGIN;
}

function rule(doc, state, color = [226, 232, 240], weight = 0.2) {
  doc.setDrawColor(color[0], color[1], color[2]);
  doc.setLineWidth(weight);
  doc.line(MARGIN, state.y, RIGHT, state.y);
}

function text(doc, str, x, y, opts) {
  doc.text(String(str ?? ''), x, y, opts);
}

function setType(doc, size, style = 'normal', color = INK) {
  doc.setFont('helvetica', style);
  doc.setFontSize(size);
  doc.setTextColor(color[0], color[1], color[2]);
}

function drawHeader(doc, state) {
  if (iconData) {
    try {
      doc.addImage(iconData, 'PNG', PAGE_W / 2 - 8, state.y, 16, 16);
      state.y += 22;
    } catch {
      state.y += 2;
    }
  } else {
    state.y += 2;
  }

  setType(doc, 20, 'bold');
  text(doc, 'Halfsies', PAGE_W / 2, state.y, { align: 'center' });
  state.y += 6;

  setType(doc, 9, 'normal', GRAY);
  state.y += 5;

  rule(doc, state, BLUE, 0.4);
  state.y += 10;
}

function drawTitleBlock(doc, state, { title, merchant, date, payerName }) {
  setType(doc, 16, 'bold');
  const lines = doc.splitTextToSize(title, WIDTH);
  for (const line of lines) {
    text(doc, line, MARGIN, state.y);
    state.y += 7;
  }

  // Where the receipt came from, when the reader could see it. Skipped when the
  // merchant is already the title, which is what a photo read leaves behind.
  if (merchant && merchant.toLowerCase() !== title.trim().toLowerCase()) {
    setType(doc, 11, 'normal', GRAY);
    text(doc, merchant, MARGIN, state.y);
    state.y += 6;
  }

  const parts = [];
  if (date) parts.push('Date ' + date);
  if (payerName) parts.push('Paid by ' + payerName);
  if (parts.length) {
    setType(doc, 10, 'normal', GRAY);
    text(doc, parts.join('   '), MARGIN, state.y);
    state.y += 6;
  }
  state.y += 4;
}

function tableHead(doc, state, left, right) {
  setType(doc, 9, 'bold', GRAY);
  text(doc, left, MARGIN, state.y);
  text(doc, right, RIGHT, state.y, { align: 'right' });
  state.y += 2;
  rule(doc, state);
  state.y += 5;
}

// --- one person -------------------------------------------------------------

function drawPersonStatement(doc, state, { person, split, payer, payerName }) {
  const share = split.perPerson.find((p) => p.id === person.id);

  setType(doc, 12, 'bold');
  text(doc, 'Statement for ' + person.name, MARGIN, state.y);
  state.y += 8;

  if (!share || share.lines.length === 0) {
    setType(doc, 10, 'normal', GRAY);
    text(doc, 'Nothing is assigned to this person yet.', MARGIN, state.y);
    state.y += 8;
  } else {
    tableHead(doc, state, 'Item', 'Share');
    for (const line of share.lines) {
      const label = line.name + (line.splitWays > 1 ? ` (split ${line.splitWays} ways)` : '');
      setType(doc, 10, 'normal');
      const wrapped = doc.splitTextToSize(label, WIDTH - 32);
      ensure(doc, state, wrapped.length * 5 + 2);
      text(doc, money(line.shareCents), RIGHT, state.y, { align: 'right' });
      for (const part of wrapped) {
        text(doc, part, MARGIN, state.y);
        state.y += 5;
      }
      state.y += 1;
    }
  }

  ensure(doc, state, 40);
  state.y += 2;
  rule(doc, state);
  state.y += 6;

  const totals = [
    ['Items', share ? share.itemsCents : 0],
    ['Tax', share ? share.taxCents : 0],
    ['Tip', share ? share.tipCents : 0]
  ];
  for (const [label, cents] of totals) {
    setType(doc, 10, 'normal', GRAY);
    text(doc, label, MARGIN, state.y);
    setType(doc, 10, 'normal');
    text(doc, money(cents), RIGHT, state.y, { align: 'right' });
    state.y += 6;
  }

  state.y += 2;
  setType(doc, 11, 'bold');
  text(doc, payerName ? 'Total owed to ' + payerName : 'Total owed', MARGIN, state.y);
  setType(doc, 14, 'bold');
  text(doc, money(share ? share.totalCents : 0), RIGHT, state.y, { align: 'right' });
  state.y += 12;

  if (person.settled) {
    setType(doc, 10, 'normal', GRAY);
    text(doc, person.settled_via ? 'Paid via ' + person.settled_via : 'Paid', MARGIN, state.y);
    state.y += 8;
  }

  const handles = payer
    ? HANDLE_FIELDS.map(([key, label, prefix]) => {
        const value = (payer[key] || '').trim();
        return value ? [label, prefix && !value.startsWith(prefix) ? prefix + value : value] : null;
      }).filter(Boolean)
    : [];

  if (handles.length) {
    ensure(doc, state, 14 + handles.length * 6);
    setType(doc, 11, 'bold');
    text(doc, payerName ? 'How to pay ' + payerName : 'How to pay', MARGIN, state.y);
    state.y += 7;
    for (const [label, value] of handles) {
      setType(doc, 10, 'normal', GRAY);
      text(doc, label, MARGIN, state.y);
      setType(doc, 10, 'normal');
      text(doc, value, MARGIN + 32, state.y);
      state.y += 6;
    }
  }
}

// --- everyone ---------------------------------------------------------------

const COLS = { items: 108, tax: 128, tip: 148, total: 172 };

function drawFullSplit(doc, state, { people, items, assignments, split, payer, payerName }) {
  setType(doc, 12, 'bold');
  text(doc, 'Everyone on this split', MARGIN, state.y);
  state.y += 8;

  setType(doc, 9, 'bold', GRAY);
  text(doc, 'Name', MARGIN, state.y);
  text(doc, 'Items', COLS.items, state.y, { align: 'right' });
  text(doc, 'Tax', COLS.tax, state.y, { align: 'right' });
  text(doc, 'Tip', COLS.tip, state.y, { align: 'right' });
  text(doc, 'Total', COLS.total, state.y, { align: 'right' });
  text(doc, 'Status', RIGHT, state.y, { align: 'right' });
  state.y += 2;
  rule(doc, state);
  state.y += 5;

  const settledBy = new Map(people.map((p) => [p.id, p]));
  for (const share of split.perPerson) {
    ensure(doc, state, 8);
    const who = settledBy.get(share.id);
    setType(doc, 10, 'normal');
    const name = doc.splitTextToSize(share.name, 55)[0];
    text(doc, name, MARGIN, state.y);
    text(doc, money(share.itemsCents), COLS.items, state.y, { align: 'right' });
    text(doc, money(share.taxCents), COLS.tax, state.y, { align: 'right' });
    text(doc, money(share.tipCents), COLS.tip, state.y, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    text(doc, money(share.totalCents), COLS.total, state.y, { align: 'right' });
    // The payer is on the split too, but they are not owed by themselves.
    const isPayer = payer && share.id === payer.id;
    setType(doc, 9, 'normal', isPayer || (who && who.settled) ? GRAY : INK);
    text(doc, isPayer ? 'Paid the bill' : who && who.settled ? 'Paid' : 'Owes', RIGHT, state.y, { align: 'right' });
    state.y += 6.5;
  }

  state.y += 1;
  rule(doc, state);
  state.y += 6;

  setType(doc, 10, 'bold');
  text(doc, payerName ? 'Total, paid by ' + payerName : 'Total', MARGIN, state.y);
  text(doc, money(split.assignedCents), COLS.items, state.y, { align: 'right' });
  text(doc, money(split.allocatedTaxCents), COLS.tax, state.y, { align: 'right' });
  text(doc, money(split.allocatedTipCents), COLS.tip, state.y, { align: 'right' });
  text(doc, money(split.grandCents), COLS.total, state.y, { align: 'right' });
  state.y += 12;

  ensure(doc, state, 20);
  setType(doc, 12, 'bold');
  text(doc, 'What was on the bill', MARGIN, state.y);
  state.y += 8;
  tableHead(doc, state, 'Item', 'Price');

  const nameById = new Map(people.map((p) => [p.id, p.name]));
  const byItem = new Map();
  for (const a of assignments) {
    if (!nameById.has(a.person_id)) continue;
    if (!byItem.has(a.item_id)) byItem.set(a.item_id, []);
    byItem.get(a.item_id).push(nameById.get(a.person_id));
  }

  for (const item of items) {
    const who = byItem.get(item.id) || [];
    setType(doc, 10, 'normal');
    const wrapped = doc.splitTextToSize(item.name, WIDTH - 32);
    ensure(doc, state, wrapped.length * 5 + 6);
    text(doc, money(Math.round(Number(item.price) * 100)), RIGHT, state.y, { align: 'right' });
    for (const part of wrapped) {
      text(doc, part, MARGIN, state.y);
      state.y += 5;
    }
    setType(doc, 9, 'normal', GRAY);
    text(doc, who.length ? who.join(', ') : 'Nobody yet', MARGIN + 4, state.y);
    state.y += 7;
  }
}

// --- footer -----------------------------------------------------------------

function drawFooters(doc, shareUrl) {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    setType(doc, 8, 'normal', GRAY);
    text(doc, 'Made with Halfsies', MARGIN, PAGE_H - 15);
    if (shareUrl) {
      const short = doc.splitTextToSize(shareUrl, WIDTH * 0.6)[0];
      text(doc, short, RIGHT, PAGE_H - 15, { align: 'right' });
    }
    if (pages > 1) {
      text(doc, `Page ${i} of ${pages}`, PAGE_W / 2, PAGE_H - 10, { align: 'center' });
    }
  }
}

// --- delivery ---------------------------------------------------------------

function probeFile() {
  return new File([new Blob(['x'], { type: 'application/pdf' })], 'probe.pdf', { type: 'application/pdf' });
}

// Whether this browser can hand a file to the share sheet. Used to decide
// whether to warn that an email link cannot carry an attachment.
export function canShareFiles() {
  try {
    return typeof File !== 'undefined' && Boolean(navigator.canShare) && navigator.canShare({ files: [probeFile()] });
  } catch {
    return false;
  }
}

/**
 * Share the PDF if the device has a share sheet, otherwise download it.
 * Called straight from a click so iOS still counts it as a user gesture.
 */
export function deliverPdf(blob, filename, title, onFallback) {
  const download = () => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  try {
    const file = new File([blob], filename, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title }).catch((err) => {
        // Closing the sheet is a decision, not a failure. Anything else means
        // the share did not happen, and the file has to reach them some other
        // way rather than disappearing without a word.
        if (err && err.name === 'AbortError') return;
        download();
        onFallback?.();
      });
      return 'share';
    }
  } catch {
    // fall through to the download
  }
  download();
  return 'download';
}

// --- the whole trip ---------------------------------------------------------

/**
 * One statement covering every split in a trip: the log, the totals table and
 * the who-owes-who list. With forKey set it narrows to that person's lines.
 * @returns {Blob}
 */
export function buildTripPdf({
  trip,
  rows = [],
  balances = [],
  moves = [],
  totalCents = 0,
  forKey = null,
  shareUrl = ''
}) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  doc.setFont('helvetica', 'normal');
  const state = { y: MARGIN };

  // No "You" anywhere in here. This document is built to be handed to somebody
  // else, and on their screen "You owe Casey $40" names the wrong person. Same
  // defect the payer line had. The trip screen still says You, because there
  // the reader is the phone's owner and it is right.
  const key = (name) => String(name || '').trim().toLowerCase();

  const dates = rows.map((r) => r.receipt.event_date).filter(Boolean).sort();
  const span =
    dates.length === 0
      ? prettyDate(trip?.start_date)
      : dates[0] === dates[dates.length - 1]
        ? prettyDate(dates[0])
        : prettyDate(dates[0]) + ' to ' + prettyDate(dates[dates.length - 1]);

  drawHeader(doc, state);
  const mine = forKey ? balances.find((b) => b.key === forKey) : null;
  drawTitleBlock(doc, state, {
    title: (trip?.title || '').trim() || 'Untitled trip',
    date: span,
    payerName: ''
  });

  if (mine) {
    setType(doc, 12, 'bold');
    text(doc, 'Statement for ' + mine.name, MARGIN, state.y);
    state.y += 8;
  }

  setType(doc, 12, 'bold');
  text(doc, 'The log', MARGIN, state.y);
  state.y += 8;
  tableHead(doc, state, 'Split', 'Total');

  for (const r of rows) {
    ensure(doc, state, 14);
    setType(doc, 10, 'normal');
    text(doc, r.receipt.title || 'Untitled split', MARGIN, state.y);
    text(doc, money(shownTotal(r.split).cents), RIGHT, state.y, { align: 'right' });
    state.y += 5;
    setType(doc, 9, 'normal', GRAY);
    const who = mine
      ? r.split.perPerson.filter((p) => key(p.name) === forKey)
      : r.split.perPerson;
    const parts = who.map((p) => `${p.name} ${money(p.totalCents)}`);
    const line = [prettyDate(r.receipt.event_date), r.receipt.category, parts.join(', ')]
      .filter(Boolean)
      .join('  ·  ');
    for (const part of doc.splitTextToSize(line, WIDTH)) {
      text(doc, part, MARGIN, state.y);
      state.y += 4.5;
    }
    state.y += 3;
  }

  state.y += 2;
  rule(doc, state);
  state.y += 6;
  setType(doc, 11, 'bold');
  text(doc, 'Trip total', MARGIN, state.y);
  setType(doc, 14, 'bold');
  text(doc, money(totalCents), RIGHT, state.y, { align: 'right' });
  state.y += 14;

  ensure(doc, state, 30);
  setType(doc, 12, 'bold');
  text(doc, 'Trip totals', MARGIN, state.y);
  state.y += 8;
  setType(doc, 9, 'bold', GRAY);
  text(doc, 'Name', MARGIN, state.y);
  text(doc, 'Paid', COLS.tax, state.y, { align: 'right' });
  text(doc, 'Owed', COLS.total, state.y, { align: 'right' });
  text(doc, 'Net', RIGHT, state.y, { align: 'right' });
  state.y += 2;
  rule(doc, state);
  state.y += 5;

  for (const b of balances) {
    ensure(doc, state, 8);
    setType(doc, 10, 'normal');
    text(doc, b.name, MARGIN, state.y);
    text(doc, money(b.paidCents), COLS.tax, state.y, { align: 'right' });
    text(doc, money(b.owedCents), COLS.total, state.y, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    text(doc, money(b.netCents), RIGHT, state.y, { align: 'right' });
    state.y += 6.5;
  }

  state.y += 8;
  ensure(doc, state, 24);
  setType(doc, 12, 'bold');
  text(doc, 'Who owes who', MARGIN, state.y);
  state.y += 8;

  const shown = mine ? moves.filter((m) => m.fromKey === forKey || m.toKey === forKey) : moves;
  if (shown.length === 0) {
    setType(doc, 10, 'normal', GRAY);
    text(doc, 'Everyone is square.', MARGIN, state.y);
    state.y += 6;
  } else {
    for (const m of shown) {
      ensure(doc, state, 8);
      setType(doc, 10, 'normal');
      text(doc, `${m.from} owes ${m.to}`, MARGIN, state.y);
      doc.setFont('helvetica', 'bold');
      text(doc, money(m.cents), RIGHT, state.y, { align: 'right' });
      state.y += 6.5;
    }
  }

  drawFooters(doc, shareUrl);
  return doc.output('blob');
}

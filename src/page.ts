/**
 * The client booking page — view the quote + agreement, e-sign, pay. Served by
 * the Worker at /b/:token; all data comes from GET /api/bookings/:token at
 * runtime, so this file is a self-contained HTML/CSS/JS template (no build step).
 *
 * Styling matches the contract/quote PDF design (shared/contractHtml.ts):
 * ink #1f1f1f, accent #1e78ae, borders #e2e2e2, Nunito Sans stack.
 *
 * Security: everything client-controlled is inserted via textContent; the
 * agreement HTML (rendered by the desktop, not the client) is displayed inside
 * a sandboxed iframe (no scripts). The token only ever matches [A-Za-z0-9_-].
 */
export function renderBookingShell(token: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Your booking — Summit Casino Events</title>
<style>
  :root { --ink:#1f1f1f; --muted:#5a5a5a; --faint:#6b6b6b; --line:#e2e2e2; --accent:#1e78ae; --bg:#f5f6f8; color-scheme:light; }
  * { box-sizing:border-box; margin:0; }
  body { font-family:'Nunito Sans','Helvetica Neue',Helvetica,Arial,sans-serif; color:var(--ink);
         background:var(--bg); -webkit-font-smoothing:antialiased; line-height:1.5; }
  .wrap { max-width:720px; margin:0 auto; padding:24px 16px 64px; }
  .brand { display:flex; align-items:center; gap:14px; padding:8px 4px 20px; }
  .brand img { height:44px; width:auto; }
  .brand .name { font-size:15px; font-weight:700; letter-spacing:.04em; }
  .card { background:#fff; border:1px solid var(--line); border-radius:10px; padding:22px; margin-bottom:16px; box-shadow:0 1px 3px rgba(16,24,40,.05); }
  h1 { font-size:22px; font-weight:800; margin-bottom:2px; }
  h2 { font-size:13px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; color:var(--faint); margin-bottom:12px; }
  .meta { color:var(--muted); font-size:14px; }
  .steps { display:flex; gap:8px; margin:14px 0 2px; font-size:12px; font-weight:700; letter-spacing:.05em; }
  .step { padding:4px 10px; border-radius:99px; border:1px solid var(--line); color:var(--faint); background:#fff; }
  .step.on { border-color:var(--accent); color:var(--accent); }
  .step.done { border-color:#2e7d4f; color:#2e7d4f; }
  table.svc { width:100%; border-collapse:collapse; font-size:14px; }
  table.svc td { padding:9px 6px; border-bottom:1px solid var(--line); vertical-align:top; }
  table.svc tr:last-child td { border-bottom:none; }
  td.qty { width:36px; color:var(--accent); font-weight:800; }
  td .svcname { font-weight:700; color:var(--ink); }
  td .svcsub { font-size:12.5px; color:var(--muted); margin-top:2px; }
  .sub { color:var(--faint); font-size:12.5px; }
  .contact { font-size:13px; color:var(--muted); margin-top:16px; padding-top:12px; border-top:1px solid var(--line); }
  .contact a { color:var(--accent); text-decoration:none; font-weight:700; }
  .contact a:hover { text-decoration:underline; }
  .goodtoknow { background:#f8fafb; border:1px solid var(--line); border-radius:9px; padding:12px 14px; margin-bottom:14px; font-size:13px; color:var(--muted); }
  .goodtoknow b { color:var(--ink); }
  .signedbanner { display:flex; align-items:center; gap:8px; background:rgba(46,125,79,.08); border:1px solid rgba(46,125,79,.28); color:#2e7d4f; border-radius:9px; padding:9px 12px; font-size:13.5px; font-weight:700; margin-bottom:12px; }
  .agreement { border:1px solid var(--line); border-radius:8px; overflow:hidden; background:#fff; }
  .agreement .doc { position:relative; overflow:hidden; width:100%; background:#fff; }
  .agreement iframe { border:0; display:block; background:#fff; transform-origin:top left; }
  .docActions { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:9px 12px; border-top:1px solid var(--line); }
  .linkbtn { background:none; border:0; color:var(--accent); font:inherit; font-size:12.5px; font-weight:700; cursor:pointer; padding:6px 4px; min-height:34px; }
  .sumline { display:flex; justify-content:space-between; font-size:14px; margin-top:12px; padding-top:12px; border-top:1px solid var(--line); }
  .sumline .lbl { color:var(--muted); }
  .sumline .val { font-weight:800; }
  .paysum { background:#f8fafb; border:1px solid var(--line); border-radius:9px; padding:12px 14px; margin-bottom:14px; }
  .paysum .row { display:flex; justify-content:space-between; gap:16px; font-size:13.5px; padding:3px 0; }
  .paysum .row span:last-child { white-space:nowrap; text-align:right; }
  .paysum .row.big { font-size:16px; font-weight:800; border-top:1px solid var(--line); margin-top:6px; padding-top:9px; }
  .paysum .hint { font-size:12px; color:var(--muted); margin-top:8px; }
  .docrow { display:flex; justify-content:space-between; align-items:center; padding:10px 2px; border-bottom:1px solid var(--line); }
  .docrow:last-child { border-bottom:0; }
  .docname { font-size:14px; font-weight:600; color:var(--ink); }
  a.linkbtn { text-decoration:none; }
  label { display:block; font-size:13px; font-weight:700; margin:14px 0 5px; }
  input[type=text], input[type=date], input[type=email] { width:100%; padding:10px 12px; font:inherit; font-size:16px; border:1px solid var(--line); border-radius:8px; background:#fff; color:var(--ink); appearance:none; -webkit-appearance:none; }
  input[type=date] { min-height:44px; } /* match the text fields' height (native date control is shorter) */
  input[type=text]:focus, input[type=date]:focus, input[type=email]:focus { outline:2px solid var(--accent); border-color:var(--accent); }
  .tabs { display:flex; gap:8px; margin-top:14px; }
  .tab { flex:1; padding:8px; font:inherit; font-size:13px; font-weight:700; border:1px solid var(--line); background:#fff; border-radius:8px; cursor:pointer; color:var(--muted); }
  .tab.on { border-color:var(--accent); color:var(--accent); }
  .sigbox { margin-top:10px; border:1px dashed var(--line); border-radius:8px; background:#fcfcfd; position:relative; }
  canvas.pad { width:100%; height:150px; display:block; touch-action:none; cursor:crosshair; }
  .typedPreview { height:150px; display:flex; align-items:center; justify-content:center; font-family:'Snell Roundhand','Segoe Script',cursive; font-size:32px; color:var(--ink); padding:0 16px; overflow:hidden; white-space:nowrap; }
  .clear { position:absolute; top:8px; right:8px; font-size:12px; background:#fff; border:1px solid var(--line); border-radius:6px; padding:6px 10px; cursor:pointer; color:var(--muted); }
  .consent { display:flex; gap:10px; align-items:flex-start; margin:16px 0 4px; font-size:13.5px; color:var(--muted); }
  .consent input { margin-top:3px; width:16px; height:16px; accent-color:var(--accent); }
  .btn { width:100%; margin-top:16px; padding:13px; font:inherit; font-size:15px; font-weight:800; color:#fff; background:var(--accent); border:0; border-radius:8px; cursor:pointer; transition:filter .12s; }
  .btn:not(:disabled):hover { filter:brightness(1.07); }
  .btn:disabled { opacity:.45; cursor:default; }
  .btn.ghost { background:#fff; color:var(--accent); border:1px solid var(--accent); }
  .err { color:#b3261e; font-size:13.5px; margin-top:10px; min-height:1em; }
  .notice { text-align:center; padding:36px 20px; }
  .notice .big { font-size:20px; font-weight:800; margin-bottom:6px; }
  .notice.ok .big { color:#2e7d4f; }
  .okbadge { width:46px; height:46px; border-radius:50%; background:rgba(61,154,99,.12); color:#2e7d4f;
             display:flex; align-items:center; justify-content:center; margin:0 auto 14px; font-size:22px; font-weight:800; }
  .recap { text-align:left; background:#f8fafb; border:1px solid var(--line); border-radius:9px; padding:12px 14px; margin:18px auto 0; max-width:420px; }
  .recap .row { display:flex; justify-content:space-between; gap:16px; font-size:13.5px; padding:3px 0; }
  .recap .row .lbl { color:var(--muted); }
  .recap .row .val { font-weight:700; white-space:nowrap; }
  .recap .row.big { font-size:15px; font-weight:800; border-top:1px solid var(--line); margin-top:6px; padding-top:9px; }
  .fine { color:var(--faint); font-size:12.5px; margin-top:14px; }
  #payment-element { margin-top:14px; }
  .choices { display:flex; flex-direction:column; gap:8px; margin:2px 0 6px; }
  .choice { display:block; width:100%; text-align:left; padding:11px 13px; font:inherit; border:1.5px solid var(--line); border-radius:10px; background:#fff; cursor:pointer; transition:border-color .12s; }
  .choice:hover { border-color:#c4cbd3; }
  .choice.on { border-color:var(--accent); box-shadow:inset 0 0 0 1px var(--accent); background:rgba(30,120,174,.05); }
  .choice-top { display:flex; justify-content:space-between; align-items:baseline; gap:10px; }
  .choice-title { font-size:14px; font-weight:800; color:var(--ink); }
  .choice-amt { font-size:15px; font-weight:800; color:var(--ink); }
  .choice-sub { font-size:12px; color:var(--muted); margin-top:2px; }
  .footer { text-align:center; color:var(--faint); font-size:12px; margin-top:8px; }
  a.linkbtn:hover { text-decoration:underline; }
  @media (max-width:480px) {
    .wrap { padding:14px 10px 48px; }
    .card { padding:18px 15px; }
    h1 { font-size:20px; }
    .steps { flex-wrap:wrap; }
  }
</style>
<script src="https://js.stripe.com/v3/"></script>
</head>
<body>
<div class="wrap">
  <div class="brand" id="brand" hidden><img id="brandLogo" alt="" hidden><span class="name" id="brandName"></span></div>
  <div id="app"><div class="card notice"><div class="big">Loading your booking…</div></div></div>
  <div class="footer" id="footer"></div>
</div>
<script>
'use strict';
var TOKEN = '${token}';
var API = '/api/bookings/' + TOKEN;
var CONSENT_TEXT = 'I have read and agree to the terms of this Agreement, and I intend my electronic signature below to be legally binding, the same as a handwritten signature.';
var app = document.getElementById('app');
var booking = null, stripe = null;

function el(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
function money(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// A properly associated label (htmlFor ↔ id) so screen readers announce the field and a tap
// on the label focuses the input.
function labelFor(id, text) {
  var l = document.createElement('label'); l.htmlFor = id; l.textContent = text; return l;
}
function fmtDate(iso) {
  if (!iso) return '';
  var d = new Date(iso + (iso.length === 10 ? 'T12:00:00' : ''));
  return isNaN(d) ? iso : d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}
function notice(kind, big, small) {
  app.textContent = '';
  var c = el('div', 'card notice' + (kind === 'ok' ? ' ok' : ''));
  c.appendChild(el('div', 'big', big));
  if (small) c.appendChild(el('div', 'meta', small));
  app.appendChild(c);
}
function contactLine() {
  var b = (booking && booking.snapshot && booking.snapshot.brand) || {};
  return [b.email, b.phone].filter(Boolean).join(' · ');
}

// ─── Confirmation states ─────────────────────────────────────────────────────
// A small receipt-style recap (event + amounts) so every end state says exactly
// what happened — a deposit is never presented as "fully paid".
function recapRows(rows) {
  var r = el('div', 'recap');
  rows.forEach(function (x) {
    var row = el('div', 'row' + (x.big ? ' big' : ''));
    row.appendChild(el('span', 'lbl', x.lbl));
    row.appendChild(el('span', 'val', x.val));
    r.appendChild(row);
  });
  return r;
}
function eventRecap() {
  var s = (booking && booking.snapshot) || {};
  var rows = [];
  if (s.title) rows.push({ lbl: 'Event', val: s.title });
  if (s.event_date) rows.push({ lbl: 'Date', val: fmtDate(s.event_date) });
  return rows;
}
function doneState(big, small, rows) {
  app.textContent = '';
  var c = el('div', 'card notice ok');
  c.appendChild(el('div', 'okbadge', '\\u2713'));
  c.appendChild(el('div', 'big', big));
  if (small) c.appendChild(el('div', 'meta', small));
  if (rows && rows.length) c.appendChild(recapRows(rows));
  app.appendChild(c);
  var dc = documentsCard();
  if (dc) app.appendChild(dc);
}

// ─── Load & route ───────────────────────────────────────────────────────────
// Fetch the authoritative booking state and route to the right screen. Called at
// startup and again whenever the server tells us state moved under us (e.g. a payment
// that already succeeded → we re-read rather than guess what happened).
function loadBooking() {
  return fetch(API).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { s: r.status, j: j }; }); })
    .then(function (res) {
      if (res.s === 404) return notice('', 'This booking link is no longer active.', 'If you\\u2019ve already completed your booking, you\\u2019re all set \\u2014 nothing more to do. Otherwise, please contact us.');
      booking = res.j;
      var brand = (booking.snapshot && booking.snapshot.brand) || {};
      if (brand.name) {
        document.getElementById('brandName').textContent = brand.name;
        if (brand.logo) { var im = document.getElementById('brandLogo'); im.src = brand.logo; im.hidden = false; }
        document.getElementById('brand').hidden = false;
        document.getElementById('footer').textContent = brand.name + (contactLine() ? ' — ' + contactLine() : '');
      }
      if (!stripe) stripe = window.Stripe ? window.Stripe(booking.stripe_publishable_key) : null;
      route();
    })
    .catch(function () { notice('', 'Something went wrong loading your booking.', 'Please refresh, or contact us if it keeps happening.'); });
}
loadBooking();

function route() {
  if (booking.status === 'expired' || booking.status === 'cancelled') {
    return notice('', 'This booking link has expired.', 'Please contact us for a fresh link — we\\u2019ll get you sorted right away. ' + contactLine());
  }
  if (booking.status === 'paid') {
    return doneState('You\\u2019re all set \\u2014 thank you!',
      'This booking is fully paid. A receipt was emailed when the payment went through \\u2014 we\\u2019ll see you at the event.', eventRecap());
  }
  if (booking.status === 'processing') {
    app.textContent = '';
    var pc = el('div', 'card notice');
    pc.appendChild(el('div', 'big', 'Bank transfer on its way'));
    pc.appendChild(el('div', 'meta', 'Bank transfers take a few business days to clear. Your date is held in the meantime \\u2014 we\\u2019ll email your receipt the moment it lands.'));
    var pr = eventRecap();
    if (pr.length) pc.appendChild(recapRows(pr));
    app.appendChild(pc);
    var pdc = documentsCard();
    if (pdc) app.appendChild(pdc);
    return;
  }
  render();
}

// ─── Main view: header + agreement + sign/pay ───────────────────────────────
function render() {
  app.textContent = '';
  onSignResize = null; // dropped each render; signCard re-registers it when the pad is present
  var s = booking.snapshot || {};
  var needSign = booking.require_signature && !booking.signed;

  // Header: event, a slim total line, and a stable step tracker.
  var head = el('div', 'card');
  head.appendChild(el('h1', null, s.title || 'Your event'));
  var metaBits = [fmtDate(s.event_date), s.event_time, s.venue, s.guest_count ? s.guest_count + ' guests' : null].filter(Boolean);
  head.appendChild(el('div', 'meta', metaBits.join('  ·  ')));
  if (typeof s.total === 'number') {
    var sum = el('div', 'sumline');
    sum.appendChild(el('span', 'lbl', 'Event total'));
    sum.appendChild(el('span', 'val', money(s.total)));
    head.appendChild(sum);
  }
  head.appendChild(buildSteps(needSign));
  app.appendChild(head);

  var qc = quoteCard();
  if (qc) app.appendChild(qc);
  app.appendChild(agreementCard());
  var dc = documentsCard();
  if (dc) app.appendChild(dc);

  if (needSign) app.appendChild(signCard());
  else app.appendChild(payCard());
}

// A stable step tracker — the number of steps never changes within a link (the detail
// tables live in the agreement/estimate, so nothing to duplicate up top).
function buildSteps(needSign) {
  var steps = el('div', 'steps');
  var n = 1;
  function add(label, state) { steps.appendChild(el('span', 'step ' + state, n + ' · ' + label)); n++; }
  add('Review', 'done');
  if (booking.require_signature) add('Sign', booking.signed ? 'done' : 'on');
  add('Pay', needSign ? '' : 'on');
  return steps;
}

// The itemized quote — what the client is actually paying for. The line items ride in the
// snapshot (qty · service · detail); the full branded quote PDF, when we've sent it, opens
// via "View full quote" (mirrors the agreement's "View full agreement").
function quoteCard() {
  var s = booking.snapshot || {};
  var svcs = Array.isArray(s.services) ? s.services : [];
  if (!svcs.length && typeof s.total !== 'number') return null;
  var card = el('div', 'card');
  card.appendChild(el('h2', null, 'Your quote'));
  if (svcs.length) {
    var tbl = document.createElement('table'); tbl.className = 'svc';
    svcs.forEach(function (it) {
      var tr = document.createElement('tr');
      tr.appendChild(el('td', 'qty', (it && it.qty) ? String(it.qty) : ''));
      var d = document.createElement('td');
      d.appendChild(el('div', 'svcname', (it && it.name) ? it.name : '\\u2014'));
      if (it && it.sub) d.appendChild(el('div', 'svcsub', it.sub));
      tr.appendChild(d);
      tbl.appendChild(tr);
    });
    card.appendChild(tbl);
  }
  if (typeof s.total === 'number') {
    var sum = el('div', 'sumline');
    sum.appendChild(el('span', 'lbl', 'Total'));
    sum.appendChild(el('span', 'val', money(s.total)));
    card.appendChild(sum);
  }
  // "View full quote" → the branded estimate PDF, only when the desktop has published one.
  var docs = (booking && booking.documents) || [];
  if (docs.indexOf('estimate') >= 0) {
    var actions = el('div', 'docActions');
    actions.appendChild(el('span', 'sub', 'The full itemized quote, ready to download.'));
    var a = document.createElement('a');
    a.href = API + '/doc/estimate'; a.target = '_blank'; a.rel = 'noopener';
    a.className = 'linkbtn'; a.textContent = 'View full quote';
    actions.appendChild(a);
    card.appendChild(actions);
  }
  return card;
}

// A clickable "questions?" affordance for the moment a client hesitates on the sign/pay step —
// real mailto:/tel: links, not the faint footer text. Rendered only when we have contact info.
function contactBlock() {
  var b = (booking && booking.snapshot && booking.snapshot.brand) || {};
  if (!b.email && !b.phone) return null;
  var wrap = el('div', 'contact');
  wrap.appendChild(document.createTextNode('Questions about your booking? '));
  if (b.email) {
    var em = document.createElement('a'); em.href = 'mailto:' + b.email; em.textContent = 'Email us';
    wrap.appendChild(em);
  }
  if (b.email && b.phone) wrap.appendChild(document.createTextNode(' · '));
  if (b.phone) {
    var ph = document.createElement('a'); ph.href = 'tel:' + String(b.phone).replace(/[^0-9+]/g, ''); ph.textContent = 'Call ' + b.phone;
    wrap.appendChild(ph);
  }
  return wrap;
}

// The agreement, scaled to fit the card (the source is a full letter page, so we render it
// at its natural width inside a same-origin iframe and scale the whole frame to fit — no more
// zoomed-in blob). A "View full agreement" toggle expands it to its full height.
function agreementCard() {
  var agr = el('div', 'card');
  agr.appendChild(el('h2', null, 'Your agreement'));
  var box = el('div', 'agreement');
  var doc = el('div', 'doc');
  var frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-same-origin'); // trusted desktop-rendered HTML, scripts still blocked
  frame.setAttribute('title', 'Event Booking Agreement');
  frame.srcdoc = booking.contract_html;
  doc.appendChild(frame);
  box.appendChild(doc);

  var actions = el('div', 'docActions');
  actions.appendChild(el('span', 'sub', booking.signed ? ('Signed by ' + booking.signer_name + ' on ' + fmtDate(booking.signed_at)) : 'Please review the full agreement below.'));
  // A readable, full-size escape hatch from the tiny scaled preview (especially on phones):
  // the agreement always downloads as a PDF (/doc/contract falls back to the on-page HTML).
  var right = document.createElement('div');
  right.style.display = 'flex'; right.style.gap = '4px'; right.style.alignItems = 'center'; right.style.flex = 'none';
  var pdf = document.createElement('a');
  pdf.href = API + '/doc/contract'; pdf.target = '_blank'; pdf.rel = 'noopener';
  pdf.className = 'linkbtn'; pdf.textContent = 'Open PDF';
  var expand = el('button', 'linkbtn', 'View full agreement'); expand.type = 'button';
  right.appendChild(pdf); right.appendChild(expand);
  actions.appendChild(right);
  box.appendChild(actions);
  agr.appendChild(box);

  currentDoc = doc; currentFrame = frame;
  frame.addEventListener('load', function () {
    scaleDoc(doc, frame);
    // Web-font load can reflow the document height after 'load' — re-measure once shortly after.
    setTimeout(function () { scaleDoc(doc, frame); }, 150);
  });
  expand.addEventListener('click', function () {
    doc.classList.toggle('full');
    expand.textContent = doc.classList.contains('full') ? 'Collapse' : 'View full agreement';
    scaleDoc(doc, frame);
  });
  return agr;
}

var currentDoc = null, currentFrame = null, onSignResize = null;
function scaleDoc(doc, frame) {
  try {
    var cw = doc.clientWidth || 600;
    var d = frame.contentDocument;
    var natW = Math.max(816, d.documentElement.scrollWidth, d.body ? d.body.scrollWidth : 0);
    // Set the natural width FIRST, then measure height — a replaced iframe lays out at ~300px
    // until its width is set, so reading scrollHeight before this gives a wrong (too-tall) value.
    frame.style.width = natW + 'px';
    void frame.offsetHeight; // force reflow at the real width before measuring
    var natH = Math.max(d.documentElement.scrollHeight, d.body ? d.body.scrollHeight : 0) || 1056;
    var scale = cw / natW;
    frame.style.height = natH + 'px';
    frame.style.transform = 'scale(' + scale + ')';
    doc.style.height = (doc.classList.contains('full') ? Math.ceil(natH * scale) : Math.min(560, Math.ceil(natH * scale))) + 'px';
  } catch (e) {
    frame.style.width = '100%'; frame.style.transform = 'none'; frame.style.height = '560px'; doc.style.height = '560px';
  }
}
window.addEventListener('resize', function () {
  if (currentDoc && currentFrame) scaleDoc(currentDoc, currentFrame);
  if (onSignResize) onSignResize(); // re-fit the signature pad so drawn strokes still map (rotation)
});

// "Your documents" — each opens the full document in a new tab (readable + printable → Save as
// PDF). The contract is always present; estimate/invoice ride along when we've sent them.
var DOC_LABELS = { contract: 'Event agreement', estimate: 'Quote', invoice: 'Invoice' };
function documentsCard() {
  var docs = (booking && booking.documents) || [];
  if (!docs.length) return null;
  var card = el('div', 'card');
  card.appendChild(el('h2', null, 'Your documents'));
  docs.forEach(function (k) {
    var row = el('div', 'docrow');
    row.appendChild(el('span', 'docname', DOC_LABELS[k] || k));
    var a = document.createElement('a');
    a.href = API + '/doc/' + k; a.target = '_blank'; a.rel = 'noopener';
    a.className = 'linkbtn'; a.textContent = 'Download PDF';
    row.appendChild(a);
    card.appendChild(row);
  });
  return card;
}

// ─── E-sign ─────────────────────────────────────────────────────────────────
function signCard() {
  var card = el('div', 'card');
  card.appendChild(el('h2', null, 'Sign the agreement'));
  if (booking.snapshot && booking.snapshot.countersigned) {
    card.appendChild(el('div', 'meta', 'We\\u2019ve already signed this agreement \\u2014 add your signature below to finalize it.'));
  }

  // Make it unmistakable WHAT is being signed: the agreement above, for THIS event,
  // between the client and us. (Clarity pass — the tie to the document wasn't obvious.)
  var ss = booking.snapshot || {};
  var sumBits = [ss.title, fmtDate(ss.event_date), (typeof ss.total === 'number' ? money(ss.total) : null)].filter(Boolean);
  var callout = el('div', 'paysum');
  callout.appendChild(el('div', null, 'You\\u2019re signing the Event Booking Agreement above' + (sumBits.length ? ' \\u2014 ' + sumBits.join('  \\u00b7  ') : '') + '.'));
  var parties = (ss.brand && ss.brand.name) ? ss.brand.name : 'Summit Casino Events';
  var calloutSub = el('div', 'hint', 'This agreement is between you and ' + parties + '. Your typed or drawn signature below is legally binding.');
  calloutSub.style.marginTop = '4px';
  callout.appendChild(calloutSub);
  card.appendChild(callout);

  card.appendChild(labelFor('sig-name', 'Your full legal name'));
  var name = document.createElement('input');
  name.type = 'text'; name.id = 'sig-name'; name.autocomplete = 'name'; name.maxLength = 200; name.placeholder = 'Jane Q. Smith';
  card.appendChild(name);

  // Optional title/role — fills the agreement's client "Title:" line (blank if left empty).
  card.appendChild(labelFor('sig-title', 'Title / role (optional)'));
  var titleIn = document.createElement('input');
  titleIn.type = 'text'; titleIn.id = 'sig-title'; titleIn.autocomplete = 'organization-title'; titleIn.maxLength = 120; titleIn.placeholder = 'e.g. Event Coordinator';
  card.appendChild(titleIn);

  var mode = 'typed';
  var tabs = el('div', 'tabs');
  var tType = el('button', 'tab on', 'Type it'); tType.type = 'button'; tType.setAttribute('aria-pressed', 'true');
  var tDraw = el('button', 'tab', 'Draw it'); tDraw.type = 'button'; tDraw.setAttribute('aria-pressed', 'false');
  tabs.appendChild(tType); tabs.appendChild(tDraw);
  card.appendChild(tabs);

  var sigbox = el('div', 'sigbox');
  var typed = el('div', 'typedPreview', '');
  var pad = document.createElement('canvas'); pad.className = 'pad'; pad.style.display = 'none';
  var clear = el('button', 'clear', 'Clear'); clear.type = 'button'; clear.style.display = 'none';
  sigbox.appendChild(typed); sigbox.appendChild(pad); sigbox.appendChild(clear);
  card.appendChild(sigbox);

  // Date — pre-filled with today, but the client confirms (and may adjust) it.
  card.appendChild(labelFor('sig-date', 'Date'));
  var dateIn = document.createElement('input');
  dateIn.type = 'date'; dateIn.id = 'sig-date';
  var now = new Date();
  dateIn.value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  card.appendChild(dateIn);

  var strokes = 0, drawing = false, ctx = null;
  function setupPad() {
    var dpr = window.devicePixelRatio || 1, r = pad.getBoundingClientRect();
    pad.width = r.width * dpr; pad.height = 150 * dpr;
    ctx = pad.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.25; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1f1f1f';
  }
  function pos(e) { var r = pad.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  // strokes only increments on real movement (pointermove), so a single tap on the pad — which
  // leaves no visible ink — can't satisfy the "please draw your signature" check.
  pad.addEventListener('pointerdown', function (e) { if (!ctx) setupPad(); drawing = true; var p = pos(e); ctx.beginPath(); ctx.moveTo(p[0], p[1]); pad.setPointerCapture(e.pointerId); });
  pad.addEventListener('pointermove', function (e) { if (!drawing) return; strokes++; var p = pos(e); ctx.lineTo(p[0], p[1]); ctx.stroke(); });
  pad.addEventListener('pointerup', function () { drawing = false; });
  clear.addEventListener('click', function () { if (ctx) { ctx.clearRect(0, 0, pad.width, pad.height); } strokes = 0; });
  // On resize/rotation, re-fit the pad bitmap to the new CSS width so pointer coordinates keep
  // mapping 1:1 (a stretched bitmap makes strokes land offset). Clears any in-progress drawing.
  onSignResize = function () { if (pad.style.display !== 'none' && ctx) { setupPad(); strokes = 0; } };

  name.addEventListener('input', function () { typed.textContent = name.value; });
  tType.addEventListener('click', function () { mode = 'typed'; tType.className = 'tab on'; tDraw.className = 'tab'; tType.setAttribute('aria-pressed', 'true'); tDraw.setAttribute('aria-pressed', 'false'); typed.style.display = 'flex'; pad.style.display = 'none'; clear.style.display = 'none'; });
  tDraw.addEventListener('click', function () { mode = 'drawn'; tDraw.className = 'tab on'; tType.className = 'tab'; tDraw.setAttribute('aria-pressed', 'true'); tType.setAttribute('aria-pressed', 'false'); typed.style.display = 'none'; pad.style.display = 'block'; clear.style.display = 'block'; if (!ctx) setupPad(); });

  var consent = el('div', 'consent');
  var cb = document.createElement('input'); cb.type = 'checkbox'; cb.id = 'consent';
  var cl = document.createElement('label'); cl.htmlFor = 'consent'; cl.textContent = CONSENT_TEXT; cl.style.margin = '0'; cl.style.fontWeight = '400';
  consent.appendChild(cb); consent.appendChild(cl);
  card.appendChild(consent);

  var err = el('div', 'err', '');
  var btn = el('button', 'btn', 'Sign agreement'); btn.type = 'button';
  card.appendChild(btn); card.appendChild(err);
  card.appendChild(el('div', 'fine', 'Your signature, the date and time, and your device information are recorded to create a verifiable signing record.'));
  var sc = contactBlock();
  if (sc) card.appendChild(sc);

  btn.addEventListener('click', function () {
    err.textContent = '';
    if (!name.value.trim()) { err.textContent = 'Please enter your full legal name.'; return; }
    if (mode === 'drawn' && strokes === 0) { err.textContent = 'Please draw your signature (or switch to \\u201cType it\\u201d).'; return; }
    if (!dateIn.value) { err.textContent = 'Please confirm the date.'; return; }
    if (!cb.checked) { err.textContent = 'Please tick the agreement box to sign.'; return; }
    btn.disabled = true; btn.textContent = 'Signing\\u2026';
    var sig = mode === 'typed' ? name.value.trim() : pad.toDataURL('image/png');
    fetch(API + '/sign', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ signer_name: name.value.trim(), signer_title: titleIn.value.trim() || null, sig_kind: mode, sig_data: sig, consent: true, consent_text: CONSENT_TEXT, signed_date: dateIn.value }),
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { s: r.status, j: j }; }); })
      .then(function (res) {
        if (res.s !== 200) { throw new Error(res.j && res.j.error || 'Could not record the signature.'); }
        booking.signed = true; booking.signer_name = name.value.trim(); booking.signed_at = res.j.signed_at; booking.status = 'signed';
        render();
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      })
      .catch(function (e2) { err.textContent = e2.message; btn.disabled = false; btn.textContent = 'Sign agreement'; });
  });
  return card;
}

// ─── Pay ────────────────────────────────────────────────────────────────────
function psRow(label, val, muted) {
  var r = el('div', 'row');
  var l = el('span', null, label), v = el('span', null, val);
  if (muted) { l.style.color = 'var(--muted)'; v.style.color = 'var(--muted)'; }
  r.appendChild(l); r.appendChild(v);
  return r;
}
function choiceRow(title, amount, sub, active) {
  var row = document.createElement('button'); row.type = 'button'; row.className = 'choice' + (active ? ' on' : '');
  var top = el('div', 'choice-top');
  top.appendChild(el('span', 'choice-title', title));
  top.appendChild(el('span', 'choice-amt', money(amount)));
  row.appendChild(top);
  row.appendChild(el('div', 'choice-sub', sub));
  return { row: row, setActive: function (on) { row.className = 'choice' + (on ? ' on' : ''); } };
}

function payCard() {
  var card = el('div', 'card');
  // "Pay in full" is offered only on a deposit link that carries a larger whole-contract total.
  var canFull = booking.pay_target === 'deposit' && typeof booking.full_amount === 'number' && booking.full_amount > booking.amount_due;
  var depAmt = booking.amount_due, fullAmt = booking.full_amount;
  var choice = 'deposit';

  card.appendChild(el('h2', null, booking.pay_target === 'deposit' ? 'Complete your booking' : 'Pay your balance'));

  // Confirm the just-completed sign step (sign→pay is otherwise a silent scroll).
  if (booking.require_signature && booking.signed) {
    card.appendChild(el('div', 'signedbanner', '\\u2713  Agreement signed' + (booking.signer_name ? ' by ' + booking.signer_name : '') + ' \\u2014 the last step is payment.'));
  }

  // Clear "what you're paying" summary so deposit vs. full vs. remaining is never ambiguous.
  var s = booking.snapshot || {};
  var ps = el('div', 'paysum');
  if (typeof s.total === 'number') ps.appendChild(psRow('Event total', money(s.total)));
  if (booking.pay_target === 'deposit') {
    ps.appendChild(psRow(canFull ? 'Deposit — books your date' : 'Deposit due today', money(depAmt), true));
    if (typeof s.balance === 'number' && s.balance > 0) ps.appendChild(psRow('Remaining balance (due before the event)', money(s.balance), true));
    ps.appendChild(el('div', 'hint', canFull
      ? 'Pay just the deposit to lock your date, or pay in full below — your choice.'
      : 'Your deposit locks the date; the remaining balance is due before the event.'));
  } else {
    // Returning to settle up — acknowledge what's already in before asking for the rest.
    if (typeof s.total === 'number' && s.total > depAmt) {
      ps.appendChild(psRow('Already received \\u2014 thank you', money(s.total - depAmt), true));
    }
    ps.appendChild(psRow('Remaining balance due today', money(depAmt), true));
  }
  card.appendChild(ps);

  // Plain-language "good to know" surfaced BEFORE paying — the cancellation/refund terms
  // otherwise live only inside the agreement. We point to the agreement rather than restating
  // policy here, so the two can never contradict each other.
  var gtk = el('div', 'goodtoknow');
  var gline = document.createElement('div');
  var gstrong = document.createElement('b'); gstrong.textContent = 'Good to know: ';
  gline.appendChild(gstrong);
  gline.appendChild(document.createTextNode(booking.pay_target === 'deposit'
    ? 'Your deposit reserves your event date; the remaining balance is due before the event. Please review the cancellation and refund terms in your agreement above before paying.'
    : 'Please review the cancellation and refund terms in your agreement above before paying.'));
  gtk.appendChild(gline);
  card.appendChild(gtk);

  card.appendChild(el('div', 'meta', 'Pay by bank transfer (ACH) or card. Card is instant; a bank transfer clears in a few business days.'));

  var optDep = null, optFull = null;
  if (canFull) {
    var choices = el('div', 'choices');
    optDep = choiceRow('Pay deposit', depAmt, 'Locks your date now — the balance is due later.', true);
    optFull = choiceRow('Pay in full', fullAmt, 'Settle everything today — nothing left to pay.', false);
    choices.appendChild(optDep.row); choices.appendChild(optFull.row);
    card.appendChild(choices);
  }

  // Email for the receipt — Stripe emails a receipt only when the PaymentIntent carries
  // receipt_email. Prefilled from the booking contact when we have it, but always editable
  // and OPTIONAL: an empty (or invalid) address never blocks paying, it just means no receipt.
  card.appendChild(labelFor('pay-email', 'Email for your receipt'));
  var emailIn = document.createElement('input');
  emailIn.type = 'email'; emailIn.id = 'pay-email'; emailIn.autocomplete = 'email'; emailIn.inputMode = 'email'; emailIn.maxLength = 254;
  emailIn.placeholder = 'you@example.com';
  if (s && typeof s.client_email === 'string') emailIn.value = s.client_email;
  card.appendChild(emailIn);
  var emailHint = el('div', 'hint', 'We\\u2019ll email your Stripe receipt here. Leave blank to skip it.');
  emailHint.style.marginBottom = '4px';
  card.appendChild(emailHint);

  var mount = el('div'); mount.id = 'payment-element';
  var err = el('div', 'err', '');
  var btn = el('button', 'btn', 'Pay ' + money(depAmt)); btn.type = 'button'; btn.disabled = true;
  card.appendChild(mount); card.appendChild(btn); card.appendChild(err);
  card.appendChild(el('div', 'fine', 'Payments are processed securely by Stripe. Your card or bank details go directly to Stripe and never touch our servers.'));
  var payContact = contactBlock();
  if (payContact) card.appendChild(payContact);

  if (!stripe) { err.textContent = 'The payment form could not load. Please refresh the page.'; return card; }

  var elements = null;
  var sentEmail = null; // the receipt email last sent to the server (to detect edits)
  function amountFor(c) { return c === 'full' ? fullAmt : depAmt; }
  // Optional: only send a plausible address (contains '@'); anything else is treated as blank.
  function receiptEmail() {
    var v = (emailIn.value || '').trim();
    return v.indexOf('@') > 0 ? v : '';
  }

  // (Re)load the PaymentIntent for the chosen amount and mount a fresh Payment Element, so
  // switching deposit↔full always reflects the right amount. The server is authoritative.
  function loadIntent(c) {
    choice = c;
    err.textContent = ''; btn.disabled = true; btn.textContent = 'Pay ' + money(amountFor(c)); mount.innerHTML = ''; elements = null;
    if (canFull) { optDep.setActive(c === 'deposit'); optFull.setActive(c === 'full'); }
    sentEmail = receiptEmail();
    fetch(API + '/pay-intent' + (c === 'full' ? '?choice=full' : ''), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: sentEmail }),
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { s: r.status, j: j }; }); })
      .then(function (res) {
        // The server moved state under us. Re-read the AUTHORITATIVE booking and route on it,
        // never assuming "fully paid": a deposit that just cleared comes back 'partial' and we
        // render the balance form; a booking that's truly settled shows the done state; a payment
        // still clearing shows the transfer screen. (A blanket status='paid' here used to tell a
        // deposit-payer their whole booking was settled and stall balance collection.)
        if (res.s === 409 && res.j) {
          if (/already paid/i.test(res.j.error || '')) {
            if (res.j.status && res.j.status !== 'paid') return loadBooking();
            booking.status = 'paid'; return route();
          }
          return loadBooking(); // e.g. amount change refused while an ACH payment is clearing
        }
        if (res.s !== 200) throw new Error(res.j && res.j.error || 'Could not start the payment.');
        return stripe.retrievePaymentIntent(res.j.client_secret).then(function (r2) {
          var st = r2 && r2.paymentIntent && r2.paymentIntent.status;
          var cents2 = r2 && r2.paymentIntent && r2.paymentIntent.amount;
          // Already settled (page reopened before the webhook caught up) — show the
          // kind-aware confirmation, not a blanket "fully paid" (it may be a deposit).
          if (st === 'succeeded') { return showJustPaid(paidKind(cents2), cents2 / 100); }
          if (st === 'processing') { return showTransferStarted(cents2 / 100); }
          if (choice !== c) return; // a newer choice superseded this load
          elements = stripe.elements({
            clientSecret: res.j.client_secret,
            appearance: { theme: 'stripe', variables: { colorPrimary: '#1e78ae', fontFamily: "'Nunito Sans', Helvetica, Arial, sans-serif" } },
          });
          // ACH (bank transfer) first — big-ticket bookings cost ~0.8% (capped) vs ~3% on card.
          elements.create('payment', { paymentMethodOrder: ['us_bank_account', 'card'] }).mount('#payment-element');
          btn.disabled = false;
        });
      })
      .catch(function (e2) { err.textContent = e2.message; });
  }

  if (canFull) {
    optDep.row.addEventListener('click', function () { if (choice !== 'deposit') loadIntent('deposit'); });
    optFull.row.addEventListener('click', function () { if (choice !== 'full') loadIntent('full'); });
  }
  // If the client fills in / changes the receipt email after the form has mounted, attach the
  // new address to the SAME PaymentIntent — without tearing down the mounted card field (which
  // would wipe any card details they'd already entered). Same amount + kind, so the server
  // reuses the intent and just updates receipt_email; never double-charges.
  emailIn.addEventListener('blur', function () {
    if (!elements || receiptEmail() === sentEmail) return;
    sentEmail = receiptEmail();
    fetch(API + '/pay-intent' + (choice === 'full' ? '?choice=full' : ''), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: sentEmail }),
    }).catch(function () { /* the receipt email is non-blocking */ });
  });
  loadIntent('deposit');

  // What was JUST paid decides the confirmation — a deposit is never shown as "fully paid".
  function paidKind(amtCents) {
    if (booking.pay_target === 'balance') return 'balance';
    return typeof fullAmt === 'number' && Math.round(fullAmt * 100) === amtCents ? 'full' : 'deposit';
  }
  function showJustPaid(kind, amt) {
    var s3 = booking.snapshot || {};
    // Remaining after a deposit is the whole total minus what was just paid (authoritative),
    // falling back to the snapshot balance — so a deposit is never mislabeled "paid in full".
    var remaining = 0;
    if (kind === 'deposit') {
      if (typeof booking.full_amount === 'number') remaining = Math.max(0, Math.round((booking.full_amount - amt) * 100) / 100);
      else if (typeof s3.balance === 'number' && s3.balance > 0) remaining = s3.balance;
    }
    var rows = eventRecap();
    rows.push({ lbl: 'Paid today', val: money(amt), big: true });
    if (remaining > 0) rows.push({ lbl: 'Remaining balance', val: money(remaining) });
    if (kind === 'deposit' && remaining > 0) {
      doneState('Deposit received \\u2014 your date is locked in',
        'Thank you! A receipt is on its way to your inbox. The remaining balance is due before your event \\u2014 you\\u2019ll pay it right here on this same link.', rows);
    } else if (kind === 'balance') {
      doneState('Balance received \\u2014 you\\u2019re all paid',
        'Thank you! A receipt is on its way to your inbox. We\\u2019ll see you at the event.', rows);
    } else {
      doneState('Paid in full \\u2014 you\\u2019re all set',
        'Thank you! A receipt is on its way to your inbox. Nothing left to pay \\u2014 we\\u2019ll see you at the event.', rows);
    }
  }
  function showTransferStarted(amt) {
    app.textContent = '';
    var tc = el('div', 'card notice');
    tc.appendChild(el('div', 'big', 'Bank transfer initiated'));
    tc.appendChild(el('div', 'meta', 'Your ' + money(amt) + ' transfer is on its way \\u2014 bank transfers take a few business days to clear. Your date is held in the meantime; we\\u2019ll email your receipt the moment it lands.'));
    var rows = eventRecap();
    if (rows.length) tc.appendChild(recapRows(rows));
    app.appendChild(tc);
    var dc = documentsCard();
    if (dc) app.appendChild(dc);
  }

  btn.addEventListener('click', function () {
    if (!elements) return;
    err.textContent = ''; btn.disabled = true; btn.textContent = 'Processing\\u2026';
    stripe.confirmPayment({ elements: elements, confirmParams: { return_url: window.location.href }, redirect: 'if_required' })
      .then(function (res) {
        if (res.error) throw new Error(res.error.message || 'Payment failed. Please try again.');
        var st = res.paymentIntent && res.paymentIntent.status;
        var cents = res.paymentIntent && res.paymentIntent.amount;
        if (st === 'succeeded') { showJustPaid(paidKind(cents), cents / 100); }
        else if (st === 'processing') { showTransferStarted(cents / 100); }
        else { throw new Error('Payment did not complete. Please try again.'); }
      })
      .catch(function (e2) { err.textContent = e2.message; btn.disabled = false; btn.textContent = 'Pay ' + money(amountFor(choice)); });
  });
  return card;
}
</script>
</body>
</html>`;
}

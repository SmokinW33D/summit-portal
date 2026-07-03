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
  :root { --ink:#1f1f1f; --muted:#5a5a5a; --faint:#909090; --line:#e2e2e2; --accent:#1e78ae; --bg:#f5f6f8; }
  * { box-sizing:border-box; margin:0; }
  body { font-family:'Nunito Sans','Helvetica Neue',Helvetica,Arial,sans-serif; color:var(--ink);
         background:var(--bg); -webkit-font-smoothing:antialiased; line-height:1.5; }
  .wrap { max-width:720px; margin:0 auto; padding:24px 16px 64px; }
  .brand { display:flex; align-items:center; gap:14px; padding:8px 4px 20px; }
  .brand img { height:44px; width:auto; }
  .brand .name { font-size:15px; font-weight:700; letter-spacing:.04em; }
  .card { background:#fff; border:1px solid var(--line); border-radius:10px; padding:22px; margin-bottom:16px; }
  h1 { font-size:22px; font-weight:800; margin-bottom:2px; }
  h2 { font-size:13px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; color:var(--faint); margin-bottom:12px; }
  .meta { color:var(--muted); font-size:14px; }
  .steps { display:flex; gap:8px; margin:14px 0 2px; font-size:12px; font-weight:700; letter-spacing:.05em; }
  .step { padding:4px 10px; border-radius:99px; border:1px solid var(--line); color:var(--faint); background:#fff; }
  .step.on { border-color:var(--accent); color:var(--accent); }
  .step.done { border-color:#3d9a63; color:#3d9a63; }
  table.svc { width:100%; border-collapse:collapse; font-size:14px; }
  table.svc td { padding:8px 6px; border-bottom:1px solid var(--line); vertical-align:top; }
  table.svc tr:last-child td { border-bottom:none; }
  td.qty { width:36px; color:var(--muted); }
  .sub { color:var(--faint); font-size:12.5px; }
  .money { display:flex; justify-content:space-between; font-size:14px; padding:5px 6px; }
  .money.due { font-size:17px; font-weight:800; border-top:2px solid var(--ink); margin-top:6px; padding-top:11px; }
  .agreement { border:1px solid var(--line); border-radius:8px; overflow:hidden; }
  .agreement iframe { width:100%; height:460px; border:0; display:block; background:#fff; }
  label { display:block; font-size:13px; font-weight:700; margin:14px 0 5px; }
  input[type=text] { width:100%; padding:10px 12px; font:inherit; font-size:15px; border:1px solid var(--line); border-radius:8px; }
  input[type=text]:focus { outline:2px solid var(--accent); border-color:var(--accent); }
  .tabs { display:flex; gap:8px; margin-top:14px; }
  .tab { flex:1; padding:8px; font:inherit; font-size:13px; font-weight:700; border:1px solid var(--line); background:#fff; border-radius:8px; cursor:pointer; color:var(--muted); }
  .tab.on { border-color:var(--accent); color:var(--accent); }
  .sigbox { margin-top:10px; border:1px dashed var(--line); border-radius:8px; background:#fcfcfd; position:relative; }
  canvas.pad { width:100%; height:150px; display:block; touch-action:none; cursor:crosshair; }
  .typedPreview { height:150px; display:flex; align-items:center; justify-content:center; font-family:'Snell Roundhand','Segoe Script',cursive; font-size:32px; color:var(--ink); padding:0 16px; overflow:hidden; }
  .clear { position:absolute; top:8px; right:8px; font-size:12px; background:#fff; border:1px solid var(--line); border-radius:6px; padding:3px 8px; cursor:pointer; color:var(--muted); }
  .consent { display:flex; gap:10px; align-items:flex-start; margin:16px 0 4px; font-size:13.5px; color:var(--muted); }
  .consent input { margin-top:3px; width:16px; height:16px; accent-color:var(--accent); }
  .btn { width:100%; margin-top:16px; padding:13px; font:inherit; font-size:15px; font-weight:800; color:#fff; background:var(--accent); border:0; border-radius:8px; cursor:pointer; }
  .btn:disabled { opacity:.45; cursor:default; }
  .btn.ghost { background:#fff; color:var(--accent); border:1px solid var(--accent); }
  .err { color:#b3261e; font-size:13.5px; margin-top:10px; min-height:1em; }
  .notice { text-align:center; padding:36px 20px; }
  .notice .big { font-size:20px; font-weight:800; margin-bottom:6px; }
  .notice.ok .big { color:#2e7d4f; }
  .fine { color:var(--faint); font-size:12.5px; margin-top:14px; }
  #payment-element { margin-top:14px; }
  .footer { text-align:center; color:var(--faint); font-size:12px; margin-top:8px; }
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

// ─── Load & route ───────────────────────────────────────────────────────────
fetch(API).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { s: r.status, j: j }; }); })
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
    stripe = window.Stripe ? window.Stripe(booking.stripe_publishable_key) : null;
    route();
  })
  .catch(function () { notice('', 'Something went wrong loading your booking.', 'Please refresh, or contact us if it keeps happening.'); });

function route() {
  if (booking.status === 'expired' || booking.status === 'cancelled') {
    return notice('', 'This booking link has expired.', 'Please contact us for a fresh link — we\\u2019ll get you sorted right away. ' + contactLine());
  }
  if (booking.status === 'paid') {
    return notice('ok', booking.pay_target === 'deposit' ? 'You\\u2019re booked!' : 'Payment received — thank you!',
      booking.pay_target === 'deposit' ? 'Your deposit is in and your date is locked. A receipt is on its way.' : 'Your balance is settled. See you at the event!');
  }
  if (booking.status === 'processing') {
    return notice('ok', 'Bank transfer initiated', 'Your payment is on its way — bank transfers take a few business days to clear. We\\u2019ll confirm as soon as it lands.');
  }
  render();
}

// ─── Main view: summary + agreement + sign + pay ───────────────────────────
function render() {
  app.textContent = '';
  var s = booking.snapshot || {};
  var needSign = booking.require_signature && !booking.signed;

  var head = el('div', 'card');
  head.appendChild(el('h1', null, s.title || 'Your event'));
  var metaBits = [fmtDate(s.event_date), s.event_time, s.venue, s.guest_count ? s.guest_count + ' guests' : null].filter(Boolean);
  head.appendChild(el('div', 'meta', metaBits.join('  ·  ')));
  var steps = el('div', 'steps');
  steps.appendChild(el('span', 'step done', '1 · Review'));
  if (booking.require_signature) steps.appendChild(el('span', 'step' + (needSign ? ' on' : ' done'), '2 · Sign'));
  steps.appendChild(el('span', 'step' + (needSign ? '' : ' on'), (booking.require_signature ? '3' : '2') + ' · Pay'));
  head.appendChild(steps);
  app.appendChild(head);

  if (Array.isArray(s.services) && s.services.length) {
    var svc = el('div', 'card');
    svc.appendChild(el('h2', null, 'What\\u2019s included'));
    var t = el('table', 'svc');
    s.services.forEach(function (it) {
      var tr = el('tr');
      tr.appendChild(el('td', 'qty', it.qty ? String(it.qty) + '\\u00d7' : ''));
      var td = el('td');
      td.appendChild(el('div', null, it.name || ''));
      if (it.sub) td.appendChild(el('div', 'sub', it.sub));
      tr.appendChild(td);
      t.appendChild(tr);
    });
    svc.appendChild(t);
    if (typeof s.total === 'number') {
      var rows = [['Event total', s.total]];
      if (booking.pay_target === 'deposit' && typeof s.balance === 'number') rows.push(['Remaining balance (later)', s.balance]);
      rows.forEach(function (r) {
        var m = el('div', 'money');
        m.appendChild(el('span', null, r[0]));
        m.appendChild(el('span', null, money(r[1])));
        svc.appendChild(m);
      });
    }
    var due = el('div', 'money due');
    due.appendChild(el('span', null, booking.pay_target === 'deposit' ? 'Deposit due today' : 'Balance due'));
    due.appendChild(el('span', null, money(booking.amount_due)));
    svc.appendChild(due);
    app.appendChild(svc);
  }

  var agr = el('div', 'card');
  agr.appendChild(el('h2', null, 'Your agreement'));
  var box = el('div', 'agreement');
  var frame = document.createElement('iframe');
  frame.setAttribute('sandbox', '');
  frame.setAttribute('title', 'Event Booking Agreement');
  frame.srcdoc = booking.contract_html;
  box.appendChild(frame);
  agr.appendChild(box);
  if (booking.signed) agr.appendChild(el('div', 'fine', 'Signed by ' + booking.signer_name + ' on ' + fmtDate(booking.signed_at) + '.'));
  app.appendChild(agr);

  if (needSign) app.appendChild(signCard());
  else app.appendChild(payCard());
}

// ─── E-sign ─────────────────────────────────────────────────────────────────
function signCard() {
  var card = el('div', 'card');
  card.appendChild(el('h2', null, 'Sign the agreement'));

  card.appendChild(el('label', null, 'Your full legal name'));
  var name = document.createElement('input');
  name.type = 'text'; name.autocomplete = 'name'; name.maxLength = 200; name.placeholder = 'Jane Q. Smith';
  card.appendChild(name);

  var mode = 'typed';
  var tabs = el('div', 'tabs');
  var tType = el('button', 'tab on', 'Type it'); tType.type = 'button';
  var tDraw = el('button', 'tab', 'Draw it'); tDraw.type = 'button';
  tabs.appendChild(tType); tabs.appendChild(tDraw);
  card.appendChild(tabs);

  var sigbox = el('div', 'sigbox');
  var typed = el('div', 'typedPreview', '');
  var pad = document.createElement('canvas'); pad.className = 'pad'; pad.style.display = 'none';
  var clear = el('button', 'clear', 'Clear'); clear.type = 'button'; clear.style.display = 'none';
  sigbox.appendChild(typed); sigbox.appendChild(pad); sigbox.appendChild(clear);
  card.appendChild(sigbox);

  var strokes = 0, drawing = false, ctx = null;
  function setupPad() {
    var dpr = window.devicePixelRatio || 1, r = pad.getBoundingClientRect();
    pad.width = r.width * dpr; pad.height = 150 * dpr;
    ctx = pad.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.25; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1f1f1f';
  }
  function pos(e) { var r = pad.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  pad.addEventListener('pointerdown', function (e) { if (!ctx) setupPad(); drawing = true; strokes++; var p = pos(e); ctx.beginPath(); ctx.moveTo(p[0], p[1]); pad.setPointerCapture(e.pointerId); });
  pad.addEventListener('pointermove', function (e) { if (!drawing) return; var p = pos(e); ctx.lineTo(p[0], p[1]); ctx.stroke(); });
  pad.addEventListener('pointerup', function () { drawing = false; });
  clear.addEventListener('click', function () { if (ctx) { ctx.clearRect(0, 0, pad.width, pad.height); } strokes = 0; });

  name.addEventListener('input', function () { typed.textContent = name.value; });
  tType.addEventListener('click', function () { mode = 'typed'; tType.className = 'tab on'; tDraw.className = 'tab'; typed.style.display = 'flex'; pad.style.display = 'none'; clear.style.display = 'none'; });
  tDraw.addEventListener('click', function () { mode = 'drawn'; tDraw.className = 'tab on'; tType.className = 'tab'; typed.style.display = 'none'; pad.style.display = 'block'; clear.style.display = 'block'; if (!ctx) setupPad(); });

  var consent = el('div', 'consent');
  var cb = document.createElement('input'); cb.type = 'checkbox'; cb.id = 'consent';
  var cl = document.createElement('label'); cl.htmlFor = 'consent'; cl.textContent = CONSENT_TEXT; cl.style.margin = '0'; cl.style.fontWeight = '400';
  consent.appendChild(cb); consent.appendChild(cl);
  card.appendChild(consent);

  var err = el('div', 'err', '');
  var btn = el('button', 'btn', 'Sign agreement'); btn.type = 'button';
  card.appendChild(btn); card.appendChild(err);
  card.appendChild(el('div', 'fine', 'Your signature, the date and time, and your device information are recorded to create a verifiable signing record.'));

  btn.addEventListener('click', function () {
    err.textContent = '';
    if (!name.value.trim()) { err.textContent = 'Please enter your full legal name.'; return; }
    if (mode === 'drawn' && strokes === 0) { err.textContent = 'Please draw your signature (or switch to \\u201cType it\\u201d).'; return; }
    if (!cb.checked) { err.textContent = 'Please tick the agreement box to sign.'; return; }
    btn.disabled = true; btn.textContent = 'Signing\\u2026';
    var sig = mode === 'typed' ? name.value.trim() : pad.toDataURL('image/png');
    fetch(API + '/sign', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ signer_name: name.value.trim(), sig_kind: mode, sig_data: sig, consent: true, consent_text: CONSENT_TEXT }),
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
function payCard() {
  var card = el('div', 'card');
  card.appendChild(el('h2', null, (booking.pay_target === 'deposit' ? 'Pay your deposit' : 'Pay your balance') + ' — ' + money(booking.amount_due)));
  if (booking.pay_target === 'deposit') card.appendChild(el('div', 'meta', 'Your date is locked in the moment your deposit goes through.'));
  else card.appendChild(el('div', 'meta', 'Card is instant; bank transfer (ACH) works too and takes a few business days to clear.'));

  var mount = el('div'); mount.id = 'payment-element';
  var err = el('div', 'err', '');
  var btn = el('button', 'btn', 'Pay ' + money(booking.amount_due)); btn.type = 'button'; btn.disabled = true;
  card.appendChild(mount); card.appendChild(btn); card.appendChild(err);
  card.appendChild(el('div', 'fine', 'Payments are processed securely by Stripe. Your card or bank details go directly to Stripe and never touch our servers.'));

  if (!stripe) { err.textContent = 'The payment form could not load. Please refresh the page.'; return card; }

  var elements = null;
  fetch(API + '/pay-intent', { method: 'POST' })
    .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { s: r.status, j: j }; }); })
    .then(function (res) {
      // Already paid (e.g. link reopened right after paying, before the confirmation
      // lands) — show the done state, never the form.
      if (res.s === 409 && res.j && /already paid/i.test(res.j.error || '')) { booking.status = 'paid'; return route(); }
      if (res.s !== 200) throw new Error(res.j && res.j.error || 'Could not start the payment.');
      return stripe.retrievePaymentIntent(res.j.client_secret).then(function (r2) {
        var st = r2 && r2.paymentIntent && r2.paymentIntent.status;
        if (st === 'succeeded') { booking.status = 'paid'; return route(); }
        if (st === 'processing') { booking.status = 'processing'; return route(); }
        elements = stripe.elements({
          clientSecret: res.j.client_secret,
          appearance: { theme: 'stripe', variables: { colorPrimary: '#1e78ae', fontFamily: "'Nunito Sans', Helvetica, Arial, sans-serif" } },
        });
        elements.create('payment').mount('#payment-element');
        btn.disabled = false;
      });
    })
    .catch(function (e2) { err.textContent = e2.message; });

  btn.addEventListener('click', function () {
    err.textContent = ''; btn.disabled = true; btn.textContent = 'Processing\\u2026';
    stripe.confirmPayment({ elements: elements, confirmParams: { return_url: window.location.href }, redirect: 'if_required' })
      .then(function (res) {
        if (res.error) throw new Error(res.error.message || 'Payment failed. Please try again.');
        var st = res.paymentIntent && res.paymentIntent.status;
        if (st === 'succeeded') { booking.status = 'paid'; route(); }
        else if (st === 'processing') { booking.status = 'processing'; route(); }
        else { throw new Error('Payment did not complete. Please try again.'); }
      })
      .catch(function (e2) { err.textContent = e2.message; btn.disabled = false; btn.textContent = 'Pay ' + money(booking.amount_due); });
  });
  return card;
}
</script>
</body>
</html>`;
}

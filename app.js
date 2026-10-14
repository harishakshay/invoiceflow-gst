/* =========================================================
   InvoiceFlow - shared helpers + vanilla JS for the
   login page (index.html) and printable invoice (invoice.html).
   The React app (app.html) reuses these helpers too.
   ========================================================= */

/** GST state codes (first two digits of every GSTIN) */
const STATES = [
    ['01', 'Jammu & Kashmir'], ['02', 'Himachal Pradesh'], ['03', 'Punjab'], ['04', 'Chandigarh'], ['05', 'Uttarakhand'],
    ['06', 'Haryana'], ['07', 'Delhi'], ['08', 'Rajasthan'], ['09', 'Uttar Pradesh'], ['10', 'Bihar'], ['11', 'Sikkim'],
    ['12', 'Arunachal Pradesh'], ['13', 'Nagaland'], ['14', 'Manipur'], ['15', 'Mizoram'], ['16', 'Tripura'], ['17', 'Meghalaya'],
    ['18', 'Assam'], ['19', 'West Bengal'], ['20', 'Jharkhand'], ['21', 'Odisha'], ['22', 'Chhattisgarh'], ['23', 'Madhya Pradesh'],
    ['24', 'Gujarat'], ['26', 'Dadra & Nagar Haveli and Daman & Diu'], ['27', 'Maharashtra'], ['29', 'Karnataka'], ['30', 'Goa'],
    ['31', 'Lakshadweep'], ['32', 'Kerala'], ['33', 'Tamil Nadu'], ['34', 'Puducherry'], ['35', 'Andaman & Nicobar Islands'],
    ['36', 'Telangana'], ['37', 'Andhra Pradesh'], ['38', 'Ladakh'],
];
const GST_RATES = [0, 5, 12, 18, 28, 40];
const PAY_MODES = ['UPI', 'Bank Transfer', 'Cash', 'Cheque', 'Card'];

/** Calls api.php and returns JSON, or throws an Error with the server's message */
async function api(action, data = null, query = {}) {
    const clean = Object.fromEntries(Object.entries(query).filter(([, v]) => v !== '' && v != null));
    const options = { method: data ? 'POST' : 'GET', credentials: 'same-origin' };
    if (data) {
        options.headers = { 'Content-Type': 'application/json' };
        options.body = JSON.stringify(data);
    }
    const res = await fetch('api.php?' + new URLSearchParams({ action, ...clean }), options);
    const json = await res.json().catch(() => ({ error: 'The server sent an invalid response.' }));
    if (!res.ok || json.error) {
        const err = new Error(json.error || 'Request failed');
        err.status = res.status;
        throw err;
    }
    return json;
}

function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(message, isError = false) {
    document.querySelector('.toast')?.remove();
    const el = document.createElement('div');
    el.className = 'toast' + (isError ? ' err' : '');
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2800);
}

/** ₹1,23,456.00 - Indian digit grouping */
const inrFormat = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
const inrWhole = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
function inr(n, whole = false) { return (whole ? inrWhole : inrFormat).format(Number(n) || 0); }
/** ₹4.2L / ₹1.1Cr - compact for charts */
function inrShort(n) {
    n = Number(n) || 0;
    if (n >= 1e7) return '₹' + (n / 1e7).toFixed(1) + 'Cr';
    if (n >= 1e5) return '₹' + (n / 1e5).toFixed(1) + 'L';
    if (n >= 1e3) return '₹' + (n / 1e3).toFixed(1) + 'K';
    return '₹' + Math.round(n);
}

function fmtDate(d) {
    if (!d) return '–';
    return new Date(d.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function today(offsetDays = 0) {
    const d = new Date(Date.now() + offsetDays * 86400000);
    return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function addDays(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** 125000 -> "Rupees One Lakh Twenty Five Thousand Only" (Indian numbering) */
function amountInWords(amount) {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
        'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const two = n => (n < 20 ? ones[n] : tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : ''));
    const three = n => (n >= 100 ? ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' : '') : '') + (n % 100 ? two(n % 100) : '');
    const words = n => {
        if (n === 0) return 'Zero';
        const parts = [];
        const crore = Math.floor(n / 1e7); n %= 1e7;
        const lakh = Math.floor(n / 1e5); n %= 1e5;
        const thousand = Math.floor(n / 1e3); n %= 1e3;
        if (crore) parts.push(words(crore) + ' Crore');
        if (lakh) parts.push(two(lakh) + ' Lakh');
        if (thousand) parts.push(two(thousand) + ' Thousand');
        if (n) parts.push(three(n));
        return parts.join(' ');
    };
    const abs = Math.abs(Number(amount) || 0);
    const rupees = Math.floor(abs);
    const paise = Math.round((abs - rupees) * 100);
    return 'Rupees ' + words(rupees) + (paise ? ' and ' + two(paise) + ' Paise' : '') + ' Only';
}

/**
 * Same GST maths as compute_invoice() in db.php, used for the live preview
 * while typing. The server always recalculates before saving.
 */
function computeInvoice(items, interstate) {
    const r2 = x => Math.round(x * 100) / 100;
    let subtotal = 0, discount = 0, taxable = 0, tax = 0;
    const lines = items.map(it => {
        const gross = (+it.qty || 0) * (+it.rate || 0);
        const disc = r2(gross * (+it.discount_pct || 0) / 100);
        const lineTaxable = r2(gross - disc);
        const lineTax = r2(lineTaxable * (+it.gst_rate || 0) / 100);
        subtotal += gross; discount += disc; taxable += lineTaxable; tax += lineTax;
        return { ...it, taxable: lineTaxable, tax: lineTax };
    });
    const cgst = interstate ? 0 : r2(tax / 2);
    const sgst = interstate ? 0 : r2(tax - cgst);
    const igst = interstate ? r2(tax) : 0;
    const exact = r2(taxable + cgst + sgst + igst);
    const total = Math.round(exact);
    return { lines, subtotal: r2(subtotal), discount: r2(discount), taxable: r2(taxable), cgst, sgst, igst, round_off: r2(total - exact), total };
}

/* =========================================================
   LOGIN PAGE
   ========================================================= */
function initLogin() {
    api('me').then(() => location.replace('app.html')).catch(() => {});
    const form = document.getElementById('loginForm');
    const errBox = document.getElementById('loginError');
    form.addEventListener('submit', async e => {
        e.preventDefault();
        const email = form.email.value.trim();
        const password = form.password.value;
        if (!email || !password) { errBox.textContent = 'Please enter your email and password.'; errBox.classList.remove('hidden'); return; }
        const btn = form.querySelector('button');
        btn.disabled = true;
        btn.textContent = 'Signing in…';
        try {
            await api('login', { email, password });
            location.replace('app.html');
        } catch (err) {
            errBox.textContent = err.message;
            errBox.classList.remove('hidden');
            btn.disabled = false;
            btn.textContent = 'Sign in';
        }
    });
}

/* =========================================================
   PRINTABLE TAX INVOICE
   ========================================================= */
async function initInvoice() {
    const id = new URLSearchParams(location.search).get('id');
    const sheet = document.getElementById('sheet');
    let inv;
    try {
        inv = await api('invoice', null, { id });
    } catch (err) {
        if (err.status === 401) return location.replace('index.html');
        sheet.innerHTML = `<p class="empty">${esc(err.message)}</p>`;
        return;
    }
    const b = inv.business;
    const c = inv.client;
    const igst = +inv.interstate === 1;
    document.title = `${inv.number} · ${c.name}`;

    // Tax summary grouped by HSN code + rate (required on GST invoices)
    const groups = {};
    inv.items.forEach(it => {
        const key = it.hsn + '|' + it.gst_rate;
        groups[key] = groups[key] || { hsn: it.hsn, rate: +it.gst_rate, taxable: 0, tax: 0 };
        groups[key].taxable += +it.taxable;
        groups[key].tax += +it.tax;
    });
    const taxRows = Object.values(groups).map(g => igst
        ? `<tr><td>${esc(g.hsn)}</td><td>${inr(g.taxable)}</td><td>${g.rate}%</td><td>${inr(g.tax)}</td><td>${inr(g.tax)}</td></tr>`
        : `<tr><td>${esc(g.hsn)}</td><td>${inr(g.taxable)}</td><td>${g.rate / 2}%</td><td>${inr(g.tax / 2)}</td><td>${g.rate / 2}%</td><td>${inr(g.tax / 2)}</td><td>${inr(g.tax)}</td></tr>`).join('');

    sheet.innerHTML = `
        ${['paid', 'cancelled'].includes(inv.pay_status) ? `<div class="stamp ${inv.pay_status}">${inv.pay_status.toUpperCase()}</div>` : ''}
        <div class="sheet-top">
            <div>
                <h1>${esc(b.name)}</h1>
                <div class="addr">${esc(b.address)}, ${esc(b.state)}</div>
                <div style="margin-top:4px"><b>GSTIN:</b> ${esc(b.gstin)} &nbsp;·&nbsp; ${esc(b.phone)} &nbsp;·&nbsp; ${esc(b.email)}</div>
            </div>
            <div class="doc-title">
                <h2>TAX INVOICE</h2>
                <table>
                    <tr><td>Invoice No.</td><td><b>${esc(inv.number)}</b></td></tr>
                    <tr><td>Invoice Date</td><td>${fmtDate(inv.issue_date)}</td></tr>
                    <tr><td>Due Date</td><td>${fmtDate(inv.due_date)}</td></tr>
                    <tr><td>Place of Supply</td><td>${esc(c.state)} (${esc(c.state_code)})</td></tr>
                </table>
            </div>
        </div>

        <div class="parties">
            <div>
                <h4>Bill to</h4>
                <b>${esc(c.name)}</b>
                <div class="addr">${esc(c.address)}, ${esc(c.state)}</div>
                <div>${c.gstin ? '<b>GSTIN:</b> ' + esc(c.gstin) : 'Unregistered (B2C)'}</div>
            </div>
            <div>
                <h4>Contact</h4>
                <div>${esc(c.contact_person || '–')}</div>
                <div>${esc(c.phone || '')}</div>
                <div>${esc(c.email || '')}</div>
            </div>
        </div>

        <table class="inv-table">
            <thead><tr><th>#</th><th>Item / Description</th><th>HSN/SAC</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Disc.</th><th class="r">Taxable</th><th class="r">GST</th><th class="r">Amount</th></tr></thead>
            <tbody>
                ${inv.items.map((it, i) => `
                    <tr>
                        <td>${i + 1}</td><td>${esc(it.description)}</td><td>${esc(it.hsn)}</td>
                        <td class="r">${+it.qty} ${esc(it.unit)}</td><td class="r">${inr(it.rate)}</td>
                        <td class="r">${+it.discount_pct ? +it.discount_pct + '%' : '–'}</td>
                        <td class="r">${inr(it.taxable)}</td><td class="r">${+it.gst_rate}%</td>
                        <td class="r"><b>${inr(+it.taxable + +it.tax)}</b></td>
                    </tr>`).join('')}
            </tbody>
        </table>

        <div class="inv-bottom">
            <div>
                <table class="tax-table">
                    <thead>${igst
                        ? '<tr><th>HSN/SAC</th><th>Taxable</th><th>IGST %</th><th>IGST</th><th>Total tax</th></tr>'
                        : '<tr><th>HSN/SAC</th><th>Taxable</th><th>CGST %</th><th>CGST</th><th>SGST %</th><th>SGST</th><th>Total tax</th></tr>'}</thead>
                    <tbody>${taxRows}</tbody>
                </table>
                <div class="in-words">${amountInWords(inv.total)}</div>
                <div class="pay-box">
                    <div id="qr"></div>
                    <div>
                        <b>Bank details</b><br>
                        ${esc(b.bank_name)}<br>
                        A/c No: <b>${esc(b.account_no)}</b> &nbsp; IFSC: <b>${esc(b.ifsc)}</b><br>
                        UPI: <b>${esc(b.upi_id)}</b>
                        ${+inv.balance > 0 && inv.pay_status !== 'cancelled' ? '<br><small style="color:#666">Scan the QR with any UPI app to pay the balance</small>' : ''}
                    </div>
                </div>
            </div>
            <table class="totals">
                <tr><td>Sub total</td><td>${inr(inv.subtotal)}</td></tr>
                ${+inv.discount ? `<tr><td>Discount</td><td>− ${inr(inv.discount)}</td></tr>` : ''}
                <tr><td>Taxable value</td><td>${inr(inv.taxable)}</td></tr>
                ${igst ? `<tr><td>IGST</td><td>${inr(inv.igst)}</td></tr>`
                       : `<tr><td>CGST</td><td>${inr(inv.cgst)}</td></tr><tr><td>SGST</td><td>${inr(inv.sgst)}</td></tr>`}
                ${+inv.round_off ? `<tr><td>Round off</td><td>${inv.round_off > 0 ? '+' : '−'} ${inr(Math.abs(inv.round_off))}</td></tr>` : ''}
                <tr class="grand"><td>Total</td><td>${inr(inv.total)}</td></tr>
                ${+inv.paid ? `<tr><td>Amount received</td><td>${inr(inv.paid)}</td></tr><tr><td><b>Balance due</b></td><td><b>${inr(inv.balance)}</b></td></tr>` : ''}
            </table>
        </div>

        ${inv.notes ? `<p style="margin-top:14px"><b>Notes:</b> ${esc(inv.notes)}</p>` : ''}
        <div class="sheet-foot">
            <div class="terms"><b>Terms & Conditions</b>\n${esc(b.terms)}</div>
            <div class="sign">For <b>${esc(b.name)}</b><div class="line">Authorised Signatory</div></div>
        </div>
        <p class="computer-note">This is a computer-generated invoice.</p>`;

    // UPI "scan to pay" QR code for the balance amount (standard upi:// payment link)
    if (window.QRCode && b.upi_id && +inv.balance > 0 && inv.pay_status !== 'cancelled') {
        const upi = `upi://pay?pa=${encodeURIComponent(b.upi_id)}&pn=${encodeURIComponent(b.name)}&am=${(+inv.balance).toFixed(2)}&cu=INR&tn=${encodeURIComponent(inv.number)}`;
        new QRCode(document.getElementById('qr'), { text: upi, width: 92, height: 92, correctLevel: QRCode.CorrectLevel.M });
    }
    if (new URLSearchParams(location.search).get('print') === '1') setTimeout(() => window.print(), 400);
}

const page = document.body.dataset.page;
if (page === 'login') initLogin();
if (page === 'invoice') initInvoice();

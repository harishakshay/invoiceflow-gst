/* =========================================================
   InvoiceFlow - React application (app.html)
   Screens: Dashboard · Invoices · Invoice detail · Invoice builder
            Clients · Products · Settings
   Routing is done with the URL hash, e.g. #invoice/12, #edit/12, #new
   Helpers (api, inr, computeInvoice, amountInWords, STATES...) come from app.js
   ========================================================= */
const { useState, useEffect, useMemo } = React;

/* ---------- Shared pieces ---------- */
function useApi(action, query, deps) {
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    useEffect(() => {
        let alive = true;
        setError(null);
        api(action, null, query).then(d => alive && setData(d)).catch(e => alive && setError(e.message));
        return () => { alive = false; };
    }, deps);
    return [data, error, setData];
}
function Pill({ status }) { return <span className={'pill ' + status}>{status}</span>; }
function Modal({ title, onClose, children }) {
    useEffect(() => {
        const onKey = e => e.key === 'Escape' && onClose();
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, []);
    return (
        <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
            <div className="modal">
                <div className="modal-head"><h3>{title}</h3><button className="icon-btn" onClick={onClose}>✕</button></div>
                <div className="modal-body">{children}</div>
            </div>
        </div>
    );
}
function StateSelect({ value, onChange }) {
    return (
        <select value={value} onChange={e => { const s = STATES.find(x => x[0] === e.target.value); onChange(s ? { state_code: s[0], state: s[1] } : { state_code: '', state: '' }); }}>
            <option value="">Select state…</option>
            {STATES.map(([code, name]) => <option key={code} value={code}>{name} ({code})</option>)}
        </select>
    );
}
const go = hash => { location.hash = hash; };

/* =========================================================
   APP SHELL + ROUTER
   ========================================================= */
function App() {
    const [user, setUser] = useState(null);
    const [route, setRoute] = useState(location.hash.slice(1) || 'dashboard');

    useEffect(() => {
        api('me').then(setUser).catch(() => location.replace('index.html'));
        const onHash = () => { setRoute(location.hash.slice(1) || 'dashboard'); window.scrollTo(0, 0); };
        window.addEventListener('hashchange', onHash);
        return () => window.removeEventListener('hashchange', onHash);
    }, []);

    if (!user) return <div className="loading">Loading…</div>;
    const [screen, param] = route.split('/');
    const tabs = [['dashboard', 'Dashboard'], ['invoices', 'Invoices'], ['clients', 'Clients'], ['products', 'Products'], ['settings', 'Settings']];
    const activeTab = ['invoice', 'new', 'edit'].includes(screen) ? 'invoices' : screen;
    const logout = async () => { await api('logout', {}); location.replace('index.html'); };

    return (
        <>
            <header className="topbar">
                <div className="topbar-inner">
                    <div className="brand"><span className="brand-mark">IF</span> InvoiceFlow</div>
                    <nav className="tabs-nav">
                        {tabs.map(([k, l]) => <button key={k} className={activeTab === k ? 'on' : ''} onClick={() => go(k)}>{l}</button>)}
                    </nav>
                    <span className="spacer" />
                    <button className="btn btn-primary btn-sm" onClick={() => go('new')}>+ New invoice</button>
                    <div className="user-chip">
                        <span className="av">{user.name[0]}</span>
                        <div><b>{user.name}</b><small>{user.business} · <a href="#" onClick={e => { e.preventDefault(); logout(); }}>Sign out</a></small></div>
                    </div>
                </div>
            </header>
            <main className="page" key={route}>
                {screen === 'dashboard' && <Dashboard />}
                {screen === 'invoices' && <InvoiceList />}
                {screen === 'invoice' && <InvoiceDetail id={param} />}
                {screen === 'new' && <InvoiceBuilder />}
                {screen === 'edit' && <InvoiceBuilder id={param} />}
                {screen === 'clients' && <Clients />}
                {screen === 'products' && <Products />}
                {screen === 'settings' && <Settings />}
            </main>
        </>
    );
}

/* =========================================================
   DASHBOARD
   ========================================================= */
function Dashboard() {
    const [d, error] = useApi('dashboard', {}, []);
    if (error) return <div className="empty">{error}</div>;
    if (!d) return <div className="loading">Loading your numbers…</div>;

    const maxMonth = Math.max(1, ...d.months.flatMap(m => [m.billed, m.collected]));
    const collectedPct = d.billed ? Math.min(100, Math.round((d.collected / d.billed) * 100)) : 0;
    const agingColors = ['#0e9f6e', '#f0b429', '#f17e2c', '#df1b41', '#8a0b26'];
    const agingTotal = Object.values(d.aging).reduce((a, b) => a + b, 0);
    const gstTotal = +d.gst.cgst + +d.gst.sgst + +d.gst.igst;

    return (
        <>
            <div className="page-head">
                <div><h1>Dashboard</h1><p>Financial year {d.fy} · {d.invoice_count} invoices issued</p></div>
                <button className="btn btn-light" onClick={() => go('invoices')}>View all invoices →</button>
            </div>

            <div className="kpis">
                <div className="card kpi">
                    <div className="label">Billed this FY</div>
                    <div className="value">{inr(d.billed, true)}</div>
                    <div className="sub">incl. GST · {d.invoice_count} invoices</div>
                </div>
                <div className="card kpi">
                    <div className="label">Collected <span>{collectedPct}%</span></div>
                    <div className="value">{inr(d.collected, true)}</div>
                    <div className="bar"><i style={{ width: collectedPct + '%' }} /></div>
                </div>
                <div className="card kpi">
                    <div className="label">Outstanding</div>
                    <div className="value">{inr(d.outstanding, true)}</div>
                    <div className="sub">avg. {d.avg_days_to_pay || '–'} days for clients to pay</div>
                </div>
                <div className={'card kpi' + (d.overdue > 0 ? ' alert' : '')} style={{ cursor: 'pointer' }} onClick={() => go('invoices/overdue')}>
                    <div className="label">Overdue</div>
                    <div className="value">{inr(d.overdue, true)}</div>
                    <div className="sub">{d.overdue_count} invoice{d.overdue_count === 1 ? '' : 's'} past due date →</div>
                </div>
            </div>

            <div className="dash-grid">
                <div className="card">
                    <div className="card-head">
                        <h3>Billed vs collected</h3>
                        <div className="legend"><span style={{ '--c': 'var(--brand)' }}>Billed</span><span style={{ '--c': 'var(--cyan)' }}>Collected</span></div>
                    </div>
                    <div className="card-pad">
                        <div className="chart">
                            {d.months.map(m => (
                                <div className="col" key={m.month}>
                                    <i className="b" style={{ height: (m.billed / maxMonth) * 100 + '%' }} />
                                    <i className="c" style={{ height: (m.collected / maxMonth) * 100 + '%' }} />
                                    <span className="tip">Billed {inr(m.billed, true)}<br />Collected {inr(m.collected, true)}</span>
                                </div>
                            ))}
                        </div>
                        <div className="chart-labels">
                            {d.months.map(m => <span key={m.month}>{new Date(m.month + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'short' })}</span>)}
                        </div>
                    </div>
                </div>

                <div className="card">
                    <div className="card-head"><h3>Receivables ageing</h3><small>{inr(agingTotal, true)} unpaid</small></div>
                    <div className="card-pad">
                        <div className="stack">
                            {Object.values(d.aging).map((v, i) => <i key={i} style={{ width: agingTotal ? (v / agingTotal) * 100 + '%' : 0, background: agingColors[i] }} />)}
                        </div>
                        {Object.entries(d.aging).map(([k, v], i) => (
                            <div className="aging-row" key={k}><span style={{ '--c': agingColors[i] }}>{k}</span><b className="num">{inr(v, true)}</b></div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="dash-grid">
                <div className="card">
                    <div className="card-head"><h3>Recent invoices</h3><button className="btn btn-light btn-sm" onClick={() => go('new')}>+ New</button></div>
                    <div className="table-wrap">
                        <table className="data">
                            <thead><tr><th>Invoice</th><th>Client</th><th>Date</th><th className="right">Amount</th><th>Status</th></tr></thead>
                            <tbody>
                                {d.recent.map(r => (
                                    <tr key={r.id} className="click" onClick={() => go('invoice/' + r.id)}>
                                        <td className="mono">{r.number}</td><td>{r.client_name}</td><td>{fmtDate(r.issue_date)}</td>
                                        <td className="right num"><b>{inr(r.total)}</b></td><td><Pill status={r.pay_status} /></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
                <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
                    <div className="card">
                        <div className="card-head"><h3>GST collected · FY {d.fy}</h3><small>{inr(gstTotal, true)}</small></div>
                        <div className="card-pad">
                            <div className="gst-split">
                                <div><small>CGST</small><b>{inr(d.gst.cgst, true)}</b></div>
                                <div><small>SGST</small><b>{inr(d.gst.sgst, true)}</b></div>
                                <div><small>IGST</small><b>{inr(d.gst.igst, true)}</b></div>
                            </div>
                            <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>Tax liability to file in your GSTR-1 / GSTR-3B returns.</p>
                        </div>
                    </div>
                    <div className="card">
                        <div className="card-head"><h3>Top clients</h3><small>by billing</small></div>
                        <div className="card-pad" style={{ paddingTop: 8, paddingBottom: 8 }}>
                            {d.top_clients.map(c => (
                                <div className="aging-row" key={c.client_id}>
                                    <span style={{ '--c': 'var(--brand)' }}>{c.client_name}</span>
                                    <span className="num right"><b>{inrShort(c.billed)}</b>{c.due > 0 && <small style={{ color: 'var(--red)', display: 'block' }}>{inrShort(c.due)} due</small>}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}

/* =========================================================
   INVOICE LIST
   ========================================================= */
function InvoiceList() {
    const initial = location.hash.split('/')[1] || '';
    const [status, setStatus] = useState(initial);
    const [q, setQ] = useState('');
    const [list, error] = useApi('invoices', { status }, [status]);

    const rows = (list || []).filter(r => !q || (r.number + ' ' + r.client_name).toLowerCase().includes(q.toLowerCase()));
    const sum = rows.reduce((a, r) => a + (r.pay_status === 'cancelled' ? 0 : +r.balance), 0);
    const filters = [['', 'All'], ['unpaid', 'Unpaid'], ['partial', 'Partial'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['cancelled', 'Cancelled']];

    return (
        <>
            <div className="page-head">
                <div><h1>Invoices</h1><p>{rows.length} invoices · {inr(sum)} balance due</p></div>
                <div className="toolbar">
                    <div className="filter-tabs">
                        {filters.map(([k, l]) => <button key={k} className={status === k ? 'on' : ''} onClick={() => { setStatus(k); history.replaceState(null, '', '#invoices' + (k ? '/' + k : '')); }}>{l}</button>)}
                    </div>
                    <input className="input" type="search" placeholder="Search number or client…" value={q} onChange={e => setQ(e.target.value)} />
                </div>
            </div>
            <div className="card table-wrap">
                {error ? <div className="empty">{error}</div> : !list ? <div className="loading">Loading…</div> : (
                    <table className="data">
                        <thead><tr><th>Invoice no.</th><th>Client</th><th>Issued</th><th>Due</th><th>Tax</th><th className="right">Total</th><th className="right">Balance</th><th>Status</th></tr></thead>
                        <tbody>
                            {rows.map(r => (
                                <tr key={r.id} className="click" onClick={() => go('invoice/' + r.id)}>
                                    <td className="mono">{r.number}</td>
                                    <td><b>{r.client_name}</b></td>
                                    <td>{fmtDate(r.issue_date)}</td>
                                    <td>{fmtDate(r.due_date)}{r.pay_status === 'overdue' && <small style={{ color: 'var(--red)', display: 'block' }}>{r.days_overdue} days late</small>}</td>
                                    <td><span className={'tag' + (+r.interstate ? ' igst' : '')}>{+r.interstate ? 'IGST' : 'CGST+SGST'}</span></td>
                                    <td className="right num">{inr(r.total)}</td>
                                    <td className="right num"><b>{r.pay_status === 'cancelled' ? '–' : inr(r.balance)}</b></td>
                                    <td><Pill status={r.pay_status} /></td>
                                </tr>
                            ))}
                            {!rows.length && <tr><td colSpan="8" className="empty">No invoices here. <a href="#new">Create one →</a></td></tr>}
                        </tbody>
                    </table>
                )}
            </div>
        </>
    );
}

/* =========================================================
   INVOICE DETAIL - summary, items, payments, reminder
   ========================================================= */
function InvoiceDetail({ id }) {
    const [version, setVersion] = useState(0);
    const [inv, error] = useApi('invoice', { id }, [id, version]);
    const [pay, setPay] = useState(null);
    const [showReminder, setShowReminder] = useState(false);
    const reload = () => setVersion(v => v + 1);

    if (error) return <div className="empty">{error}</div>;
    if (!inv) return <div className="loading">Loading invoice…</div>;

    const igst = +inv.interstate === 1;
    const paidPct = Math.min(100, Math.round((inv.paid / inv.total) * 100)) || 0;
    const open = ['unpaid', 'partial', 'overdue'].includes(inv.pay_status);
    const reminder = `Dear ${inv.client.contact_person || inv.client.name},\n\nThis is a gentle reminder that invoice ${inv.number} dated ${fmtDate(inv.issue_date)} for ${inr(inv.total)} ${inv.pay_status === 'overdue' ? `was due on ${fmtDate(inv.due_date)} (${inv.days_overdue} days ago)` : `is due on ${fmtDate(inv.due_date)}`}.\n\nBalance payable: ${inr(inv.balance)}\nUPI: ${inv.business.upi_id}\nBank: ${inv.business.bank_name}, A/c ${inv.business.account_no}, IFSC ${inv.business.ifsc}\n\nPlease ignore if already paid. Thank you!\n${inv.business.name}`;

    const cancel = async () => {
        if (!confirm(`Cancel invoice ${inv.number}? This cannot be undone. The number stays reserved for GST records.`)) return;
        try { await api('invoice_cancel', { id: inv.id }); toast('Invoice cancelled'); reload(); } catch (e) { toast(e.message, true); }
    };
    const removePayment = async p => {
        if (!confirm(`Delete payment of ${inr(p.amount)}?`)) return;
        try { await api('payment_delete', { id: p.id }); toast('Payment deleted'); reload(); } catch (e) { toast(e.message, true); }
    };

    return (
        <>
            <button className="back" onClick={() => go('invoices')}>← All invoices</button>
            <div className="detail-grid">
                <div className="card">
                    <div className="detail-head">
                        <div>
                            <div className="mono muted">{inv.number}</div>
                            <div className="amount num">{inr(inv.total)}</div>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                                <Pill status={inv.pay_status} />
                                <span className={'tag' + (igst ? ' igst' : '')}>{igst ? 'Inter-state · IGST' : 'Intra-state · CGST + SGST'}</span>
                            </div>
                        </div>
                        <div className="toolbar" style={{ alignItems: 'flex-start' }}>
                            <a className="btn btn-primary" href={'invoice.html?id=' + inv.id} target="_blank">⎙ Print / PDF</a>
                            {inv.status !== 'cancelled' && <button className="btn btn-light" onClick={() => go('edit/' + inv.id)}>Edit</button>}
                            {inv.status !== 'cancelled' && +inv.paid === 0 && <button className="btn btn-danger" onClick={cancel}>Cancel</button>}
                        </div>
                    </div>
                    <div className="meta-grid">
                        <div><small>Billed to</small><b>{inv.client.name}</b><div className="muted" style={{ fontSize: 12 }}>{inv.client.gstin || 'Unregistered (B2C)'}</div></div>
                        <div><small>Place of supply</small><b>{inv.client.state} ({inv.client.state_code})</b></div>
                        <div><small>Issued</small><b>{fmtDate(inv.issue_date)}</b></div>
                        <div><small>Due</small><b style={{ color: inv.pay_status === 'overdue' ? 'var(--red)' : '' }}>{fmtDate(inv.due_date)}</b>
                            {inv.pay_status === 'overdue' && <div style={{ color: 'var(--red)', fontSize: 12 }}>{inv.days_overdue} days overdue</div>}</div>
                    </div>
                    <div className="table-wrap">
                        <table className="data">
                            <thead><tr><th>Item</th><th>HSN</th><th className="right">Qty</th><th className="right">Rate</th><th className="right">Disc</th><th className="right">GST</th><th className="right">Amount</th></tr></thead>
                            <tbody>
                                {inv.items.map(it => (
                                    <tr key={it.id}>
                                        <td>{it.description}</td><td className="mono">{it.hsn}</td>
                                        <td className="right num">{+it.qty} {it.unit}</td><td className="right num">{inr(it.rate)}</td>
                                        <td className="right">{+it.discount_pct ? +it.discount_pct + '%' : '–'}</td><td className="right">{+it.gst_rate}%</td>
                                        <td className="right num"><b>{inr(+it.taxable + +it.tax)}</b></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="card-pad" style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <div style={{ width: 300 }}>
                            <div className="sum-row"><span className="muted">Taxable value</span><span>{inr(inv.taxable)}</span></div>
                            {igst ? <div className="sum-row"><span className="muted">IGST</span><span>{inr(inv.igst)}</span></div> : <>
                                <div className="sum-row"><span className="muted">CGST</span><span>{inr(inv.cgst)}</span></div>
                                <div className="sum-row"><span className="muted">SGST</span><span>{inr(inv.sgst)}</span></div></>}
                            {+inv.round_off !== 0 && <div className="sum-row"><span className="muted">Round off</span><span>{inr(inv.round_off)}</span></div>}
                            <div className="sum-row total"><span>Total</span><span>{inr(inv.total)}</span></div>
                            <div className="words">{amountInWords(inv.total)}</div>
                        </div>
                    </div>
                </div>

                <div style={{ display: 'grid', gap: 16 }}>
                    <div className="card card-pad">
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}><b>Payments</b><span className="muted">{paidPct}% received</span></div>
                        <div className="progress"><i style={{ width: paidPct + '%' }} /></div>
                        <div className="sum-row"><span className="muted">Received</span><b>{inr(inv.paid)}</b></div>
                        <div className="sum-row"><span className="muted">Balance due</span><b style={{ color: inv.balance > 0 ? 'var(--red)' : 'var(--green)' }}>{inr(inv.balance)}</b></div>
                        {inv.payments.map(p => (
                            <div className="pay-item" key={p.id}>
                                <div><b className="num">{inr(p.amount)}</b><div className="muted" style={{ fontSize: 12 }}>{fmtDate(p.paid_on)} · {p.mode}{p.reference ? ' · ' + p.reference : ''}</div></div>
                                <button className="icon-btn" title="Delete payment" onClick={() => removePayment(p)}>🗑</button>
                            </div>
                        ))}
                        {open && <button className="btn btn-primary" style={{ width: '100%', marginTop: 14 }} onClick={() => setPay({ amount: inv.balance, paid_on: today(), mode: 'UPI', reference: '' })}>+ Record payment</button>}
                    </div>
                    {open && (
                        <div className="card card-pad">
                            <b>Payment reminder</b>
                            <p className="muted" style={{ fontSize: 13 }}>Ready-to-send message for WhatsApp or email.</p>
                            {showReminder && <div className="reminder">{reminder}</div>}
                            <div className="toolbar" style={{ marginTop: 10 }}>
                                <button className="btn btn-light btn-sm" onClick={() => setShowReminder(s => !s)}>{showReminder ? 'Hide' : 'Preview'}</button>
                                <button className="btn btn-light btn-sm" onClick={() => navigator.clipboard.writeText(reminder).then(() => toast('Reminder copied to clipboard'), () => toast('Copy failed - select the text manually', true))}>Copy text</button>
                                {inv.client.email && <a className="btn btn-light btn-sm" href={`mailto:${inv.client.email}?subject=${encodeURIComponent('Payment reminder: ' + inv.number)}&body=${encodeURIComponent(reminder)}`}>Open in email</a>}
                            </div>
                        </div>
                    )}
                    {inv.notes && <div className="card card-pad"><b>Notes</b><p className="muted">{inv.notes}</p></div>}
                </div>
            </div>
            {pay && <PaymentForm inv={inv} initial={pay} onClose={() => setPay(null)} onSaved={() => { setPay(null); reload(); }} />}
        </>
    );
}

function PaymentForm({ inv, initial, onClose, onSaved }) {
    const [f, setF] = useState(initial);
    const [error, setError] = useState('');
    const set = k => e => setF({ ...f, [k]: e.target.value });
    const save = async e => {
        e.preventDefault();
        try { await api('payment_add', { invoice_id: inv.id, ...f }); toast('Payment recorded'); onSaved(); }
        catch (err) { setError(err.message); }
    };
    return (
        <Modal title={'Record payment · ' + inv.number} onClose={onClose}>
            <form onSubmit={save}>
                {error && <div className="form-error">{error}</div>}
                <div className="form-grid">
                    <div className="field"><label>Amount (₹)</label><input type="number" step="0.01" min="0.01" max={inv.balance} value={f.amount} onChange={set('amount')} required />
                        <span className="hint">Balance due: {inr(inv.balance)}</span></div>
                    <div className="field"><label>Payment date</label><input type="date" min={inv.issue_date} max={today()} value={f.paid_on} onChange={set('paid_on')} required /></div>
                    <div className="field"><label>Mode</label><select value={f.mode} onChange={set('mode')}>{PAY_MODES.map(m => <option key={m}>{m}</option>)}</select></div>
                    <div className="field"><label>Reference / UTR</label><input value={f.reference} onChange={set('reference')} placeholder="Optional" /></div>
                </div>
                <button className="btn btn-primary">Save payment</button>
            </form>
        </Modal>
    );
}

/* =========================================================
   INVOICE BUILDER - live GST calculation while typing
   ========================================================= */
const blankLine = () => ({ key: Math.random(), product_id: '', description: '', hsn: '', unit: 'Nos', qty: 1, rate: 0, discount_pct: 0, gst_rate: 18 });

function InvoiceBuilder({ id }) {
    const [clients] = useApi('clients', {}, []);
    const [products] = useApi('products', {}, []);
    const [business] = useApi('business', {}, []);
    const [f, setF] = useState(id ? null : { client_id: '', issue_date: today(), due_date: today(15), notes: 'Thank you for your business!', items: [blankLine()] });
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    // Editing: load the existing invoice into the form
    useEffect(() => {
        if (!id) return;
        api('invoice', null, { id }).then(inv => setF({
            client_id: String(inv.client_id), issue_date: inv.issue_date, due_date: inv.due_date, notes: inv.notes || '',
            items: inv.items.map(it => ({ ...it, key: it.id, product_id: it.product_id ? String(it.product_id) : '' })),
            number: inv.number,
        })).catch(e => setError(e.message));
    }, [id]);

    const client = clients?.find(c => String(c.id) === String(f?.client_id));
    const interstate = client && business ? client.state_code !== business.state_code : false;
    const calc = useMemo(() => f ? computeInvoice(f.items, interstate) : null, [f, interstate]);

    if (!f || !clients || !products || !business) return <div className="loading">{error || 'Loading…'}</div>;

    const setLine = (i, patch) => setF({ ...f, items: f.items.map((it, n) => (n === i ? { ...it, ...patch } : it)) });
    const pickProduct = (i, pid) => {
        const p = products.find(x => String(x.id) === pid);
        setLine(i, p ? { product_id: pid, description: p.name, hsn: p.hsn, unit: p.unit, rate: +p.price, gst_rate: +p.gst_rate } : { product_id: '' });
    };

    const save = async e => {
        e.preventDefault();
        setError('');
        if (!f.client_id) return setError('Please choose a client.');
        setBusy(true);
        try {
            const res = await api('invoice_save', { ...f, id: id || 0 });
            toast(id ? 'Invoice updated' : 'Invoice created');
            go('invoice/' + res.id);
        } catch (err) { setError(err.message); setBusy(false); window.scrollTo(0, 0); }
    };

    return (
        <form onSubmit={save}>
            <button type="button" className="back" onClick={() => history.back()}>← Back</button>
            <div className="page-head">
                <div><h1>{id ? 'Edit invoice' : 'New invoice'}</h1><p>{id ? f.number : 'Invoice number is assigned automatically when you save.'}</p></div>
            </div>
            {error && <div className="form-error">{error}</div>}

            <div className="builder">
                <div style={{ display: 'grid', gap: 16 }}>
                    <div className="card card-pad">
                        <div className="form-grid">
                            <div className="field span-2"><label>Client *</label>
                                <select value={f.client_id} onChange={e => setF({ ...f, client_id: e.target.value })}>
                                    <option value="">Select a client…</option>
                                    {clients.map(c => <option key={c.id} value={c.id}>{c.name} - {c.state}</option>)}
                                </select>
                                <span className="hint">Not listed? <a href="#clients">Add a client first</a>.</span>
                            </div>
                            <div className="field"><label>Invoice date *</label><input type="date" value={f.issue_date} onChange={e => setF({ ...f, issue_date: e.target.value })} required /></div>
                            <div className="field"><label>Due date *</label><input type="date" min={f.issue_date} value={f.due_date} onChange={e => setF({ ...f, due_date: e.target.value })} required />
                                <div className="terms-btns">{[0, 7, 15, 30, 45].map(d => <button type="button" key={d} onClick={() => setF({ ...f, due_date: addDays(f.issue_date, d) })}>{d ? 'Net ' + d : 'On receipt'}</button>)}</div>
                            </div>
                        </div>
                    </div>

                    <div className="card">
                        <div className="card-head"><h3>Items</h3><small>Pick a saved product or type a custom line</small></div>
                        <div className="table-wrap" style={{ padding: '6px 10px' }}>
                            <table className="items-table">
                                <thead><tr><th style={{ minWidth: 220 }}>Item</th><th style={{ width: 90 }}>HSN/SAC</th><th style={{ width: 70 }}>Qty</th><th style={{ width: 100 }}>Rate ₹</th><th style={{ width: 66 }}>Disc %</th><th style={{ width: 76 }}>GST</th><th style={{ width: 110 }} className="right">Amount</th><th></th></tr></thead>
                                <tbody>
                                    {f.items.map((it, i) => (
                                        <tr key={it.key}>
                                            <td>
                                                <select value={it.product_id} onChange={e => pickProduct(i, e.target.value)} style={{ marginBottom: 5 }}>
                                                    <option value="">- Custom item -</option>
                                                    {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                                </select>
                                                <input placeholder="Description" value={it.description} onChange={e => setLine(i, { description: e.target.value })} />
                                            </td>
                                            <td><input value={it.hsn} onChange={e => setLine(i, { hsn: e.target.value })} /></td>
                                            <td><input type="number" min="0" step="any" value={it.qty} onChange={e => setLine(i, { qty: e.target.value })} /></td>
                                            <td><input type="number" min="0" step="0.01" value={it.rate} onChange={e => setLine(i, { rate: e.target.value })} /></td>
                                            <td><input type="number" min="0" max="100" step="0.5" value={it.discount_pct} onChange={e => setLine(i, { discount_pct: e.target.value })} /></td>
                                            <td><select value={+it.gst_rate} onChange={e => setLine(i, { gst_rate: +e.target.value })}>{GST_RATES.map(r => <option key={r} value={r}>{r}%</option>)}</select></td>
                                            <td className="amt num">{inr(calc.lines[i].taxable + calc.lines[i].tax)}<div className="muted" style={{ fontSize: 11, fontWeight: 400 }}>tax {inr(calc.lines[i].tax)}</div></td>
                                            <td><button type="button" className="icon-btn" title="Remove line" disabled={f.items.length === 1} onClick={() => setF({ ...f, items: f.items.filter((_, n) => n !== i) })}>✕</button></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <button type="button" className="btn btn-light btn-sm" style={{ margin: '10px 6px' }} onClick={() => setF({ ...f, items: [...f.items, blankLine()] })}>+ Add line</button>
                        </div>
                    </div>

                    <div className="card card-pad">
                        <div className="field" style={{ marginBottom: 0 }}><label>Notes (printed on invoice)</label><textarea value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></div>
                    </div>
                </div>

                <aside className="card card-pad summary">
                    {client
                        ? <div className={'supply-note' + (interstate ? ' igst' : '')}>
                            {interstate
                                ? <>Seller in <b>{business.state}</b>, buyer in <b>{client.state}</b>, so this is <b>inter-state: IGST</b> applies.</>
                                : <>Seller and buyer are both in <b>{client.state}</b>, so this is <b>intra-state: CGST + SGST</b> applies.</>}
                          </div>
                        : <div className="supply-note">Choose a client to decide the GST type.</div>}
                    <div className="sum-row"><span className="muted">Sub total</span><span>{inr(calc.subtotal)}</span></div>
                    {calc.discount > 0 && <div className="sum-row"><span className="muted">Discount</span><span>− {inr(calc.discount)}</span></div>}
                    <div className="sum-row"><span className="muted">Taxable value</span><span>{inr(calc.taxable)}</span></div>
                    {interstate
                        ? <div className="sum-row"><span className="muted">IGST</span><span>{inr(calc.igst)}</span></div>
                        : <><div className="sum-row"><span className="muted">CGST</span><span>{inr(calc.cgst)}</span></div>
                            <div className="sum-row"><span className="muted">SGST</span><span>{inr(calc.sgst)}</span></div></>}
                    {calc.round_off !== 0 && <div className="sum-row"><span className="muted">Round off</span><span>{inr(calc.round_off)}</span></div>}
                    <div className="sum-row total"><span>Total</span><span>{inr(calc.total)}</span></div>
                    <div className="words">{amountInWords(calc.total)}</div>
                    <button className="btn btn-primary" style={{ width: '100%', marginTop: 18, padding: 11 }} disabled={busy}>{busy ? 'Saving…' : id ? 'Save changes' : 'Create invoice'}</button>
                </aside>
            </div>
        </form>
    );
}

/* =========================================================
   CLIENTS
   ========================================================= */
function Clients() {
    const [version, setVersion] = useState(0);
    const [list] = useApi('clients', {}, [version]);
    const [editing, setEditing] = useState(null);
    const [q, setQ] = useState('');
    const reload = () => setVersion(v => v + 1);

    const remove = async c => {
        if (!confirm(`Delete client ${c.name}?`)) return;
        try { await api('client_delete', { id: c.id }); toast('Client deleted'); reload(); } catch (e) { toast(e.message, true); }
    };
    const rows = (list || []).filter(c => !q || [c.name, c.gstin, c.state, c.contact_person].join(' ').toLowerCase().includes(q.toLowerCase()));

    return (
        <>
            <div className="page-head">
                <div><h1>Clients</h1><p>{list?.length ?? '…'} customers</p></div>
                <div className="toolbar">
                    <input className="input" type="search" placeholder="Search clients…" value={q} onChange={e => setQ(e.target.value)} />
                    <button className="btn btn-primary" onClick={() => setEditing({})}>+ Add client</button>
                </div>
            </div>
            <div className="card table-wrap">
                {!list ? <div className="loading">Loading…</div> : (
                    <table className="data">
                        <thead><tr><th>Client</th><th>GSTIN</th><th>State</th><th>Contact</th><th className="right">Invoices</th><th className="right">Billed</th><th className="right">Due</th><th></th></tr></thead>
                        <tbody>
                            {rows.map(c => (
                                <tr key={c.id}>
                                    <td><b>{c.name}</b></td>
                                    <td className="mono">{c.gstin || <span className="muted">B2C</span>}</td>
                                    <td>{c.state}</td>
                                    <td>{c.contact_person}<div className="muted" style={{ fontSize: 12 }}>{c.phone}</div></td>
                                    <td className="right">{c.invoices}</td>
                                    <td className="right num">{inr(c.billed, true)}</td>
                                    <td className="right num" style={{ color: c.due > 0 ? 'var(--red)' : '' }}><b>{inr(c.due, true)}</b></td>
                                    <td className="right" style={{ whiteSpace: 'nowrap' }}>
                                        <button className="btn btn-light btn-sm" onClick={() => setEditing(c)}>Edit</button>{' '}
                                        <button className="icon-btn" title="Delete" onClick={() => remove(c)}>🗑</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
            {editing && <ClientForm client={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
        </>
    );
}

function ClientForm({ client, onClose, onSaved }) {
    const [f, setF] = useState({ id: client.id || 0, name: client.name || '', gstin: client.gstin || '', contact_person: client.contact_person || '', email: client.email || '', phone: client.phone || '', address: client.address || '', state: client.state || '', state_code: client.state_code || '' });
    const [error, setError] = useState('');
    const set = k => e => setF({ ...f, [k]: e.target.value });

    // Typing a GSTIN auto-selects the state from its first two digits
    const onGstin = e => {
        const gstin = e.target.value.toUpperCase();
        const s = STATES.find(x => x[0] === gstin.slice(0, 2));
        setF({ ...f, gstin, ...(s ? { state_code: s[0], state: s[1] } : {}) });
    };
    const save = async e => {
        e.preventDefault();
        try { await api('client_save', f); toast(f.id ? 'Client updated' : 'Client added'); onSaved(); } catch (err) { setError(err.message); }
    };
    return (
        <Modal title={f.id ? 'Edit client' : 'Add client'} onClose={onClose}>
            <form onSubmit={save}>
                {error && <div className="form-error">{error}</div>}
                <div className="form-grid">
                    <div className="field span-2"><label>Business / customer name *</label><input value={f.name} onChange={set('name')} required /></div>
                    <div className="field"><label>GSTIN</label><input className="mono" maxLength="15" value={f.gstin} onChange={onGstin} placeholder="Leave blank for B2C" /></div>
                    <div className="field"><label>State *</label><StateSelect value={f.state_code} onChange={s => setF({ ...f, ...s })} /></div>
                    <div className="field"><label>Contact person</label><input value={f.contact_person} onChange={set('contact_person')} /></div>
                    <div className="field"><label>Phone</label><input value={f.phone} onChange={set('phone')} /></div>
                    <div className="field span-2"><label>Email</label><input type="email" value={f.email} onChange={set('email')} /></div>
                    <div className="field span-2"><label>Billing address *</label><textarea value={f.address} onChange={set('address')} required /></div>
                </div>
                <button className="btn btn-primary">{f.id ? 'Save changes' : 'Add client'}</button>
            </form>
        </Modal>
    );
}

/* =========================================================
   PRODUCTS & SERVICES
   ========================================================= */
function Products() {
    const [version, setVersion] = useState(0);
    const [list] = useApi('products', {}, [version]);
    const [editing, setEditing] = useState(null);
    const reload = () => setVersion(v => v + 1);

    const remove = async p => {
        if (!confirm(`Delete ${p.name}? Existing invoices keep their copy of this item.`)) return;
        try { await api('product_delete', { id: p.id }); toast('Product deleted'); reload(); } catch (e) { toast(e.message, true); }
    };

    return (
        <>
            <div className="page-head">
                <div><h1>Products & Services</h1><p>Saved items fill in description, HSN, price and GST automatically.</p></div>
                <button className="btn btn-primary" onClick={() => setEditing({})}>+ Add item</button>
            </div>
            <div className="card table-wrap">
                {!list ? <div className="loading">Loading…</div> : (
                    <table className="data">
                        <thead><tr><th>Name</th><th>HSN / SAC</th><th>Unit</th><th className="right">Price</th><th className="right">GST</th><th className="right">Price incl. GST</th><th className="right">Qty sold</th><th></th></tr></thead>
                        <tbody>
                            {list.map(p => (
                                <tr key={p.id}>
                                    <td><b>{p.name}</b></td><td className="mono">{p.hsn}</td><td>{p.unit}</td>
                                    <td className="right num">{inr(p.price)}</td><td className="right">{+p.gst_rate}%</td>
                                    <td className="right num">{inr(p.price * (1 + p.gst_rate / 100))}</td>
                                    <td className="right">{+p.sold}</td>
                                    <td className="right" style={{ whiteSpace: 'nowrap' }}>
                                        <button className="btn btn-light btn-sm" onClick={() => setEditing(p)}>Edit</button>{' '}
                                        <button className="icon-btn" title="Delete" onClick={() => remove(p)}>🗑</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
            {editing && <ProductForm product={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
        </>
    );
}

function ProductForm({ product, onClose, onSaved }) {
    const [f, setF] = useState({ id: product.id || 0, name: product.name || '', hsn: product.hsn || '', unit: product.unit || 'Nos', price: product.price ?? '', gst_rate: product.gst_rate ?? 18 });
    const [error, setError] = useState('');
    const set = k => e => setF({ ...f, [k]: e.target.value });
    const save = async e => {
        e.preventDefault();
        try { await api('product_save', f); toast('Saved'); onSaved(); } catch (err) { setError(err.message); }
    };
    return (
        <Modal title={f.id ? 'Edit item' : 'Add product or service'} onClose={onClose}>
            <form onSubmit={save}>
                {error && <div className="form-error">{error}</div>}
                <div className="form-grid">
                    <div className="field span-2"><label>Name *</label><input value={f.name} onChange={set('name')} required /></div>
                    <div className="field"><label>HSN / SAC code *</label><input className="mono" value={f.hsn} onChange={set('hsn')} placeholder="e.g. 8471" required />
                        <span className="hint">HSN for goods, SAC for services</span></div>
                    <div className="field"><label>Unit</label>
                        <select value={f.unit} onChange={set('unit')}>{['Nos', 'Pack', 'Box', 'Ream', 'Kg', 'Litre', 'Can', 'Hour', 'Service'].map(u => <option key={u}>{u}</option>)}</select></div>
                    <div className="field"><label>Price (excl. GST) *</label><input type="number" min="0" step="0.01" value={f.price} onChange={set('price')} required /></div>
                    <div className="field"><label>GST rate *</label>
                        <select value={+f.gst_rate} onChange={set('gst_rate')}>{GST_RATES.map(r => <option key={r} value={r}>{r}%</option>)}</select></div>
                </div>
                <button className="btn btn-primary">Save</button>
            </form>
        </Modal>
    );
}

/* =========================================================
   SETTINGS - seller's business profile printed on invoices
   ========================================================= */
function Settings() {
    const [b, error, setB] = useApi('business', {}, []);
    const [msg, setMsg] = useState('');
    if (error) return <div className="empty">{error}</div>;
    if (!b) return <div className="loading">Loading…</div>;
    const set = k => e => setB({ ...b, [k]: e.target.value });

    const save = async e => {
        e.preventDefault();
        setMsg('');
        try { await api('business_save', b); toast('Business profile saved'); } catch (err) { setMsg(err.message); window.scrollTo(0, 0); }
    };
    return (
        <form onSubmit={save} style={{ maxWidth: 820 }}>
            <div className="page-head"><div><h1>Business settings</h1><p>These details appear on every invoice you print.</p></div><button className="btn btn-primary">Save settings</button></div>
            {msg && <div className="form-error">{msg}</div>}
            <div className="card card-pad" style={{ marginBottom: 16 }}>
                <h3 style={{ marginBottom: 14 }}>Business</h3>
                <div className="form-grid">
                    <div className="field span-2"><label>Business name *</label><input value={b.name} onChange={set('name')} /></div>
                    <div className="field"><label>GSTIN *</label><input className="mono" maxLength="15" value={b.gstin} onChange={e => setB({ ...b, gstin: e.target.value.toUpperCase() })} /></div>
                    <div className="field"><label>State *</label><StateSelect value={b.state_code} onChange={s => setB({ ...b, ...s })} /></div>
                    <div className="field"><label>Phone</label><input value={b.phone} onChange={set('phone')} /></div>
                    <div className="field"><label>Email</label><input value={b.email} onChange={set('email')} /></div>
                    <div className="field span-2"><label>Address *</label><textarea value={b.address} onChange={set('address')} /></div>
                </div>
            </div>
            <div className="card card-pad" style={{ marginBottom: 16 }}>
                <h3 style={{ marginBottom: 14 }}>Payments</h3>
                <div className="form-grid">
                    <div className="field"><label>Bank name & branch</label><input value={b.bank_name} onChange={set('bank_name')} /></div>
                    <div className="field"><label>Account number</label><input className="mono" value={b.account_no} onChange={set('account_no')} /></div>
                    <div className="field"><label>IFSC</label><input className="mono" value={b.ifsc} onChange={e => setB({ ...b, ifsc: e.target.value.toUpperCase() })} /></div>
                    <div className="field"><label>UPI ID</label><input value={b.upi_id} onChange={set('upi_id')} /><span className="hint">Used to generate the "scan to pay" QR on invoices</span></div>
                </div>
            </div>
            <div className="card card-pad">
                <h3 style={{ marginBottom: 14 }}>Invoice</h3>
                <div className="form-grid">
                    <div className="field"><label>Invoice number prefix</label><input value={b.invoice_prefix} onChange={set('invoice_prefix')} />
                        <span className="hint">Next: {b.invoice_prefix}/{'YYYY-YY'}/{String(b.next_number).padStart(4, '0')}</span></div>
                    <div className="field span-2"><label>Terms & conditions</label><textarea rows="4" value={b.terms} onChange={set('terms')} /></div>
                </div>
            </div>
        </form>
    );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);

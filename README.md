# InvoiceFlow: GST Invoicing & Payment Tracking

**Student:** Hemalatha · **Subject:** Web Programming · **Project 1**

InvoiceFlow is a billing tool for Indian small businesses (shops, distributors, agencies, freelancers), similar to
Zoho Invoice, Vyapar or Tally's invoicing. It creates **GST-compliant tax invoices**, prints them as A4 PDFs with a
**UPI scan-to-pay QR code**, records payments and shows exactly **who owes how much and for how long**.

---

## Problem statement
Lakhs of small businesses still make invoices in Word or Excel. This leads to:
- **Wrong GST**: choosing CGST + SGST vs IGST by hand, calculation and rounding mistakes
- **Lost money**: no reminder when an invoice crosses its due date
- **No visibility**: the owner doesn't know total receivables, overdue amounts or GST payable

InvoiceFlow automates the tax logic and turns invoices into a live receivables dashboard.

## Key features
| Area | Feature |
|---|---|
| GST engine | Automatically applies **CGST + SGST** (same state) or **IGST** (different state) based on the *place of supply*. Supports line-wise discount, 0/5/12/18/28/40% slabs and round-off to the nearest rupee. |
| Invoice builder | Pick saved products to auto-fill HSN, price and GST. Totals, tax split and **amount in words** (Indian lakh/crore system) update live as you type. |
| Numbering | Automatic financial-year invoice numbers, e.g. `SLO/2026-27/0015` |
| Printable invoice | A4 tax invoice with GSTIN, HSN-wise tax summary, bank details, terms, signature block, a **UPI QR code** for the balance and a PAID/CANCELLED stamp. Save as PDF from the browser. |
| Payments | Record full or partial payments (UPI, bank, cash, cheque, card). Status is calculated automatically: **Unpaid → Partial → Paid**, or **Overdue** after the due date. |
| Reminders | One-click payment reminder message (copy for WhatsApp, or open in email) |
| Dashboard | Billed / collected / outstanding / overdue for the financial year, a 6-month billed-vs-collected chart, a **receivables ageing** report (0-30, 31-60, 61-90, 90+ days), **GST collected** (CGST/SGST/IGST) and top clients |
| Validation | **GSTIN format check**, plus the GSTIN must match the state code. IFSC format, HSN 4-8 digits, payment cannot exceed the balance, due date cannot be before the invoice date. |
| Data integrity | Clients with invoices cannot be deleted. Invoices are *cancelled*, never deleted, to keep GST records. Totals are always **recalculated on the server**. |
| Security | Hashed passwords, PHP sessions, prepared SQL statements, escaped output |

## Technology used
| Layer | Technology | Where |
|---|---|---|
| Structure | **HTML5** | `index.html` (login), `app.html` (app), `invoice.html` (printable invoice) |
| Styling | **CSS3** (grid, flexbox, custom properties, `@media print` A4 layout, responsive) | `style.css` |
| Client logic | **JavaScript** (fetch API, Intl currency format, amount-in-words, GST preview, QR) | `app.js` |
| UI library | **React 18** (hooks, components, hash routing) via CDN | `components.jsx` |
| Backend | **PHP 8** (JSON API, sessions, validation, GST engine) | `api.php` |
| Database | **SQLite** via PDO, including a SQL **VIEW** for payment status | `db.php` → creates `invoiceflow.db` |

## Project structure
```
Hemalatha Project 1/
├── index.html      Login page
├── app.html        Main app (React mounts here)
├── invoice.html    Printable A4 tax invoice
├── style.css       All styles (screen + print)
├── app.js          Helpers (₹ format, amount in words, GST maths) + login + invoice print
├── components.jsx  React screens: Dashboard, Invoices, Invoice detail, Builder, Clients, Products, Settings
├── api.php         JSON API
├── db.php          SQLite schema, GST calculation, demo data
├── start.bat       Double-click to run
└── README.md
```

## Database design (7 tables + 1 view)
- **users**: login accounts
- **business**: the seller's profile (GSTIN, state, bank, UPI, invoice prefix, next number, terms)
- **clients**: customers with GSTIN (optional for B2C) and state code
- **products**: item master with HSN/SAC, unit, price, GST rate
- **invoices**: header with all totals (taxable, CGST, SGST, IGST, round-off, total, paid)
- **invoice_items**: invoice lines (copy of description, HSN, rate so old invoices never change)
- **payments**: each payment received against an invoice
- **invoice_view** (VIEW): adds `balance`, `pay_status` and `days_overdue`, calculated live with SQL `CASE`

Relationships: `clients 1─N invoices 1─N invoice_items`, `invoices 1─N payments`, `products 1─N invoice_items`.

## How GST is decided (viva explanation)
```
seller state code (33 Tamil Nadu)  ==  client state code ?
        YES → intra-state → tax split equally: CGST (half) + SGST (half)
        NO  → inter-state → full tax as IGST
line taxable = qty × rate − discount
line tax     = line taxable × GST%
total        = round(taxable + tax) → difference shown as "Round off"
```

## How to run
1. Double-click **`start.bat`**, or open a terminal in this folder and run:
   ```
   php -S localhost:8002
   ```
2. Open **http://localhost:8002** in your browser.
3. Login: **owner@invoiceflow.test** / **invoice123**

> An internet connection is needed for Google Fonts, React and the QR library (CDN).
> To reset all demo data, stop the server and delete `invoiceflow.db`.

## Demo script (for the viva)
1. **Dashboard**: explain billed vs collected, ageing and GST collected.
2. **New invoice** for *Chennai Silks* (Tamil Nadu): the note says **CGST + SGST**. Switch the client to *Bengaluru Byte Labs* (Karnataka) and it changes to **IGST** instantly.
3. Add products, a discount and change quantities. Watch totals and the amount in words update live, then **Create invoice**.
4. **Print / PDF**: show the A4 tax invoice, HSN tax table and UPI QR (scan it with GPay or PhonePe to show the amount pre-filled).
5. **Record payment** of part of the amount and the status becomes *Partial*. Pay the rest and it becomes *Paid* with a PAID stamp on the print.
6. **Invoices → Overdue**: open one and show the payment reminder message.
7. **Clients → Add client**: type a GSTIN starting with `29` and the state auto-selects Karnataka. A mismatched GSTIN is rejected.

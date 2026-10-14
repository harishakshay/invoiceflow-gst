<?php
/**
 * InvoiceFlow - database layer
 * Opens the SQLite database, creates tables + a reporting view on first run,
 * seeds demo data, and holds the GST calculation used everywhere.
 */
date_default_timezone_set('Asia/Kolkata');

const GST_RATES = [0, 5, 12, 18, 28, 40];
const PAY_MODES = ['UPI', 'Bank Transfer', 'Cash', 'Cheque', 'Card'];

function db(): PDO
{
    static $pdo = null;
    if ($pdo) return $pdo;

    $pdo = new PDO('sqlite:' . __DIR__ . '/invoiceflow.db');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->exec('PRAGMA foreign_keys = ON');

    create_schema($pdo);
    if ((int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn() === 0) {
        seed($pdo);
    }
    return $pdo;
}

function create_schema(PDO $pdo): void
{
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            name          TEXT NOT NULL,
            email         TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL
        );

        -- The seller's own business profile (single row, id = 1)
        CREATE TABLE IF NOT EXISTS business (
            id             INTEGER PRIMARY KEY CHECK (id = 1),
            name           TEXT NOT NULL,
            gstin          TEXT NOT NULL,
            address        TEXT NOT NULL,
            state          TEXT NOT NULL,
            state_code     TEXT NOT NULL,
            phone          TEXT,
            email          TEXT,
            bank_name      TEXT,
            account_no     TEXT,
            ifsc           TEXT,
            upi_id         TEXT,
            invoice_prefix TEXT NOT NULL DEFAULT 'INV',
            next_number    INTEGER NOT NULL DEFAULT 1,
            terms          TEXT
        );

        CREATE TABLE IF NOT EXISTS clients (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            name           TEXT NOT NULL,
            gstin          TEXT,                 -- empty for unregistered (B2C) customers
            contact_person TEXT,
            email          TEXT,
            phone          TEXT,
            address        TEXT NOT NULL,
            state          TEXT NOT NULL,
            state_code     TEXT NOT NULL,
            created_at     TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS products (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            name     TEXT NOT NULL,
            hsn      TEXT NOT NULL,              -- HSN code (goods) or SAC code (services)
            unit     TEXT NOT NULL DEFAULT 'Nos',
            price    REAL NOT NULL CHECK (price >= 0),
            gst_rate REAL NOT NULL
        );

        CREATE TABLE IF NOT EXISTS invoices (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            number      TEXT NOT NULL UNIQUE,
            client_id   INTEGER NOT NULL REFERENCES clients(id),
            issue_date  TEXT NOT NULL,
            due_date    TEXT NOT NULL,
            interstate  INTEGER NOT NULL DEFAULT 0,  -- 1 = IGST, 0 = CGST + SGST
            subtotal    REAL NOT NULL,               -- before discount
            discount    REAL NOT NULL,
            taxable     REAL NOT NULL,
            cgst        REAL NOT NULL,
            sgst        REAL NOT NULL,
            igst        REAL NOT NULL,
            round_off   REAL NOT NULL,
            total       REAL NOT NULL,
            paid        REAL NOT NULL DEFAULT 0,     -- kept in sync with SUM(payments)
            status      TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','cancelled')),
            notes       TEXT,
            created_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS invoice_items (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            invoice_id  INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
            product_id  INTEGER REFERENCES products(id) ON DELETE SET NULL,
            description TEXT NOT NULL,
            hsn         TEXT,
            unit        TEXT,
            qty         REAL NOT NULL,
            rate        REAL NOT NULL,
            discount_pct REAL NOT NULL DEFAULT 0,
            gst_rate    REAL NOT NULL,
            taxable     REAL NOT NULL,
            tax         REAL NOT NULL
        );

        CREATE TABLE IF NOT EXISTS payments (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
            amount     REAL NOT NULL CHECK (amount > 0),
            paid_on    TEXT NOT NULL,
            mode       TEXT NOT NULL,
            reference  TEXT,
            created_at TEXT NOT NULL
        );

        -- Payment status is never stored; it is always calculated from the data
        CREATE VIEW IF NOT EXISTS invoice_view AS
        SELECT i.*, c.name AS client_name, c.gstin AS client_gstin, c.state AS client_state,
               ROUND(i.total - i.paid, 2) AS balance,
               CASE
                   WHEN i.status = 'cancelled'                      THEN 'cancelled'
                   WHEN i.paid >= i.total                           THEN 'paid'
                   WHEN date(i.due_date) < date('now','localtime')  THEN 'overdue'
                   WHEN i.paid > 0                                  THEN 'partial'
                   ELSE 'unpaid'
               END AS pay_status,
               CAST(julianday(date('now','localtime')) - julianday(i.due_date) AS INTEGER) AS days_overdue
        FROM invoices i JOIN clients c ON c.id = i.client_id;
    ");
}

/**
 * The GST engine.
 * $items: [['qty'=>, 'rate'=>, 'discount_pct'=>, 'gst_rate'=>], ...]
 * Same state  -> tax is split equally into CGST + SGST
 * Other state -> full tax is IGST
 * Grand total is rounded to the nearest rupee (round-off shown separately).
 */
function compute_invoice(array $items, bool $interstate): array
{
    $subtotal = $discount = $taxable = $tax = 0;
    foreach ($items as &$it) {
        $gross = $it['qty'] * $it['rate'];
        $disc = round($gross * $it['discount_pct'] / 100, 2);
        $it['taxable'] = round($gross - $disc, 2);
        $it['tax'] = round($it['taxable'] * $it['gst_rate'] / 100, 2);
        $subtotal += $gross;
        $discount += $disc;
        $taxable += $it['taxable'];
        $tax += $it['tax'];
    }
    unset($it);
    $cgst = $interstate ? 0 : round($tax / 2, 2);
    $sgst = $interstate ? 0 : round($tax - $cgst, 2);
    $igst = $interstate ? round($tax, 2) : 0;
    $exact = round($taxable + $cgst + $sgst + $igst, 2);
    $total = round($exact);
    return [
        'items' => $items,
        'subtotal' => round($subtotal, 2), 'discount' => round($discount, 2), 'taxable' => round($taxable, 2),
        'cgst' => $cgst, 'sgst' => $sgst, 'igst' => $igst,
        'round_off' => round($total - $exact, 2), 'total' => $total,
    ];
}

/** Indian financial year label for a date, e.g. 2026-10-14 -> "2026-27" */
function fy_label(string $date): string
{
    $y = (int) date('Y', strtotime($date));
    $start = (int) date('n', strtotime($date)) >= 4 ? $y : $y - 1;
    return $start . '-' . substr((string) ($start + 1), -2);
}

/** Reserves the next invoice number, e.g. "SLT/2026-27/0015" */
function next_invoice_number(PDO $pdo, string $issueDate): string
{
    $b = $pdo->query('SELECT invoice_prefix, next_number FROM business WHERE id = 1')->fetch();
    $pdo->exec('UPDATE business SET next_number = next_number + 1 WHERE id = 1');
    return sprintf('%s/%s/%04d', $b['invoice_prefix'], fy_label($issueDate), $b['next_number']);
}

/** Inserts an invoice + its items. Used by the seed and by the API. */
function insert_invoice(PDO $pdo, int $clientId, string $issue, string $due, bool $interstate, array $items, string $notes = ''): int
{
    $calc = compute_invoice($items, $interstate);
    $pdo->prepare('INSERT INTO invoices (number, client_id, issue_date, due_date, interstate, subtotal, discount, taxable, cgst, sgst, igst, round_off, total, notes, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        ->execute([next_invoice_number($pdo, $issue), $clientId, $issue, $due, (int) $interstate, $calc['subtotal'], $calc['discount'],
            $calc['taxable'], $calc['cgst'], $calc['sgst'], $calc['igst'], $calc['round_off'], $calc['total'], $notes, date('Y-m-d H:i:s')]);
    $id = (int) $pdo->lastInsertId();
    save_items($pdo, $id, $calc['items']);
    return $id;
}

function save_items(PDO $pdo, int $invoiceId, array $items): void
{
    $pdo->prepare('DELETE FROM invoice_items WHERE invoice_id = ?')->execute([$invoiceId]);
    $ins = $pdo->prepare('INSERT INTO invoice_items (invoice_id, product_id, description, hsn, unit, qty, rate, discount_pct, gst_rate, taxable, tax) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    foreach ($items as $it) {
        $ins->execute([$invoiceId, $it['product_id'] ?: null, $it['description'], $it['hsn'], $it['unit'], $it['qty'], $it['rate'], $it['discount_pct'], $it['gst_rate'], $it['taxable'], $it['tax']]);
    }
}

/** Recalculates invoices.paid from the payments table */
function sync_paid(PDO $pdo, int $invoiceId): void
{
    $pdo->prepare('UPDATE invoices SET paid = (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE invoice_id = ?) WHERE id = ?')
        ->execute([$invoiceId, $invoiceId]);
}

function seed(PDO $pdo): void
{
    $pdo->beginTransaction();
    $day = fn(int $daysAgo) => date('Y-m-d', strtotime("-$daysAgo days"));

    $pdo->prepare('INSERT INTO users (name, email, password_hash) VALUES (?,?,?)')
        ->execute(['Hemalatha', 'owner@invoiceflow.test', password_hash('invoice123', PASSWORD_DEFAULT)]);

    $pdo->prepare('INSERT INTO business (id, name, gstin, address, state, state_code, phone, email, bank_name, account_no, ifsc, upi_id, invoice_prefix, next_number, terms)
                   VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        ->execute(['Sri Lakshmi Office Solutions', '33ABCDE1234F1Z5', "No. 14, Usman Road, T. Nagar\nChennai - 600017", 'Tamil Nadu', '33',
            '+91 44 2434 5678', 'accounts@srilakshmi.test', 'State Bank of India, T. Nagar', '30987654321', 'SBIN0000123', 'srilakshmi@sbi',
            'SLO', 1, "1. Goods once sold will not be taken back.\n2. Interest @ 18% p.a. will be charged on payments delayed beyond the due date.\n3. Subject to Chennai jurisdiction."]);

    $clients = [
        ['Chennai Silks Retail Pvt Ltd', '33AACCC1234D1Z2', 'Mr. Senthil Kumar', 'purchase@chennaisilks.test', '+91 98400 11223', "45, Ranganathan Street, T. Nagar\nChennai - 600017", 'Tamil Nadu', '33', 160],
        ['Kovai Tech Solutions', '33AAKFK5678L1Z9', 'Ms. Revathi', 'admin@kovaitech.test', '+91 94430 55667', "12, Avinashi Road\nCoimbatore - 641018", 'Tamil Nadu', '33', 150],
        ['Bengaluru Byte Labs LLP', '29AAJFB4321M1Z3', 'Mr. Kiran Rao', 'finance@bytelabs.test', '+91 99000 77889', "3rd Floor, 80 Feet Road, Koramangala\nBengaluru - 560034", 'Karnataka', '29', 140],
        ['Kochi Marine Exports', '32AADCK8765N1ZX', 'Mr. Thomas Mathew', 'accounts@kochimarine.test', '+91 98470 33445', "Willingdon Island\nKochi - 682003", 'Kerala', '32', 120],
        ['Pune Learning Academy', '27AAATP2468Q1Z1', 'Dr. Sneha Kulkarni', 'office@punelearning.test', '+91 98220 99001', "FC Road, Shivajinagar\nPune - 411005", 'Maharashtra', '27', 90],
        ['Dr. Ramesh Family Clinic', '', 'Dr. Ramesh', 'ramesh.clinic@mail.test', '+91 97910 12345', "22, Arcot Road, Vadapalani\nChennai - 600026", 'Tamil Nadu', '33', 60],
    ];
    $insClient = $pdo->prepare('INSERT INTO clients (name, gstin, contact_person, email, phone, address, state, state_code, created_at) VALUES (?,?,?,?,?,?,?,?,?)');
    foreach ($clients as $c) $insClient->execute([...array_slice($c, 0, 8), $day($c[8]) . ' 10:00:00']);

    $products = [
        ['HP 88A LaserJet Toner Cartridge', '8443', 'Nos', 2450, 18],
        ['A4 Copier Paper 75 GSM (500 sheets)', '4802', 'Ream', 285, 18],
        ['Dell 24" FHD Monitor P2422H', '8528', 'Nos', 11800, 18],
        ['Logitech MK270 Wireless Keyboard & Mouse', '8471', 'Nos', 1650, 18],
        ['Ergonomic Mesh Office Chair', '9401', 'Nos', 6500, 18],
        ['Annual Maintenance Contract - IT (per year)', '998713', 'Service', 15000, 18],
        ['Classmate Long Notebook (pack of 12)', '4820', 'Pack', 540, 0],
        ['Hand Sanitizer 5 L Can', '3808', 'Can', 950, 5],
    ];
    $insProd = $pdo->prepare('INSERT INTO products (name, hsn, unit, price, gst_rate) VALUES (?,?,?,?,?)');
    foreach ($products as $p) $insProd->execute($p);
    $prod = $pdo->query('SELECT * FROM products')->fetchAll(PDO::FETCH_UNIQUE);

    $line = fn(int $pid, float $qty, float $disc = 0) => [
        'product_id' => $pid, 'description' => $prod[$pid]['name'], 'hsn' => $prod[$pid]['hsn'], 'unit' => $prod[$pid]['unit'],
        'qty' => $qty, 'rate' => $prod[$pid]['price'], 'discount_pct' => $disc, 'gst_rate' => $prod[$pid]['gst_rate'],
    ];
    $states = $pdo->query('SELECT id, state_code FROM clients')->fetchAll(PDO::FETCH_KEY_PAIR);

    // client, issued days ago, payment terms (days), items, payments [[fraction of total, days after issue, mode]]
    $invoices = [
        [1, 165, 15, [$line(1, 10), $line(2, 50)], [[1, 12, 'Bank Transfer']]],
        [3, 150, 30, [$line(3, 6, 5), $line(4, 6)], [[1, 28, 'Bank Transfer']]],
        [2, 132, 15, [$line(6, 1)], [[1, 10, 'UPI']]],
        [4, 118, 30, [$line(5, 8, 10)], [[0.5, 20, 'Cheque'], [0.5, 45, 'Bank Transfer']]],
        [5, 101, 30, [$line(7, 25), $line(2, 40)], [[1, 25, 'UPI']]],
        [1, 86, 15, [$line(1, 6), $line(8, 4)], [[1, 14, 'UPI']]],
        [6, 74, 7, [$line(8, 3), $line(2, 5)], [[1, 2, 'Cash']]],
        [3, 62, 30, [$line(3, 4), $line(4, 10, 5)], [[0.4, 30, 'Bank Transfer']]],   // partial + overdue
        [2, 48, 15, [$line(4, 12), $line(1, 4)], []],                                 // overdue
        [5, 37, 30, [$line(5, 5)], [[1, 20, 'Bank Transfer']]],
        [4, 26, 15, [$line(6, 1), $line(2, 20)], []],                                 // overdue
        [1, 15, 30, [$line(1, 8), $line(2, 60)], [[0.5, 5, 'UPI']]],                  // partial
        [6, 9, 15, [$line(8, 2)], []],
        [3, 4, 30, [$line(3, 10, 8), $line(5, 10, 8)], []],
    ];
    $insPay = $pdo->prepare('INSERT INTO payments (invoice_id, amount, paid_on, mode, reference, created_at) VALUES (?,?,?,?,?,?)');
    foreach ($invoices as $n => [$cid, $ago, $terms, $items, $pays]) {
        $id = insert_invoice($pdo, $cid, $day($ago), $day($ago - $terms), $states[$cid] !== '33', $items, 'Thank you for your business!');
        $total = (float) $pdo->query("SELECT total FROM invoices WHERE id = $id")->fetchColumn();
        $paidSoFar = 0;
        $fullyPaid = array_sum(array_column($pays, 0)) >= 1;
        foreach ($pays as $k => [$fraction, $after, $mode]) {
            // The last instalment of a fully paid invoice clears the exact balance
            $amount = ($fullyPaid && $k === count($pays) - 1) ? $total - $paidSoFar : round($total * $fraction);
            $paidSoFar += $amount;
            $insPay->execute([$id, $amount, $day(max(0, $ago - $after)), $mode, $mode === 'Cash' ? null : 'TXN' . (48213 + $n * 97 + $k), date('Y-m-d H:i:s')]);
        }
        sync_paid($pdo, $id);
    }
    $pdo->commit();
}

<?php
/**
 * InvoiceFlow - JSON API
 * Every request looks like: api.php?action=<name>
 * Only "login" is public; everything else needs a logged-in user (PHP session).
 */
require __DIR__ . '/db.php';
session_name('INVOICEFLOW_SESSION'); // own cookie name so other localhost apps don't share the login
session_start();

function out($data, int $code = 200): never
{
    http_response_code($code);
    header('Content-Type: application/json');
    echo json_encode($data);
    exit;
}
function fail(string $message, int $code = 400): never { out(['error' => $message], $code); }
function input(): array
{
    static $data = null;
    return $data ??= (json_decode(file_get_contents('php://input'), true) ?: []);
}
function field(string $key, $default = '') { $v = input()[$key] ?? $default; return is_string($v) ? trim($v) : $v; }
function require_login(): array
{
    if (empty($_SESSION['user'])) fail('Please log in to continue.', 401);
    return $_SESSION['user'];
}
function valid_date(string $d): bool { $t = DateTime::createFromFormat('Y-m-d', $d); return $t && $t->format('Y-m-d') === $d; }

/** GSTIN = 2-digit state code + 10-char PAN + entity no. + 'Z' + checksum, e.g. 33ABCDE1234F1Z5 */
function check_gstin(string $gstin, string $stateCode): void
{
    if ($gstin === '') return; // unregistered customer (B2C)
    if (!preg_match('/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/', $gstin)) fail('GSTIN format is invalid (example: 33ABCDE1234F1Z5).');
    if (substr($gstin, 0, 2) !== $stateCode) fail('GSTIN must start with the state code ' . $stateCode . ' for the selected state.');
}
function invoice_row(PDO $pdo, int $id): array
{
    $st = $pdo->prepare('SELECT * FROM invoice_view WHERE id = ?');
    $st->execute([$id]);
    return $st->fetch() ?: fail('Invoice not found.', 404);
}
function fy_start(): string { return (int) date('n') >= 4 ? date('Y') . '-04-01' : (date('Y') - 1) . '-04-01'; }

$pdo = db();
$action = $_GET['action'] ?? '';

try {
    switch ($action) {

        /* ---------------- Authentication ---------------- */

        case 'login':
            $st = $pdo->prepare('SELECT * FROM users WHERE email = ?');
            $st->execute([strtolower(field('email'))]);
            $user = $st->fetch();
            if (!$user || !password_verify((string) field('password'), $user['password_hash'])) fail('Incorrect email or password.', 401);
            session_regenerate_id(true);
            $_SESSION['user'] = ['id' => $user['id'], 'name' => $user['name'], 'email' => $user['email']];
            out(['ok' => true]);

        case 'logout':
            session_destroy();
            out(['ok' => true]);

        case 'me':
            $user = require_login();
            $user['business'] = $pdo->query('SELECT name FROM business WHERE id = 1')->fetchColumn();
            out($user);

        /* ---------------- Dashboard ---------------- */

        case 'dashboard':
            require_login();
            $fy = fy_start();
            $one = function (string $sql, array $args = []) use ($pdo) { $st = $pdo->prepare($sql); $st->execute($args); return $st->fetchColumn(); };

            // Last 6 months: billed vs collected
            $months = [];
            for ($i = 5; $i >= 0; $i--) {
                $m = date('Y-m', strtotime(date('Y-m-01') . " -$i months"));
                $months[] = [
                    'month' => $m,
                    'billed' => (float) $one("SELECT COALESCE(SUM(total),0) FROM invoices WHERE status = 'issued' AND strftime('%Y-%m', issue_date) = ?", [$m]),
                    'collected' => (float) $one("SELECT COALESCE(SUM(p.amount),0) FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.status = 'issued' AND strftime('%Y-%m', p.paid_on) = ?", [$m]),
                ];
            }

            // Receivables ageing: how late is the unpaid money?
            $aging = ['Not due' => 0, '1-30 days' => 0, '31-60 days' => 0, '61-90 days' => 0, '90+ days' => 0];
            foreach ($pdo->query("SELECT balance, days_overdue FROM invoice_view WHERE pay_status IN ('unpaid','partial','overdue')") as $r) {
                $d = (int) $r['days_overdue'];
                $bucket = $d <= 0 ? 'Not due' : ($d <= 30 ? '1-30 days' : ($d <= 60 ? '31-60 days' : ($d <= 90 ? '61-90 days' : '90+ days')));
                $aging[$bucket] += (float) $r['balance'];
            }

            out([
                'fy' => fy_label(date('Y-m-d')),
                'billed' => (float) $one("SELECT COALESCE(SUM(total),0) FROM invoices WHERE status = 'issued' AND issue_date >= ?", [$fy]),
                'invoice_count' => (int) $one("SELECT COUNT(*) FROM invoices WHERE status = 'issued' AND issue_date >= ?", [$fy]),
                'collected' => (float) $one("SELECT COALESCE(SUM(p.amount),0) FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.status = 'issued' AND p.paid_on >= ?", [$fy]),
                'outstanding' => (float) $one("SELECT COALESCE(SUM(balance),0) FROM invoice_view WHERE pay_status IN ('unpaid','partial','overdue')"),
                'overdue' => (float) $one("SELECT COALESCE(SUM(balance),0) FROM invoice_view WHERE pay_status = 'overdue'"),
                'overdue_count' => (int) $one("SELECT COUNT(*) FROM invoice_view WHERE pay_status = 'overdue'"),
                'avg_days_to_pay' => round((float) $one("SELECT AVG(julianday(last_paid) - julianday(issue_date)) FROM
                    (SELECT i.issue_date, MAX(p.paid_on) last_paid FROM invoices i JOIN payments p ON p.invoice_id = i.id
                     WHERE i.paid >= i.total AND i.status = 'issued' GROUP BY i.id)"), 1),
                'gst' => $pdo->query("SELECT COALESCE(SUM(cgst),0) cgst, COALESCE(SUM(sgst),0) sgst, COALESCE(SUM(igst),0) igst
                                      FROM invoices WHERE status = 'issued' AND issue_date >= '$fy'")->fetch(),
                'months' => $months,
                'aging' => $aging,
                'top_clients' => $pdo->query("SELECT client_id, client_name, SUM(total) billed, SUM(CASE WHEN pay_status IN ('unpaid','partial','overdue') THEN balance ELSE 0 END) due
                                              FROM invoice_view WHERE status = 'issued' GROUP BY client_id ORDER BY billed DESC LIMIT 5")->fetchAll(),
                'recent' => $pdo->query('SELECT id, number, client_name, issue_date, total, balance, pay_status FROM invoice_view ORDER BY issue_date DESC, id DESC LIMIT 6')->fetchAll(),
            ]);

        /* ---------------- Business profile ---------------- */

        case 'business':
            require_login();
            out($pdo->query('SELECT * FROM business WHERE id = 1')->fetch());

        case 'business_save':
            require_login();
            $keys = ['name', 'gstin', 'address', 'state', 'state_code', 'phone', 'email', 'bank_name', 'account_no', 'ifsc', 'upi_id', 'invoice_prefix', 'terms'];
            $d = [];
            foreach ($keys as $k) $d[$k] = (string) field($k);
            $d['gstin'] = strtoupper($d['gstin']);
            if ($d['name'] === '' || $d['address'] === '' || $d['state'] === '') fail('Business name, address and state are required.');
            if ($d['gstin'] === '') fail('Your business GSTIN is required to issue tax invoices.');
            check_gstin($d['gstin'], $d['state_code']);
            if (!preg_match('/^[A-Z0-9]{1,8}$/i', $d['invoice_prefix'])) fail('Invoice prefix must be 1-8 letters or digits.');
            if ($d['ifsc'] !== '' && !preg_match('/^[A-Z]{4}0[A-Z0-9]{6}$/i', $d['ifsc'])) fail('IFSC code format is invalid (example: SBIN0000123).');
            $pdo->prepare('UPDATE business SET ' . implode(', ', array_map(fn($k) => "$k = ?", $keys)) . ' WHERE id = 1')->execute(array_values($d));
            out(['ok' => true]);

        /* ---------------- Clients ---------------- */

        case 'clients':
            require_login();
            out($pdo->query("SELECT c.*, COUNT(v.id) invoices, COALESCE(SUM(CASE WHEN v.status = 'issued' THEN v.total END),0) billed,
                                    COALESCE(SUM(CASE WHEN v.pay_status IN ('unpaid','partial','overdue') THEN v.balance END),0) due
                             FROM clients c LEFT JOIN invoice_view v ON v.client_id = c.id GROUP BY c.id ORDER BY c.name")->fetchAll());

        case 'client_save':
            require_login();
            $id = (int) field('id', 0);
            $d = [];
            foreach (['name', 'gstin', 'contact_person', 'email', 'phone', 'address', 'state', 'state_code'] as $k) $d[$k] = (string) field($k);
            $d['gstin'] = strtoupper($d['gstin']);
            if (mb_strlen($d['name']) < 2) fail('Client name is required.');
            if ($d['address'] === '') fail('Billing address is required.');
            if ($d['state'] === '' || !preg_match('/^\d{2}$/', $d['state_code'])) fail('Please choose the client\'s state.');
            if ($d['email'] !== '' && !filter_var($d['email'], FILTER_VALIDATE_EMAIL)) fail('Email address is invalid.');
            check_gstin($d['gstin'], $d['state_code']);
            if ($id) {
                $pdo->prepare('UPDATE clients SET name=?, gstin=?, contact_person=?, email=?, phone=?, address=?, state=?, state_code=? WHERE id=?')
                    ->execute([...array_values($d), $id]);
            } else {
                $pdo->prepare('INSERT INTO clients (name, gstin, contact_person, email, phone, address, state, state_code, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
                    ->execute([...array_values($d), date('Y-m-d H:i:s')]);
                $id = (int) $pdo->lastInsertId();
            }
            out(['ok' => true, 'id' => $id]);

        case 'client_delete':
            require_login();
            $st = $pdo->prepare('SELECT COUNT(*) FROM invoices WHERE client_id = ?');
            $st->execute([(int) field('id')]);
            if ($st->fetchColumn() > 0) fail('This client has invoices, so it cannot be deleted (needed for GST records).');
            $pdo->prepare('DELETE FROM clients WHERE id = ?')->execute([(int) field('id')]);
            out(['ok' => true]);

        /* ---------------- Products & services ---------------- */

        case 'products':
            require_login();
            out($pdo->query('SELECT p.*, (SELECT COALESCE(SUM(qty),0) FROM invoice_items WHERE product_id = p.id) sold FROM products p ORDER BY name')->fetchAll());

        case 'product_save':
            require_login();
            $id = (int) field('id', 0);
            $name = (string) field('name');
            $hsn = (string) field('hsn');
            $unit = (string) field('unit') ?: 'Nos';
            $price = field('price');
            $rate = field('gst_rate');
            if ($name === '') fail('Product name is required.');
            if (!preg_match('/^\d{4,8}$/', $hsn)) fail('HSN/SAC code must be 4 to 8 digits.');
            if (!is_numeric($price) || $price < 0) fail('Price must be a positive number.');
            if (!in_array((float) $rate, GST_RATES)) fail('Choose a valid GST rate.');
            if ($id) {
                $pdo->prepare('UPDATE products SET name=?, hsn=?, unit=?, price=?, gst_rate=? WHERE id=?')->execute([$name, $hsn, $unit, $price, $rate, $id]);
            } else {
                $pdo->prepare('INSERT INTO products (name, hsn, unit, price, gst_rate) VALUES (?,?,?,?,?)')->execute([$name, $hsn, $unit, $price, $rate]);
            }
            out(['ok' => true]);

        case 'product_delete':
            require_login();
            $pdo->prepare('DELETE FROM products WHERE id = ?')->execute([(int) field('id')]); // old invoice lines keep their own copy
            out(['ok' => true]);

        /* ---------------- Invoices ---------------- */

        case 'invoices':
            require_login();
            $sql = 'SELECT id, number, client_id, client_name, issue_date, due_date, total, paid, balance, pay_status, days_overdue, interstate FROM invoice_view WHERE 1';
            $args = [];
            if (!empty($_GET['status'])) { $sql .= ' AND pay_status = ?'; $args[] = $_GET['status']; }
            if (!empty($_GET['client_id'])) { $sql .= ' AND client_id = ?'; $args[] = (int) $_GET['client_id']; }
            if (!empty($_GET['q'])) { $sql .= ' AND (number LIKE ? OR client_name LIKE ?)'; $args[] = '%' . $_GET['q'] . '%'; $args[] = '%' . $_GET['q'] . '%'; }
            $st = $pdo->prepare($sql . ' ORDER BY issue_date DESC, id DESC');
            $st->execute($args);
            out($st->fetchAll());

        case 'invoice':
            require_login();
            $inv = invoice_row($pdo, (int) ($_GET['id'] ?? 0));
            foreach (['items' => 'SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id',
                      'payments' => 'SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_on, id'] as $k => $sql) {
                $st = $pdo->prepare($sql);
                $st->execute([$inv['id']]);
                $inv[$k] = $st->fetchAll();
            }
            $st = $pdo->prepare('SELECT * FROM clients WHERE id = ?');
            $st->execute([$inv['client_id']]);
            $inv['client'] = $st->fetch();
            $inv['business'] = $pdo->query('SELECT * FROM business WHERE id = 1')->fetch();
            out($inv);

        case 'invoice_save':
            require_login();
            $id = (int) field('id', 0);
            $st = $pdo->prepare('SELECT * FROM clients WHERE id = ?');
            $st->execute([(int) field('client_id')]);
            $client = $st->fetch() ?: fail('Please choose a client.');
            $issue = (string) field('issue_date');
            $due = (string) field('due_date');
            if (!valid_date($issue) || !valid_date($due)) fail('Please enter valid issue and due dates.');
            if ($due < $issue) fail('Due date cannot be before the invoice date.');

            $items = [];
            foreach ((array) field('items', []) as $n => $it) {
                $row = [
                    'product_id' => (int) ($it['product_id'] ?? 0),
                    'description' => trim((string) ($it['description'] ?? '')),
                    'hsn' => trim((string) ($it['hsn'] ?? '')),
                    'unit' => trim((string) ($it['unit'] ?? 'Nos')) ?: 'Nos',
                    'qty' => (float) ($it['qty'] ?? 0),
                    'rate' => (float) ($it['rate'] ?? 0),
                    'discount_pct' => (float) ($it['discount_pct'] ?? 0),
                    'gst_rate' => (float) ($it['gst_rate'] ?? 0),
                ];
                $line = 'Line ' . ($n + 1) . ': ';
                if ($row['description'] === '') fail($line . 'description is required.');
                if ($row['qty'] <= 0) fail($line . 'quantity must be more than 0.');
                if ($row['rate'] < 0) fail($line . 'rate cannot be negative.');
                if ($row['discount_pct'] < 0 || $row['discount_pct'] > 100) fail($line . 'discount must be 0-100%.');
                if (!in_array($row['gst_rate'], GST_RATES)) fail($line . 'invalid GST rate.');
                $items[] = $row;
            }
            if (!$items) fail('Add at least one item to the invoice.');

            // Place of supply decides the tax type: different state => IGST
            $sellerState = $pdo->query('SELECT state_code FROM business WHERE id = 1')->fetchColumn();
            $interstate = $client['state_code'] !== $sellerState;

            $pdo->beginTransaction();
            if ($id) {
                $old = invoice_row($pdo, $id);
                if ($old['status'] === 'cancelled') fail('Cancelled invoices cannot be edited.');
                $calc = compute_invoice($items, $interstate);
                if ($calc['total'] < $old['paid']) fail('New total is less than the amount already received (₹' . $old['paid'] . ').');
                $pdo->prepare('UPDATE invoices SET client_id=?, issue_date=?, due_date=?, interstate=?, subtotal=?, discount=?, taxable=?, cgst=?, sgst=?, igst=?, round_off=?, total=?, notes=? WHERE id=?')
                    ->execute([$client['id'], $issue, $due, (int) $interstate, $calc['subtotal'], $calc['discount'], $calc['taxable'], $calc['cgst'], $calc['sgst'], $calc['igst'], $calc['round_off'], $calc['total'], (string) field('notes'), $id]);
                save_items($pdo, $id, $calc['items']);
            } else {
                $id = insert_invoice($pdo, (int) $client['id'], $issue, $due, $interstate, $items, (string) field('notes'));
            }
            $pdo->commit();
            out(['ok' => true, 'id' => $id]);

        case 'invoice_cancel':
            require_login();
            $inv = invoice_row($pdo, (int) field('id'));
            if ($inv['paid'] > 0) fail('This invoice has payments recorded. Delete the payments first, then cancel.');
            $pdo->prepare("UPDATE invoices SET status = 'cancelled' WHERE id = ?")->execute([$inv['id']]);
            out(['ok' => true]);

        /* ---------------- Payments ---------------- */

        case 'payment_add':
            require_login();
            $inv = invoice_row($pdo, (int) field('invoice_id'));
            $amount = round((float) field('amount'), 2);
            $date = (string) field('paid_on');
            $mode = (string) field('mode');
            if ($inv['status'] === 'cancelled') fail('Cannot record payment on a cancelled invoice.');
            if ($amount <= 0) fail('Amount must be more than 0.');
            if ($amount > $inv['balance'] + 0.001) fail('Amount is more than the balance due (₹' . number_format($inv['balance'], 2) . ').');
            if (!valid_date($date) || $date > date('Y-m-d')) fail('Payment date must be a valid date, not in the future.');
            if ($date < $inv['issue_date']) fail('Payment date cannot be before the invoice date.');
            if (!in_array($mode, PAY_MODES, true)) fail('Choose a payment mode.');
            $pdo->prepare('INSERT INTO payments (invoice_id, amount, paid_on, mode, reference, created_at) VALUES (?,?,?,?,?,?)')
                ->execute([$inv['id'], $amount, $date, $mode, (string) field('reference') ?: null, date('Y-m-d H:i:s')]);
            sync_paid($pdo, (int) $inv['id']);
            out(['ok' => true]);

        case 'payment_delete':
            require_login();
            $st = $pdo->prepare('SELECT invoice_id FROM payments WHERE id = ?');
            $st->execute([(int) field('id')]);
            $invoiceId = $st->fetchColumn() ?: fail('Payment not found.', 404);
            $pdo->prepare('DELETE FROM payments WHERE id = ?')->execute([(int) field('id')]);
            sync_paid($pdo, (int) $invoiceId);
            out(['ok' => true]);

        default:
            fail('Unknown action.', 404);
    }
} catch (PDOException $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    fail('Database error: ' . $e->getMessage(), 500);
}

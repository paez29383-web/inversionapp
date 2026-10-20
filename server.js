const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (!err) console.log('Conectado a SQLite.');
});

// Inicialización de la Base de Datos
db.serialize(() => {
    // Usuarios
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        phone TEXT UNIQUE,
        password TEXT,
        role TEXT DEFAULT 'client',
        balance REAL DEFAULT 0,
        referred_by TEXT
    )`);

    // Depósitos
    db.run(`CREATE TABLE IF NOT EXISTS deposits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        phone TEXT,
        amount REAL,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Solicitudes de Retiro
    db.run(`CREATE TABLE IF NOT EXISTS withdrawals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        phone TEXT,
        bank_details TEXT,
        amount REAL,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Inversiones Compradas
    db.run(`CREATE TABLE IF NOT EXISTS investments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        plan_name TEXT,
        cost REAL,
        daily_return REAL,
        days_total INTEGER,
        days_passed INTEGER DEFAULT 0,
        last_payout DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'active'
    )`);
});

// --- SISTEMA AUTOMÁTICO DE PAGOS DIARIOS (CADA 24 HORAS) ---
setInterval(() => {
    console.log("Ejecutando pago diario de inversiones...");
    db.all("SELECT * FROM investments WHERE status = 'active'", [], (err, investments) => {
        if (err || !investments) return;

        investments.forEach(inv => {
            const now = new Date();
            const lastPay = new Date(inv.last_payout);
            const diffHours = (now - lastPay) / (1000 * 60 * 60);

            // Si ya pasaron 24 horas o más desde el último pago
            if (diffHours >= 24 && inv.days_passed < inv.days_total) {
                const newDaysPassed = inv.days_passed + 1;
                const newStatus = (newDaysPassed >= inv.days_total) ? 'completed' : 'active';

                // Acreditar dinero al saldo del usuario
                db.run("UPDATE users SET balance = balance + ? WHERE id = ?", [inv.daily_return, inv.user_id]);

                // Actualizar la inversión
                db.run(
                    "UPDATE investments SET days_passed = ?, last_payout = CURRENT_TIMESTAMP, status = ? WHERE id = ?",
                    [newDaysPassed, newStatus, inv.id]
                );
            }
        });
    });
}, 60000); // Revisa cada minuto si ya pasaron 24 horas para alguna inversión

// --- RUTAS DE APIS ---

app.post('/api/register', (req, res) => {
    const { name, phone, password, referralCode } = req.body;
    if (!name || !phone || !password) return res.status(400).json({ error: 'Faltan campos obligatorios.' });

    const role = (phone === '5512345678') ? 'admin' : 'client';
    const stmt = db.prepare("INSERT INTO users (name, phone, password, role, referred_by) VALUES (?, ?, ?, ?, ?)");
    stmt.run(name, phone, password, role, referralCode || null, function(err) {
        if (err) return res.status(400).json({ error: 'El número ya está registrado.' });
        res.json({ message: 'Usuario registrado con éxito', userId: this.lastID, role });
    });
    stmt.finalize();
});

app.post('/api/login', (req, res) => {
    const { phone, password } = req.body;
    db.get("SELECT id, name, phone, role, balance FROM users WHERE phone = ? AND password = ?", [phone, password], (err, user) => {
        if (err || !user) return res.status(401).json({ error: 'Credenciales incorrectas.' });
        res.json({ user });
    });
});

app.get('/api/user/:phone', (req, res) => {
    const phone = req.params.phone;
    db.get("SELECT id, name, phone, role, balance FROM users WHERE phone = ?", [phone], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'Usuario no encontrado.' });

        db.get("SELECT COUNT(*) as referral_count FROM users WHERE referred_by = ?", [phone], (err, refData) => {
            const totalReferrals = refData ? refData.referral_count : 0;
            res.json({
                user,
                referralsCount: totalReferrals,
                referralBonus: totalReferrals * 8
            });
        });
    });
});

// Comprar Plan de Inversión
app.post('/api/buy-plan', (req, res) => {
    const { userId, planName, cost, dailyReturn, daysTotal } = req.body;

    db.get("SELECT balance FROM users WHERE id = ?", [userId], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'Usuario no encontrado.' });
        if (user.balance < cost) return res.status(400).json({ error: 'Saldo insuficiente para comprar este plan.' });

        // Descontar saldo y crear inversión
        db.run("UPDATE users SET balance = balance - ? WHERE id = ?", [cost, userId], (err) => {
            if (err) return res.status(500).json({ error: 'Error al procesar el pago.' });

            const stmt = db.prepare("INSERT INTO investments (user_id, plan_name, cost, daily_return, days_total) VALUES (?, ?, ?, ?, ?)");
            stmt.run(userId, planName, cost, dailyReturn, daysTotal, function(err) {
                res.json({ message: '¡Plan comprado con éxito y activado!' });
            });
            stmt.finalize();
        });
    });
});

// Obtener Inversiones del Usuario
app.get('/api/user-investments/:userId', (req, res) => {
    db.all("SELECT * FROM investments WHERE user_id = ? ORDER BY id DESC", [req.params.userId], (err, rows) => {
        res.json({ investments: rows || [] });
    });
});

// Solicitar Retiro
app.post('/api/withdraw', (req, res) => {
    const { userId, phone, bankDetails, amount } = req.body;

    db.get("SELECT balance FROM users WHERE id = ?", [userId], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'Usuario no encontrado.' });
        if (user.balance < amount) return res.status(400).json({ error: 'Saldo insuficiente.' });

        // Descontar saldo y enviar solicitud
        db.run("UPDATE users SET balance = balance - ? WHERE id = ?", [amount, userId], (err) => {
            const stmt = db.prepare("INSERT INTO withdrawals (user_id, phone, bank_details, amount) VALUES (?, ?, ?, ?)");
            stmt.run(userId, phone, bankDetails, amount, function(err) {
                res.json({ message: 'Solicitud de retiro enviada. El admin transferirá a tu cuenta.' });
            });
            stmt.finalize();
        });
    });
});

// --- DEPÓSITOS Y ADMIN ---

app.post('/api/deposit', (req, res) => {
    const { userId, phone, amount } = req.body;
    const stmt = db.prepare("INSERT INTO deposits (user_id, phone, amount) VALUES (?, ?, ?)");
    stmt.run(userId, phone, amount, function(err) {
        res.json({ message: 'Depósito enviado a revisión.' });
    });
    stmt.finalize();
});

app.get('/api/admin/pending-data', (req, res) => {
    db.all("SELECT * FROM deposits WHERE status = 'pending'", [], (err, deposits) => {
        db.all("SELECT * FROM withdrawals WHERE status = 'pending'", [], (err, withdrawals) => {
            res.json({ deposits: deposits || [], withdrawals: withdrawals || [] });
        });
    });
});

app.post('/api/admin/approve-deposit', (req, res) => {
    const { depositId, userId, amount } = req.body;
    db.run("UPDATE deposits SET status = 'approved' WHERE id = ?", [depositId], () => {
        db.run("UPDATE users SET balance = balance + ? WHERE id = ?", [amount, userId], () => {
            res.json({ message: 'Depósito aprobado y saldo acreditado.' });
        });
    });
});

app.post('/api/admin/approve-withdrawal', (req, res) => {
    const { withdrawalId } = req.body;
    db.run("UPDATE withdrawals SET status = 'completed' WHERE id = ?", [withdrawalId], () => {
        res.json({ message: 'Retiro marcado como pagado.' });
    });
});

app.get('/reset-admin', (req, res) => {
    db.run(
        `INSERT INTO users (name, phone, password, role) VALUES ('Administrador', '5512345678', '777', 'admin')
         ON CONFLICT(phone) DO UPDATE SET password = '777', role = 'admin'`,
        () => res.send("<h3>Admin listo: 5512345678 / 777</h3><a href='/'>Ir al inicio</a>")
    );
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));

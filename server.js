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

    // Solicitudes de Depósito (Bitso)
    db.run(`CREATE TABLE IF NOT EXISTS deposits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        phone TEXT,
        amount REAL,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Inversiones activas
    db.run(`CREATE TABLE IF NOT EXISTS investments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        plan_name TEXT,
        amount REAL,
        daily_return REAL,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// --- RUTAS DE AUTENTICACIÓN Y USUARIO ---

app.post('/api/register', (req, res) => {
    const { name, phone, password, referralCode } = req.body;
    if (!name || !phone || !password) return res.status(400).json({ error: 'Faltan campos obligatorios.' });

    const role = (phone === '5512345678') ? 'admin' : 'client';
    const referredBy = referralCode ? referralCode.trim() : null;

    const stmt = db.prepare("INSERT INTO users (name, phone, password, role, referred_by) VALUES (?, ?, ?, ?, ?)");
    stmt.run(name, phone, password, role, referredBy, function(err) {
        if (err) return res.status(400).json({ error: 'El número de teléfono ya está registrado.' });
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
            const totalBonus = totalReferrals * 150; // Bono acumulado estimado por invitado

            res.json({
                user,
                referralsCount: totalReferrals,
                referralBonus: totalBonus
            });
        });
    });
});

// --- RUTAS DE DEPÓSITO BITSO ---

// Cliente reporta un depósito vía Bitso
app.post('/api/deposit', (req, res) => {
    const { userId, phone, amount } = req.body;
    if (!userId || !amount || amount <= 0) return res.status(400).json({ error: 'Monto inválido.' });

    const stmt = db.prepare("INSERT INTO deposits (user_id, phone, amount) VALUES (?, ?, ?)");
    stmt.run(userId, phone, amount, function(err) {
        if (err) return res.status(500).json({ error: 'Error al registrar depósito.' });
        res.json({ message: 'Depósito registrado. En espera de confirmación por el administrador.' });
    });
    stmt.finalize();
});

// --- RUTAS DE ADMINISTRADOR ---

// Obtener depósitos pendientes
app.get('/api/admin/pending-deposits', (req, res) => {
    db.all("SELECT * FROM deposits WHERE status = 'pending' ORDER BY created_at DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Error al obtener depósitos.' });
        res.json({ deposits: rows });
    });
});

// Aprobar depósito (Admin aprueba y se acredita el saldo)
app.post('/api/admin/approve-deposit', (req, res) => {
    const { depositId, userId, amount } = req.body;

    db.run("UPDATE deposits SET status = 'approved' WHERE id = ?", [depositId], function(err) {
        if (err) return res.status(500).json({ error: 'Error al actualizar estado.' });

        // Sumar saldo al usuario
        db.run("UPDATE users SET balance = balance + ? WHERE id = ?", [amount, userId], function(err) {
            if (err) return res.status(500).json({ error: 'Error al acreditar saldo.' });
            res.json({ message: 'Depósito aprobado y saldo acreditado con éxito.' });
        });
    });
});

// Servir frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));

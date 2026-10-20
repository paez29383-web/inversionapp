const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Inicializar Base de Datos SQLite
const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) console.error('Error al conectar con SQLite:', err.message);
    else console.log('Conectado a la Base de Datos SQLite.');
});

// Crear Tablas e Insertar Datos
db.serialize(() => {
    // Usuarios
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        phone TEXT UNIQUE,
        password TEXT,
        balance REAL DEFAULT 0,
        role TEXT DEFAULT 'client'
    )`);

    // Productos de Inversión
    db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        price REAL,
        daily_rate REAL,
        days INTEGER
    )`);

    // Transacciones
    db.run(`CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        type TEXT,
        amount REAL,
        status TEXT DEFAULT 'pending',
        details TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Inversiones
    db.run(`CREATE TABLE IF NOT EXISTS investments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        product_id INTEGER,
        amount REAL,
        daily_profit REAL,
        days_left INTEGER,
        status TEXT DEFAULT 'active'
    )`);

    // Limpiar y Cargar Planes
    db.get("SELECT COUNT(*) as count FROM products", (err, row) => {
        if (!row || row.count === 0) {
            const stmt = db.prepare("INSERT INTO products (name, price, daily_rate, days) VALUES (?, ?, ?, ?)");
            stmt.run("Plan Inicial", 20, 2.50, 60);
            stmt.run("Plan Plata", 75, 3.33, 60);
            stmt.run("Plan Oro", 200, 3.25, 60);
            stmt.run("Plan Platino", 500, 2.40, 90);
            stmt.run("Plan Esmeralda", 2250, 1.78, 90);
            stmt.run("Plan Diamante VIP", 5000, 1.40, 120);
            stmt.finalize(() => {
                console.log("Planes de inversión en USDT insertados correctamente.");
            });
        }
    });
});

// --- RUTAS DE LA API ---

// Obtener Productos Públicos (sin requerir sesión)
app.get('/api/products', (req, res) => {
    db.all("SELECT * FROM products", [], (err, products) => {
        if (err) return res.status(500).json({ error: 'Error al consultar productos' });
        res.json(products);
    });
});

// Registro
app.post('/api/register', (req, res) => {
    const { name, phone, password } = req.body;
    if (!name || !phone || !password) return res.status(400).json({ error: 'Todos los campos son requeridos.' });

    const role = (phone === '5512345678') ? 'admin' : 'client';

    const stmt = db.prepare("INSERT INTO users (name, phone, password, role) VALUES (?, ?, ?, ?)");
    stmt.run(name, phone, password, role, function(err) {
        if (err) return res.status(400).json({ error: 'El número de teléfono ya está registrado.' });
        res.json({ message: 'Usuario registrado con éxito', userId: this.lastID, role });
    });
    stmt.finalize();
});

// Inicio de Sesión
app.post('/api/login', (req, res) => {
    const { phone, password } = req.body;
    db.get("SELECT id, name, phone, balance, role FROM users WHERE phone = ? AND password = ?", [phone, password], (err, user) => {
        if (err || !user) return res.status(401).json({ error: 'Credenciales incorrectas.' });
        res.json({ user });
    });
});

// Datos del Usuario
app.get('/api/data/:userId', (req, res) => {
    const userId = req.params.userId;
    db.get("SELECT id, name, phone, balance, role FROM users WHERE id = ?", [userId], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'Usuario no encontrado.' });
        
        db.all("SELECT * FROM products", [], (err, products) => {
            res.json({ user, products });
        });
    });
});

// Depósito
app.post('/api/deposit', (req, res) => {
    const { userId, amount } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Monto inválido.' });

    const stmt = db.prepare("INSERT INTO transactions (user_id, type, amount, details) VALUES (?, 'deposit', ?, 'Depósito en USDT (Red TRC-20)')");
    stmt.run(userId, amount, function(err) {
        if (err) return res.status(500).json({ error: 'Error al registrar el depósito.' });
        res.json({ message: 'Notificación de depósito enviada. En espera de aprobación por el Administrador.' });
    });
    stmt.finalize();
});

// Retiro
app.post('/api/withdraw', (req, res) => {
    const { userId, amount, clabe } = req.body;
    if (!amount || amount <= 0 || !clabe) return res.status(400).json({ error: 'Monto o Wallet de destino no válida.' });

    db.get("SELECT balance FROM users WHERE id = ?", [userId], (err, user) => {
        if (err || !user || user.balance < amount) return res.status(400).json({ error: 'Saldo insuficiente para este retiro.' });

        const stmt = db.prepare("INSERT INTO transactions (user_id, type, amount, details) VALUES (?, 'withdraw', ?, ?)");
        stmt.run(userId, amount, `Wallet USDT: ${clabe}`, function(err) {
            if (err) return res.status(500).json({ error: 'Error al procesar la solicitud de retiro.' });
            
            db.run("UPDATE users SET balance = balance - ? WHERE id = ?", [amount, userId]);
            res.json({ message: 'Solicitud de retiro registrada exitosamente.' });
        });
        stmt.finalize();
    });
});

// Invertir
app.post('/api/invest', (req, res) => {
    const { userId, productId } = req.body;

    db.get("SELECT * FROM products WHERE id = ?", [productId], (err, product) => {
        if (!product) return res.status(404).json({ error: 'Plan no encontrado.' });

        db.get("SELECT balance FROM users WHERE id = ?", [userId], (err, user) => {
            if (user.balance < product.price) return res.status(400).json({ error: 'Saldo insuficiente. Realiza una recarga en USDT.' });

            const newBalance = user.balance - product.price;
            db.run("UPDATE users SET balance = ? WHERE id = ?", [newBalance, userId], (err) => {
                const dailyProfit = product.price * (product.daily_rate / 100);
                const stmt = db.prepare("INSERT INTO investments (user_id, product_id, amount, daily_profit, days_left) VALUES (?, ?, ?, ?, ?)");
                stmt.run(userId, productId, product.price, dailyProfit, product.days);
                stmt.finalize();

                res.json({ message: `¡Plan ${product.name} activado con éxito!`, newBalance });
            });
        });
    });
});

// Admin Pendientes
app.get('/api/admin/pending', (req, res) => {
    const query = `
        SELECT t.id, t.type, t.amount, t.details, t.created_at, u.name, u.phone 
        FROM transactions t
        JOIN users u ON t.user_id = u.id
        WHERE t.status = 'pending'
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Error al consultar transacciones.' });
        res.json(rows);
    });
});

// Admin Aprobar / Rechazar
app.post('/api/admin/approve', (req, res) => {
    const { txId, action } = req.body;

    db.get("SELECT * FROM transactions WHERE id = ?", [txId], (err, tx) => {
        if (!tx || tx.status !== 'pending') return res.status(400).json({ error: 'Transacción no válida o procesada.' });

        const newStatus = action === 'approve' ? 'approved' : 'rejected';

        db.run("UPDATE transactions SET status = ? WHERE id = ?", [newStatus, txId], (err) => {
            if (action === 'approve' && tx.type === 'deposit') {
                db.run("UPDATE users SET balance = balance + ? WHERE id = ?", [tx.amount, tx.user_id]);
            } else if (action === 'reject' && tx.type === 'withdraw') {
                db.run("UPDATE users SET balance = balance + ? WHERE id = ?", [tx.amount, tx.user_id]);
            }
            res.json({ message: 'Estado de la transacción actualizado con éxito.' });
        });
    });
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
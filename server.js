const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Base de datos SQLite
const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) {
        console.error('Error al conectar con SQLite:', err.message);
    } else {
        console.log('Conectado a la base de datos SQLite.');
    }
});

// Crear tablas si no existen
db.serialize(() => {
    // Tabla de usuarios con columna referred_by
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        phone TEXT UNIQUE,
        password TEXT,
        role TEXT,
        balance REAL DEFAULT 0,
        referred_by TEXT
    )`);

    // Tabla de inversiones
    db.run(`CREATE TABLE IF NOT EXISTS investments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        plan_name TEXT,
        amount REAL,
        daily_return REAL,
        duration INTEGER,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// --- RUTAS DE API ---

// Registro de usuario
app.post('/api/register', (req, res) => {
    const { name, phone, password, referralCode } = req.body;

    if (!name || !phone || !password) {
        return res.status(400).json({ error: 'Todos los campos son requeridos.' });
    }

    // Si el teléfono es 5512345678 se asigna como admin
    const role = (phone === '5512345678') ? 'admin' : 'client';
    const referredBy = referralCode ? referralCode.trim() : null;

    const stmt = db.prepare("INSERT INTO users (name, phone, password, role, referred_by) VALUES (?, ?, ?, ?, ?)");
    stmt.run(name, phone, password, role, referredBy, function(err) {
        if (err) {
            return res.status(400).json({ error: 'El número de teléfono ya está registrado.' });
        }
        res.json({ message: 'Usuario registrado con éxito', userId: this.lastID, role });
    });
    stmt.finalize();
});

// Inicio de sesión
app.post('/api/login', (req, res) => {
    const { phone, password } = req.body;

    db.get("SELECT id, name, phone, role, balance FROM users WHERE phone = ? AND password = ?", [phone, password], (err, user) => {
        if (err || !user) {
            return res.status(401).json({ error: 'Credenciales incorrectas.' });
        }
        res.json({ user });
    });
});

// Obtener datos del usuario y estadísticas de referidos
app.get('/api/user/:phone', (req, res) => {
    const phone = req.params.phone;

    db.get("SELECT id, name, phone, role, balance FROM users WHERE phone = ?", [phone], (err, user) => {
        if (err || !user) {
            return res.status(404).json({ error: 'Usuario no encontrado.' });
        }

        // Contar cuántos usuarios se registraron con este teléfono como referido
        db.get("SELECT COUNT(*) as referral_count FROM users WHERE referred_by = ?", [phone], (err, refData) => {
            const totalReferrals = refData ? refData.referral_count : 0;
            // Cálculo estimado de comisiones (8% por referido con bono fijo ej. $150)
            const totalBonus = totalReferrals * 150;

            res.json({
                user,
                referralsCount: totalReferrals,
                referralBonus: totalBonus
            });
        });
    });
});

// Ruta de rescate/reset para Administrador
app.get('/reset-admin', (req, res) => {
    const adminPhone = '5512345678';
    const adminPass = 'admin123';

    db.run(
        `INSERT INTO users (name, phone, password, role) VALUES ('Administrador', ?, ?, 'admin')
         ON CONFLICT(phone) DO UPDATE SET password = ?`,
        [adminPhone, adminPass, adminPass],
        (err) => {
            if (err) return res.status(500).send("Error: " + err.message);
            res.send(`Administrador actualizado con éxito. <br>Teléfono: <b>${adminPhone}</b> <br>Contraseña: <b>${adminPass}</b>`);
        }
    );
});

// Servir la aplicación web
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});

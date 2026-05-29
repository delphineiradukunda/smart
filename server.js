const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());

// Enable CORS for your Vite frontend development server
app.use(cors({
    origin: 'http://localhost:5173',
    credentials: true
}));

const JWT_SECRET = 'SmartPark_Super_Secret_JWT_Key_2026';

// Direct Single MySQL Connection (No Pool)
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '', // Default XAMPP password
    database: 'adeba'
});

db.connect((err) => {
    if (err) {
        console.error('Database connection failed: ' + err.stack);
        return;
    }
    console.log('Connected directly to MySQL database [adeba].');
});

// Middleware for JWT Authentication (Kept here but detached from data endpoints)
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) return res.status(401).json({ message: 'Access Token Required' });
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ message: 'Invalid or Expired Token' });
        req.user = user;
        next();
    });
};

/* --- AUTHENTICATION ROUTES --- */

app.post('/api/auth/register', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required' });
    }

    db.query('SELECT * FROM Users WHERE username = ?', [username], async (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length > 0) {
            return res.status(400).json({ message: 'User already exists' });
        }

        try {
            const hashedPassword = await bcrypt.hash(password, 10);
            db.query('INSERT INTO Users (username, password) VALUES (?, ?)', [username, hashedPassword], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.status(201).json({ message: 'User registered successfully' });
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
});

app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    db.query('SELECT * FROM Users WHERE username = ?', [username], async (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) return res.status(400).json({ message: 'User not found' });

        const user = results[0];
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.status(400).json({ message: 'Invalid credentials' });

        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '8h' });
        res.json({ token, username: user.username });
    });
});


/* --- DASHBOARD METRICS ENDPOINT (Open) --- */
app.get('/api/dashboard/metrics', (req, res) => {
    // Quick fallback metrics endpoint for frontend dashboard engine
    const sqlSlots = 'SELECT COUNT(*) as total, SUM(CASE WHEN SlotStatus="Occupied" THEN 1 ELSE 0 END) as occupied FROM ParkingSlot';
    db.query(sqlSlots, (err, slotSummary) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({
            slots: slotSummary[0]
        });
    });
});


/* --- CAR ENDPOINTS (Open - Removed authenticateToken) --- */
app.post('/api/cars', (req, res) => {
    const { PlateNumber, DriverName, PhoneNumber } = req.body;
    const query = 'INSERT INTO Car (PlateNumber, DriverName, PhoneNumber) VALUES (?, ?, ?)';
    db.query(query, [PlateNumber, DriverName, PhoneNumber], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: 'Car recorded successfully' });
    });
});

app.get('/api/cars', (req, res) => {
    db.query('SELECT * FROM Car', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});


/* --- PARKING SLOT ENDPOINTS (Open - Removed authenticateToken) --- */
app.post('/api/slots', (req, res) => {
    const { SlotNumber, SlotStatus } = req.body;
    const query = 'INSERT INTO ParkingSlot (SlotNumber, SlotStatus) VALUES (?, ?)';
    db.query(query, [SlotNumber, SlotStatus || 'Available'], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: 'Parking Slot added successfully' });
    });
});

app.get('/api/slots', (req, res) => {
    db.query('SELECT * FROM ParkingSlot', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});


/* --- PARKING RECORD ENDPOINTS (Open - Removed authenticateToken) --- */
// Look at this validation block inside server.js:/* --- 📝 PARKING RECORD ENDPOINTS (Zishingiye kuri: RecordID, SlotNumber, PlateNumber, EntryTime, ExitTime, Duration) --- */

// 1. CREATE: Check-In (Kwandika imodoka yinjiye)
app.post('/api/records', (req, res) => {
    const { SlotNumber, PlateNumber, EntryTime } = req.body;

    const slot = SlotNumber ? SlotNumber.trim().toUpperCase() : null;
    const plate = PlateNumber ? PlateNumber.trim().toUpperCase() : null;
    const entry = EntryTime || new Date().toISOString().slice(0, 19).replace('T', ' ');

    if (!slot || !plate) {
        return res.status(400).json({ error: "Amakuru ntabwo itunganye: SlotNumber n'PlateNumber zirakenewe." });
    }

    // Reba niba umwanya (Slot) ubaho kandi ucomokamo (Available)
    db.query('SELECT SlotStatus FROM ParkingSlot WHERE SlotNumber = ?', [slot], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!rows.length) return res.status(404).json({ error: `Umwanya #${slot} ntabwo ubaho muri mfatiro y'amakuru.` });
        if (rows[0].SlotStatus === 'Occupied') return res.status(400).json({ error: `Umwanya #${slot} urimo andi modoka.` });

        // Injiza amakuru muri ParkingRecord
        const sqlInsert = 'INSERT INTO ParkingRecord (SlotNumber, PlateNumber, EntryTime) VALUES (?, ?, ?)';
        db.query(sqlInsert, [slot, plate, entry], (insErr, result) => {
            if (insErr) return res.status(500).json({ error: insErr.message });

            // Hindura umwanya ube "Occupied"
            db.query('UPDATE ParkingSlot SET SlotStatus = "Occupied" WHERE SlotNumber = ?', [slot], (upErr) => {
                if (upErr) return res.status(500).json({ error: upErr.message });

                res.status(201).json({ 
                    success: true, 
                    message: "Check-in yakozwe neza.", 
                    RecordID: result.insertId 
                });
            });
        });
    });
});

// 2. READ: Kubona amakuru yose (Kuri Frontend Tables)
app.get('/api/records', (req, res) => {
    const sql = 'SELECT RecordID, SlotNumber, PlateNumber, EntryTime, ExitTime, Duration FROM ParkingRecord ORDER BY EntryTime DESC';
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// 3. UPDATE: Check-Out (Gusohora imodoka, Kubara Duration n'amafaranga auto)
app.put('/api/records/checkout/:id', (req, res) => {
    const { id } = req.params;
    const { ExitTime } = req.body;

    const exit = ExitTime || new Date().toISOString().slice(0, 19).replace('T', ' ');

    // Reba amakuru y'aho imodoka yinshiriye
    db.query('SELECT EntryTime, SlotNumber FROM ParkingRecord WHERE RecordID = ?', [id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!rows.length) return res.status(404).json({ error: `RecordID #${id} ntabwo yabonetse.` });

        const { EntryTime, SlotNumber } = rows[0];
        
        // Kubara Duration (Mu masaha)
        const diffMs = new Date(exit) - new Date(EntryTime);
        let hours = Math.ceil(diffMs / (1000 * 60 * 60));
        if (hours <= 0) hours = 1; // Niba ari munsi y'isaha imwe ikurwaho isaha 1 standard

        // Hindura ParkingRecord (Shyiramo ExitTime n'Duration)
        const sqlUpdate = 'UPDATE ParkingRecord SET ExitTime = ?, Duration = ? WHERE RecordID = ?';
        db.query(sqlUpdate, [exit, hours, id], (upErr) => {
            if (upErr) return res.status(500).json({ error: upErr.message });

            // Fungura umwanya ube "Available" noneho
            db.query('UPDATE ParkingSlot SET SlotStatus = "Available" WHERE SlotNumber = ?', [SlotNumber], (slotErr) => {
                if (slotErr) return res.status(500).json({ error: slotErr.message });

                res.json({ 
                    success: true, 
                    message: "Check-out yarangiye neza.", 
                    data: { RecordID: id, Duration: hours, ExitTime: exit } 
                });
            });
        });
    });
});

// 4. DELETE: Gusiba record
app.delete('/api/records/:id', (req, res) => {
    const { id } = req.params;
    db.query('DELETE FROM ParkingRecord WHERE RecordID = ?', [id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: "Record yasibwe neza." });
    });
});

/* --- PAYMENT ENDPOINTS (Open - Removed authenticateToken) --- */
/* --- 💰 PAYMENT TABLE ENDPOINTS --- */

// 1. Create: Log a new manual payment record
app.post('/api/payments', (req, res) => {
    const { RecordID, AmountPaid, PaymentDate } = req.body;

    // Instantly cast types and format date
    const recordId = parseInt(RecordID, 10);
    const amount = parseFloat(AmountPaid);
    const date = PaymentDate || new Date().toISOString().slice(0, 19).replace('T', ' ');

    // Short unified input validation guard
    if (!recordId || !amount || isNaN(recordId) || isNaN(amount)) {
        return res.status(400).json({ 
            error: "Data Format Error: RecordID and AmountPaid are required and must be numeric." 
        });
    }

    // Safety Pre-check: Intercept foreign key crash by making sure parent record exists
    db.query('SELECT RecordID FROM ParkingRecord WHERE RecordID = ?', [recordId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!rows.length) return res.status(404).json({ error: `RecordID #${recordId} not found inside parent schema.` });

        // Insert using exact schema matching column casing: RecordID, AmountPaid, PaymentDate
        const sql = 'INSERT INTO Payment (RecordID, AmountPaid, PaymentDate) VALUES (?, ?, ?)';
        db.query(sql, [recordId, amount, date], (insertErr, result) => {
            if (insertErr) return res.status(500).json({ error: insertErr.message });
            
            res.status(201).json({ 
                success: true, 
                message: "Payment logged successfully into ledger.", 
                PaymentID: result.insertId // Returns auto-incremented primary key
            });
        });
    });
});

// 2. Read: Fetch all payment logs joined with vehicle info for frontend tables
app.get('/api/payments', (req, res) => {
    const query = `
        SELECT 
            p.PaymentID, 
            p.RecordID, 
            p.AmountPaid, 
            p.PaymentDate, 
            r.PlateNumber, 
            r.Duration 
        FROM Payment p
        LEFT JOIN ParkingRecord r ON p.RecordID = r.RecordID
        ORDER BY p.PaymentDate DESC`;

    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

/* --- REPORTS ENDPOINTS (Open - Removed authenticateToken) --- */
app.get('/api/reports/daily', (req, res) => {
    const query = `
        SELECT r.PlateNumber, r.EntryTime, r.ExitTime, r.Duration, p.AmountPaid, p.PaymentDate
        FROM Payment p
        JOIN ParkingRecord r ON p.RecordID = r.RecordID
        WHERE DATE(p.PaymentDate) = CURDATE()
        ORDER BY p.PaymentDate DESC`;
    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.listen(5000, () => console.log('🚀 Server running smoothly on port http://localhost:5000'));

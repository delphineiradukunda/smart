const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());
app.use(cors());

const JWT_SECRET = 'SmartPark_Super_Secret_JWT_Key_2026';

// Direct Single MySQL Connection (As explicitly requested: No Connection Pool)
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '', // Default XAMPP password
    database: 'PSSMS'
});

db.connect((err) => {
    if (err) {
        console.error('Database connection failed: ' + err.stack);
        return;
    }
    console.log('Connected directly to MySQL database.');
});

// Middleware for JWT Authentication verification
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

//registration 

app.post('/api/auth/register', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required' });
    }

    // Check if user already exists
    db.query(
        'SELECT * FROM Users WHERE username = ?',
        [username],
        async (err, results) => {
            if (err) return res.status(500).json({ error: err.message });

            if (results.length > 0) {
                return res.status(400).json({ message: 'User already exists' });
            }

            try {
                // Hash password
                const hashedPassword = await bcrypt.hash(password, 10);

                // Insert new user
                db.query(
                    'INSERT INTO Users (username, password) VALUES (?, ?)',
                    [username, hashedPassword],
                    (err, result) => {
                        if (err) return res.status(500).json({ error: err.message });

                        res.status(201).json({
                            message: 'User registered successfully'
                        });
                    }
                );
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        }
    );
});

/* --- AUTHENTICATION ROUTES --- */
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

/* --- CAR ENDPOINTS --- */
app.post('/api/cars', authenticateToken, (req, res) => {
    const { PlateNumber, DriverName, PhoneNumber } = req.body;
    const query = 'INSERT INTO Car (PlateNumber, DriverName, PhoneNumber) VALUES (?, ?, ?)';
    db.query(query, [PlateNumber, DriverName, PhoneNumber], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: 'Car recorded successfully' });
    });
});

app.get('/api/cars', authenticateToken, (req, res) => {
    db.query('SELECT * FROM Car', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

/* --- PARKING SLOT ENDPOINTS --- */
app.post('/api/slots', authenticateToken, (req, res) => {
    const { SlotNumber, SlotStatus } = req.body;
    const query = 'INSERT INTO ParkingSlot (SlotNumber, SlotStatus) VALUES (?, ?)';
    db.query(query, [SlotNumber, SlotStatus || 'Available'], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: 'Parking Slot added successfully' });
    });
});

app.get('/api/slots', authenticateToken, (req, res) => {
    db.query('SELECT * FROM ParkingSlot', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

/* --- PARKING RECORD ENDPOINTS (Full CRUD requested) --- */
// 1. Create (Insert Form Action)
app.post('/api/records', authenticateToken, (req, res) => {
    const { SlotNumber, PlateNumber, EntryTime } = req.body;
    
    // Check if slot is available
    db.query('SELECT SlotStatus FROM ParkingSlot WHERE SlotNumber = ?', [SlotNumber], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) return res.status(404).json({ message: 'Slot not found' });
        if (results[0].SlotStatus === 'Occupied') return res.status(400).json({ message: 'Slot is already occupied' });

        // Proceed to Insert Record
        const insertRecordQuery = 'INSERT INTO ParkingRecord (SlotNumber, PlateNumber, EntryTime) VALUES (?, ?, ?)';
        db.query(insertRecordQuery, [SlotNumber, PlateNumber, EntryTime], (err, recordResult) => {
            if (err) return res.status(500).json({ error: err.message });

            // Update Slot Status to Occupied in Real Time
            db.query('UPDATE ParkingSlot SET SlotStatus = "Occupied" WHERE SlotNumber = ?', [SlotNumber], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.status(201).json({ message: 'Check-in recorded, slot updated to Occupied', recordId: recordResult.insertId });
            });
        });
    });
});

// 2. Retrieve (Read list of records)
app.get('/api/records', authenticateToken, (req, res) => {
    const query = `
        SELECT r.*, c.DriverName, c.PhoneNumber 
        FROM ParkingRecord r 
        JOIN Car c ON r.PlateNumber = c.PlateNumber
        ORDER BY r.EntryTime DESC`;
    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// 3. Update (Process Exit & Calculate Bills)
app.put('/api/records/:id/exit', authenticateToken, (req, res) => {
    const { id } = req.params;
    const { ExitTime } = req.body;

    db.query('SELECT EntryTime, SlotNumber, PlateNumber FROM ParkingRecord WHERE RecordID = ?', [id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) return res.status(404).json({ message: 'Record not found' });

        const { EntryTime, SlotNumber, PlateNumber } = results[0];
        const entry = new Date(EntryTime);
        const exit = new Date(ExitTime);
        
        // Calculate dynamic duration in hours
        const diffMs = exit - entry;
        let hours = Math.ceil(diffMs / (1000 * 60 * 60)); 
        if (hours <= 0) hours = 1; // Under 1 hour is charged standard 1 hour fee

        const amountPaid = hours * 500; // 500 Rwf hourly rate

        // Update active record details
        const updateRecordQuery = 'UPDATE ParkingRecord SET ExitTime = ?, Duration = ? WHERE RecordID = ?';
        db.query(updateRecordQuery, [ExitTime, hours, id], (err) => {
            if (err) return res.status(500).json({ error: err.message });

            // Automatically make the slot available again
            db.query('UPDATE ParkingSlot SET SlotStatus = "Available" WHERE SlotNumber = ?', [SlotNumber], (err) => {
                if (err) return res.status(500).json({ error: err.message });

                // Create full entry payment tracking receipt
                const insertPaymentQuery = 'INSERT INTO Payment (RecordID, AmountPaid, PaymentDate) VALUES (?, ?, ?)';
                db.query(insertPaymentQuery, [id, amountPaid, ExitTime], (err, paymentResult) => {
                    if (err) return res.status(500).json({ error: err.message });

                    res.json({
                        message: 'Exit recorded, bill generated successfully',
                        bill: {
                            PlateNumber,
                            EntryTime,
                            ExitTime,
                            Duration: hours,
                            AmountPaid: amountPaid,
                            PaymentDate: ExitTime
                        }
                    });
                });
            });
        });
    });
});

// Generic Record Update Route for managing manual changes
app.put('/api/records/:id', authenticateToken, (req, res) => {
    const { id } = req.params;
    const { SlotNumber, PlateNumber, EntryTime, ExitTime, Duration } = req.body;
    const query = 'UPDATE ParkingRecord SET SlotNumber = ?, PlateNumber = ?, EntryTime = ?, ExitTime = ?, Duration = ? WHERE RecordID = ?';
    db.query(query, [SlotNumber, PlateNumber, EntryTime, ExitTime, Duration, id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Parking record modified successfully' });
    });
});

// 4. Delete (Remove completely from tracking log)
app.delete('/api/records/:id', authenticateToken, (req, res) => {
    const { id } = req.params;
    db.query('DELETE FROM ParkingRecord WHERE RecordID = ?', [id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Parking record removed successfully' });
    });
});

/* --- PAYMENT ENDPOINTS --- */
app.post('/api/payments', authenticateToken, (req, res) => {
    const { RecordID, AmountPaid, PaymentDate } = req.body;
    const query = 'INSERT INTO Payment (RecordID, AmountPaid, PaymentDate) VALUES (?, ?, ?)';
    db.query(query, [RecordID, AmountPaid, PaymentDate], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: 'Payment tracked manually.' });
    });
});

/* --- REPORTS ENDPOINTS --- */
app.get('/api/reports/daily', authenticateToken, (req, res) => {
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

app.listen(5000, () => console.log(' Server running on port  http://localhost:5000'));
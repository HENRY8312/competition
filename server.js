// ------------------- IMPORTS -------------------
const express = require("express");
const mysql = require("mysql");
const cors = require("cors");
const nodemailer = require("nodemailer");
const path = require("path"); // <-- needed for static files

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public"))); // serve static files

// ------------------- DATABASE -------------------
const db = mysql.createConnection({
    host: "sql8.freesqldatabase.com",
    user: "sql8819909",
    password: "Check your emails",
    database: "sql8819909"
    
});

db.connect(err => {
    if (err) console.log("❌ Database connection failed:", err);
    else console.log("✅ Connected to database");
});

// ------------------- EMAIL -------------------
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: "yourgmail@gmail.com", // replace with your Gmail
        pass: "your_app_password"    // Gmail App Password
    }
});

function sendEmail(to, name) {
    const mailOptions = {
        from: "yourgmail@gmail.com",
        to,
        subject: "Mathematics Competition Result",
        html: `<h2>Congratulations ${name}</h2>
               <p>You have qualified for the next round of the Mathematics Competition.</p>`
    };
    transporter.sendMail(mailOptions, (err) => {
        if (err) console.log("Email error:", err);
        else console.log("Email sent to", to);
    });
}

// ------------------- ROUTES -------------------

// --- TEST DB ---
app.get("/test-db", (req, res) => {
    db.query("SELECT 1", (err) => {
        if (err) res.send("❌ Database connection failed");
        else res.send("✅ Database connected successfully");
    });
});

// --- REGISTER STUDENT ---
app.post("/register", (req, res) => {
    const { name, email, phone, studentClass, parish, yearsWatchman, password } = req.body;
    if (!name || !email || !phone || !studentClass || !parish || !yearsWatchman || !password) {
        return res.json({ success: false, message: "All fields required" });
    }

    db.query(
        "SELECT * FROM students WHERE name=? OR email=? OR mobile=?",
        [name, email, phone],
        (err, results) => {
            if (err) return res.json({ success: false, message: "Registration failed" });
            if (results.length > 0) return res.json({ success: false, message: "Student already exists" });

            db.query(
                "INSERT INTO students (name,email,mobile,class,parish,Years_watchman,password) VALUES (?,?,?,?,?,?,?)",
                [name,email,phone,studentClass,parish,yearsWatchman,password],
                (err2, result) => {
                    if (err2) return res.json({ success: false, message: "Registration failed" });
                    res.json({ success: true, message: "Registered successfully", studentId: result.insertId });
                }
            );
        }
    );
});

// --- STUDENT LOGIN ---
app.post("/login", (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.json({ success: false, message: "All fields required" });

    db.query(
        "SELECT * FROM students WHERE email=? AND password=?",
        [email, password],
        (err, result) => {
            if (err) return res.json({ success: false, message: "Login failed" });
            if (result.length === 0) return res.json({ success: false, message: "Invalid credentials" });
            res.json({ success: true, studentId: result[0].id });
        }
    );
});

// --- GET QUESTIONS (RANDOM ORDER) ---
app.get("/questions", (req, res) => {
    db.query("SELECT * FROM questions ORDER BY RAND()", (err, results) => {
        if (err) return res.status(500).json([]);
        res.json(results);
    });
});

// --- SUBMIT QUIZ ---
app.post("/submitQuiz", (req, res) => {
    const { studentId, answers } = req.body;
    if (!studentId || !answers) return res.json({ success: false, message: "Invalid data" });

    db.query("SELECT id, answer FROM questions", (err, questions) => {
        if (err) return res.json({ success: false, message: "Error fetching questions" });

        let score = 0;
        questions.forEach(q => {
            const key = "q" + q.id;
            if (answers[key] && answers[key] === q.answer) score++;
        });

        db.query("INSERT INTO results (student_id, score) VALUES (?,?)", [studentId, score], (err2) => {
            if (err2) return res.json({ success: false, message: "Error saving score" });
            res.json({ success: true, score });
        });
    });
});

// --- ADMIN LEADERBOARD ---
app.get("/admin/leaderboard", (req, res) => {
    const sql = `
        SELECT students.name, students.email, students.mobile, students.parish, results.score
        FROM results
        JOIN students ON results.student_id = students.id
        ORDER BY results.score DESC
    `;
    db.query(sql, (err, result) => {
        if (err) return res.json({ success: false });
        res.json({ success: true, leaderboard: result });
    });
});

// --- SEND EMAILS TO TOP 10 ---
app.get("/admin/sendEmails", (req, res) => {
    const sql = `
        SELECT students.name, students.email, results.score
        FROM results
        JOIN students ON results.student_id = students.id
        ORDER BY results.score DESC
        LIMIT 10
    `;
    db.query(sql, (err, students) => {
        if (err) return res.json({ success: false, message: "Error fetching top students" });

        students.forEach(student => sendEmail(student.email, student.name));
        res.json({ success: true, message: "Emails sent to top 10 students" });
    });
});

// --- ADD QUESTION ---
app.post("/addQuestion", (req, res) => {
    const { question, optionA, optionB, optionC, optionD, answer } = req.body;
    if (!question || !optionA || !optionB || !optionC || !optionD || !answer) return res.json({ success: false });
    const sql = "INSERT INTO questions (question, optionA, optionB, optionC, optionD, answer) VALUES (?,?,?,?,?,?)";
    db.query(sql, [question, optionA, optionB, optionC, optionD, answer], (err) => {
        if (err) return res.json({ success: false });
        res.json({ success: true });
    });
});

// --- DELETE QUESTION ---
app.delete("/admin/question/:id", (req, res) => {
    const id = req.params.id;
    db.query("DELETE FROM questions WHERE id=?", [id], (err) => {
        if (err) return res.json({ success: false });
        res.json({ success: true });
    });
});

// --- DELETE STUDENT ---
app.delete("/admin/student/:id", (req, res) => {
    const studentId = req.params.id;
    db.query("DELETE FROM results WHERE student_id=?", [studentId], (err1) => {
        if (err1) return res.json({ success: false });
        db.query("DELETE FROM students WHERE id=?", [studentId], (err2) => {
            if (err2) return res.json({ success: false });
            res.json({ success: true });
        });
    });
});

// --- GET ALL REGISTERED STUDENTS ---
app.get("/admin/students", (req, res) => {
    const sql = `
        SELECT students.id, students.name, students.email, students.mobile, students.parish,
        IFNULL(results.score,0) AS score
        FROM students
        LEFT JOIN results ON students.id = results.student_id
        ORDER BY students.id ASC
    `;
    db.query(sql, (err, result) => {
        if (err) return res.json({ success: false });
        res.json({ success: true, students: result });
    });
});

// ------------------- SERVER -------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

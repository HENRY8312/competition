// ------------------- IMPORTS -------------------
const express = require("express");
const mysql = require("mysql");
const cors = require("cors");
const nodemailer = require("nodemailer");
const path = require("path");
const multer = require("multer");
const fs = require("fs");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ------------------- CLOUD RUN SAFE UPLOAD DIR -------------------
const uploadDir = "/tmp/uploads";

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// ---------------- QUIZ SCHEDULE ----------------
const quizStartTime = new Date("2026-05-02T11:00:00+01:00");
const quizEndTime = new Date("2026-05-02T12:00:00+01:00");
const registrationDeadline = new Date("2026-05-02T11:00:00+01:00");

// ------------------- DATABASE (CLOUD SQL READY) -------------------
const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    charset: "utf8mb4",
};

// If using Cloud SQL socket
if (process.env.CLOUD_SQL_CONNECTION_NAME) {
    dbConfig.socketPath = `/cloudsql/${process.env.CLOUD_SQL_CONNECTION_NAME}`;
} else {
    dbConfig.host = process.env.DB_HOST;
}

const db = mysql.createConnection(dbConfig);

db.connect(err => {
    if (err) console.log("❌ DB connection failed:", err);
    else console.log("✅ Connected to Cloud SQL");
});

// ------------------- EMAIL (ENV SAFE) -------------------
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// ------------------- HELPERS -------------------
function sendEmail(to, name) {
    transporter.sendMail({
        from: process.env.EMAIL_USER,
        to,
        subject: "Mathematics Competition Result",
        html: `<h2>Congratulations ${name}</h2>
               <p>You have qualified for the next round of the Mathematics Competition.</p>`
    });
}

// ------------------- ROUTES -------------------

// TEST DB
app.get("/test-db", (req, res) => {
    db.query("SELECT 1", (err) => {
        if (err) return res.send("❌ DB failed");
        res.send("✅ DB connected");
    });
});

// QUIZ TIME
app.get("/quizTime", (req, res) => {
    res.json({ startTime: quizStartTime, endTime: quizEndTime });
});

// REGISTER
app.post("/register", (req, res) => {
    const now = new Date();

    if (now > registrationDeadline) {
        return res.json({
            success: false,
            message: "Registration closed."
        });
    }

    const { name, email, phone, studentClass, parish, yearsWatchman, password } = req.body;

    if (!name || !email || !phone || !studentClass || !parish || !yearsWatchman || !password) {
        return res.json({ success: false, message: "All fields required" });
    }

    db.query(
        "SELECT * FROM students WHERE name=? OR email=? OR mobile=?",
        [name, email, phone],
        (err, results) => {
            if (err) return res.json({ success: false });

            if (results.length > 0) {
                return res.json({ success: false, message: "Student exists" });
            }

            db.query(
                `INSERT INTO students 
                (name, email, mobile, student_class, parish, Years_watchman, password)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [name, email, phone, studentClass, parish, yearsWatchman, password],
                (err2, result) => {
                    if (err2) return res.json({ success: false });

                    res.json({
                        success: true,
                        studentId: result.insertId
                    });
                }
            );
        }
    );
});

// LOGIN
app.post("/login", (req, res) => {
    const { email, password } = req.body;

    db.query(
        "SELECT * FROM students WHERE email=? AND password=?",
        [email, password],
        (err, result) => {
            if (err || result.length === 0) {
                return res.json({ success: false });
            }

            res.json({
                success: true,
                studentId: result[0].id,
                name: result[0].name
            });
        }
    );
});

// QUESTIONS
app.get("/questions", (req, res) => {
    const now = new Date();

    if (now < quizStartTime || now > quizEndTime) {
        return res.json({ success: false, message: "Quiz not active" });
    }

    db.query("SELECT * FROM questions ORDER BY RAND()", (err, results) => {
        if (err) return res.json({ success: false });
        res.json({ success: true, questions: results });
    });
});

// ADMIN QUESTIONS
app.get("/admin/questions", (req, res) => {
    db.query("SELECT * FROM questions", (err, results) => {
        res.json({ success: !err, questions: results });
    });
});

// ADD QUESTION
app.post("/admin/add-question", (req, res) => {
    const { question, optionA, optionB, optionC, optionD, answer } = req.body;

    db.query(
        `INSERT INTO questions (question, optionA, optionB, optionC, optionD, answer)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [question, optionA, optionB, optionC, optionD, answer],
        (err) => {
            res.json({ success: !err });
        }
    );
});

// ---------------- UPLOADS (Cloud Run safe) ----------------
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, "/tmp/uploads"),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});

const upload = multer({ storage });

// FILE UPLOAD
app.post("/admin/uploadQuestions", upload.single("file"), async (req, res) => {
    try {
        const file = req.file;
        let text = "";

        if (file.mimetype === "application/pdf") {
            const data = fs.readFileSync(file.path);
            const pdf = await pdfParse(data);
            text = pdf.text;
        } else {
            const result = await mammoth.extractRawText({ path: file.path });
            text = result.value;
        }

        const lines = text.split(/\r?\n/);

        lines.forEach(line => {
            if (line.trim().length < 5) return;

            db.query(
                "INSERT IGNORE INTO questions (question, optionA, optionB, optionC, optionD, answer) VALUES (?,?,?,?,?,?)",
                [line, "A", "B", "C", "D", "A"]
            );
        });

        fs.unlinkSync(file.path);

        res.json({ success: true });

    } catch (e) {
        console.log(e);
        res.json({ success: false });
    }
});

// ------------------- SERVER (CRITICAL FOR CLOUD RUN) -------------------
const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server running on port ${PORT}`);
});

// ------------------- IMPORTS -------------------
const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const bcrypt = require("bcrypt");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");
const { Storage } = require("@google-cloud/storage");

// ------------------- APP SETUP -------------------
const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*" }
});

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// ------------------- CLOUD SQL -------------------
const db = mysql.createPool({
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    socketPath: `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}`
});

// ------------------- CLOUD STORAGE -------------------
const storage = new Storage();
const bucket = storage.bucket(process.env.BUCKET_NAME);
const upload = multer({ storage: multer.memoryStorage() });

// ------------------- QUIZ TIME -------------------
const quizStartTime = new Date("2026-05-02T11:00:00+01:00");
const quizEndTime = new Date("2026-05-02T12:00:00+01:00");

// ------------------- REGISTER -------------------
app.post("/register", async (req, res) => {
    const { name, email, phone, studentClass, parish, yearsWatchman, password } = req.body;

    const hashed = await bcrypt.hash(password, 10);

    db.query(
        `INSERT INTO students (name,email,mobile,student_class,parish,Years_watchman,password,status)
         VALUES (?,?,?,?,?,?,?, 'active')`,
        [name, email, phone, studentClass, parish, yearsWatchman, hashed],
        (err, result) => {
            if (err) return res.json({ success: false });
            res.json({ success: true, studentId: result.insertId });
        }
    );
});

// ------------------- LOGIN -------------------
app.post("/login", (req, res) => {
    const { email, password } = req.body;

    db.query("SELECT * FROM students WHERE email=?", [email], async (err, result) => {
        if (err || result.length === 0) return res.json({ success: false });

        const user = result[0];

        if (user.status === "terminated") {
            return res.json({ success: false, message: "Disqualified" });
        }

        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.json({ success: false });

        res.json({ success: true, studentId: user.id, name: user.name });
    });
});

// ------------------- QUESTIONS -------------------
app.get("/questions", (req, res) => {
    const now = new Date();

    if (now < quizStartTime || now > quizEndTime) {
        return res.json({ success: false, questions: [] });
    }

    db.query("SELECT * FROM questions ORDER BY RAND()", (err, results) => {
        res.json({ success: true, questions: results });
    });
});

// ------------------- SUBMIT QUIZ -------------------
app.post("/submitQuiz", (req, res) => {
    const { studentId, answers, questionIds } = req.body;

    const now = new Date();
    if (now > quizEndTime) {
        return res.json({ success: false, message: "Time up" });
    }

    db.query("SELECT * FROM results WHERE student_id=?", [studentId], (err, existing) => {
        if (existing.length > 0) {
            return res.json({ success: true, score: existing[0].score });
        }

        const placeholders = questionIds.map(() => "?").join(",");

        const sql = `
        SELECT COUNT(*) AS score
        FROM questions
        WHERE id IN (${placeholders})
        AND answer = CASE id
            ${questionIds.map(id => `WHEN ${id} THEN ?`).join(" ")}
        END
        `;

        const answerValues = questionIds.map(id => answers["q" + id] || "");

        db.query(sql, [...questionIds, ...answerValues], (err2, result) => {
            const score = result[0].score;

            db.query("INSERT INTO results (student_id, score) VALUES (?,?)",
                [studentId, score],
                () => {
                    broadcastLeaderboard();
                    res.json({ success: true, score });
                }
            );
        });
    });
});

// ------------------- FORCE TERMINATION -------------------
app.post("/forceTerminate", (req, res) => {
    const { studentId } = req.body;

    db.query("SELECT * FROM results WHERE student_id=?", [studentId], (err, existing) => {
        if (existing.length === 0) {
            db.query("INSERT INTO results (student_id, score) VALUES (?,0)", [studentId]);
        }

        db.query("UPDATE students SET status='terminated' WHERE id=?", [studentId]);

        res.json({ success: true });
    });
});

// ------------------- REALTIME LEADERBOARD -------------------
function broadcastLeaderboard() {
    db.query(`
        SELECT students.name, results.score
        FROM results
        JOIN students ON results.student_id = students.id
        ORDER BY results.score DESC
        LIMIT 10
    `, (err, results) => {
        if (!err) io.emit("leaderboard", results);
    });
}

// ------------------- UPLOAD TO CLOUD STORAGE -------------------
app.post("/upload", upload.single("file"), (req, res) => {
    const blob = bucket.file(Date.now() + req.file.originalname);
    const stream = blob.createWriteStream();

    stream.end(req.file.buffer);

    stream.on("finish", () => {
        res.json({ success: true });
    });
});

// ------------------- SERVER -------------------
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log("Server running"));

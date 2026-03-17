// ------------------- IMPORTS -------------------
const express = require("express");
const mysql = require("mysql");
const cors = require("cors");
const nodemailer = require("nodemailer");
const path = require("path");
const multer = require("multer"); // For file uploads
const fs = require("fs");
const mammoth = require("mammoth"); // Word (.docx) parsing
const pdfParse = require("pdf-parse"); // PDF parsing

// ------------------- ENSURE UPLOADS FOLDER EXISTS -------------------
const uploadDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public"))); // serve static files

// ---------------- QUIZ SCHEDULE ----------------
const quizStartTime = new Date("2026-03-15T06:30:00");
const quizEndTime = new Date("2026-03-17T11:00:00");

// ------------------- DATABASE -------------------
const db = mysql.createConnection({
    host: "sql8.freesqldatabase.com",
    user: "sql8819909",
    password: "ig6cdQwVAh",
    database: "sql8819909",
    charset: "utf8mb4"  // critical for symbols
});

db.connect(err => {
    if (err) console.log("❌ Database connection failed:", err);
    else console.log("✅ Connected to database");
});

// ------------------- EMAIL -------------------
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: "yourgmail@gmail.com",
        pass: "your_app_password"
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

// ------ QUIZ TIMER ----------
app.get("/quizTime",(req,res)=>{
    res.json({
        startTime: quizStartTime,
        endTime: quizEndTime
    });
});

// --- REGISTER STUDENT ---
app.post("/register", (req, res) => {
    const { name, email, phone, studentClass, parish, yearsWatchman, password } = req.body;
    if (!name || !email || !phone || !studentClass || !parish || !yearsWatchman || !password) {
        return res.json({ success: false, message: "All fields required" });
    }
    const checkQuery = "SELECT * FROM students WHERE name=? OR email=? OR mobile=?";
    db.query(checkQuery, [name, email, phone], (err, results) => {
        if (err) return res.json({ success: false, message: "Registration failed", error: err });
        if (results.length > 0) return res.json({ success: false, message: "Student already exists" });

        const insertQuery = `
            INSERT INTO students 
            (name, email, mobile, student_class, parish, Years_watchman, password) 
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        db.query(insertQuery, [name, email, phone, studentClass, parish, yearsWatchman, password],
        (err2, result) => {
            if (err2) return res.json({ success: false, message: "Registration failed", error: err2 });
            res.json({ success: true, message: "Registered successfully", studentId: result.insertId });
        });
    });
});

// --- STUDENT LOGIN ---
app.post("/login", (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.json({ success: false, message: "All fields required" });

    db.query("SELECT * FROM students WHERE email=? AND password=?", [email, password], (err, result) => {
        if (err) return res.json({ success: false, message: "Login failed" });
        if (result.length === 0) return res.json({ success: false, message: "Invalid credentials" });
        const studentId = result[0].id;
        res.json({ success: true, studentId, name: result[0].name });
    });
});

//------- Questions --------------
app.get("/questions", (req, res) => {
    const now = new Date();
    if (now < quizStartTime || now > quizEndTime) {
        return res.json({ success: false, questions: [], message: "Quiz not active at this time" });
    }
    db.query("SELECT * FROM questions ORDER BY RAND()", (err, results) => {
        if (err) return res.json({ success: false, questions: [], message: "Failed to fetch questions" });
        res.json({ success: true, questions: results });
    });
});

// --- GET QUESTIONS FOR ADMIN ---
app.get("/admin/questions", (req, res) => {
    db.query("SELECT * FROM questions ORDER BY RAND()", (err, results) => {
        if (err) return res.json({ success: false, questions: [], message: "Failed to fetch questions" });
        res.json({ success: true, questions: results });
    });
});

app.post("/admin/add-question", (req,res)=>{
    const {question, optionA, optionB, optionC, optionD, answer} = req.body;

    const sql = `
        INSERT INTO questions
        (question, optionA, optionB, optionC, optionD, answer)
        VALUES (?,?,?,?,?,?)
    `;

    db.query(sql,[question,optionA,optionB,optionC,optionD,answer],(err,result)=>{
        if(err){
            console.log(err);
            return res.json({success:false});
        }

        res.json({success:true});
    });
});
// --- SUBMIT QUIZ ---
app.post("/submitQuiz", (req, res) => {
    const { studentId, answers } = req.body;
    if (!studentId || !answers) return res.json({ success: false, message: "Invalid data" });

    db.query("SELECT * FROM results WHERE student_id=?", [studentId], (err1, existing) => {
        if (err1) return res.json({ success: false, message: "Database error" });
        if (existing.length > 0) return res.json({ success: true, score: existing[0].score, message: "Already submitted" });

        db.query("SELECT id, answer FROM questions", (err2, questions) => {
            if (err2) return res.json({ success: false, message: "Error fetching questions" });

            let score = 0;
            questions.forEach(q => {
                const key = "q" + q.id;
                if (answers[key] && answers[key] === q.answer) score++;
            });

            db.query("INSERT INTO results (student_id, score) VALUES (?,?)", [studentId, score], (err3) => {
                if (err3) return res.json({ success: false, message: "Error saving score" });
                res.json({ success: true, score });
            });
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

// --- ADD QUESTION WITH DUPLICATE CHECK ---
app.post("/addQuestion", (req, res) => {
    const { question, optionA, optionB, optionC, optionD, answer } = req.body;
    if (!question || !optionA || !optionB || !optionC || !optionD || !answer) return res.json({ success: false, message: "All fields required" });

    // Check for duplicate
    db.query("SELECT * FROM questions WHERE question=?", [question], (err, existing) => {
        if (err) return res.json({ success: false, message: "DB error" });
        if (existing.length > 0) return res.json({ success: false, message: "Duplicate question detected" });

        const sql = "INSERT INTO questions (question, optionA, optionB, optionC, optionD, answer) VALUES (?,?,?,?,?,?)";
        db.query(sql, [question, optionA, optionB, optionC, optionD, answer], (err2) => {
            if (err2) return res.json({ success: false, message: "Insert failed" });
            res.json({ success: true });
        });
    });
});

// --- UPLOAD QUESTIONS FROM FILE ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, "uploads/"),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

app.post("/admin/uploadQuestions", upload.single("file"), async (req, res) => {
    const file = req.file;
    if (!file) return res.json({ success: false, message: "No file uploaded" });

    try {
        let text = "";
        if (file.mimetype === "application/pdf") {
            const data = fs.readFileSync(file.path);
            const pdf = await pdfParse(data);
            text = pdf.text;
        } else if (file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
            const result = await mammoth.extractRawText({ path: file.path });
            text = result.value;
        } else {
            return res.json({ success: false, message: "Unsupported file type" });
        }

        // Split into questions based on newlines or numbering (basic)
        const lines = text.split(/\r?\n/).filter(l => l.trim() !== "");
        for (let line of lines) {
            // Skip if line too short
            if (line.length < 5) continue;
            // Attempt auto-add (you can improve parsing)
            const sql = "INSERT IGNORE INTO questions (question, optionA, optionB, optionC, optionD, answer) VALUES (?,?,?,?,?,?)";
            db.query(sql, [line, "A", "B", "C", "D", "A"]); // default options, admin can edit later
        }

        res.json({ success: true, message: "File processed successfully" });
    } catch (err) {
        console.error(err);
        res.json({ success: false, message: "File processing failed" });
    } finally {
        fs.unlinkSync(file.path); // clean up uploaded file
    }
});

// ================= NEW ROUTES FOR PREVIEW AND SAVE =================

// Preview uploaded questions before saving
app.post("/admin/upload-preview", upload.single("file"), async (req, res) => {
    const file = req.file;
    if (!file) return res.json({ success: false, message: "No file uploaded" });

    try {
        let text = "";

        if (file.mimetype === "application/pdf") {
            const data = fs.readFileSync(file.path);
            const pdf = await pdfParse(data);
            text = pdf.text;
        } else if (file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
            const result = await mammoth.extractRawText({ path: file.path });
            text = result.value;
        } else {
            return res.json({ success: false, message: "Unsupported file type" });
        }

        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
        let questions = [];
        let current = {};

        lines.forEach(line => {
            if (line.match(/^\d+\./)) {
                if (current.question) questions.push(current);
                current = { question: line.replace(/^\d+\./, "").trim() };
            } else if (line.startsWith("A.")) current.optionA = line.replace("A.", "").trim();
            else if (line.startsWith("B.")) current.optionB = line.replace("B.", "").trim();
            else if (line.startsWith("C.")) current.optionC = line.replace("C.", "").trim();
            else if (line.startsWith("D.")) current.optionD = line.replace("D.", "").trim();
            else if (line.toLowerCase().startsWith("answer")) current.answer = line.split(":")[1].trim();
        });

        if (current.question) questions.push(current);

        fs.unlinkSync(file.path);

        res.json({ success: true, questions });
    } catch (err) {
        console.error(err);
        res.json({ success: false, message: "File processing failed" });
    }
});

// Save uploaded questions to DB
app.post("/admin/save-uploaded-questions", (req, res) => {
    const questions = req.body.questions;
    if (!questions || questions.length === 0) return res.json({ success: false, message: "No questions received" });

    let inserted = 0;

    questions.forEach(q => {
        const sql = `
            INSERT INTO questions
            (question, optionA, optionB, optionC, optionD, answer)
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        db.query(sql, [q.question || "", q.optionA || "", q.optionB || "", q.optionC || "", q.optionD || "", q.answer || ""], (err) => {
            if (!err) inserted++;
        });
    });

    res.json({ success: true, inserted });
});

// --- DELETE QUESTION ---
app.delete("/admin/question/:id", (req, res) => {
    const id = req.params.id;
    db.query("DELETE FROM questions WHERE id=?", [id], (err) => {
        if (err) return res.json({ success: false });
        res.json({ success: true });
    });
});

//------ DELETE ALL QUESTIONS-------------------
app.delete("/admin/delete-all-questions",(req,res)=>{

db.query("DELETE FROM questions",(err,result)=>{

if(err){
console.log(err);
return res.json({success:false});
}

res.json({success:true});

});

});
// --- DELETE STUDENT ---
app.delete("/admin/student/:id", (req, res) => {
    const id = req.params.id;
    db.query("DELETE FROM students WHERE id=?", [id], (err) => {
        if (err) return res.json({ success: false });
        res.json({ success: true });
    });
});

// --- GET ALL REGISTERED STUDENTS ---
app.get("/admin/students", (req, res) => {
    const sql = "SELECT id, name, email, mobile, student_class, parish, Years_watchman, score FROM students";
    db.query(sql, (err, results) => {
        if (err) return res.json({ success: false, message: "Failed to fetch students" });
        res.json({ success: true, students: results });
    });
});

// ------------------- SERVER -------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

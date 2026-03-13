// ------------------- TIMER -------------------
let time = 3600; // 60 minutes in seconds
let timerInterval;

function startTimer() {
    const timerElement = document.getElementById("timer");
    timerInterval = setInterval(() => {
        let minutes = Math.floor(time / 60);
        let seconds = time % 60;
        timerElement.innerText = `Time: ${minutes}:${seconds < 10 ? '0' + seconds : seconds}`;
        time--;
        if (time < 0) {
            clearInterval(timerInterval);
            alert("Time is up! Submitting automatically...");
            submitQuiz();
        }
    }, 1000);
}

startTimer();

// ------------------- LOAD QUESTIONS -------------------
let questions = [];
let answers = JSON.parse(localStorage.getItem("answers")) || {};

async function loadQuestions() {
    try {
        const res = await fetch("/questions");
        questions = await res.json();

        if (!questions || questions.length === 0) {
            document.getElementById("quiz").innerHTML = "<p>No questions available yet.</p>";
            return;
        }

        // Shuffle questions for random order
        questions = questions.sort(() => Math.random() - 0.5);

        let html = "";
        let nav = "";

        questions.forEach((q, index) => {
            nav += `<button onclick="scrollToQuestion(${q.id})" id="nav${q.id}">${index + 1}</button>`;
            
            html += `
            <div class="question" id="q${q.id}">
                <h3>${index + 1}. ${q.question}</h3>
                <label><input type="radio" name="q${q.id}" value="A" onchange="saveAnswer(${q.id},'A')"> ${q.optionA}</label>
                <label><input type="radio" name="q${q.id}" value="B" onchange="saveAnswer(${q.id},'B')"> ${q.optionB}</label>
                <label><input type="radio" name="q${q.id}" value="C" onchange="saveAnswer(${q.id},'C')"> ${q.optionC}</label>
                <label><input type="radio" name="q${q.id}" value="D" onchange="saveAnswer(${q.id},'D')"> ${q.optionD}</label>
            </div><br>`;
        });

        document.getElementById("quiz").innerHTML = html;
        document.getElementById("navButtons").innerHTML = nav;

        restoreAnswers();
        updateProgress();

    } catch (err) {
        console.log(err);
        document.getElementById("quiz").innerHTML = "<p>Failed to load questions. Check server.</p>";
    }
}

loadQuestions();

// ------------------- SAVE ANSWER -------------------
function saveAnswer(id, value) {
    answers["q" + id] = value;
    localStorage.setItem("answers", JSON.stringify(answers));
    document.getElementById("nav" + id).classList.add("answered");
    updateProgress();
}

// ------------------- RESTORE ANSWERS -------------------
function restoreAnswers() {
    Object.keys(answers).forEach(key => {
        const input = document.querySelector(`input[name="${key}"][value="${answers[key]}"]`);
        if (input) input.checked = true;

        const qid = key.replace("q", "");
        const navBtn = document.getElementById("nav" + qid);
        if (navBtn) navBtn.classList.add("answered");
    });
}

// ------------------- PROGRESS BAR -------------------
function updateProgress() {
    let total = questions.length;
    let answered = Object.keys(answers).length;
    let percent = (answered / total) * 100;
    const progressBar = document.getElementById("progressBar");
    if (progressBar) progressBar.style.width = percent + "%";
}

// ------------------- NAVIGATION -------------------
function scrollToQuestion(id) {
    const element = document.getElementById("q" + id);
    if (element) {
        element.scrollIntoView({ behavior: "smooth" });
    }
}

// ------------------- PREVENT REFRESH -------------------
window.onbeforeunload = function () {
    return "You may lose your quiz progress";
}

// ------------------- SUBMIT QUIZ -------------------
async function submitQuiz() {
    // Use saved answers
    const studentId = localStorage.getItem("studentId");
    if (!studentId) {
        alert("Student ID not found. Please login again.");
        return;
    }

    try {
        const res = await fetch("/submitQuiz", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ studentId, answers })
        });

        const data = await res.json();
        localStorage.removeItem("answers");

        if (data.success) {
            alert(`Your score: ${data.score}`);
            window.location = "leaderboard.html";
        } else {
            alert("Failed to submit quiz: " + (data.message || "Unknown error"));
        }

    } catch (err) {
        console.log(err);
        alert("Error submitting quiz. Check server.");
    }
}
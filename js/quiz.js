let questions = [];
let answers = JSON.parse(localStorage.getItem("answers")) || {};
let examTerminated = false;

// ------------------- TIMER (SERVER SYNC) -------------------
async function startTimer() {
    const res = await fetch("/quizTime");
    const { endTime } = await res.json();

    const end = new Date(endTime).getTime();
    const timerElement = document.getElementById("timer");

    setInterval(() => {
        const now = new Date().getTime();
        let timeLeft = Math.floor((end - now) / 1000);

        if (timeLeft <= 0) {
            submitQuiz();
            return;
        }

        let min = Math.floor(timeLeft / 60);
        let sec = timeLeft % 60;

        timerElement.innerText = `Time: ${min}:${sec < 10 ? '0'+sec : sec}`;
    }, 1000);
}

// ------------------- LOAD QUESTIONS -------------------
async function loadQuestions() {
    const res = await fetch("/questions");
    const data = await res.json();

    questions = data.questions;

    let html = "";

    questions.forEach((q, i) => {
        html += `
        <div>
            <h3>${i+1}. ${q.question}</h3>
            ${["A","B","C","D"].map(opt => `
                <label>
                    <input type="radio" name="q${q.id}" value="${opt}" 
                    onchange="saveAnswer(${q.id}, '${opt}')">
                    ${q["option"+opt]}
                </label>
            `).join("")}
        </div>`;
    });

    document.getElementById("quiz").innerHTML = html;
}

// ------------------- SAVE -------------------
function saveAnswer(id, val) {
    answers["q"+id] = val;
    localStorage.setItem("answers", JSON.stringify(answers));
}

// ------------------- SUBMIT -------------------
async function submitQuiz() {
    const studentId = localStorage.getItem("studentId");

    const questionIds = questions.map(q => q.id);

    const res = await fetch("/submitQuiz", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ studentId, answers, questionIds })
    });

    const data = await res.json();
    alert("Score: " + data.score);
    localStorage.clear();
    window.location = "/login.html";
}

// ------------------- FORCE TERMINATE -------------------
async function forceSubmitAndLogout() {
    if (examTerminated) return;
    examTerminated = true;

    const studentId = localStorage.getItem("studentId");

    await fetch("/forceTerminate", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ studentId })
    });

    localStorage.clear();
    window.location = "/login.html";
}

// ------------------- ANTI CHEAT -------------------
document.addEventListener("visibilitychange", () => {
    if (document.hidden) forceSubmitAndLogout();
});

window.addEventListener("blur", () => {
    forceSubmitAndLogout();
});

setInterval(() => {
    if (window.outerWidth - window.innerWidth > 160) {
        forceSubmitAndLogout();
    }
}, 1000);

// ------------------- SOCKET.IO -------------------
const socket = io();

socket.on("leaderboard", data => {
    console.log("Live leaderboard", data);
});

// ------------------- INIT -------------------
startTimer();
loadQuestions();

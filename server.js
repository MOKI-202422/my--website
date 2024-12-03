const express = require("express");
const session = require("express-session");
const http = require("http");
const { Server } = require("socket.io");

// アプリケーションとサーバーのセットアップ
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3320;

// セッション設定
app.use(
    session({
        secret: "your_secret_key",
        resave: false,
        saveUninitialized: true,
        cookie: { secure: false }, // HTTPS環境ではtrue
    })
);

// ユーザー情報管理（仮のデータベース）
const users = {};

// JSONリクエストボディ解析
app.use(express.json());

// ルーティング
app.get("/", (req, res) => res.sendFile(__dirname + "/docs/login.html"));
app.get("/home", (req, res) => {
    if (!req.session.user) return res.redirect("/");
    res.sendFile(__dirname + "/docs/home.html");
});
app.get("/quiz", (req, res) => {
    if (!req.session.user) return res.redirect("/");
    res.sendFile(__dirname + "/docs/index.html");
});
app.get("/get-username", (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: "未ログインです。" });
    }
    res.json({ success: true, username: req.session.user.id });
});

// 静的ファイルの提供
app.use(express.static("docs"));

// 新規登録エンドポイント
app.post("/register", (req, res) => {
    const { id, password } = req.body;
    if (users[id]) {
        return res.json({ success: false, message: "このIDは既に登録されています。" });
    }
    users[id] = { password };
    res.json({ success: true, message: "登録が完了しました。" });
});

// ログインエンドポイント
app.post("/login", (req, res) => {
    const { id, password } = req.body;
    if (!users[id] || users[id].password !== password) {
        return res.json({ success: false, message: "IDまたはパスワードが間違っています。" });
    }
    req.session.user = { id };
    res.json({ success: true, message: "ログインに成功しました。" });
});

// クイズデータ
const quizQuestions = [
    { question: "日本の首都はどこ？", choices: ["大阪", "東京", "京都", "札幌"], answer: "東京" },
    { question: "1+1は何？", choices: ["1", "2", "3", "4"], answer: "2" },
    { question: "地球で一番高い山は？", choices: ["富士山", "エベレスト", "キリマンジャロ", "アンデス山脈"], answer: "エベレスト" },
];

const rooms = {};

// WebSocketの設定
io.on("connection", (socket) => {
    console.log("ユーザーが接続しました:", socket.id);

    socket.on("join_room", (roomName, playerName) => {
        console.log(`ルーム: ${roomName}, プレイヤー名: ${playerName} が参加しました。`);
        socket.join(roomName);

        if (!rooms[roomName]) {
            rooms[roomName] = {
                players: {},
                readyPlayers: new Set(),
                currentQuestionIndex: 0,
                timer: null,
                timeLeft: 30,
                incorrectPlayers: new Set(), // 不正解プレイヤー
                answeredPlayers: new Set(), // 回答済みプレイヤー
            };
        }

        rooms[roomName].players[playerName] = 0; // スコア初期化
        io.to(roomName).emit("player_list", Object.entries(rooms[roomName].players));
    });

    socket.on("player_ready", ({ roomName, playerName }) => {
        const room = rooms[roomName];
        if (!room) return;

        room.readyPlayers.add(playerName);
        if (room.readyPlayers.size === Object.keys(room.players).length) {
            io.to(roomName).emit("all_ready");
        }
    });

    socket.on("start_quiz", (roomName) => {
        const room = rooms[roomName];
        if (!room) return;

        room.currentQuestionIndex = 0;
        sendQuestion(roomName);
    });

    function sendQuestion(roomName) {
        const room = rooms[roomName];
        if (!room || room.currentQuestionIndex >= quizQuestions.length) {
            io.to(roomName).emit("end_quiz", "クイズ終了！");
            return;
        }

        const currentQuestion = quizQuestions[room.currentQuestionIndex];
        room.timeLeft = 30;
        room.incorrectPlayers.clear();
        room.answeredPlayers.clear();

        io.to(roomName).emit("question", {
            question: currentQuestion.question,
            choices: currentQuestion.choices,
        });

        startTimer(roomName);
        room.currentQuestionIndex++;
    }

    function startTimer(roomName) {
        const room = rooms[roomName];
        if (!room) return;

        if (room.timer) clearInterval(room.timer);

        room.timer = setInterval(() => {
            room.timeLeft--;
            io.to(roomName).emit("timer_update", room.timeLeft);

            if (room.timeLeft <= 0) {
                clearInterval(room.timer);

                const currentQuestion = quizQuestions[room.currentQuestionIndex - 1];
                io.to(roomName).emit("correct_answer", {
                    isAnswerReveal: true,
                    answer: currentQuestion.answer,
                });
                setTimeout(() => sendQuestion(roomName), 2000);
            }
        }, 1000);
    }

    socket.on("answer", ({ roomName, playerName, answer }) => {
        const room = rooms[roomName];
        if (!room) return;

        if (room.incorrectPlayers.has(playerName) || room.answeredPlayers.has(playerName)) {
            socket.emit("message", { type: "warning", text: "すでに回答済みです。" });
            return;
        }

        const currentIndex = room.currentQuestionIndex - 1;
        const currentQuestion = quizQuestions[currentIndex];

        room.answeredPlayers.add(playerName);

        if (answer === currentQuestion.answer) {
            room.players[playerName] += 1;
            io.to(roomName).emit("update_scores", room.players);
            io.to(roomName).emit("correct_answer", { playerName, answer });

            if (room.timer) clearInterval(room.timer);
            setTimeout(() => sendQuestion(roomName), 2000);
        } else {
            room.incorrectPlayers.add(playerName);
            io.to(roomName).emit("wrong_answer", { playerName, answer });

            if (room.incorrectPlayers.size === Object.keys(room.players).length) {
                if (room.timer) clearInterval(room.timer);

                io.to(roomName).emit("correct_answer", {
                    isAnswerReveal: true,
                    answer: currentQuestion.answer,
                });
                setTimeout(() => sendQuestion(roomName), 2000);
            }
        }
    });
});

// サーバー起動
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});

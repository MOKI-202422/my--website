const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3320;

// 静的ファイルの提供
app.use(express.static("docs"));

// ルーティング
// 最初にログイン画面を表示
app.get("/", (req, res) => res.sendFile(__dirname + "/docs/login.html"));

// ホームページ
app.get("/home", (req, res) => res.sendFile(__dirname + "/docs/home.html"));

// クイズページ
app.get("/quiz", (req, res) => res.sendFile(__dirname + "/docs/index.html"));

// クイズの質問データ
const quizQuestions = [
    { question: "日本の首都はどこ？", choices: ["大阪", "東京", "京都", "札幌"], answer: "東京" },
    { question: "1+1は何？", choices: ["1", "2", "3", "4"], answer: "2" },
    { question: "地球で一番高い山は？", choices: ["富士山", "エベレスト", "キリマンジャロ", "アンデス山脈"], answer: "エベレスト" },
];

// ルームごとの状態管理
const rooms = {};

io.on("connection", (socket) => {
    console.log("ユーザーが接続しました:", socket.id);

    // プレイヤーがルームに参加
    socket.on("join_room", (roomName, playerName) => {
        socket.join(roomName);

        if (!rooms[roomName]) {
            rooms[roomName] = {
                players: {}, // プレイヤーごとのスコア
                readyPlayers: new Set(),
                currentQuestionIndex: 0,
                timer: null,
                timeLeft: 30,
                wrongAnswers: {}, // 不正解プレイヤーの追跡
            };
        }

        rooms[roomName].players[playerName] = 0; // スコアを初期化
        io.to(roomName).emit("player_list", Object.entries(rooms[roomName].players));
    });

    // プレイヤーが準備完了
    socket.on("player_ready", ({ roomName, playerName }) => {
        const room = rooms[roomName];
        if (!room) return;

        room.readyPlayers.add(playerName);

        if (room.readyPlayers.size === Object.keys(room.players).length) {
            io.to(roomName).emit("all_ready");
        }
    });

    // クイズを開始
    socket.on("start_quiz", (roomName) => {
        const room = rooms[roomName];
        if (!room) return;

        room.currentQuestionIndex = 0;
        room.readyPlayers.clear();
        room.wrongAnswers = {};
        sendQuestion(roomName);
    });

    // 解答を受け取る
    socket.on("answer", (data) => {
        const { roomName, playerName, answer } = data;
        const room = rooms[roomName];
        if (!room) return;

        const currentQuestionIndex = room.currentQuestionIndex;
        const currentQuestion = quizQuestions[currentQuestionIndex];

        if (answer === currentQuestion.answer) {
            // 正解
            room.players[playerName] += 1;
            io.to(roomName).emit("update_scores", room.players);

            io.to(roomName).emit("correct_answer", {
                isAnswerReveal: false,
                playerName,
                answer,
            });

            clearInterval(room.timer);
            room.currentQuestionIndex++;
            setTimeout(() => sendQuestion(roomName), 2000);
        } else {
            // 不正解
            if (!room.wrongAnswers[playerName]) {
                room.wrongAnswers[playerName] = [];
            }
            room.wrongAnswers[playerName].push(currentQuestionIndex);

            io.to(roomName).emit("wrong_answer", { playerName, answer });

            // 全員が不正解の場合
            if (Object.keys(room.wrongAnswers).length === Object.keys(room.players).length) {
                clearInterval(room.timer);
                io.to(roomName).emit("correct_answer", {
                    isAnswerReveal: true,
                    answer: currentQuestion.answer,
                });

                setTimeout(() => {
                    room.currentQuestionIndex++;
                    sendQuestion(roomName);
                }, 2000);
            }
        }
    });

    socket.on("disconnect", () => {
        for (const roomName in rooms) {
            const room = rooms[roomName];
            if (!room) continue;

            for (const playerName in Object.keys(room.players)) {
                if (room.players[playerName] === socket.id) {
                    delete room.players[playerName];
                    room.readyPlayers.delete(playerName);
                    io.to(roomName).emit("player_list", Object.entries(room.players));
                    break;
                }
            }
        }
    });

    // 問題を送信
    function sendQuestion(roomName) {
        const room = rooms[roomName];
        if (!room || room.currentQuestionIndex >= quizQuestions.length) {
            io.to(roomName).emit("end_quiz", "クイズ終了！");
            return;
        }

        const currentQuestion = quizQuestions[room.currentQuestionIndex];
        room.timeLeft = 30;

        io.to(roomName).emit("question", {
            question: currentQuestion.question,
            choices: currentQuestion.choices,
        });

        startTimer(roomName);
    }

    // タイマー管理
    function startTimer(roomName) {
        const room = rooms[roomName];
        if (!room) return;

        room.timer = setInterval(() => {
            room.timeLeft--;
            io.to(roomName).emit("timer_update", room.timeLeft);

            if (room.timeLeft <= 0) {
                clearInterval(room.timer);

                const currentQuestion = quizQuestions[room.currentQuestionIndex];
                io.to(roomName).emit("correct_answer", {
                    isAnswerReveal: true,
                    answer: currentQuestion.answer,
                });

                setTimeout(() => {
                    room.currentQuestionIndex++;
                    sendQuestion(roomName);
                }, 2000);
            }
        }, 1000);
    }
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});

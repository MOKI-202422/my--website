const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3320;

// JSONリクエストボディの解析
app.use(express.json());

// 明示的にルート `/` を設定して `login.html` を提供
app.get("/", (req, res) => res.sendFile(__dirname + "/docs/login.html"));

// 静的ファイルの提供
app.use(express.static("docs"));

// ホームページ
app.get("/home", (req, res) => res.sendFile(__dirname + "/docs/home.html"));

// クイズページ
app.get("/quiz", (req, res) => res.sendFile(__dirname + "/docs/index.html"));

// 簡易的なユーザー管理
const users = {};

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
    if (!users[id]) {
        return res.json({ success: false, message: "IDが存在しません。" });
    }
    if (users[id].password !== password) {
        return res.json({ success: false, message: "パスワードが間違っています。" });
    }
    res.json({ success: true, message: "ログインに成功しました。" });
});

// クイズロジック（簡略化）
const quizQuestions = [
    { question: "日本の首都はどこ？", choices: ["大阪", "東京", "京都", "札幌"], answer: "東京" },
    { question: "1+1は何？", choices: ["1", "2", "3", "4"], answer: "2" },
    { question: "地球で一番高い山は？", choices: ["富士山", "エベレスト", "キリマンジャロ", "アンデス山脈"], answer: "エベレスト" },
];

const rooms = {};

io.on("connection", (socket) => {
    console.log("ユーザーが接続しました:", socket.id);

    // ルーム参加ロジック
    socket.on("join_room", (roomName, playerName) => {
        socket.join(roomName);

        if (!rooms[roomName]) {
            rooms[roomName] = {
                players: {},
                readyPlayers: new Set(),
                currentQuestionIndex: 0,
                timer: null,
                timeLeft: 30,
                wrongAnswers: {},
            };
        }

        rooms[roomName].players[playerName] = 0;
        io.to(roomName).emit("player_list", Object.entries(rooms[roomName].players));
    });

    // 他のクイズロジックをここに追加
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});

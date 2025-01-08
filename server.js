const express = require("express");
const session = require("express-session");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const users = {};
const categories = {};
const playerReadyStatus = {}; // プレイヤーの準備状況を管理
const playerScores = {}; // 各プレイヤーのスコアを管理
const playerAnswers = {}; // 各ルームごとのプレイヤーの回答履歴を記録
const privateChats = {}; // プライベートチャット用
const boardPosts = []; // 投稿データを保持
const studyRecords = {}; // ユーザごとの勉強記録を管理

io.on("connection", (socket) => {
    console.log("A user connected");

    socket.on("join_room", (roomName, playerName) => {
        socket.join(roomName);
        socket.playerName = playerName;

        if (!playerScores[roomName]) playerScores[roomName] = {};
        if (!playerScores[roomName][playerName]) playerScores[roomName][playerName] = 0; // スコア初期化

        console.log(`${playerName} joined room: ${roomName}`);
        if (!playerReadyStatus[roomName]) playerReadyStatus[roomName] = {};
        playerReadyStatus[roomName][playerName] = false;

        const playersInRoom = getPlayersInRoom(roomName);
        io.to(roomName).emit("update_players", playersInRoom);
    });

    socket.on("player_ready", ({ roomName, playerName }) => {
        playerReadyStatus[roomName][playerName] = true;
    
        // ログ出力を追加して準備状況を確認
        console.log(`準備状況: ${JSON.stringify(playerReadyStatus[roomName])}`);
        const allReady = Object.values(playerReadyStatus[roomName]).every((status) => status);
    
        if (allReady) {
            console.log(`全員準備完了: ${roomName}`);
            io.to(roomName).emit("all_ready");
            startQuiz(roomName);
        } else {
            io.to(roomName).emit("update_ready_status", playerReadyStatus[roomName]);
        }
    });
    

    socket.on("answer", ({ roomName, playerName, answer }) => handleAnswer(roomName, playerName, answer));

    socket.on("disconnect", () => {
        for (const roomName in playerReadyStatus) {
            delete playerReadyStatus[roomName][socket.playerName];
        }
    });

    // ここにチャット機能のコードを追加
    socket.on("set_username", (playerName) => {
        socket.playerName = playerName;
        console.log(`${playerName} has connected`);
    });

    // メッセージ送信
socket.on("send_message", ({ roomKey, message }) => {
    const sender = socket.playerName;

    if (!roomKey || !sender || !message) return;

    // チャット履歴を保存
    if (!privateChats[roomKey]) privateChats[roomKey] = [];
    privateChats[roomKey].push({ sender, message });

    // 指定されたチャットルームにメッセージを送信
    io.to(roomKey).emit("receive_message", { roomKey, sender, message });
});

// 指定されたプライベートチャットルームの履歴を取得
socket.on("get_chat_history", ({ roomKey }, callback) => {
    if (!roomKey) {
        callback({ success: false, message: "ルームキーが無効です。" });
        return;
    }

    const messages = privateChats[roomKey] || [];
    callback({ success: true, messages });
});

// プライベートチャットルームに参加
socket.on("join_private_chat", ({ roomKey }) => {
    socket.join(roomKey);
    console.log(`${socket.playerName}がプライベートチャットルーム「${roomKey}」に参加しました。`);
});

    socket.on("disconnect", () => {
        console.log(`${socket.playerName} disconnected`);
    });
});

// Helper functions
function getPlayersInRoom(roomName) {
    return Array.from(io.sockets.adapter.rooms.get(roomName) || []).map(
        (socketId) => io.sockets.sockets.get(socketId).playerName
    );
}

function startQuiz(roomName) {
    const questions = categories[roomName]?.questions || [];
    if (questions.length === 0) {
        io.to(roomName).emit("end_quiz", "クイズに問題がありません。");
        return;
    }

    playerReadyStatus[roomName].currentQuestion = 0;
    answeredPlayers[roomName] = {}; // 回答済みプレイヤーを初期化
    startQuestionTimer(roomName, questions);
}

const intervalIds = {}; // 各ルームのタイマーを管理

// クイズ終了時にスコアをリセットする関数
function resetScores(roomName) {
    if (playerScores[roomName]) {
        Object.keys(playerScores[roomName]).forEach((playerName) => {
            playerScores[roomName][playerName] = 0; // スコアを0にリセット
        });
    }
}

// クイズ終了時の処理
function endQuiz(roomName) {
    io.to(roomName).emit("end_quiz", "クイズが終了しました！");
    resetScores(roomName); // スコアをリセット
}

function startQuestionTimer(roomName, questions) {
    const questionIndex = playerReadyStatus[roomName].currentQuestion || 0;
    if (questionIndex >= questions.length) {
        endQuiz(roomName); // クイズ終了時にスコアをリセット
        return;
    }

    const question = questions[questionIndex];
    io.to(roomName).emit("room_questions", [question]);

    let timeLeft = 30;

    if (intervalIds[roomName]) {
        clearInterval(intervalIds[roomName]);
    }

    intervalIds[roomName] = setInterval(() => {
        timeLeft--;
        io.to(roomName).emit("timer_update", timeLeft);

        if (timeLeft <= 0) {
            clearInterval(intervalIds[roomName]);
            const correctAnswer = question.choices[question.answer - 1];
            io.to(roomName).emit("show_correct_answer", { correctAnswer });

            nextQuestion(roomName, questions);
        }
    }, 1000);
}

function nextQuestion(roomName, questions) {
    playerReadyStatus[roomName].currentQuestion++;

    if (playerReadyStatus[roomName].currentQuestion >= questions.length) {
        io.to(roomName).emit("end_quiz", "問題はすべて終了しました！");
        return;
    }

    answeredPlayers[roomName] = {}; // 回答済みプレイヤーをリセット

    
    // 2秒後に次の問題を開始
    setTimeout(() => {
    startQuestionTimer(roomName, questions);
   }, 2000);
}

const answeredPlayers = {}; // 各ルームごとの回答済みプレイヤーを管理

function handleAnswer(roomName, playerName, answer) {
    const questions = categories[roomName]?.questions || [];
    const questionIndex = playerReadyStatus[roomName]?.currentQuestion || 0;
    const question = questions[questionIndex];
    if (!question) return;

    // 回答履歴を初期化
    if (!playerAnswers[roomName]) playerAnswers[roomName] = {};
    if (!playerAnswers[roomName][playerName]) playerAnswers[roomName][playerName] = [];

    // 回答済みプレイヤーをチェック
    if (!answeredPlayers[roomName]) answeredPlayers[roomName] = {};
    if (answeredPlayers[roomName][playerName]) {
        // 既に回答したプレイヤーの場合は無視
        io.to(roomName).emit("already_answered", { playerName });
        return;
    }

    // プレイヤーの回答を記録
    const correctAnswer = question.choices[question.answer - 1];
    playerAnswers[roomName][playerName].push({
        question: question.question,
        choices: question.choices, // 選択肢を追加
        answer: question.choices[answer - 1], // プレイヤーの回答
        correct: question.choices[answer - 1] === correctAnswer,
        explanation: question.explanation // 解説を追加
    });

    answeredPlayers[roomName][playerName] = true; // プレイヤーの回答を記録
    console.log(`Player answers for room ${roomName}:`, playerAnswers[roomName]);

    if (question.choices[answer - 1] === correctAnswer) {
        // 正解の場合
        playerScores[roomName][playerName] += 1; // スコアを加算
        io.to(roomName).emit("update_scores", playerScores[roomName]); // スコアをクライアントに送信
        console.log(`Scores for room ${roomName}:`, playerScores[roomName]);
        io.to(roomName).emit("correct_answer", { playerName, answer });
        // 正解を表示してから次の問題に移る
        io.to(roomName).emit("show_correct_answer", { correctAnswer });
        clearInterval(intervalIds[roomName]); // タイマーをクリア
         // 2秒後に次の問題を開始
         setTimeout(() => {
        nextQuestion(roomName, questions); // 次の問題に進む
    }, 2000);
    } else {
        // 不正解の場合
        io.to(roomName).emit("wrong_answer", { playerName, answer });
    }
    

    // 全員が回答済みかチェック
    const playersInRoom = getPlayersInRoom(roomName);
    const allAnswered = playersInRoom.every((player) => answeredPlayers[roomName][player]);

    if (allAnswered) {
        // 全員が回答したが正解者がいない場合も正解を表示
        io.to(roomName).emit("show_correct_answer", { correctAnswer });
        // 全員が回答済みの場合
        clearInterval(intervalIds[roomName]); // タイマーをクリア
        // 2秒後に次の問題を開始
        setTimeout(() => {
        nextQuestion(roomName, questions); // 次の問題に進む
    }, 2000);
    }
}

const PORT = process.env.PORT || 3320;

app.use(
    session({
        secret: "your_secret_key",
        resave: false,
        saveUninitialized: true,
        cookie: {
            secure: false, // HTTPSで運用する場合はtrueに変更
            httpOnly: true, // JavaScriptからアクセス不可
            sameSite: "lax", // セッション固定化攻撃を防ぐ
        },
    })
);

app.use(express.json());

app.get("/", (req, res) => res.sendFile(__dirname + "/docs/login.html"));
app.get("/home", (req, res) => {
    if (!req.session.user) return res.redirect("/");
    res.sendFile(__dirname + "/docs/home.html");
});
app.get("/quiz", (req, res) => {
    if (!req.session.user) return res.redirect("/"); // ログインしていない場合リダイレクト
    res.sendFile(__dirname + "/docs/index.html");
});

app.get("/question", (req, res) => {
    if (!req.session.user) return res.redirect("/");
    res.sendFile(__dirname + "/docs/question.html");
});

app.get("/get-username", (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: "未ログインです。" });
    }
    res.json({ success: true, username: req.session.user.id });
});

app.use(express.static("docs"));

app.post("/register", (req, res) => {
    const { id, password } = req.body;
    if (users[id]) {
        return res.json({ success: false, message: "このIDは既に登録されています。" });
    }
    users[id] = { password };
    res.json({ success: true, message: "登録が完了しました。" });
});

app.post("/login", (req, res) => {
    const { id, password } = req.body;
    if (!users[id] || users[id].password !== password) {
        return res.json({ success: false, message: "IDまたはパスワードが間違っています。" });
    }
    req.session.user = { id };
    res.json({ success: true, message: "ログインに成功しました。" });
});

app.post("/add-category", (req, res) => {
    const { category, isLocked } = req.body;
    const username = req.session.user?.id;

    if (!category) {
        return res.status(400).json({ success: false, message: "カテゴリ名を指定してください。" });
    }

    if (categories[category]) {
        return res.status(400).json({ success: false, message: "カテゴリ名が既に存在します。" });
    }

    categories[category] = {
        isLocked: isLocked || false,
        owner: username,
        questions: [],
    };

    res.json({ success: true, message: `カテゴリ「${category}」が作成されました。` });
});

app.get("/categories", (req, res) => {
    res.json({
        success: true,
        categories: Object.keys(categories).map((category) => ({
            name: category,
            isLocked: categories[category].isLocked,
        })),
    });
});

app.post("/add-question", (req, res) => {
    const { category, question, choices, answer, explanation } = req.body;
    const username = req.session.user?.id;

    if (!category || !question || !choices || !answer || !explanation || choices.length < 2) {
        return res.status(400).json({ success: false, message: "カテゴリまたは問題が不正です。" });
    }

    if (!categories[category]) {
        return res.status(404).json({ success: false, message: "カテゴリが存在しません。" });
    }

    if (categories[category].isLocked && categories[category].owner !== username) {
        return res.status(403).json({ success: false, message: "このカテゴリにはアクセスできません。" });
    }

    categories[category].questions.push({ question, choices, answer, explanation });

    // 新しい問題をルームにいるユーザーに送信
io.to(category).emit("new_question", { question, choices, answer, explanation });

    res.json({ success: true, message: `カテゴリ「${category}」に問題が追加されました。` });
});

app.post("/delete-question", (req, res) => {
   const { category, index } = req.body;
   const username = req.session.user?.id;

   if (!username) {
       return res.status(401).json({ success: false, message: "ログインが必要です。" });
   }

   if (!categories[category]) {
       return res.status(404).json({ success: false, message: "カテゴリが存在しません。" });
   }

   const categoryData = categories[category];

   // 鍵付きカテゴリはオーナーのみ削除可能
   if (categoryData.isLocked && categoryData.owner !== username) {
       return res.status(403).json({ success: false, message: "このカテゴリの問題を削除する権限がありません。" });
   }

   if (!categoryData.questions[index]) {
       return res.status(404).json({ success: false, message: "指定された問題が存在しません。" });
   }

   // 問題を削除
   categoryData.questions.splice(index, 1);
   res.json({ success: true, message: "問題が削除されました。" });
});

// 新規追加: カテゴリ内の問題を取得
app.get("/questions/:category", (req, res) => {
    const { category } = req.params;

    if (!categories[category]) {
        return res.status(404).json({
            success: false,
            message: "カテゴリが見つかりません。",
        });
    }

    res.json({
        success: true,
        questions: categories[category].questions,
    });
});

// 成績ページの静的ファイル提供
app.get("/results.html", (req, res) => {
    res.sendFile(__dirname + "/docs/results.html");
});

// 成績データを返すエンドポイント
app.get("/quiz-results", (req, res) => {
    const roomName = req.query.roomName; // クエリパラメータからルーム名を取得
    if (!roomName || !playerScores[roomName]) {
        return res.json({ success: false, message: "成績データがありません。" });
    }

    const scores = Object.entries(playerScores[roomName]).map(([playerName, score]) => ({
        playerName,
        score,
        answers: playerAnswers[roomName]?.[playerName] || [], // プレイヤーの回答履歴を含める
    }));

    res.json({ success: true, scores });
});

app.get("/friend.html", (req, res) => {
    res.sendFile(__dirname + "/docs/friend.html");
});

app.get("/board.html", (req, res) => {
    res.sendFile(__dirname + "/docs/board.html");
});

app.post("/add-post", (req, res) => {
    const { username, message } = req.body;

    if (!username || !message) {
        return res.status(400).json({ success: false, message: "ユーザー名またはメッセージがありません。" });
    }

    const post = {
        username,
        message,
        timestamp: new Date().toISOString(),
    };

    boardPosts.push(post);

    io.emit("new_post", post); // 新しい投稿を全員に通知
    res.json({ success: true, message: "投稿が成功しました。" });
});

app.get("/get-posts", (req, res) => {
    res.json({ success: true, posts: boardPosts });
});

app.post("/add-category-post", (req, res) => {
    const { category, username, message } = req.body;

    if (!category || !username || !message) {
        return res.status(400).json({ success: false, message: "カテゴリ、名前、またはメッセージが不足しています。" });
    }

    if (!boardPosts[category]) boardPosts[category] = [];

    const post = {
        username,
        message,
        timestamp: new Date().toISOString(),
    };

    boardPosts[category].push(post);

    // 指定されたカテゴリ内の掲示板に通知
    io.to(category).emit("new_category_post", { category, post });
    res.json({ success: true, message: "投稿が追加されました。" });
});

app.get("/get-category-posts/:category", (req, res) => {
    const { category } = req.params;

    if (!category || !boardPosts[category]) {
        return res.status(404).json({ success: false, message: "指定されたカテゴリは存在しません。" });
    }

    res.json({ success: true, posts: boardPosts[category] });
});

app.get("/get-username", (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: "未ログインです。" });
    }
    res.json({ success: true, username: req.session.user.id });
});

// 勉強時間ページを提供
app.get("/study.html", (req, res) => {
    if (!req.session.user) return res.redirect("/");
    res.sendFile(__dirname + "/docs/study.html");
});

// 勉強記録を追加
app.post("/add-study", (req, res) => {
    const { date, time, content } = req.body;
    const username = req.session.user?.id;

    if (!username) {
        return res.status(401).json({ success: false, message: "ログインが必要です。" });
    }

    if (!date || !time || !content) {
        return res.status(400).json({ success: false, message: "全ての項目を記入してください。" });
    }

    if (!studyRecords[username]) studyRecords[username] = []; // 初期化
    studyRecords[username].push({ date, time, content });

    res.json({ success: true, message: "勉強記録が追加されました。" });
});

// 勉強記録を取得
app.get("/get-study-data", (req, res) => {
    const username = req.session.user?.id;

    if (!username) {
        return res.status(401).json({ success: false, message: "ログインが必要です。" });
    }

    const userRecords = studyRecords[username] || [];
    res.json({ success: true, studyRecords: userRecords });
});

// 特定のユーザーの勉強記録を取得
app.get("/get-user-study-data/:username", (req, res) => {
    const { username } = req.params;

    if (!username) {
        return res.status(400).json({ success: false, message: "ユーザー名が指定されていません。" });
    }

    const userRecords = studyRecords[username] || [];
    res.json({ success: true, studyRecords: userRecords });
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});




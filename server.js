const express = require("express");
const session = require("express-session");
const http = require("http");
const { Server } = require("socket.io");

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
        cookie: { secure: false },
    })
);

// ユーザー情報管理（仮のデータベース）
const users = {};

// JSONリクエストボディの解析
app.use(express.json());

// 明示的なルート設定
app.get("/", (req, res) => {
    res.sendFile(__dirname + "/docs/login.html");
});

app.get("/home", (req, res) => {
    if (!req.session.user) {
        return res.redirect("/");
    }
    res.sendFile(__dirname + "/docs/home.html");
});

app.get("/quiz", (req, res) => {
    if (!req.session.user) {
        return res.redirect("/");
    }
    res.sendFile(__dirname + "/docs/index.html");
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

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});

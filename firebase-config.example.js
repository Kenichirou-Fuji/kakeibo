// ════════════════════════════════════════════════════════
// Firebase設定ファイル テンプレート
//
// 【使い方】
// 1. このファイルを firebase-config.js にコピーする
//    > cp firebase-config.example.js firebase-config.js  (Mac/Linux)
//    > copy firebase-config.example.js firebase-config.js (Windows)
// 2. https://console.firebase.google.com/ でプロジェクトを作成
// 3. 「Firestore Database」を作成（テストモードで開始）
// 4. 「プロジェクトの設定 ⚙️」→「マイアプリ」→「Web アプリを追加」
// 5. 表示された値を下の firebaseConfig に貼り付ける
// ════════════════════════════════════════════════════════

const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

firebase.initializeApp(firebaseConfig);

const db = firebase.firestore();

// オフライン永続化（ネット接続が切れても操作でき、復帰後に自動同期）
db.enablePersistence({ synchronizeTabs: true }).catch(err => {
  console.warn('オフライン永続化を有効にできませんでした:', err.code);
});

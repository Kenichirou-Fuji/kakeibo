// ════════════════════════════════════════════════════════
// ★ Firebase設定ファイル ★
//
// 【初回セットアップ手順】
// 1. https://console.firebase.google.com/ でプロジェクトを作成
// 2. 左メニュー「構築 > Firestore Database」を作成
//    → 「テストモードで開始」を選択（後でルールを変更できます）
// 3. 「プロジェクトの設定（⚙️）」→「マイアプリ」→「</>（Web）」でアプリを追加
// 4. 表示された firebaseConfig の値をここに貼り付ける
// ════════════════════════════════════════════════════════

const firebaseConfig = {
  apiKey: "AIzaSyBO1LFNNWZYJfBnPWdXc8BFJohWLFtpNQM",
  authDomain: "kakeibo-398a2.firebaseapp.com",
  projectId: "kakeibo-398a2",
  storageBucket: "kakeibo-398a2.firebasestorage.app",
  messagingSenderId: "772972328665",
  appId: "1:772972328665:web:92d44e1ad524ca216930c8",
  measurementId: "G-D60V9RJFNS"
};

firebase.initializeApp(firebaseConfig);

const db = firebase.firestore();

// オフライン永続化（ネット接続が切れても操作でき、復帰後に自動同期）
db.enablePersistence({ synchronizeTabs: true }).catch(err => {
  console.warn('オフライン永続化を有効にできませんでした:', err.code);
});

firebase.initializeApp(firebaseConfig);

const db = firebase.firestore();

firebase.auth().signInAnonymously()
  .then(() => {
    console.log("Firebase Auth: 匿名ログインに成功しました");
  })
  .catch((error) => {
    console.error("Firebase Auth Error:", error);
    showToast("⚠️ ログインに失敗しました");
  });

let editingId = null;
let cachedEntries = [];

// ── Firestore リアルタイム同期 ──
// データが変わると全デバイスで自動的に renderList() が呼ばれる
db.collection('entries').onSnapshot(
  snapshot => {
    cachedEntries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    renderList();
  },
  err => {
    console.error('Firestore 同期エラー:', err);
    showToast('⚠️ データの読み込みに失敗しました');
  }
);

// ── 初期化 ──
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('date').value = today();
  document.getElementById('filterMonth').value = currentMonth();
});

function today() {
  return new Date().toISOString().slice(0, 10);
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

// ── タブ切り替え ──
function switchTab(tab, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + tab).classList.add('active');
  btn.classList.add('active');
  if (tab === 'view') renderList();
}

// ── 登録 ──
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('registerForm').addEventListener('submit', async e => {
    e.preventDefault();
    const entry = {
      date: document.getElementById('date').value,
      amount: parseInt(document.getElementById('amount').value, 10),
      purpose: document.getElementById('purpose').value,
      wallet: document.getElementById('wallet').value,
      memo: document.getElementById('memo').value.trim(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    try {
      await db.collection('entries').add(entry);
      showToast('登録しました！');
      e.target.reset();
      document.getElementById('date').value = today();
      document.getElementById('purpose').value = 'personal';
      document.getElementById('wallet').value = 'personal';
    } catch (err) {
      console.error(err);
      showToast('⚠️ 登録に失敗しました');
    }
  });

  // モーダル外クリックで閉じる
  document.getElementById('editModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });
});

// ── 一覧表示 ──
function renderList() {
  const entries = cachedEntries;
  const monthFilter = document.getElementById('filterMonth').value;
  const purposeFilter = document.getElementById('filterPurpose').value;
  const walletFilter = document.getElementById('filterWallet').value;

  let filtered = entries.filter(e => {
    if (monthFilter && !e.date.startsWith(monthFilter)) return false;
    if (purposeFilter && e.purpose !== purposeFilter) return false;
    if (walletFilter && e.wallet !== walletFilter) return false;
    return true;
  });

  filtered.sort((a, b) => b.date.localeCompare(a.date));

  const tbody = document.getElementById('entryList');
  const mobileList = document.getElementById('mobileList');
  const empty = document.getElementById('emptyState');

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    mobileList.innerHTML = '';
    empty.style.display = '';
  } else {
    empty.style.display = 'none';

    // デスクトップ表示
    tbody.innerHTML = filtered.map(e => `
      <tr>
        <td>${formatDate(e.date)}</td>
        <td><span class="badge badge-${e.purpose || 'personal'}">${e.purpose === 'family' ? '家族用' : '個人用'}</span></td>
        <td><span class="badge badge-${e.wallet || 'personal'}">${e.wallet === 'family' ? '共有財布' : '私の財布'}</span></td>
        <td class="amount-cell">¥${e.amount.toLocaleString()}</td>
        <td style="color:#718096">${e.memo || '—'}</td>
        <td>
          <div class="actions">
            <button class="btn-edit" onclick="openEdit('${e.id}')">編集</button>
            <button class="btn-del"  onclick="deleteEntry('${e.id}')">削除</button>
          </div>
        </td>
      </tr>
    `).join('');

    // モバイル表示
    mobileList.innerHTML = filtered.map(e => `
      <div class="mobile-card" data-id="${e.id}">
        <div class="card-content">
          <div class="card-row">
            <div>
              <div class="card-label">日付</div>
              <div class="card-value">${formatDate(e.date)}</div>
            </div>
            <div style="text-align: right;">
              <div class="card-label">金額</div>
              <div class="card-amount">¥${e.amount.toLocaleString()}</div>
            </div>
          </div>
          <div class="card-row">
            <span class="card-badge badge-${e.purpose || 'personal'}">${e.purpose === 'family' ? '家族用' : '個人用'}</span>
            <span class="card-badge badge-${e.wallet || 'personal'}">${e.wallet === 'family' ? '共有財布' : '私の財布'}</span>
          </div>
          ${e.memo ? `<div class="card-row" style="color: #718096; font-size: 0.85rem;">💬 ${e.memo}</div>` : ''}
        </div>
        <div class="card-actions">
          <button class="card-btn-edit" onclick="openEdit('${e.id}')">✏️ 編集</button>
          <button class="card-btn-del" onclick="deleteEntry('${e.id}')">🗑️ 削除</button>
        </div>
      </div>
    `).join('');

    // スワイプ機能を初期化
    initSwipe();
  }

  // サマリー更新
  const thisMonth = currentMonth();
  const monthSum = entries
    .filter(e => e.date.startsWith(thisMonth))
    .reduce((s, e) => s + e.amount, 0);
  const allSum = entries.reduce((s, e) => s + e.amount, 0);

  document.getElementById('monthTotal').textContent = '¥' + monthSum.toLocaleString();
  document.getElementById('allTotal').textContent = '¥' + allSum.toLocaleString();
  document.getElementById('totalCount').textContent = entries.length + '件';
}

function formatDate(d) {
  const [y, m, day] = d.split('-');
  return `${y}/${m}/${day}`;
}

// ── 削除 ──
async function deleteEntry(id) {
  if (!confirm('この項目を削除しますか？')) return;
  try {
    await db.collection('entries').doc(id).delete();
    showToast('削除しました');
  } catch (err) {
    console.error(err);
    showToast('⚠️ 削除に失敗しました');
  }
}

// ── 編集モーダル ──
function openEdit(id) {
  const entry = cachedEntries.find(e => e.id === id);
  if (!entry) return;
  editingId = id;
  document.getElementById('editDate').value = entry.date;
  document.getElementById('editAmount').value = entry.amount;
  document.getElementById('editPurpose').value = entry.purpose || 'personal';
  document.getElementById('editWallet').value = entry.wallet || 'personal';
  document.getElementById('editMemo').value = entry.memo;
  document.getElementById('editModal').classList.add('open');
}

function closeModal() {
  document.getElementById('editModal').classList.remove('open');
  editingId = null;
}

async function saveEdit() {
  if (!editingId) return;
  const date = document.getElementById('editDate').value;
  const amount = parseInt(document.getElementById('editAmount').value, 10);
  const purpose = document.getElementById('editPurpose').value;
  const wallet = document.getElementById('editWallet').value;
  const memo = document.getElementById('editMemo').value.trim();

  if (!date || isNaN(amount)) { alert('日付と金額は必須です'); return; }

  try {
    await db.collection('entries').doc(editingId).update({ date, amount, purpose, wallet, memo });
    closeModal();
    showToast('更新しました！');
  } catch (err) {
    console.error(err);
    showToast('⚠️ 更新に失敗しました');
  }
}

// ── トースト通知 ──
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ── スワイプ機能 ──
function initSwipe() {
  const cards = document.querySelectorAll('.mobile-card');
  const closeCard = (card) => {
    const cardContent = card.querySelector('.card-content');
    if (!cardContent) return;
    card.classList.remove('swiped');
    cardContent.classList.remove('swiped');
    cardContent.style.transform = 'translateX(0)';
  };

  const openCard = (card, width) => {
    const cardContent = card.querySelector('.card-content');
    if (!cardContent) return;
    card.style.setProperty('--swipe-actions-width', `${width}px`);
    card.classList.add('swiped');
    cardContent.classList.add('swiped');
    cardContent.style.transform = `translateX(-${width}px)`;
  };

  const closeOtherCards = (activeCard) => {
    cards.forEach(card => {
      if (card !== activeCard) closeCard(card);
    });
  };

  cards.forEach(card => {
    let startX = 0;
    let startTime = 0;
    const cardContent = card.querySelector('.card-content');
    const cardActions = card.querySelector('.card-actions');

    if (!cardContent || !cardActions) return;

    const getRevealWidth = () => Math.ceil(cardActions.getBoundingClientRect().width);

    card.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      startTime = Date.now();
      closeOtherCards(card);
      card.style.setProperty('--swipe-actions-width', `${getRevealWidth()}px`);
    }, false);

    card.addEventListener('touchmove', (e) => {
      const currentX = e.touches[0].clientX;
      const diff = startX - currentX;
      const revealWidth = getRevealWidth();

      if (diff <= 0) {
        cardContent.style.transform = 'translateX(0)';
        return;
      }

      cardContent.style.transform = `translateX(-${Math.min(diff, revealWidth)}px)`;
    }, false);

    card.addEventListener('touchend', (e) => {
      const endX = e.changedTouches[0].clientX;
      const diff = startX - endX;
      const duration = Date.now() - startTime;
      const revealWidth = getRevealWidth();

      if ((diff > 30 && duration < 500) || diff > revealWidth / 2) {
        openCard(card, revealWidth);
      } else {
        closeCard(card);
      }
    }, false);

    // タップでスワイプ状態をリセット
    cardContent.addEventListener('click', (e) => {
      if (!e.target.closest('button')) {
        closeCard(card);
      }
    });
  });
}


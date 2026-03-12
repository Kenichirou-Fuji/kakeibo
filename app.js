firebase.initializeApp(firebaseConfig);

const db = firebase.firestore();

db.enablePersistence({ synchronizeTabs: true }).catch(err => {
  console.warn('オフライン永続化を有効にできませんでした:', err.code);
});

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
let cachedMonthlyDeposits = {};
const DEFAULT_BASE_DEPOSIT_AMOUNT = 180000;
const BASE_DEPOSIT_STORAGE_KEY = 'baseDepositAmount';
const MONTHLY_DEPOSIT_STATUS_TYPE = 'monthlyDepositStatus';

// ── Firestore リアルタイム同期 ──
// データが変わると全デバイスで自動的に renderList() が呼ばれる
db.collection('entries').onSnapshot(
  snapshot => {
    cachedEntries = [];
    cachedMonthlyDeposits = {};

    snapshot.docs.forEach(doc => {
      const data = doc.data();
      if (data.entryType === MONTHLY_DEPOSIT_STATUS_TYPE) {
        cachedMonthlyDeposits[data.month || doc.id.replace('monthlyDepositStatus-', '')] = { id: doc.id, ...data };
        return;
      }

      cachedEntries.push({ id: doc.id, ...data });
    });

    renderList();
    renderDeposit();
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
  document.getElementById('depositMonth').value = currentMonth();
  document.getElementById('baseDepositAmount').value = loadBaseDepositAmount();
  document.getElementById('depositMonth').addEventListener('change', renderDeposit);
  document.getElementById('baseDepositAmount').addEventListener('input', onBaseDepositAmountChange);
  document.getElementById('depositCompletedCheckbox').addEventListener('change', onDepositCompletedChange);
  renderDeposit();
});

function today() {
  return formatLocalDate(new Date());
}

function currentMonth() {
  return formatLocalMonth(new Date());
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatLocalMonth(date) {
  return formatLocalDate(date).slice(0, 7);
}

// ── タブ切り替え ──
function switchTab(tab, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + tab).classList.add('active');
  btn.classList.add('active');
  if (tab === 'view') renderList();
  if (tab === 'deposit') renderDeposit();
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

function loadBaseDepositAmount() {
  const saved = parseInt(localStorage.getItem(BASE_DEPOSIT_STORAGE_KEY), 10);
  return Number.isFinite(saved) ? saved : DEFAULT_BASE_DEPOSIT_AMOUNT;
}

function onBaseDepositAmountChange(e) {
  const rawValue = parseInt(e.target.value, 10);
  const amount = Number.isFinite(rawValue) ? rawValue : 0;
  localStorage.setItem(BASE_DEPOSIT_STORAGE_KEY, String(amount));
  renderDeposit();
}

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

  document.getElementById('monthTotal').textContent = formatCurrency(monthSum);
  document.getElementById('allTotal').textContent = formatCurrency(allSum);
  document.getElementById('totalCount').textContent = entries.length + '件';
}

function renderDeposit() {
  const monthInput = document.getElementById('depositMonth');
  const baseInput = document.getElementById('baseDepositAmount');
  if (!monthInput || !baseInput) return;

  const selectedMonth = monthInput.value || currentMonth();
  const rawBaseAmount = parseInt(baseInput.value, 10);
  const baseAmount = Number.isFinite(rawBaseAmount) ? rawBaseAmount : 0;

  const monthlyEntries = cachedEntries
    .filter(e => e.date && e.date.startsWith(selectedMonth))
    .sort((a, b) => b.date.localeCompare(a.date));

  const familyPersonalEntries = monthlyEntries.filter(e => e.wallet === 'family' && e.purpose === 'personal');
  const personalFamilyEntries = monthlyEntries.filter(e => e.wallet === 'personal' && e.purpose === 'family');

  const familyPersonalTotal = familyPersonalEntries.reduce((sum, e) => sum + e.amount, 0);
  const personalFamilyTotal = personalFamilyEntries.reduce((sum, e) => sum + e.amount, 0);
  const recommendedDeposit = baseAmount + familyPersonalTotal - personalFamilyTotal;
  const monthlyDepositStatus = cachedMonthlyDeposits[selectedMonth] || {};
  const isDeposited = monthlyDepositStatus.deposited === true;

  document.getElementById('depositBaseTotal').textContent = formatCurrency(baseAmount);
  document.getElementById('depositFamilyPersonal').textContent = formatCurrency(familyPersonalTotal);
  document.getElementById('depositPersonalFamily').textContent = formatCurrency(personalFamilyTotal);
  document.getElementById('depositRecommendedTotal').textContent = formatCurrency(recommendedDeposit);
  document.getElementById('depositFormula').textContent =
    `${formatCurrency(baseAmount)} + ${formatCurrency(familyPersonalTotal)} - ${formatCurrency(personalFamilyTotal)} = ${formatCurrency(recommendedDeposit)}`;
  document.getElementById('familyPersonalCount').textContent = familyPersonalEntries.length + '件';
  document.getElementById('personalFamilyCount').textContent = personalFamilyEntries.length + '件';
  document.getElementById('depositMonthEntryCount').textContent = monthlyEntries.length + '件';
  document.getElementById('depositStatus').textContent = buildDepositStatusMessage(
    selectedMonth,
    familyPersonalTotal,
    personalFamilyTotal,
    recommendedDeposit
  );
  document.getElementById('depositCompletedCheckbox').checked = isDeposited;
  document.getElementById('depositCompletedMeta').textContent = buildDepositCompletedMeta(
    monthlyDepositStatus,
    recommendedDeposit
  );

  renderDepositDetailList(
    'depositFamilyPersonalList',
    familyPersonalEntries,
    'この月は、共有財布で払った個人用の支出はありません。'
  );
  renderDepositDetailList(
    'depositPersonalFamilyList',
    personalFamilyEntries,
    'この月は、私の財布で払った家族用の支出はありません。'
  );
}

async function onDepositCompletedChange(e) {
  const monthInput = document.getElementById('depositMonth');
  const baseInput = document.getElementById('baseDepositAmount');
  const selectedMonth = monthInput.value || currentMonth();
  const rawBaseAmount = parseInt(baseInput.value, 10);
  const baseAmount = Number.isFinite(rawBaseAmount) ? rawBaseAmount : 0;
  const monthlyEntries = cachedEntries.filter(entry => entry.date && entry.date.startsWith(selectedMonth));
  const familyPersonalTotal = monthlyEntries
    .filter(entry => entry.wallet === 'family' && entry.purpose === 'personal')
    .reduce((sum, entry) => sum + entry.amount, 0);
  const personalFamilyTotal = monthlyEntries
    .filter(entry => entry.wallet === 'personal' && entry.purpose === 'family')
    .reduce((sum, entry) => sum + entry.amount, 0);
  const recommendedDeposit = baseAmount + familyPersonalTotal - personalFamilyTotal;
  const checked = e.target.checked;

  e.target.disabled = true;
  try {
    await db.collection('entries').doc(`monthlyDepositStatus-${selectedMonth}`).set({
      entryType: MONTHLY_DEPOSIT_STATUS_TYPE,
      month: selectedMonth,
      deposited: checked,
      checkedAt: checked ? firebase.firestore.FieldValue.serverTimestamp() : null,
      amountAtCheck: checked ? recommendedDeposit : null,
      baseAmountAtCheck: checked ? baseAmount : null,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    showToast(checked ? '入金済みにしました' : '未入金に戻しました');
  } catch (err) {
    console.error(err);
    e.target.checked = !checked;
    showToast('⚠️ 入金状態の更新に失敗しました');
  } finally {
    e.target.disabled = false;
  }
}

function buildDepositStatusMessage(selectedMonth, familyPersonalTotal, personalFamilyTotal, recommendedDeposit) {
  const label = selectedMonth.replace('-', '年') + '月';
  if (familyPersonalTotal === 0 && personalFamilyTotal === 0) {
    return `${label}は立替精算がないため、基本入金額そのままで大丈夫です。`;
  }
  if (recommendedDeposit < 0) {
    return `${label}は個人財布での家族立替が大きく、計算上の入金額はマイナスです。精算方法を確認してください。`;
  }
  return `${label}の立替分を反映した入金額です。`;
}

function buildDepositCompletedMeta(monthlyDepositStatus, recommendedDeposit) {
  if (monthlyDepositStatus.deposited !== true) {
    return '未入金';
  }

  const checkedAt = monthlyDepositStatus.checkedAt && typeof monthlyDepositStatus.checkedAt.toDate === 'function'
    ? monthlyDepositStatus.checkedAt.toDate()
    : null;
  const checkedAtLabel = checkedAt ? formatDateTime(checkedAt) : '記録時刻不明';
  const amountAtCheck = Number.isFinite(monthlyDepositStatus.amountAtCheck)
    ? monthlyDepositStatus.amountAtCheck
    : recommendedDeposit;

  return `入金済み (${formatCurrency(amountAtCheck)} / ${checkedAtLabel})`;
}

function renderDepositDetailList(containerId, entries, emptyMessage) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (entries.length === 0) {
    container.innerHTML = `<div class="deposit-empty">${emptyMessage}</div>`;
    return;
  }

  container.innerHTML = entries.map(entry => `
    <div class="deposit-item">
      <div>
        <div class="deposit-item-date">${formatDate(entry.date)}</div>
        <div class="deposit-item-memo">${entry.memo || 'メモなし'}</div>
      </div>
      <div class="deposit-item-amount">${formatCurrency(entry.amount)}</div>
    </div>
  `).join('');
}

function formatDate(d) {
  const [y, m, day] = d.split('-');
  return `${y}/${m}/${day}`;
}

function formatCurrency(amount) {
  return '¥' + amount.toLocaleString();
}

function formatDateTime(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}/${month}/${day} ${hours}:${minutes}`;
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


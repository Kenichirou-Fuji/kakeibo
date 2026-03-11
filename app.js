const STORAGE_KEY = 'kakeibo_entries';
let editingId = null;

// ── データ操作 ──
function loadEntries() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
}

function saveEntries(entries) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

// ── 初期化 ──
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('date').value = today();
  document.getElementById('filterMonth').value = currentMonth();
  renderList();
});

function today() {
  return new Date().toISOString().slice(0, 10);
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

// ── タブ切り替え ──
function switchTab(tab) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + tab).classList.add('active');
  event.currentTarget.classList.add('active');
  if (tab === 'view') renderList();
}

// ── 登録 ──
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('registerForm').addEventListener('submit', e => {
    e.preventDefault();
    const entry = {
      id: Date.now().toString(),
      date: document.getElementById('date').value,
      amount: parseInt(document.getElementById('amount').value, 10),
      category: document.getElementById('category').value,
      purpose: document.getElementById('purpose').value,
      wallet: document.getElementById('wallet').value,
      memo: document.getElementById('memo').value.trim(),
    };
    const entries = loadEntries();
    entries.push(entry);
    saveEntries(entries);
    showToast('登録しました！');
    e.target.reset();
    document.getElementById('date').value = today();
    document.getElementById('category').value = '';
    document.getElementById('purpose').value = 'personal';
    document.getElementById('wallet').value = 'personal';
  });

  // モーダル外クリックで閉じる
  document.getElementById('editModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });
});

// ── 一覧表示 ──
function renderList() {
  const entries = loadEntries();
  const catFilter = document.getElementById('filterCategory').value;
  const monthFilter = document.getElementById('filterMonth').value;
  const purposeFilter = document.getElementById('filterPurpose').value;
  const walletFilter = document.getElementById('filterWallet').value;

  let filtered = entries.filter(e => {
    if (catFilter && e.category !== catFilter) return false;
    if (monthFilter && !e.date.startsWith(monthFilter)) return false;
    if (purposeFilter && e.purpose !== purposeFilter) return false;
    if (walletFilter && e.wallet !== walletFilter) return false;
    return true;
  });

  filtered.sort((a, b) => b.date.localeCompare(a.date));

  const tbody = document.getElementById('entryList');
  const empty = document.getElementById('emptyState');

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = '';
  } else {
    empty.style.display = 'none';
    tbody.innerHTML = filtered.map(e => `
      <tr>
        <td>${formatDate(e.date)}</td>
        <td><span class="badge badge-${e.category}">${e.category}</span></td>
        <td><span class="badge badge-${e.purpose || 'personal'}">${e.purpose === 'family' ? '家族' : '私用'}</span></td>
        <td><span class="badge badge-${e.wallet || 'personal'}">${e.wallet === 'family' ? '家族用' : '私用'}</span></td>
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
function deleteEntry(id) {
  if (!confirm('この項目を削除しますか？')) return;
  const entries = loadEntries().filter(e => e.id !== id);
  saveEntries(entries);
  showToast('削除しました');
  renderList();
}

// ── 編集モーダル ──
function openEdit(id) {
  const entry = loadEntries().find(e => e.id === id);
  if (!entry) return;
  editingId = id;
  document.getElementById('editDate').value = entry.date;
  document.getElementById('editAmount').value = entry.amount;
  document.getElementById('editCategory').value = entry.category;
  document.getElementById('editPurpose').value = entry.purpose || 'personal';
  document.getElementById('editWallet').value = entry.wallet || 'personal';
  document.getElementById('editMemo').value = entry.memo;
  document.getElementById('editModal').classList.add('open');
}

function closeModal() {
  document.getElementById('editModal').classList.remove('open');
  editingId = null;
}

function saveEdit() {
  if (!editingId) return;
  const date = document.getElementById('editDate').value;
  const amount = parseInt(document.getElementById('editAmount').value, 10);
  const category = document.getElementById('editCategory').value;
  const purpose = document.getElementById('editPurpose').value;
  const wallet = document.getElementById('editWallet').value;
  const memo = document.getElementById('editMemo').value.trim();
  if (!date || isNaN(amount)) { alert('日付と金額は必須です'); return; }

  const entries = loadEntries().map(e =>
    e.id === editingId ? { ...e, date, amount, category, purpose, wallet, memo } : e
  );
  saveEntries(entries);
  closeModal();
  showToast('更新しました！');
  renderList();
}

// ── トースト通知 ──
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ════════════════════════════════════════════════════════
// 家計簿アプリ２
// 既存アプリと同じ Firebase プロジェクトを使い、別コレクションに保存する
// ════════════════════════════════════════════════════════

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

db.enablePersistence({ synchronizeTabs: true }).catch(err => {
  console.warn('オフライン永続化を有効にできませんでした:', err.code);
});

// ── 定義 ──
const COL_ENTRIES = 'kakeibo2_entries';
const COL_FIXED = 'kakeibo2_fixedCosts';
const COL_META = 'kakeibo2_meta';
const META_SEED_DOC = 'fixedCostSeed';

const CATEGORY_ORDER = ['family', 'konami', 'ken'];
const CATEGORIES = { family: '家族', konami: 'こなみ', ken: 'けん' };
const ITEMS = {
  family: ['食費', '外食費', '雑費', '旅行', 'ガソリン', '日用品', '電気', 'ガス', '水道'],
  konami: ['雑費'],
  ken: ['卓球', '雑費'],
};
// 毎月必ず入力する項目（未入力なら警告する）
const REQUIRED_ITEMS = { family: ['電気', 'ガス', '水道'] };
// 財布が固定される項目（カテゴリ → 項目 → 財布）
const LOCKED_WALLET_ITEMS = { family: { '電気': 'family', 'ガス': 'family', '水道': 'family' } };
const WALLET_ORDER = ['ken', 'konami', 'family'];
const WALLETS = { ken: 'けんの財布', konami: 'こなみの財布', family: '家族財布' };
// カテゴリを選んだときに初期値として合わせる財布
const DEFAULT_WALLET_FOR_CATEGORY = { family: 'family', konami: 'konami', ken: 'ken' };

// 初回のみ Firestore に投入する固定費の初期値（wallet = どの財布から支払うか）
const DEFAULT_FIXED_COSTS = [
  { category: 'family', name: '家賃', amount: 60400, wallet: 'family' },
  { category: 'family', name: '駐車場', amount: 5000, wallet: 'family' },
  { category: 'family', name: 'ネット', amount: 0, wallet: 'family' },
  { category: 'family', name: 'スマホ', amount: 6000, wallet: 'konami' },
  { category: 'family', name: '自動車税', amount: 2875, wallet: 'family' },
  { category: 'family', name: '車保険', amount: 2500, wallet: 'family' },
  { category: 'family', name: 'nhk', amount: 1750, wallet: 'family' },
  { category: 'konami', name: '奨学金', amount: 15000, wallet: 'konami' },
  { category: 'konami', name: '保険', amount: 5000, wallet: 'konami' },
  { category: 'konami', name: 'ideco', amount: 5000, wallet: 'konami' },
  { category: 'konami', name: 'NISA', amount: 33000, wallet: 'konami' },
  { category: 'konami', name: '定期預金', amount: 30000, wallet: 'konami' },
  { category: 'ken', name: '保険', amount: 15000, wallet: 'family' },
  { category: 'ken', name: 'サブスク', amount: 3272, wallet: 'ken' },
  { category: 'ken', name: 'ideco', amount: 5000, wallet: 'ken' },
  { category: 'ken', name: 'NISA', amount: 200000, wallet: 'ken' },
];

// 入金額: 本人カテゴリの支出を家族財布で払えば加算、家族カテゴリの支出を本人の財布で払えば減算
const DEPOSIT_PERSONS = ['ken', 'konami'];
const DEFAULT_BASE_DEPOSIT = { ken: 180000, konami: 80000 };
const META_DEPOSIT_SETTINGS_DOC = 'depositSettings';   // kakeibo2_meta/depositSettings { baseAmounts: {ken, konami} }
const META_BUDGETS_DOC = 'budgets';                     // kakeibo2_meta/budgets { items: { "family|食費": 30000, ... } }
const DEFAULT_INCOME = { ken: 450000, konami: 210000 }; // 毎月の収入（kakeibo2_meta/depositSettings.incomes で上書き）
// 貯蓄とみなす固定費名（fixedCost.isSaving が未設定のときの既定）。収益（貯蓄除く）の計算で支出から外す
const SAVING_ITEM_NAMES = ['ideco', 'NISA', '定期預金'];
const BUDGET_WARN_RATIO = 0.8;                          // 上限のこの割合に達したら注意
const DEPOSIT_STATUS_PREFIX = 'deposit-';               // kakeibo2_meta/deposit-YYYY-MM-<person>

// ── 状態 ──
let cachedEntries = [];
let cachedFixedCosts = [];
let cachedDepositStatus = {};     // key: `${month}-${person}` → doc
let cachedBaseAmounts = { ...DEFAULT_BASE_DEPOSIT };
let cachedIncomes = { ...DEFAULT_INCOME };
let cachedBudgets = {};           // key: `${category}|${item}` → 月の上限（円）
let editingBudget = null;         // { category, item }
const depositState = { month: currentMonth() };
let editingId = null;
let editingFixedCostId = null;
let listenersStarted = false;
let seedChecked = false;
const viewState = { month: currentMonth(), category: '', item: '' };

// ── 認証 → Firestore リスナー ──
firebase.auth().onAuthStateChanged(user => {
  if (!user) {
    firebase.auth().signInAnonymously().catch(error => {
      console.error('Firebase Auth Error:', error);
      showToast('⚠️ ログインに失敗しました');
    });
    return;
  }
  if (listenersStarted) return;
  listenersStarted = true;

  db.collection(COL_ENTRIES).onSnapshot(
    snapshot => {
      cachedEntries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      renderView();
    },
    err => {
      console.error('Firestore 同期エラー (entries):', err);
      showToast('⚠️ データの読み込みに失敗しました');
    }
  );

  db.collection(COL_FIXED).onSnapshot(
    snapshot => {
      cachedFixedCosts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      sortFixedCosts();
      renderView();
      if (!seedChecked && !snapshot.metadata.fromCache) {
        seedChecked = true;
        if (snapshot.empty) seedFixedCostsIfNeeded();
      }
    },
    err => {
      console.error('Firestore 同期エラー (fixedCosts):', err);
      showToast('⚠️ 固定費の読み込みに失敗しました');
    }
  );

  db.collection(COL_META).onSnapshot(
    snapshot => {
      const status = {};
      let base = { ...DEFAULT_BASE_DEPOSIT };
      let incomes = { ...DEFAULT_INCOME };
      let budgets = {};
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        if (doc.id === META_DEPOSIT_SETTINGS_DOC) {
          base = { ...base, ...(data.baseAmounts || {}) };
          incomes = { ...incomes, ...(data.incomes || {}) };
        } else if (doc.id === META_BUDGETS_DOC) {
          budgets = { ...(data.items || {}) };
        } else if (doc.id.startsWith(DEPOSIT_STATUS_PREFIX)) {
          status[doc.id.slice(DEPOSIT_STATUS_PREFIX.length)] = { id: doc.id, ...data };
        }
      });
      cachedDepositStatus = status;
      cachedBaseAmounts = base;
      cachedIncomes = incomes;
      cachedBudgets = budgets;
      renderView();
    },
    err => {
      console.error('Firestore 同期エラー (meta):', err);
      showToast('⚠️ 入金情報の読み込みに失敗しました');
    }
  );
});

// 固定費が一件もなく、まだ初期投入していなければ既定の一覧を投入する
async function seedFixedCostsIfNeeded() {
  try {
    const metaRef = db.collection(COL_META).doc(META_SEED_DOC);
    const meta = await metaRef.get();
    if (meta.exists) return;

    const batch = db.batch();
    DEFAULT_FIXED_COSTS.forEach((fc, i) => {
      const ref = db.collection(COL_FIXED).doc(`seed-${fc.category}-${i}`);
      batch.set(ref, {
        ...fc,
        order: i,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    });
    batch.set(metaRef, { seededAt: firebase.firestore.FieldValue.serverTimestamp() });
    await batch.commit();
    showToast('固定費の初期値を投入しました');
  } catch (err) {
    console.error('固定費の初期投入に失敗:', err);
  }
}

// ── 初期化 ──
document.addEventListener('DOMContentLoaded', () => {
  fillSelect(document.getElementById('category'), CATEGORY_ORDER, CATEGORIES);
  fillSelect(document.getElementById('wallet'), WALLET_ORDER, WALLETS);
  fillSelect(document.getElementById('editCategory'), CATEGORY_ORDER, CATEGORIES);
  fillSelect(document.getElementById('editWallet'), WALLET_ORDER, WALLETS);
  fillSelect(document.getElementById('fixedCostCategory'), CATEGORY_ORDER, CATEGORIES);
  fillSelect(document.getElementById('fixedCostWallet'), WALLET_ORDER, WALLETS);

  resetRegisterForm();
  document.getElementById('category').addEventListener('change', e => {
    fillItemSelect(document.getElementById('item'), e.target.value);
    // カテゴリに合わせて財布の初期値も切り替える（手動で変更可）
    document.getElementById('wallet').value = DEFAULT_WALLET_FOR_CATEGORY[e.target.value] || 'family';
    applyWalletLock('category', 'item', 'wallet');
  });
  document.getElementById('item').addEventListener('change', () => applyWalletLock('category', 'item', 'wallet'));
  document.getElementById('editCategory').addEventListener('change', e => {
    fillItemSelect(document.getElementById('editItem'), e.target.value);
    applyWalletLock('editCategory', 'editItem', 'editWallet');
  });
  document.getElementById('editItem').addEventListener('change', () => applyWalletLock('editCategory', 'editItem', 'editWallet'));

  document.getElementById('registerForm').addEventListener('submit', onRegisterSubmit);

  document.getElementById('editModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.getElementById('fixedCostModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeFixedCostModal();
  });
  document.getElementById('budgetModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeBudgetModal();
  });

  renderView();
});

// 財布が固定される項目なら財布セレクトを固定し、それ以外なら解除する
function lockedWalletFor(category, item) {
  return (LOCKED_WALLET_ITEMS[category] || {})[item] || null;
}

function applyWalletLock(categoryId, itemId, walletId) {
  const walletSel = document.getElementById(walletId);
  const locked = lockedWalletFor(document.getElementById(categoryId).value, document.getElementById(itemId).value);
  if (locked) {
    walletSel.value = locked;
    walletSel.disabled = true;
    walletSel.title = 'この項目は家族財布から支払う項目です';
  } else {
    walletSel.disabled = false;
    walletSel.title = '';
  }
}

function fillSelect(select, order, labels) {
  select.innerHTML = order.map(key => `<option value="${key}">${labels[key]}</option>`).join('');
}

function fillItemSelect(select, category, selected) {
  const items = [...(ITEMS[category] || [])];
  if (selected && !items.includes(selected)) items.push(selected);
  select.innerHTML = items.map(name => `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`).join('');
  if (selected) select.value = selected;
}

function resetRegisterForm() {
  document.getElementById('registerForm').reset();
  document.getElementById('date').value = today();
  document.getElementById('category').value = 'family';
  fillItemSelect(document.getElementById('item'), 'family');
  document.getElementById('wallet').value = DEFAULT_WALLET_FOR_CATEGORY.family;
  applyWalletLock('category', 'item', 'wallet');
}

// ── 日付ユーティリティ ──
function today() { return formatLocalDate(new Date()); }
function currentMonth() { return formatLocalDate(new Date()).slice(0, 7); }

function formatLocalDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addMonths(month, diff) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + diff, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(month) {
  const [y, m] = month.split('-');
  return `${y}年${Number(m)}月`;
}

function formatDate(d) {
  const [y, m, day] = d.split('-');
  return `${y}/${m}/${day}`;
}

function formatCurrency(amount) {
  return '¥' + (Number(amount) || 0).toLocaleString();
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(str) { return escapeHtml(str); }

// ── タブ切り替え ──
function switchTab(tab, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + tab).classList.add('active');
  btn.classList.add('active');
  if (tab === 'view') renderView();
  if (tab === 'deposit') renderDeposit();
}

// ── 登録 ──
async function onRegisterSubmit(e) {
  e.preventDefault();
  const amount = parseInt(document.getElementById('amount').value, 10);
  const entry = {
    date: document.getElementById('date').value,
    amount,
    category: document.getElementById('category').value,
    item: document.getElementById('item').value,
    wallet: document.getElementById('wallet').value,
    memo: document.getElementById('memo').value.trim(),
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
  if (!entry.date || !Number.isFinite(amount)) { alert('日付と金額は必須です'); return; }
  entry.wallet = lockedWalletFor(entry.category, entry.item) || entry.wallet;

  try {
    await db.collection(COL_ENTRIES).add(entry);
    showToast('登録しました！');
    resetRegisterForm();
  } catch (err) {
    console.error(err);
    showToast('⚠️ 登録に失敗しました');
  }
}

// ── 集計ユーティリティ ──
function sumAmount(list) {
  return list.reduce((s, e) => s + (Number(e.amount) || 0), 0);
}

function entriesForMonth(month) {
  return cachedEntries.filter(e => typeof e.date === 'string' && e.date.startsWith(month));
}

// 固定費が貯蓄かどうか（明示設定がなければ名前で判定）
function isSavingFixedCost(fc) {
  if (typeof fc.isSaving === 'boolean') return fc.isSaving;
  return SAVING_ITEM_NAMES.includes(String(fc.name || '').trim());
}

// 固定費を「その月の1日の支出」として扱う
function fixedCostsAsEntries(month) {
  return cachedFixedCosts.map(fc => ({
    id: fc.id,
    date: `${month}-01`,
    amount: Number(fc.amount) || 0,
    category: fc.category,
    item: fc.name,
    memo: '',
    wallet: fc.wallet || null,
    isFixedCost: true,
    isSaving: isSavingFixedCost(fc),
  }));
}

function combinedForMonth(month) {
  return entriesForMonth(month).concat(fixedCostsAsEntries(month));
}

function applyFilter(list, { category, item }) {
  return list.filter(e => {
    if (category && e.category !== category) return false;
    if (item && e.item !== item) return false;
    return true;
  });
}

function availableMonths() {
  const set = new Set([currentMonth(), viewState.month]);
  cachedEntries.forEach(e => {
    if (typeof e.date === 'string' && e.date.length >= 7) set.add(e.date.slice(0, 7));
  });
  return [...set].sort((a, b) => b.localeCompare(a));
}

// ── 閲覧画面の操作 ──
function onMonthChange() {
  viewState.month = document.getElementById('monthSelect').value;
  viewState.item = '';
  renderView();
}

function shiftMonth(diff) {
  viewState.month = addMonths(viewState.month, diff);
  viewState.item = '';
  renderView();
}

function setCategory(category) {
  viewState.category = category;
  viewState.item = '';
  renderView();
}

function setItem(item) {
  viewState.item = viewState.item === item ? '' : item;
  renderView();
}

// ── 閲覧画面の描画 ──
function renderView() {
  if (!document.getElementById('monthSelect')) return;
  renderMonthSelect();
  renderCategoryChips();
  renderSummary();
  renderBreakdown();
  renderList();
  renderFixedCosts();
  renderDeposit();
  renderAlerts();
}

// ── 必須項目の未入力チェック ──
function missingRequiredItems(month) {
  const list = entriesForMonth(month);
  const missing = [];
  Object.entries(REQUIRED_ITEMS).forEach(([category, items]) => {
    items.forEach(item => {
      if (!list.some(e => e.category === category && e.item === item)) missing.push({ category, item });
    });
  });
  return missing;
}

function isRequiredItem(category, item) {
  return (REQUIRED_ITEMS[category] || []).includes(item);
}

function buildMissingAlertHtml(month) {
  const missing = missingRequiredItems(month);
  if (missing.length === 0) return '';
  return `<div class="alert-line">⚠️ <strong>${formatMonthLabel(month)}</strong> の未入力: `
    + missing.map(m => `<span class="alert-item">${escapeHtml(m.item)}</span>`).join('') + '</div>';
}

function buildBudgetAlertHtml(month) {
  const warnings = budgetWarnings(month);
  if (warnings.length === 0) return '';
  return `<div class="alert-line">💸 <strong>${formatMonthLabel(month)}</strong> の上限: `
    + warnings.map(w => {
      const label = `${CATEGORIES[w.category]}・${w.item}`;
      const detail = w.level === 'over'
        ? `${formatCurrency(w.spent - w.budget)}超過`
        : `残り${formatCurrency(w.budget - w.spent)}（${Math.round(w.ratio * 100)}%）`;
      return `<span class="alert-item alert-${w.level}">${escapeHtml(label)} ${detail}</span>`;
    }).join('') + '</div>';
}

function renderAlertInto(elementId, html) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.style.display = html ? '' : 'none';
  el.innerHTML = html;
}

function renderAlerts() {
  const thisMonth = currentMonth();
  renderAlertInto('registerAlert', buildMissingAlertHtml(thisMonth) + buildBudgetAlertHtml(thisMonth));
  renderAlertInto('viewAlert', buildMissingAlertHtml(viewState.month));
}

// ── 項目ごとの上限（予算） ──
function budgetKey(category, item) { return `${category}|${item}`; }

function getBudget(category, item) {
  const v = Number(cachedBudgets[budgetKey(category, item)]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

// その月・項目の使用状況。上限未設定なら null
function budgetStatus(month, category, item) {
  const budget = getBudget(category, item);
  if (!budget) return null;
  const spent = sumAmount(combinedForMonth(month).filter(e => e.category === category && e.item === item));
  const ratio = spent / budget;
  const level = ratio >= 1 ? 'over' : ratio >= BUDGET_WARN_RATIO ? 'warn' : 'ok';
  return { budget, spent, ratio, level, category, item };
}

function budgetWarnings(month) {
  return Object.keys(cachedBudgets)
    .map(key => {
      const [category, item] = key.split('|');
      return budgetStatus(month, category, item);
    })
    .filter(s => s && s.level !== 'ok')
    .sort((a, b) => b.ratio - a.ratio);
}

function openBudgetModal(category, item) {
  editingBudget = { category, item };
  const current = getBudget(category, item);
  document.getElementById('budgetModalTitle').textContent = `📊 ${CATEGORIES[category]}・${item} の月の上限`;
  document.getElementById('budgetAmount').value = current ?? '';
  document.getElementById('budgetClearBtn').style.display = current ? '' : 'none';
  document.getElementById('budgetModal').classList.add('open');
  document.getElementById('budgetAmount').focus();
}

function closeBudgetModal() {
  document.getElementById('budgetModal').classList.remove('open');
  editingBudget = null;
}

async function saveBudget(clear = false) {
  if (!editingBudget) return;
  const { category, item } = editingBudget;
  const key = budgetKey(category, item);
  const amount = parseInt(document.getElementById('budgetAmount').value, 10);
  if (!clear && (!Number.isFinite(amount) || amount <= 0)) { alert('1円以上の金額を入力してください'); return; }

  try {
    await db.collection(COL_META).doc(META_BUDGETS_DOC).set({
      items: { [key]: clear ? firebase.firestore.FieldValue.delete() : amount },
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    showToast(clear ? `${item}の上限を解除しました` : `${item}の上限を${formatCurrency(amount)}にしました`);
    closeBudgetModal();
  } catch (err) {
    console.error(err);
    showToast('⚠️ 上限の保存に失敗しました');
  }
}

function renderMonthSelect() {
  const select = document.getElementById('monthSelect');
  select.innerHTML = availableMonths()
    .map(m => `<option value="${m}">${formatMonthLabel(m)}</option>`)
    .join('');
  select.value = viewState.month;
}

function renderCategoryChips() {
  const container = document.getElementById('categoryChips');
  const chips = [{ key: '', label: 'すべて' }].concat(
    CATEGORY_ORDER.map(key => ({ key, label: CATEGORIES[key] }))
  );
  container.innerHTML = chips.map(c => `
    <button type="button"
      class="chip${viewState.category === c.key ? ' active' : ''}${c.key ? ` chip-${c.key}` : ''}"
      onclick="setCategory('${c.key}')">${c.label}</button>
  `).join('');
}

function renderSummary() {
  const thisMonth = currentMonth();
  const monthList = combinedForMonth(viewState.month);
  const filtered = applyFilter(monthList, viewState);

  document.getElementById('thisMonthTotal').textContent = formatCurrency(sumAmount(combinedForMonth(thisMonth)));
  document.getElementById('selectedMonthLabel').textContent = `${formatMonthLabel(viewState.month)}の合計`;
  document.getElementById('selectedMonthTotal').textContent = formatCurrency(sumAmount(monthList));

  const filterLabel = [
    viewState.category ? CATEGORIES[viewState.category] : null,
    viewState.item || null,
  ].filter(Boolean).join(' / ');
  document.getElementById('filteredLabel').textContent = filterLabel ? `${filterLabel}の合計` : '表示中の合計';
  document.getElementById('filteredTotal').textContent = formatCurrency(sumAmount(filtered));
}

function renderBreakdown() {
  const title = document.getElementById('breakdownTitle');
  const totalEl = document.getElementById('breakdownTotal');
  const list = document.getElementById('breakdownList');
  const monthList = combinedForMonth(viewState.month);
  const monthLabel = formatMonthLabel(viewState.month);

  if (!viewState.category) {
    // カテゴリ別
    title.textContent = `${monthLabel} カテゴリ別の合計`;
    totalEl.textContent = formatCurrency(sumAmount(monthList));
    list.innerHTML = CATEGORY_ORDER.map(key => {
      const rows = monthList.filter(e => e.category === key);
      const warnCount = budgetWarnings(viewState.month).filter(w => w.category === key).length;
      return `
        <div class="breakdown-row" role="button" tabindex="0" onclick="setCategory('${key}')">
          <span class="breakdown-name">
            <span class="badge badge-${key}">${CATEGORIES[key]}</span>
            ${warnCount ? `<span class="badge badge-over">上限注意 ${warnCount}</span>` : ''}
          </span>
          <span class="breakdown-count">${rows.length}件</span>
          <span class="breakdown-amount">${formatCurrency(sumAmount(rows))}</span>
          <span class="breakdown-arrow">›</span>
        </div>`;
    }).join('');
    return;
  }

  // 項目別（選択カテゴリ内）
  const catList = monthList.filter(e => e.category === viewState.category);
  title.textContent = `${monthLabel} ${CATEGORIES[viewState.category]} 項目別の合計`;
  totalEl.textContent = formatCurrency(sumAmount(catList));

  const fixedNames = new Set(catList.filter(e => e.isFixedCost).map(e => e.item));
  const itemNames = [...ITEMS[viewState.category]];
  catList.forEach(e => {
    if (e.item && !itemNames.includes(e.item)) itemNames.push(e.item);
  });

  const rowsHtml = itemNames.map(name => {
    const rows = catList.filter(e => e.item === name);
    const isFixed = fixedNames.has(name);
    const isRequired = isRequiredItem(viewState.category, name);
    const isMissing = isRequired && rows.length === 0;
    const active = viewState.item === name;
    const bs = budgetStatus(viewState.month, viewState.category, name);
    const nameArg = JSON.stringify(name).replace(/"/g, '&quot;');
    const catArg = JSON.stringify(viewState.category).replace(/"/g, '&quot;');

    let budgetHtml = '';
    if (bs) {
      const pct = Math.min(100, Math.round(bs.ratio * 100));
      const label = bs.level === 'over'
        ? `${formatCurrency(bs.spent - bs.budget)} 超過`
        : `残り ${formatCurrency(bs.budget - bs.spent)}`;
      budgetHtml = `
        <div class="budget-bar-wrap">
          <div class="budget-bar"><div class="budget-bar-fill level-${bs.level}" style="width:${pct}%"></div></div>
          <div class="budget-text">${label} / 上限 ${formatCurrency(bs.budget)}（${Math.round(bs.ratio * 100)}%）</div>
        </div>`;
    }
    const budgetBadge = bs && bs.level !== 'ok'
      ? ` <span class="badge badge-${bs.level}">${bs.level === 'over' ? '超過' : '上限注意'}</span>` : '';

    return `
      <div class="breakdown-row${active ? ' active' : ''}${isFixed ? ' is-fixed' : ''}${isMissing ? ' is-missing' : ''}${bs ? ` has-budget budget-${bs.level}` : ''}"
        role="button" tabindex="0" onclick="setItem(${nameArg})">
        <span class="breakdown-name">${escapeHtml(name)}${isFixed ? ' <span class="badge badge-fixed">固定</span>' : ''}${isRequired ? ` <span class="badge badge-required">${isMissing ? '未入力' : '必須'}</span>` : ''}${budgetBadge}</span>
        <span class="breakdown-count">${rows.length}件</span>
        <span class="breakdown-amount">${formatCurrency(sumAmount(rows))}</span>
        <button type="button" class="btn-budget" title="月の上限を設定"
          onclick="event.stopPropagation(); openBudgetModal(${catArg}, ${nameArg})">${bs ? '📊' : '＋上限'}</button>
        <span class="breakdown-arrow">${active ? '✕' : '›'}</span>
        ${budgetHtml}
      </div>`;
  }).join('');

  list.innerHTML = rowsHtml || '<div class="breakdown-empty">項目がありません</div>';
}

function renderList() {
  const filtered = applyFilter(combinedForMonth(viewState.month), viewState)
    .sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return (a.isFixedCost ? 1 : 0) - (b.isFixedCost ? 1 : 0);
    });

  const header = document.getElementById('listHeader');
  const parts = [formatMonthLabel(viewState.month)];
  if (viewState.category) parts.push(CATEGORIES[viewState.category]);
  if (viewState.item) parts.push(viewState.item);
  header.textContent = `${parts.join(' / ')} の一覧（${filtered.length}件）`;

  const tbody = document.getElementById('entryList');
  const mobileList = document.getElementById('mobileList');
  const empty = document.getElementById('emptyState');

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    mobileList.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = filtered.map(e => `
    <tr${e.isFixedCost ? ' class="fixed-cost-row"' : ''}>
      <td>${formatDate(e.date)}</td>
      <td><span class="badge badge-${e.category}">${CATEGORIES[e.category] || '—'}</span></td>
      <td>${escapeHtml(e.item || '—')}${e.isFixedCost ? ' <span class="badge badge-fixed">固定費</span>' : ''}</td>
      <td>${e.wallet ? `<span class="badge badge-wallet-${e.wallet}">${WALLETS[e.wallet] || e.wallet}</span>` : '<span class="muted">—</span>'}</td>
      <td class="amount-cell">${formatCurrency(e.amount)}</td>
      <td class="muted">${escapeHtml(e.memo || '—')}</td>
      <td>
        ${e.isFixedCost ? `
        <div class="actions">
          <button class="btn-edit" onclick="openEditFixedCost('${e.id}')">編集</button>
        </div>` : `
        <div class="actions">
          <button class="btn-edit" onclick="openEdit('${e.id}')">編集</button>
          <button class="btn-del" onclick="deleteEntry('${e.id}')">削除</button>
        </div>`}
      </td>
    </tr>
  `).join('');

  mobileList.innerHTML = filtered.map(e => `
    <div class="mobile-card${e.isFixedCost ? ' fixed-cost-card' : ''}">
      <div class="card-content">
        <div class="card-row">
          <div>
            <div class="card-label">${formatDate(e.date)}</div>
            <div class="card-value">${escapeHtml(e.item || '—')}</div>
          </div>
          <div class="card-amount">${formatCurrency(e.amount)}</div>
        </div>
        <div class="card-row card-badges">
          <span class="badge badge-${e.category}">${CATEGORIES[e.category] || '—'}</span>
          ${e.wallet ? `<span class="badge badge-wallet-${e.wallet}">${WALLETS[e.wallet] || e.wallet}</span>` : ''}
          ${e.isFixedCost ? '<span class="badge badge-fixed">固定費</span>' : ''}
        </div>
        ${e.memo ? `<div class="card-memo">💬 ${escapeHtml(e.memo)}</div>` : ''}
      </div>
      ${e.isFixedCost ? `
      <div class="card-actions">
        <button class="card-btn-edit" onclick="openEditFixedCost('${e.id}')">✏️ 編集</button>
      </div>` : `
      <div class="card-actions">
        <button class="card-btn-edit" onclick="openEdit('${e.id}')">✏️ 編集</button>
        <button class="card-btn-del" onclick="deleteEntry('${e.id}')">🗑️ 削除</button>
      </div>`}
    </div>
  `).join('');

  initSwipe();
}

// ── 固定費 ──
function sortFixedCosts() {
  cachedFixedCosts.sort((a, b) => {
    const ca = CATEGORY_ORDER.indexOf(a.category);
    const cb = CATEGORY_ORDER.indexOf(b.category);
    if (ca !== cb) return ca - cb;
    return (a.order ?? 999) - (b.order ?? 999) || String(a.name).localeCompare(String(b.name));
  });
}

function renderFixedCosts() {
  const container = document.getElementById('fixedCostList');
  const totalEl = document.getElementById('fixedCostTotal');
  totalEl.textContent = formatCurrency(sumAmount(cachedFixedCosts)) + ' / 月';

  if (cachedFixedCosts.length === 0) {
    container.innerHTML = '<div class="fixed-cost-empty">固定費が登録されていません</div>';
    return;
  }

  container.innerHTML = CATEGORY_ORDER.map(key => {
    const rows = cachedFixedCosts.filter(fc => fc.category === key);
    if (rows.length === 0) return '';
    return `
      <div class="fixed-cost-group">
        <div class="fixed-cost-group-header">
          <span class="badge badge-${key}">${CATEGORIES[key]}</span>
          <span class="fixed-cost-group-total">${formatCurrency(sumAmount(rows))}</span>
        </div>
        ${rows.map(fc => `
          <div class="fixed-cost-item">
            <div class="fixed-cost-name">
              ${escapeHtml(fc.name)}
              ${fc.wallet ? `<span class="badge badge-wallet-${fc.wallet}">${WALLETS[fc.wallet] || fc.wallet}</span>` : ''}
              ${isSavingFixedCost(fc) ? '<span class="badge badge-saving">貯蓄</span>' : ''}
            </div>
            <div class="fixed-cost-right">
              <div class="fixed-cost-amount">${formatCurrency(fc.amount)}</div>
              <div class="fixed-cost-actions">
                <button class="btn-edit" onclick="openEditFixedCost('${fc.id}')">編集</button>
                <button class="btn-del" onclick="deleteFixedCost('${fc.id}')">削除</button>
              </div>
            </div>
          </div>`).join('')}
      </div>`;
  }).join('');
}

function toggleFixedCostSection() {
  const body = document.getElementById('fixedCostBody');
  const toggle = document.getElementById('fixedCostToggle');
  const open = body.style.display === 'none';
  body.style.display = open ? '' : 'none';
  toggle.textContent = open ? '▼' : '▶';
}

function openFixedCostModal() {
  editingFixedCostId = null;
  document.getElementById('fixedCostName').value = '';
  document.getElementById('fixedCostAmount').value = '';
  const category = viewState.category || 'family';
  document.getElementById('fixedCostCategory').value = category;
  document.getElementById('fixedCostWallet').value = DEFAULT_WALLET_FOR_CATEGORY[category];
  document.getElementById('fixedCostIsSaving').checked = false;
  document.getElementById('fixedCostModalTitle').textContent = '＋ 固定費を追加';
  document.getElementById('fixedCostModal').classList.add('open');
}

function openEditFixedCost(id) {
  const fc = cachedFixedCosts.find(f => f.id === id);
  if (!fc) return;
  editingFixedCostId = id;
  document.getElementById('fixedCostName').value = fc.name || '';
  document.getElementById('fixedCostAmount').value = fc.amount;
  document.getElementById('fixedCostCategory').value = fc.category || 'family';
  document.getElementById('fixedCostWallet').value = fc.wallet || DEFAULT_WALLET_FOR_CATEGORY[fc.category] || 'family';
  document.getElementById('fixedCostIsSaving').checked = isSavingFixedCost(fc);
  document.getElementById('fixedCostModalTitle').textContent = '✏️ 固定費を編集';
  document.getElementById('fixedCostModal').classList.add('open');
}

function closeFixedCostModal() {
  document.getElementById('fixedCostModal').classList.remove('open');
  editingFixedCostId = null;
}

async function saveFixedCost() {
  const name = document.getElementById('fixedCostName').value.trim();
  const amount = parseInt(document.getElementById('fixedCostAmount').value, 10);
  const category = document.getElementById('fixedCostCategory').value;
  const wallet = document.getElementById('fixedCostWallet').value;
  const isSaving = document.getElementById('fixedCostIsSaving').checked;
  if (!name || !Number.isFinite(amount)) { alert('固定費名と金額は必須です'); return; }

  try {
    if (editingFixedCostId) {
      await db.collection(COL_FIXED).doc(editingFixedCostId).update({ name, amount, category, wallet, isSaving });
      showToast('固定費を更新しました');
    } else {
      const maxOrder = cachedFixedCosts.reduce((m, fc) => Math.max(m, Number(fc.order) || 0), -1);
      await db.collection(COL_FIXED).add({
        name, amount, category, wallet, isSaving,
        order: maxOrder + 1,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      showToast('固定費を登録しました');
    }
    closeFixedCostModal();
  } catch (err) {
    console.error(err);
    showToast('⚠️ 固定費の保存に失敗しました');
  }
}

async function deleteFixedCost(id) {
  const fc = cachedFixedCosts.find(f => f.id === id);
  if (!confirm(`固定費「${fc ? fc.name : ''}」を削除しますか？`)) return;
  try {
    await db.collection(COL_FIXED).doc(id).delete();
    showToast('固定費を削除しました');
  } catch (err) {
    console.error(err);
    showToast('⚠️ 固定費の削除に失敗しました');
  }
}

// ── 支出の編集・削除 ──
function openEdit(id) {
  const entry = cachedEntries.find(e => e.id === id);
  if (!entry) return;
  editingId = id;
  document.getElementById('editDate').value = entry.date || today();
  document.getElementById('editAmount').value = entry.amount;
  document.getElementById('editCategory').value = entry.category || 'family';
  fillItemSelect(document.getElementById('editItem'), entry.category || 'family', entry.item);
  document.getElementById('editWallet').value = entry.wallet || DEFAULT_WALLET_FOR_CATEGORY[entry.category] || 'family';
  applyWalletLock('editCategory', 'editItem', 'editWallet');
  document.getElementById('editMemo').value = entry.memo || '';
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
  const category = document.getElementById('editCategory').value;
  const item = document.getElementById('editItem').value;
  const wallet = lockedWalletFor(category, item) || document.getElementById('editWallet').value;
  const memo = document.getElementById('editMemo').value.trim();
  if (!date || !Number.isFinite(amount)) { alert('日付と金額は必須です'); return; }

  try {
    await db.collection(COL_ENTRIES).doc(editingId).update({ date, amount, category, item, wallet, memo });
    closeModal();
    showToast('更新しました！');
  } catch (err) {
    console.error(err);
    showToast('⚠️ 更新に失敗しました');
  }
}

async function deleteEntry(id) {
  if (!confirm('この支出を削除しますか？')) return;
  try {
    await db.collection(COL_ENTRIES).doc(id).delete();
    showToast('削除しました');
  } catch (err) {
    console.error(err);
    showToast('⚠️ 削除に失敗しました');
  }
}

// ── 入金額 ──
function shiftDepositMonth(diff) {
  depositState.month = addMonths(depositState.month, diff);
  renderDeposit();
}

function onDepositMonthChange() {
  depositState.month = document.getElementById('depositMonthSelect').value;
  renderDeposit();
}

// 月・人ごとの入金額を計算する
function calcDeposit(month, person) {
  const list = combinedForMonth(month);
  const plusItems = list.filter(e => e.category === person && e.wallet === 'family');
  const minusItems = list.filter(e => e.category === 'family' && e.wallet === person);
  const base = Number(cachedBaseAmounts[person]) || 0;
  const plus = sumAmount(plusItems);
  const minus = sumAmount(minusItems);
  return { base, plus, minus, total: base + plus - minus, plusItems, minusItems };
}

function renderDeposit() {
  const select = document.getElementById('depositMonthSelect');
  if (!select) return;

  const months = new Set(availableMonths());
  months.add(depositState.month);
  select.innerHTML = [...months].sort((a, b) => b.localeCompare(a))
    .map(m => `<option value="${m}">${formatMonthLabel(m)}</option>`).join('');
  select.value = depositState.month;

  const month = depositState.month;
  const results = {};
  DEPOSIT_PERSONS.forEach(p => { results[p] = calcDeposit(month, p); });

  DEPOSIT_PERSONS.forEach(p => {
    document.getElementById(`depositTotal-${p}`).textContent = formatCurrency(results[p].total);
  });
  document.getElementById('depositTotal-all').textContent =
    formatCurrency(DEPOSIT_PERSONS.reduce((s, p) => s + results[p].total, 0));

  renderHousehold(month);

  document.getElementById('depositCards').innerHTML = DEPOSIT_PERSONS.map(p => {
    const r = results[p];
    const name = CATEGORIES[p];
    const status = cachedDepositStatus[`${month}-${p}`] || {};
    const deposited = status.deposited === true;
    return `
      <div class="deposit-card${deposited ? ' is-deposited' : ''}">
        <div class="deposit-card-header">
          <span class="badge badge-${p}">${name}</span>
          <span class="deposit-card-title">${formatMonthLabel(month)}の入金額</span>
          <span class="deposit-card-total${r.total < 0 ? ' negative' : ''}">${formatCurrency(r.total)}</span>
        </div>

        <div class="deposit-formula">
          ${formatCurrency(r.base)} + ${formatCurrency(r.plus)} − ${formatCurrency(r.minus)} = <strong>${formatCurrency(r.total)}</strong>
        </div>

        <div class="deposit-base-row">
          <label for="baseAmount-${p}">基本入金額（円）</label>
          <input type="number" id="baseAmount-${p}" min="0" step="1000" inputmode="numeric"
            value="${r.base}" onchange="onBaseAmountChange('${p}', this)" />
        </div>

        <label class="deposit-check-row">
          <input type="checkbox" id="depositCheck-${p}" ${deposited ? 'checked' : ''}
            onchange="onDepositCheckedChange('${p}', this)" />
          <span class="deposit-check-text">${formatMonthLabel(month)}の入金は完了した</span>
          <span class="deposit-check-meta">${buildDepositMeta(status)}</span>
        </label>

        <div class="deposit-detail-grid">
          <section class="deposit-detail-section">
            <h3>＋ 家族財布で払った${name}分 <span>${formatCurrency(r.plus)}</span></h3>
            ${renderDepositItems(r.plusItems, `${name}分を家族財布で払った支出はありません`)}
          </section>
          <section class="deposit-detail-section">
            <h3>－ ${WALLETS[p]}で払った家族分 <span>${formatCurrency(r.minus)}</span></h3>
            ${renderDepositItems(r.minusItems, `家族分を${WALLETS[p]}で払った支出はありません`)}
          </section>
        </div>
      </div>`;
  }).join('');
}

// ── 世帯の収支（収入 − 支出） ──
function calcHousehold(month) {
  const list = combinedForMonth(month);
  const income = DEPOSIT_PERSONS.reduce((s, p) => s + (Number(cachedIncomes[p]) || 0), 0);
  const expense = sumAmount(list);
  const saving = sumAmount(list.filter(e => e.isSaving));
  return {
    income,
    expense,
    saving,
    profit: income - expense,
    profitExSaving: income - (expense - saving),
  };
}

function renderHousehold(month) {
  const el = document.getElementById('householdCard');
  if (!el) return;
  const h = calcHousehold(month);
  const sign = v => (v < 0 ? ' negative' : '');
  el.innerHTML = `
    <div class="household-header">
      <span class="household-title">${formatMonthLabel(month)}の世帯収支</span>
      <span class="household-profit${sign(h.profit)}">${formatCurrency(h.profit)}</span>
    </div>
    <div class="household-incomes">
      ${DEPOSIT_PERSONS.map(p => `
        <div class="household-income-row">
          <label for="income-${p}"><span class="badge badge-${p}">${CATEGORIES[p]}</span> 収入（円/月）</label>
          <input type="number" id="income-${p}" min="0" step="10000" inputmode="numeric"
            value="${Number(cachedIncomes[p]) || 0}" onchange="onIncomeChange('${p}', this)" />
        </div>`).join('')}
    </div>
    <div class="household-grid">
      <div class="household-cell">
        <div class="label">収入合計</div>
        <div class="value">${formatCurrency(h.income)}</div>
      </div>
      <div class="household-cell">
        <div class="label">支出合計（固定費込み）</div>
        <div class="value expense">${formatCurrency(h.expense)}</div>
      </div>
      <div class="household-cell">
        <div class="label">うち貯蓄</div>
        <div class="value saving">${formatCurrency(h.saving)}</div>
      </div>
      <div class="household-cell main">
        <div class="label">収益（収入 − 支出）</div>
        <div class="value${sign(h.profit)}">${formatCurrency(h.profit)}</div>
      </div>
      <div class="household-cell main">
        <div class="label">収益（貯蓄を除く）</div>
        <div class="value${sign(h.profitExSaving)}">${formatCurrency(h.profitExSaving)}</div>
      </div>
    </div>
    <p class="household-note">貯蓄＝固定費のうち「貯蓄」にした項目（既定: ideco・NISA・定期預金）。固定費の編集で変更できます。</p>`;
}

async function onIncomeChange(person, input) {
  const value = parseInt(input.value, 10);
  if (!Number.isFinite(value) || value < 0) {
    input.value = cachedIncomes[person];
    return;
  }
  try {
    await db.collection(COL_META).doc(META_DEPOSIT_SETTINGS_DOC).set({
      incomes: { [person]: value },
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    showToast(`${CATEGORIES[person]}の収入を保存しました`);
  } catch (err) {
    console.error(err);
    showToast('⚠️ 収入の保存に失敗しました');
  }
}

function renderDepositItems(items, emptyMessage) {
  if (items.length === 0) return `<div class="deposit-empty">${emptyMessage}</div>`;
  return items
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(e => `
      <div class="deposit-item${e.isFixedCost ? ' is-fixed' : ''}">
        <div>
          <div class="deposit-item-date">${formatDate(e.date)}${e.isFixedCost ? ' <span class="badge badge-fixed">固定費</span>' : ''}</div>
          <div class="deposit-item-name">${escapeHtml(e.item || '—')}${e.memo ? `<span class="muted"> · ${escapeHtml(e.memo)}</span>` : ''}</div>
        </div>
        <div class="deposit-item-amount">${formatCurrency(e.amount)}</div>
      </div>`).join('');
}

function buildDepositMeta(status) {
  if (status.deposited !== true) return '未入金';
  const checkedAt = status.checkedAt && typeof status.checkedAt.toDate === 'function' ? status.checkedAt.toDate() : null;
  const when = checkedAt ? formatDateTime(checkedAt) : '記録中…';
  const amount = Number.isFinite(status.amountAtCheck) ? ` ${formatCurrency(status.amountAtCheck)}` : '';
  return `入金済み${amount}（${when}）`;
}

function formatDateTime(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${formatDate(formatLocalDate(date))} ${h}:${mi}`;
}

async function onBaseAmountChange(person, input) {
  const value = parseInt(input.value, 10);
  if (!Number.isFinite(value) || value < 0) {
    input.value = cachedBaseAmounts[person];
    return;
  }
  try {
    await db.collection(COL_META).doc(META_DEPOSIT_SETTINGS_DOC).set({
      baseAmounts: { [person]: value },
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    showToast(`${CATEGORIES[person]}の基本入金額を保存しました`);
  } catch (err) {
    console.error(err);
    showToast('⚠️ 基本入金額の保存に失敗しました');
  }
}

async function onDepositCheckedChange(person, checkbox) {
  const month = depositState.month;
  const checked = checkbox.checked;
  const r = calcDeposit(month, person);
  checkbox.disabled = true;
  try {
    await db.collection(COL_META).doc(`${DEPOSIT_STATUS_PREFIX}${month}-${person}`).set({
      month,
      person,
      deposited: checked,
      checkedAt: checked ? firebase.firestore.FieldValue.serverTimestamp() : null,
      amountAtCheck: checked ? r.total : null,
      baseAtCheck: checked ? r.base : null,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    showToast(checked ? `${CATEGORIES[person]}の入金を記録しました` : `${CATEGORIES[person]}を未入金に戻しました`);
  } catch (err) {
    console.error(err);
    checkbox.checked = !checked;
    showToast('⚠️ 入金状態の更新に失敗しました');
  } finally {
    checkbox.disabled = false;
  }
}

// ── トースト ──
let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

// ── スマホ用スワイプ（カードを左にスワイプすると編集・削除ボタンが出る） ──
function initSwipe() {
  const cards = document.querySelectorAll('.mobile-card');

  const closeCard = card => {
    const content = card.querySelector('.card-content');
    if (!content) return;
    card.classList.remove('swiped');
    content.style.transform = 'translateX(0)';
  };
  const openCard = (card, width) => {
    const content = card.querySelector('.card-content');
    if (!content) return;
    card.classList.add('swiped');
    content.style.transform = `translateX(-${width}px)`;
  };

  cards.forEach(card => {
    const content = card.querySelector('.card-content');
    const actions = card.querySelector('.card-actions');
    if (!content || !actions) return;

    let startX = 0;
    let startTime = 0;
    const revealWidth = () => Math.ceil(actions.getBoundingClientRect().width);

    card.addEventListener('touchstart', e => {
      startX = e.touches[0].clientX;
      startTime = Date.now();
      cards.forEach(c => { if (c !== card) closeCard(c); });
    }, { passive: true });

    card.addEventListener('touchmove', e => {
      const diff = startX - e.touches[0].clientX;
      content.style.transform = diff <= 0 ? 'translateX(0)' : `translateX(-${Math.min(diff, revealWidth())}px)`;
    }, { passive: true });

    card.addEventListener('touchend', e => {
      const diff = startX - e.changedTouches[0].clientX;
      const duration = Date.now() - startTime;
      const width = revealWidth();
      if ((diff > 30 && duration < 500) || diff > width / 2) openCard(card, width);
      else closeCard(card);
    });

    content.addEventListener('click', e => {
      if (!e.target.closest('button')) closeCard(card);
    });
  });
}

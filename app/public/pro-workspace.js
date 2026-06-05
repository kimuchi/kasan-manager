// Pro ワークスペース（/pro）: ネイティブログイン + 書類ワークスペース + 名簿流用 + 管理者。
//
// - ネイティブ（ユーザー名/パスワード）ログイン。OAuth(Firebase) は app.js が担当（併存）。
// - 書類はブラウザ内で解析（フォルダ選択・ドラッグ&ドロップ・複数回に分けて追加）し、
//   匿名集計バンドルだけをサーバのドラフトに合算 → 解析実行。生ファイルは送らない。
// - 従業員名簿は匿名化して保存・流用・編集できる。
// - 管理者は有料ユーザーを管理できる。
//
// サーバ保存はすべて匿名化・要約済み（サーバ側でも再度匿名化）。

import {
  pickFiles,
  processFilesInto,
  newCollected,
  collectedToBundle,
} from './local/browser-extract.js';

const $ = (id) => document.getElementById(id);

const state = {
  csrfToken: null,
  csrfHeader: 'x-csrf-token',
  me: null,
  facilities: [],
  rosters: [],
  draft: null, // 現在の作業ドラフト
  collected: newCollected(), // まだドラフトに追加していない取り込み
};

const PROFESSIONS = [
  ['介護福祉士', '介護福祉士'],
  ['看護師', '看護師'],
  ['准看護師', '准看護師'],
  ['理学療法士', '理学療法士'],
  ['作業療法士', '作業療法士'],
  ['言語聴覚士', '言語聴覚士'],
  ['介護支援専門員', 'ケアマネ'],
  ['主任介護支援専門員', '主任ケアマネ'],
  ['管理栄養士', '管理栄養士'],
  ['栄養士', '栄養士'],
  ['歯科衛生士', '歯科衛生士'],
];

const SERVICES = [
  ['', '— レセプトから自動判定 —'],
  ['tsusho_kaigo', '通所介護'],
  ['houmon_kaigo', '訪問介護'],
  ['houmon_kango_kaigo', '訪問看護（介護保険）'],
  ['kyotaku_shien', '居宅介護支援'],
  ['sogoubu_tsusho', '通所型独自サービス（総合事業）'],
];

// ---------------- API ヘルパ ----------------
async function api(path, { method = 'GET', body = null } = {}) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (method !== 'GET' && state.csrfToken) headers[state.csrfHeader] = state.csrfToken;
  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let json = {};
  try {
    json = await res.json();
  } catch {
    /* noop */
  }
  if (!res.ok) {
    const err = new Error(json.message || json.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return json;
}

// multipart（生ファイル送信）用。content-type はブラウザに任せる（boundary 自動付与のため）。
async function apiForm(path, formData) {
  const headers = {};
  if (state.csrfToken) headers[state.csrfHeader] = state.csrfToken;
  const res = await fetch(path, {
    method: 'POST',
    headers,
    body: formData,
    credentials: 'same-origin',
  });
  let json = {};
  try {
    json = await res.json();
  } catch {
    /* noop */
  }
  if (!res.ok) {
    const err = new Error(json.message || json.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return json;
}

// ---------------- 起動 ----------------
init();

async function init() {
  if (!$('pw-root')) return; // /pro 以外では何もしない
  try {
    const health = await api('/api/health');
    state.csrfToken = health.csrf?.token || null;
    state.csrfHeader = health.csrf?.header_name || 'x-csrf-token';
    state.cposLoginEnabled = Boolean(health.auth?.cpos_login_enabled);
    if (!state.cposLoginEnabled) {
      $('pw-auth-msg').textContent =
        'CPOS ログインが未設定です。管理者が CPOS アプリ登録（App Token）と KASAN_SESSION_SECRET / CPOS URL を設定すると有効になります。';
    }
  } catch {
    /* health 失敗時も UI は出す */
  }
  fillSelect($('pw-service'), SERVICES);
  const now = new Date();
  $('pw-month').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  wireAuth();
  wireWorkspace();
  wireRoster();
  wireAdmin();
  await refreshMe();
}

function wireAdmin() {
  const close = $('pw-ud-close');
  if (close) close.addEventListener('click', () => $('pw-user-detail').classList.add('hidden'));
}

function fillSelect(sel, pairs) {
  if (!sel) return;
  sel.innerHTML = '';
  for (const [value, label] of pairs) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    sel.appendChild(o);
  }
}

// ---------------- 認証（CPOS ログイン一本化）----------------
function wireAuth() {
  // メール/パスワードのネイティブ認証は廃止。CPOS の同意画面へ遷移する。
  const loginBtn = $('pw-login');
  if (loginBtn) {
    loginBtn.textContent = 'CPOS でログイン';
    loginBtn.addEventListener('click', () => {
      window.location.href = '/api/auth/cpos/start';
    });
  }
  // 旧フォーム要素は隠す
  ['pw-register', 'pw-email', 'pw-password', 'pw-name'].forEach((id) => {
    const el = $(id);
    if (el) {
      const field = el.closest('.field') || el;
      field.classList.add('hidden');
      el.classList.add('hidden');
    }
  });
  const logout = $('pw-logout');
  if (logout) {
    logout.addEventListener('click', async () => {
      await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
      await refreshMe();
    });
  }
}

async function refreshMe() {
  let me = null;
  try {
    const r = await api('/api/me');
    me = r.authenticated ? r : null;
  } catch {
    me = null;
  }
  state.me = me;
  const loggedIn = Boolean(me);
  $('pw-auth-loggedout').classList.toggle('hidden', loggedIn);
  $('pw-auth-loggedin').classList.toggle('hidden', !loggedIn);
  $('pw-app').classList.toggle('hidden', !loggedIn);
  $('pw-admin').classList.toggle('hidden', !(me && me.isAdmin));
  if (loggedIn) {
    $('pw-whoami').textContent = `${me.email}（${me.planTier === 'paid' ? '有料プラン' : '無料'}）`;
    await Promise.all([refreshFacilities(), refreshRosters(), refreshDrafts()]);
    if (me.isAdmin) await refreshUsers();
  }
}

// ---------------- 施設プロフィール ----------------
async function refreshFacilities() {
  const r = await api('/api/profiles/facilities').catch(() => ({ facilities: [] }));
  state.facilities = r.facilities || [];
  const sel = $('pw-facility');
  fillSelect(
    sel,
    [['', '— 施設を選択（任意・保存して流用） —'], ...state.facilities.map((f) => [f.id, f.name || f.officeCode || f.id])],
  );
}

function wireWorkspace() {
  $('pw-fac-save').addEventListener('click', async () => {
    const body = {
      name: $('pw-fac-name').value.trim(),
      officeCode: $('pw-fac-office').value.trim(),
      serviceKey: $('pw-service').value || null,
      regionGrade: $('pw-fac-grade').value.trim(),
    };
    try {
      const r = await api('/api/profiles/facilities', { method: 'POST', body });
      await refreshFacilities();
      $('pw-facility').value = r.facility.id;
      flash($('pw-fac-msg'), '施設プロフィールを保存しました。');
    } catch (err) {
      flash($('pw-fac-msg'), `エラー: ${err.message}`);
    }
  });

  // フォルダ選択 / ファイル選択
  $('pw-pick-folder').addEventListener('click', async () => {
    const files = await pickFiles({ onFallbackInput: () => clickFileInput() });
    if (files && files.length) await ingest(files);
  });
  $('pw-file-input').addEventListener('change', (e) => ingest([...e.target.files]));

  // ドラッグ&ドロップ
  const dz = $('pw-drop');
  ['dragenter', 'dragover'].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.add('pw-drop-over');
    }),
  );
  ['dragleave', 'drop'].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.remove('pw-drop-over');
    }),
  );
  dz.addEventListener('drop', async (e) => {
    const files = await filesFromDataTransfer(e.dataTransfer);
    if (files.length) await ingest(files);
  });
  dz.addEventListener('click', () => clickFileInput());

  $('pw-add-draft').addEventListener('click', addToDraft);
  $('pw-analyze').addEventListener('click', runAnalysis);
  $('pw-new-draft').addEventListener('click', async () => {
    state.draft = null;
    state.collected = newCollected();
    $('pw-files').innerHTML = '';
    renderDraftSummary();
    flash($('pw-draft-msg'), '新しい作業ドラフトを開始しました。');
  });
}

function clickFileInput() {
  $('pw-file-input').click();
  return [];
}

// ドラッグ&ドロップのフォルダ展開（webkit getAsFileSystemEntry）
async function filesFromDataTransfer(dt) {
  const out = [];
  const items = dt.items ? [...dt.items] : [];
  const entries = items.map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null)).filter(Boolean);
  if (entries.length) {
    for (const entry of entries) await walkEntry(entry, out);
  } else {
    for (const f of dt.files || []) out.push(f);
  }
  return out;
}

async function walkEntry(entry, out, depth = 0) {
  if (depth > 4) return;
  if (entry.isFile) {
    await new Promise((resolve) => entry.file((f) => (out.push(f), resolve()), () => resolve()));
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    const batch = await new Promise((resolve) => reader.readEntries((e) => resolve(e), () => resolve([])));
    for (const child of batch) await walkEntry(child, out, depth + 1);
  }
}

// 取り込み: PDF は常にサーバで解析（デジタルは pdf-parse、スキャンはサーバOCR）。
// Excel/CSV/画像はブラウザ内で解析（画像のOCRはチェックボックスで制御）。
async function ingest(files) {
  const ocr = $('pw-ocr').checked;
  const all = [...files].filter((f) => f && f.name);
  const pdfs = all.filter((f) => /\.pdf$/i.test(f.name));
  const nonPdf = all.filter((f) => !/\.pdf$/i.test(f.name));
  if (pdfs.length) await ingestPdfsToServer(pdfs);
  if (nonPdf.length) await ingestInBrowser(nonPdf, ocr);
}

function appendFileRow(name, label) {
  const list = $('pw-files');
  const li = document.createElement('li');
  const n = document.createElement('span');
  n.textContent = name;
  const b = document.createElement('span');
  b.className = `pw-badge ${label.cls}`;
  b.textContent = label.text;
  li.append(n, b);
  list.appendChild(li);
  return li;
}

// ブラウザ内解析（Excel/CSV/画像、OCR時はPDFも）→ collected に蓄積
async function ingestInBrowser(files, ocr) {
  await processFilesInto(files, state.collected, {
    ocr,
    onProgress: (name, label) => appendFileRow(name, label),
  });
  const c = state.collected;
  $('pw-collected-note').textContent =
    `未追加の取り込み: レセプト${c.receiptTexts.length}・利用者集計${c.userSummaries.length}・職員集計${c.staffSummaries.length}` +
    (c.detectedServiceKey ? `（推定: ${c.detectedServiceKey}）` : '');
}

// レセプトPDF をサーバへ送って解析（pdf-parse）→ ドラフトへ即反映。生PDFはサーバに保存しない。
async function ingestPdfsToServer(pdfs) {
  const serviceKey = $('pw-service').value || state.collected.detectedServiceKey || state.draft?.serviceKey;
  if (!serviceKey) {
    for (const f of pdfs) {
      appendFileRow(f.name, { text: 'サービス種別を選択してください（PDFはサーバ解析）', cls: 'warn' });
    }
    flash($('pw-draft-msg'), 'PDFのサーバ解析にはサービス種別の選択が必要です。プルダウンで選んでください。');
    return;
  }
  let draft;
  try {
    draft = await ensureDraft();
  } catch (err) {
    flash($('pw-draft-msg'), `エラー: ${err.message}`);
    return;
  }
  const rows = pdfs.map((f) => appendFileRow(f.name, { text: 'サーバ解析中…', cls: 'ok' }));
  const fd = new FormData();
  for (const f of pdfs) fd.append('pdf', f, f.name);
  fd.append('serviceKey', serviceKey);
  if ($('pw-month').value) fd.append('serviceMonth', $('pw-month').value);
  try {
    const r = await apiForm(`/api/drafts/${draft.id}/ingest-pdf`, fd);
    state.draft = r.draft;
    const byName = new Map((r.ingested || []).map((it) => [it.file, it]));
    pdfs.forEach((f, i) => {
      const badge = rows[i].querySelector('.pw-badge');
      const it = byName.get(f.name);
      if (!it) return;
      if (it.error) {
        badge.textContent = `失敗: ${it.error}`;
        badge.className = 'pw-badge warn';
        return;
      }
      const warn = (it.warnings || []).length ? `・注意: ${it.warnings.join(' / ')}` : '';
      badge.textContent = `サーバ解析 → 加算${it.kasanDetected}種を検出（ドラフト反映済）${warn}`;
      badge.className = `pw-badge ${it.kasanDetected ? 'ok' : 'warn'}`;
    });
    renderDraftSummary();
    flash($('pw-draft-msg'), 'PDFをサーバで解析し、ドラフトに反映しました。');
  } catch (err) {
    for (const row of rows) {
      const badge = row.querySelector('.pw-badge');
      badge.textContent = `失敗: ${err.message}`;
      badge.className = 'pw-badge warn';
    }
    flash($('pw-draft-msg'), `PDFのサーバ解析でエラー: ${err.message}`);
  }
}

async function ensureDraft() {
  if (state.draft) return state.draft;
  const body = {
    serviceKey: $('pw-service').value || state.collected.detectedServiceKey || null,
    serviceMonth: $('pw-month').value || null,
    facilityId: $('pw-facility').value || null,
  };
  const r = await api('/api/drafts', { method: 'POST', body });
  state.draft = r.draft;
  return state.draft;
}

async function addToDraft() {
  const c = state.collected;
  if (!c.receiptTexts.length && !c.userSummaries.length && !c.staffSummaries.length) {
    flash($('pw-draft-msg'), '追加できる取り込みがありません。先に書類を取り込んでください。');
    return;
  }
  try {
    const serviceKey = $('pw-service').value || c.detectedServiceKey;
    const serviceMonth = $('pw-month').value;
    const bundle = collectedToBundle(c, { serviceKey, serviceMonth });
    const draft = await ensureDraft();
    const r = await api(`/api/drafts/${draft.id}/merge`, { method: 'POST', body: { bundle } });
    state.draft = r.draft;
    state.collected = newCollected(); // 追加済みはクリア（少しずつ追加）
    $('pw-files').innerHTML = '';
    $('pw-collected-note').textContent = '';
    renderDraftSummary();
    flash($('pw-draft-msg'), 'ドラフトに追加しました。続けて別の書類を取り込めます。');
  } catch (err) {
    flash($('pw-draft-msg'), `エラー: ${err.message}`);
  }
}

function renderDraftSummary() {
  const el = $('pw-draft-summary');
  const d = state.draft;
  if (!d) {
    el.textContent = 'ドラフト未作成';
    $('pw-analyze').disabled = true;
    return;
  }
  const u = d.userSummary ? `利用者${d.userSummary.activeUserCount ?? '?'}名` : '利用者未取込';
  const kasan = d.claimEvidence?.evidence?.[0]?.current_kasan_counts
    ? `加算${Object.keys(d.claimEvidence.evidence[0].current_kasan_counts).length}種`
    : '加算未取込';
  const staff = d.staffSummary ? '職員集計あり' : '職員未取込';
  el.textContent = `ドラフト: ${d.serviceKey || '種別未定'} / ${d.serviceMonth || '月未定'} ・ 取込${d.contributedCount}回 ・ ${u} ・ ${kasan} ・ ${staff}`;
  $('pw-analyze').disabled = false;
}

async function runAnalysis() {
  if (!state.draft) return;
  $('pw-report').innerHTML = '解析中…';
  try {
    const r = await api(`/api/drafts/${state.draft.id}/analyze`, { method: 'POST', body: {} });
    $('pw-report').innerHTML = renderMarkdownLite(r.reportMarkdown || '(レポートなし)');
    const persisted = r.persisted ? '（履歴に保存しました）' : '（無料プランのため履歴未保存）';
    flash($('pw-draft-msg'), `解析が完了しました。${persisted}`);
  } catch (err) {
    $('pw-report').textContent = `エラー: ${err.message}`;
  }
}

async function refreshDrafts() {
  const r = await api('/api/drafts').catch(() => ({ drafts: [] }));
  const list = $('pw-drafts-list');
  list.innerHTML = '';
  for (const d of r.drafts || []) {
    const li = document.createElement('li');
    li.textContent = `${d.label || d.id.slice(0, 8)} — ${d.serviceKey || '種別未定'} / ${d.serviceMonth || '-'} （取込${d.contributedCount}回）`;
    const use = document.createElement('button');
    use.className = 'ghost-btn';
    use.textContent = '続きから';
    use.addEventListener('click', () => {
      state.draft = d;
      renderDraftSummary();
      flash($('pw-draft-msg'), 'このドラフトを選択しました。');
    });
    const del = document.createElement('button');
    del.className = 'ghost-btn';
    del.textContent = '削除';
    del.addEventListener('click', async () => {
      await api(`/api/drafts/${d.id}`, { method: 'DELETE' }).catch(() => {});
      if (state.draft?.id === d.id) state.draft = null;
      await refreshDrafts();
      renderDraftSummary();
    });
    li.append(' ', use, ' ', del);
    list.appendChild(li);
  }
}

// ---------------- 従業員名簿（匿名化して保存・流用） ----------------
function wireRoster() {
  $('pw-roster-add-row').addEventListener('click', () => addRosterRow());
  addRosterRow();
  $('pw-roster-save').addEventListener('click', saveRoster);
}

function addRosterRow(preset = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'pw-roster-row';
  const prof = document.createElement('select');
  fillSelect(prof, PROFESSIONS);
  if (preset.qualification) prof.value = preset.qualification;
  const fte = document.createElement('input');
  fte.type = 'number';
  fte.step = '0.1';
  fte.min = '0';
  fte.max = '2';
  fte.value = preset.fte ?? '1';
  fte.style.width = '70px';
  const joukin = document.createElement('label');
  const jk = document.createElement('input');
  jk.type = 'checkbox';
  jk.checked = preset.joukin ?? true;
  joukin.append(jk, document.createTextNode(' 常勤'));
  const rm = document.createElement('button');
  rm.className = 'ghost-btn';
  rm.textContent = '×';
  rm.addEventListener('click', () => wrap.remove());
  wrap._get = () => ({ qualification: prof.value, fte: Number(fte.value), joukin: jk.checked });
  wrap.append(prof, fte, joukin, rm);
  $('pw-roster-rows').appendChild(wrap);
}

async function saveRoster() {
  const rows = [...$('pw-roster-rows').querySelectorAll('.pw-roster-row')].map((r) => r._get());
  const body = {
    label: $('pw-roster-label').value.trim() || '従業員名簿',
    serviceKey: $('pw-service').value || null,
    entries: rows,
  };
  try {
    await api('/api/profiles/staff-rosters', { method: 'POST', body });
    await refreshRosters();
    flash($('pw-roster-msg'), '従業員名簿を保存しました（氏名は保存されません）。');
  } catch (err) {
    flash($('pw-roster-msg'), `エラー: ${err.message}`);
  }
}

async function refreshRosters() {
  const r = await api('/api/profiles/staff-rosters').catch(() => ({ rosters: [] }));
  state.rosters = r.rosters || [];
  const list = $('pw-roster-list');
  list.innerHTML = '';
  for (const roster of state.rosters) {
    const li = document.createElement('li');
    const counts = Object.entries(roster.qualifiedPersonCountByProfession || {})
      .map(([k, v]) => `${k}:${v}`)
      .join(' ');
    li.textContent = `${roster.label}（${roster.headcount}名 ${counts}）`;
    const use = document.createElement('button');
    use.className = 'ghost-btn';
    use.textContent = 'この名簿をドラフトに使う';
    use.addEventListener('click', async () => {
      try {
        const draft = await ensureDraft();
        await api(`/api/drafts/${draft.id}/merge`, {
          method: 'POST',
          body: {
            bundle: {
              staffSummary: {
                qualifiedPersonCountByProfession: roster.qualifiedPersonCountByProfession || {},
                fteByProfession: roster.fteByProfession || {},
              },
            },
          },
        });
        const fresh = await api(`/api/drafts/${draft.id}`);
        state.draft = fresh.draft;
        renderDraftSummary();
        flash($('pw-roster-msg'), '名簿の職種別集計をドラフトに追加しました。');
      } catch (err) {
        flash($('pw-roster-msg'), `エラー: ${err.message}`);
      }
    });
    const edit = document.createElement('button');
    edit.className = 'ghost-btn';
    edit.textContent = '編集';
    edit.addEventListener('click', () => loadRosterIntoEditor(roster));
    li.append(' ', use, ' ', edit);
    list.appendChild(li);
  }
}

function loadRosterIntoEditor(roster) {
  $('pw-roster-label').value = roster.label || '';
  $('pw-roster-rows').innerHTML = '';
  // 集計から行を復元（職種ごとに人数分の行）
  const jpByKey = {
    care_worker: '介護福祉士',
    nurse: '看護師',
    assistant_nurse: '准看護師',
    physical_therapist: '理学療法士',
    occupational_therapist: '作業療法士',
    speech_therapist: '言語聴覚士',
    care_manager: '介護支援専門員',
    chief_care_manager: '主任介護支援専門員',
    registered_dietitian: '管理栄養士',
    dietitian: '栄養士',
    dental_hygienist: '歯科衛生士',
  };
  let any = false;
  for (const [key, count] of Object.entries(roster.qualifiedPersonCountByProfession || {})) {
    for (let i = 0; i < count; i += 1) {
      addRosterRow({ qualification: jpByKey[key] || '介護福祉士' });
      any = true;
    }
  }
  if (!any) addRosterRow();
  flash($('pw-roster-msg'), '名簿をエディタに読み込みました。編集して保存すると新規保存されます。');
}

// ---------------- 管理者: 集計ダッシュボード + ユーザー利用状況 ----------------
const SERVICE_LABELS = {
  tsusho_kaigo: '通所介護',
  houmon_kaigo: '訪問介護',
  houmon_kango_kaigo: '訪問看護（介護保険）',
  kyotaku_shien: '居宅介護支援',
  sogoubu_tsusho: '通所型独自サービス',
};

function fmtDateTime(iso) {
  if (!iso) return '-';
  const s = String(iso);
  return s.length >= 16 ? s.slice(0, 16).replace('T', ' ') : s;
}

function pct(num, denom) {
  if (!denom) return '0%';
  return `${Math.round((num / denom) * 100)}%`;
}

function statCard(label, value, sub = '') {
  const el = document.createElement('div');
  el.className = 'pw-stat';
  el.innerHTML =
    `<div class="pw-stat-label">${escapeHtml(label)}</div>` +
    `<div class="pw-stat-value">${escapeHtml(String(value))}</div>` +
    (sub ? `<div class="pw-stat-sub">${escapeHtml(sub)}</div>` : '');
  return el;
}

async function refreshUsers() {
  // 集計ダッシュボード + ユーザー一覧をまとめて取得
  const [statsResp, usersResp] = await Promise.all([
    api('/api/admin/stats').catch(() => ({ stats: null })),
    api('/api/admin/users').catch(() => ({ users: [] })),
  ]);
  renderAdminStats(statsResp.stats);
  renderAdminUsers(usersResp.users || []);
}

function renderAdminStats(stats) {
  const wrap = $('pw-stats');
  wrap.innerHTML = '';
  if (!stats) {
    wrap.textContent = '集計データを取得できませんでした。';
    return;
  }
  const activeLabel = stats.users.active_last_30_days == null ? '—' : `直近30日アクティブ ${stats.users.active_last_30_days}`;
  const paidVal = stats.users.paid_active == null ? '—' : stats.users.paid_active;
  wrap.append(
    statCard('CPOS 組織ユーザー', stats.users.total, activeLabel),
    statCard('有料（エンタイトルメント）', paidVal, '詳細は各ユーザーで確認'),
    statCard('認証', 'CPOS', 'CPOS ログイン一本化'),
    statCard('総解析数', stats.analyses.total, `直近30日 ${stats.analyses.last_30_days}`),
  );
  const top = Object.entries(stats.analyses.by_service || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  if (top.length) {
    const sub = top.map(([k, v]) => `${SERVICE_LABELS[k] || k}: ${v}`).join(' / ');
    wrap.appendChild(statCard('サービス別 TOP', top[0][1], sub));
  }
}

const _detailCache = new Map();

function renderAdminUsers(users) {
  const tbody = $('pw-users');
  tbody.innerHTML = '';
  for (const u of users) {
    const tr = document.createElement('tr');
    const tier = u.planTier === 'paid' ? `有料（〜${(u.planExpiresAt || '').slice(0, 10)}）` : '無料';
    const lastLogin = (u.lastLoginAt || '').slice(0, 10) || '-';
    const created = (u.createdAt || '').slice(0, 10);
    tr.innerHTML =
      `<td>${escapeHtml(u.email || u.uid)}${u.isAdmin ? ' <small>(管理者)</small>' : ''}</td>` +
      `<td>${escapeHtml(u.authProvider)}</td>` +
      `<td>${escapeHtml(tier)}</td>` +
      `<td class="pw-ud-an-count">…</td>` +
      `<td>${escapeHtml(lastLogin)}</td>` +
      `<td>${escapeHtml(created)}</td>`;
    const actions = document.createElement('td');
    const detail = document.createElement('button');
    detail.className = 'ghost-btn';
    detail.textContent = '詳細';
    detail.addEventListener('click', () => openUserDetail(u.uid));
    const grant = document.createElement('button');
    grant.className = 'ghost-btn';
    grant.textContent = '+30日';
    grant.addEventListener('click', () => setPlan(u.uid, 'grant', 30));
    const revoke = document.createElement('button');
    revoke.className = 'ghost-btn';
    revoke.textContent = '取消';
    revoke.addEventListener('click', () => setPlan(u.uid, 'revoke', 0));
    actions.append(detail, ' ', grant, ' ', revoke);
    tr.appendChild(actions);
    tbody.appendChild(tr);
    fillAnalysisCount(tr, u.uid);
  }
}

async function fillAnalysisCount(tr, uid) {
  let d = _detailCache.get(uid);
  if (!d) {
    try {
      const r = await api(`/api/admin/users/${uid}`);
      d = r.detail;
      _detailCache.set(uid, d);
    } catch {
      const cell = tr.querySelector('.pw-ud-an-count');
      if (cell) cell.textContent = '?';
      return;
    }
  }
  const cell = tr.querySelector('.pw-ud-an-count');
  if (cell) cell.textContent = String(d.counts.analyses);
}

async function openUserDetail(uid) {
  const panel = $('pw-user-detail');
  panel.classList.remove('hidden');
  $('pw-ud-title').textContent = 'ユーザー詳細を読み込み中…';
  $('pw-ud-meta').innerHTML = '';
  $('pw-ud-counts').innerHTML = '';
  $('pw-ud-by-service').innerHTML = '';
  $('pw-ud-analyses').innerHTML = '';
  $('pw-ud-codes').innerHTML = '';
  $('pw-ud-audits').innerHTML = '';
  try {
    const r = await api(`/api/admin/users/${uid}`);
    _detailCache.set(uid, r.detail);
    renderUserDetail(r.detail);
  } catch (err) {
    $('pw-ud-title').textContent = `エラー: ${err.message}`;
  }
}

function renderUserDetail(d) {
  const u = d.user;
  $('pw-ud-title').textContent = `ユーザー詳細: ${u.email || u.uid}`;
  const tier = u.planTier === 'paid' ? `有料（〜${(u.planExpiresAt || '').slice(0, 10)}）` : '無料';
  $('pw-ud-meta').innerHTML =
    `<div>uid: <code>${escapeHtml(u.uid)}</code> ・ 認証: ${escapeHtml(u.authProvider)} ・ ${escapeHtml(tier)}${u.isAdmin ? ' ・ 管理者' : ''}</div>` +
    `<div>表示名: ${escapeHtml(u.displayName || '-')} ・ 登録: ${escapeHtml(fmtDateTime(u.createdAt))} ・ 最終ログイン: ${escapeHtml(fmtDateTime(u.lastLoginAt))}</div>` +
    `<div>最終解析: ${escapeHtml(fmtDateTime(d.last_analysis_at))}</div>`;

  $('pw-ud-counts').append(
    statCard('解析実行', d.counts.analyses),
    statCard('ドラフト', d.counts.drafts),
    statCard('施設プロフィール', d.counts.facilities),
    statCard('保存名簿', d.counts.rosters),
    statCard('redeem コード', d.counts.redeemed_codes),
  );

  const bySvc = $('pw-ud-by-service');
  const svcEntries = Object.entries(d.analyses_by_service || {}).sort((a, b) => b[1] - a[1]);
  if (!svcEntries.length) bySvc.innerHTML = '<li>解析実行履歴はありません。</li>';
  for (const [k, v] of svcEntries) {
    const li = document.createElement('li');
    li.textContent = `${SERVICE_LABELS[k] || k}: ${v}件`;
    bySvc.appendChild(li);
  }

  const an = $('pw-ud-analyses');
  if (!d.recent_analyses.length) {
    an.innerHTML = '<tr><td colspan="6">履歴なし</td></tr>';
  } else {
    for (const a of d.recent_analyses) {
      const c = a.summary_counts || {};
      const tr = document.createElement('tr');
      tr.innerHTML =
        `<td>${escapeHtml(fmtDateTime(a.created_at))}</td>` +
        `<td>${escapeHtml(SERVICE_LABELS[a.service] || a.service || '-')}</td>` +
        `<td>${escapeHtml(a.source_type || '-')}</td>` +
        `<td>${escapeHtml(a.review_status || '-')}</td>` +
        `<td>${escapeHtml(String(a.kasan_count ?? '-'))}</td>` +
        `<td>${escapeHtml(`${c.clear ?? 0}/${c.waiting ?? 0}/${c.unknown ?? 0}`)}</td>`;
      an.appendChild(tr);
    }
  }

  const codes = $('pw-ud-codes');
  if (!d.redeemed_codes.length) codes.innerHTML = '<li>redeem 履歴はありません。</li>';
  for (const c of d.redeemed_codes) {
    const li = document.createElement('li');
    li.textContent = `${c.code}（${c.durationDays}日分・${fmtDateTime(c.redeemedAt)}${c.note ? ' / ' + c.note : ''}）`;
    codes.appendChild(li);
  }

  const audits = $('pw-ud-audits');
  if (!d.recent_audits.length) audits.innerHTML = '<li>監査ログはありません。</li>';
  for (const a of d.recent_audits) {
    const li = document.createElement('li');
    const detail = a.detail ? ` ・ ${JSON.stringify(a.detail).slice(0, 120)}` : '';
    li.textContent = `[${fmtDateTime(a.at)}] ${a.event_type}${detail}`;
    audits.appendChild(li);
  }
}

async function setPlan(uid, action, days) {
  try {
    await api(`/api/admin/users/${uid}/plan`, { method: 'POST', body: { action, days } });
    _detailCache.delete(uid);
    await refreshUsers();
  } catch (err) {
    flash($('pw-admin-msg'), `エラー: ${err.message}`);
  }
}

// ---------------- 補助 ----------------
function flash(el, msg) {
  if (!el) return;
  el.textContent = msg;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// サーバ Markdown を軽量 HTML に（見出し/箇条書き/強調/コード/テーブル）
function renderMarkdownLite(md) {
  const lines = String(md).split('\n');
  const html = [];
  let inList = false;
  const inline = (t) =>
    escapeHtml(t)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  const flushList = () => {
    if (inList) {
      html.push('</ul>');
      inList = false;
    }
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushList();
      html.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      continue;
    }
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) {
      if (!inList) {
        html.push('<ul>');
        inList = true;
      }
      html.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    flushList();
    if (line.trim() === '') html.push('');
    else html.push(`<p>${inline(line)}</p>`);
  }
  flushList();
  return html.join('\n');
}

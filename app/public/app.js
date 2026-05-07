/* eslint-env browser */

const $ = (sel) => document.querySelector(sel);

const STATUS_LABEL = {
  ready: '✅ 取得可能',
  waiting: '⏸ 確認待ち',
  blocked: '❌ 要件未充足',
  unknown: '❔ 情報不足',
};

const DOMAIN_LABEL = {
  kaigo: '介護保険',
  medical: '医療保険',
  disability: '障害福祉',
};

document.addEventListener('DOMContentLoaded', () => {
  initStatusPill();
  initServices();
  initFileInput();
  initAnalyzeButton();
});

async function initStatusPill() {
  const pill = $('#status-pill');
  const text = $('#status-text');
  try {
    const res = await fetch('/api/health');
    const json = await res.json();
    if (json.gemini_configured) {
      pill.classList.add('ok');
      text.textContent = `Gemini 接続OK（${json.model}）`;
    } else {
      pill.classList.add('error');
      text.textContent = 'Gemini API キー未設定';
    }
  } catch (err) {
    pill.classList.add('error');
    text.textContent = '接続エラー';
  }
}

async function initServices() {
  const select = $('#service');
  const hint = $('#service-hint');
  try {
    const res = await fetch('/api/services');
    const { services } = await res.json();
    select.innerHTML = '<option value="">— サービスを選択 —</option>';
    const grouped = {
      kaigo: { label: '介護保険', items: [] },
      medical: { label: '医療保険', items: [] },
      disability: { label: '障害福祉', items: [] },
    };
    for (const s of services) {
      (grouped[s.domain] || (grouped[s.domain] = { label: s.domain_label, items: [] })).items.push(s);
    }
    for (const [domain, group] of Object.entries(grouped)) {
      if (!group.items.length) continue;
      const og = document.createElement('optgroup');
      og.label = `【${group.label}】`;
      for (const s of group.items) {
        const opt = document.createElement('option');
        opt.value = s.service_key;
        opt.textContent = `${s.display_name}（${s.status_label || s.status}）`;
        opt.dataset.domain = domain;
        opt.dataset.status = s.status;
        og.appendChild(opt);
      }
      select.appendChild(og);
    }
    hint.textContent = `${services.length}サービスを読み込みました。介護保険・障害福祉どちらにも対応しています。`;
  } catch (err) {
    hint.textContent = `サービスの取得に失敗しました: ${err.message}`;
  }
}

function initFileInput() {
  const input = $('#attachments');
  const list = $('#file-list');
  input.addEventListener('change', () => {
    list.innerHTML = '';
    for (const file of input.files) {
      const li = document.createElement('li');
      li.textContent = `${file.name}（${humanFileSize(file.size)}）`;
      list.appendChild(li);
    }
  });
}

function humanFileSize(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

function initAnalyzeButton() {
  const btn = $('#analyze-btn');
  btn.addEventListener('click', async () => {
    const service = $('#service').value;
    if (!service) {
      alert('対象サービスを選択してください。');
      return;
    }
    runAnalyze(btn);
  });
}

async function runAnalyze(btn) {
  hide('#error-section');
  hide('#result-section');

  const formData = new FormData();
  formData.append('service', $('#service').value);
  formData.append('office_name', $('#office_name').value);
  formData.append('office_code', $('#office_code').value);
  formData.append('region', $('#region').value);
  formData.append('staff_summary', $('#staff_summary').value);
  formData.append('user_summary', $('#user_summary').value);
  formData.append('current_kasans', $('#current_kasans').value);
  formData.append('concerns', $('#concerns').value);
  formData.append('free_text', '');

  const files = $('#attachments').files;
  for (const f of files) formData.append('attachments', f);

  const originalLabel = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span><span>分析中…（10〜30秒）</span>';

  try {
    const res = await fetch('/api/analyze', { method: 'POST', body: formData });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json.error || `HTTP ${res.status}`);
    }
    renderResult(json);
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalLabel;
  }
}

function showError(msg) {
  $('#error-text').textContent = msg;
  show('#error-section');
  $('#error-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderResult(payload) {
  show('#result-section');

  const meta = $('#result-meta');
  const svc = payload.service || {};
  meta.innerHTML = `
    <div>
      <strong>${escapeHtml(svc.display_name || '?')}</strong>
      ${domainTag(svc.domain)}
      <span class="status-tag">マスタ版 ${escapeHtml(svc.master_version || '-')}</span>
      <span class="status-tag">改定 ${escapeHtml(svc.revision_tag || '-')}</span>
      <span class="status-tag">model: ${escapeHtml(payload.model || '-')}</span>
    </div>
  `;

  const a = payload.analysis;
  if (!a) {
    $('#result-summary').textContent = 'AI 応答を JSON として解釈できませんでした。生レスポンスをご確認ください。';
    $('#result-revenue').textContent = '';
    $('#result-actions').innerHTML = '';
    $('#result-candidates').innerHTML = '';
    $('#result-cautions').innerHTML = '';
    $('#result-assumptions').innerHTML = '';
  } else {
    $('#result-summary').textContent = a.summary || '（要約なし）';
    $('#result-revenue').textContent = a.estimated_total_revenue_increase
      ? `💰 増収見込み: ${a.estimated_total_revenue_increase}`
      : '';

    $('#result-actions').innerHTML = (a.top_actions || [])
      .map(
        (act) => `
      <div class="action-item">
        <h4>${escapeHtml(act.title || '')}</h4>
        <div class="why">${escapeHtml(act.why || '')}</div>
        <ol>${(act.steps || []).map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ol>
      </div>`,
      )
      .join('') || '<p>アクション提案がありません。</p>';

    $('#result-candidates').innerHTML = (a.candidates || [])
      .map((c) => candidateBlock(c))
      .join('') || '<p>取得候補が見つかりませんでした。</p>';

    $('#result-cautions').innerHTML = (a.cautions || [])
      .map((c) => `<li>${escapeHtml(c)}</li>`)
      .join('') || '<li>（特になし）</li>';

    $('#result-assumptions').innerHTML = (a.assumptions || [])
      .map((c) => `<li>${escapeHtml(c)}</li>`)
      .join('') || '<li>（前提なし）</li>';
  }

  $('#result-raw').textContent = JSON.stringify(payload, null, 2);
  $('#result-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function candidateBlock(c) {
  const status = (c.status || 'unknown').toLowerCase();
  const label = STATUS_LABEL[status] || STATUS_LABEL.unknown;
  return `
    <div class="candidate-item">
      <div class="candidate-head">
        <div class="candidate-name">${escapeHtml(c.name || '?')}</div>
        <span class="status-badge ${status}">${escapeHtml(label)}</span>
      </div>
      <div class="candidate-meta">
        ${c.kasan_key ? `<code>${escapeHtml(c.kasan_key)}</code> · ` : ''}
        ${c.unit ? `単位: ${escapeHtml(c.unit)} · ` : ''}
        ${c.revenue_estimate ? `増収: ${escapeHtml(c.revenue_estimate)}` : ''}
      </div>
      <div class="candidate-req">${escapeHtml(c.requirement_summary || '')}</div>

      ${
        c.recommended_actions && c.recommended_actions.length
          ? `<div class="candidate-block-title">▶ 取るためのアクション</div>
             <ul class="candidate-actions">${c.recommended_actions
               .map((a) => `<li>${escapeHtml(a)}</li>`)
               .join('')}</ul>`
          : ''
      }
      ${
        c.missing_info && c.missing_info.length
          ? `<div class="candidate-block-title">❔ 追加で必要な情報</div>
             <ul class="candidate-missing">${c.missing_info
               .map((a) => `<li>${escapeHtml(a)}</li>`)
               .join('')}</ul>`
          : ''
      }
    </div>
  `;
}

function domainTag(domain) {
  const cls = ['kaigo', 'medical', 'disability'].includes(domain) ? domain : '';
  const label = DOMAIN_LABEL[domain] || domain || '';
  return `<span class="domain-tag ${cls}">${escapeHtml(label)}</span>`;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function show(sel) {
  $(sel).classList.remove('hidden');
}

function hide(sel) {
  $(sel).classList.add('hidden');
}

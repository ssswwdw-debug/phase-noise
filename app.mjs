import {delaySeconds, correctTWDI, parseCSV, validateSpectrum, combineSpectra, frequencyAnalysis, spectrumCSV} from './analysis.mjs?v=csv-headers-2';
const $ = id => document.getElementById(id);
const colors = ['#169f91', '#4b79c1', '#d9a24e', '#9475be', '#d27787', '#4c9fab'];
let datasets = [], nextId = 1, frequencyRows = null, frequencyResult = null;
let records = [];
try { const stored = JSON.parse(localStorage.getItem('phase-lab-records-v1') || '[]'); if (Array.isArray(stored)) records = stored.filter(r => r && typeof r.id === 'string' && typeof r.date === 'string' && r.config); } catch { showNotice('保存済みモード記録を読み込めませんでした。新しい記録から開始します。', true); }
function showNotice(message, error = false) { $('notice').hidden = false; $('notice').classList.toggle('error', error); $('notice').textContent = message; }
function run(action) { try { action(); } catch (e) { showNotice(e.message, true); } }
function textEl(tag, value, className) { const e = document.createElement(tag); e.textContent = value; if (className) e.className = className; return e; }
function fmt(value, digits = 3) { return Number.isFinite(value) ? (value === 0 ? '0' : value.toExponential(digits)) : '—'; }
function download(name, text, mime = 'text/csv;charset=utf-8') { const url = URL.createObjectURL(new Blob([text], {type: mime})); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function selected(id) { const ds = datasets.find(d => d.id === $(id).value); if (!ds) throw new Error('スペクトルを読み込んでください。'); return ds; }
function addDataset(name, rows, metadata = {}) { const ds = {id: String(nextId++), name, rows, metadata, color: colors[datasets.length % colors.length]}; datasets.push(ds); renderDatasets(); return ds; }
function renderDatasets() {
  for (const id of ['correction-source', 'operand-a', 'operand-b', 'export-source']) {
    const select = $(id), value = select.value; select.replaceChildren();
    if (!datasets.length) select.append(new Option('データを読み込んでください', ''));
    for (const d of datasets) select.append(new Option(d.name, d.id));
    if (datasets.some(d => d.id === value)) select.value = value;
  }
  $('dataset-list').replaceChildren(); $('spectrum-legend').replaceChildren();
  for (const d of datasets) {
    const row = textEl('div', '', 'dataset'); const dot = textEl('span', '', 'dot'); dot.style.background = d.color; row.append(dot);
    const name = textEl('span', d.name, 'dataset-name'); name.title = d.name; row.append(name, textEl('small', `${d.rows.filter(r => r[1] !== null).length} pts`));
    const remove = textEl('button', '×', 'delete-button'); remove.title = `${d.name} を削除`; remove.setAttribute('aria-label', remove.title); remove.onclick = () => { datasets = datasets.filter(x => x.id !== d.id); renderDatasets(); }; row.append(remove); $('dataset-list').append(row);
    const legend = textEl('span', ''); const marker = dot.cloneNode(); legend.append(marker, document.createTextNode(d.name)); $('spectrum-legend').append(legend);
  }
  $('export-spectrum').disabled = !datasets.length;
  $('spectrum-summary').textContent = `${datasets.length} スペクトル`;
  drawSpectrum();
}
async function importSpectra(files) {
  for (const file of files) {
    try { if (file.size > 20 * 1024 * 1024) throw new Error('20 MB 以下のファイルを指定してください。'); const rows = validateSpectrum(parseCSV(await file.text(), +$('spectrum-start-line').value)); addDataset(file.name, rows, {kind: 'measurement'}); showNotice(`${file.name}: ${rows.length} 点を読み込みました。`); } catch (e) { showNotice(`${file.name}: ${e.message}`, true); }
  }
}
$('spectrum-file').onchange = e => { importSpectra(e.target.files); e.target.value = ''; };
for (const event of ['dragover', 'dragleave', 'drop']) $('dropzone').addEventListener(event, e => { e.preventDefault(); $('dropzone').classList.toggle('dragover', event === 'dragover'); if (event === 'drop') importSpectra(e.dataTransfer.files); });
function config() { return {lengthM: +$('fiber-length').value, index: +$('refractive-index').value, passes: +$('passes').value, modeA: +$('mode-a').value, modeB: +$('mode-b').value, floor: +$('null-floor').value}; }
function updateDelay() { const c = config(); $('delta-mode').textContent = Math.abs(c.modeA - c.modeB); try { $('delay-value').textContent = `${(delaySeconds(c.lengthM, c.index, c.passes) * 1e6).toFixed(3)} µs`; } catch { $('delay-value').textContent = '—'; } }
for (const id of ['fiber-length', 'refractive-index', 'passes', 'mode-a', 'mode-b']) $(id).addEventListener('input', updateDelay);
function persistRecords() { try { localStorage.setItem('phase-lab-records-v1', JSON.stringify(records)); return true; } catch { showNotice('モード記録をブラウザに保存できません。JSON 出力で記録を保管してください。', true); return false; } }
$('correction-form').onsubmit = e => { e.preventDefault(); run(() => {
  const source = selected('correction-source'), c = config();
  if (source.rows.some(r => r[1] === null)) throw new Error('欠損値を含む結果への再補正には対応していません。元の測定データを選択してください。');
  const result = correctTWDI(source.rows, c), excluded = result.filter(r => r[1] === null).length;
  const metadata = {kind: 'twdi', model: 'provisional: H=4*(m1-m2)^2*sin(pi*f*tau)^2; tau=p*ng*L/c', config: c, source: source.name, note: $('mode-note').value, excluded};
  const ds = addDataset(`${source.name} · TWDI補正`, result, metadata); $('export-source').value = ds.id;
  records.unshift({id: crypto.randomUUID(), date: new Date().toISOString(), ...metadata});
  const saved = persistRecords(); renderRecords();
  if (saved) showNotice(`暫定モデルで補正しました。${excluded} / ${result.length} 点をヌル付近として除外。モード条件を保存しました。`);
}); };
$('combine-form').onsubmit = e => { e.preventDefault(); run(() => { const a = selected('operand-a'), b = selected('operand-b'), operation = $('operation').value;
  const rows = combineSpectra(a.rows, b.rows, operation);
  if (!rows.some(r => r[1] !== null)) throw new Error('有効な演算結果がありません。重複範囲や差し引くスペクトルを確認してください。');
  const d = addDataset(`${a.name} ${operation === 'add' ? '+' : '−'} ${b.name}`, rows, {kind: operation, a: a.name, b: b.name}); $('export-source').value = d.id;
  showNotice(`線形パワーで計算しました。${rows.filter(r => r[1] === null).length} 点は範囲外・欠損・非正値のため除外しました。`);
}); };
$('export-spectrum').onclick = () => run(() => { const d = selected('export-source'); download('phase-spectrum.csv', spectrumCSV(d.rows)); download('phase-spectrum-metadata.json', JSON.stringify({name: d.name, metadata: d.metadata, excludedValue: 'empty cell', exportedAt: new Date().toISOString()}, null, 2), 'application/json'); });
function renderRecords() {
  const tbody = $('records-body'); tbody.replaceChildren();
  if (!records.length) { const tr = document.createElement('tr'); const td = textEl('td', '補正するとモードと測定条件が記録されます', 'empty'); td.colSpan = 5; tr.append(td); tbody.append(tr); }
  for (const r of records) {
    const tr = document.createElement('tr'), c = r.config;
    const date = textEl('td', new Date(r.date).toLocaleString('ja-JP')); date.append(textEl('small', r.note || r.source || ''));
    const modes = textEl('td', `${c.modeA} / ${c.modeB}`); modes.append(textEl('small', `Δm = ${Math.abs(c.modeA - c.modeB)} · 暫定モデル`));
    const params = textEl('td', `${c.lengthM} m / ${c.index}`); params.append(textEl('small', `${c.passes === 2 ? '往復' : '片道'} · 閾値 ${c.floor}`));
    let delay = '—'; try { delay = `${(delaySeconds(c.lengthM, c.index, c.passes) * 1e6).toFixed(3)} µs`; } catch {}
    const action = document.createElement('td'), del = textEl('button', '×', 'delete-button'); del.setAttribute('aria-label', 'このモード記録を削除'); del.onclick = () => { records = records.filter(x => x.id !== r.id); persistRecords(); renderRecords(); }; action.append(del);
    tr.append(date, modes, params, textEl('td', delay), action); tbody.append(tr);
  }
}
$('export-records').onclick = () => download('twdi-mode-records.json', JSON.stringify(records, null, 2), 'application/json');
$('frequency-file').onchange = async e => { const file = e.target.files[0]; if (!file) return; try { if (file.size > 20 * 1024 * 1024) throw new Error('20 MB 以下のファイルを指定してください。'); frequencyRows = parseCSV(await file.text(), +$('frequency-start-line').value); $('frequency-filename').textContent = file.name; clearFrequency(); analyzeFrequency(); } catch (error) { frequencyRows = null; clearFrequency(); showNotice(error.message, true); } e.target.value = ''; };
function clearFrequency() { frequencyResult = null; for (const id of ['bias-hz', 'fractional-bias', 'frequency-std']) $(id).textContent = '—'; $('frequency-summary').textContent = '未解析'; $('adev-body').replaceChildren(); $('export-adev').disabled = true; drawAllan(); }
$('frequency-start-line').addEventListener('input', () => { frequencyRows = null; $('frequency-filename').textContent = '開始行を変更しました。ファイルを再選択してください'; clearFrequency(); });
for (const id of ['reference-frequency', 'frequency-kind']) $(id).addEventListener('input', clearFrequency);
function analyzeFrequency() { run(() => { if (!frequencyRows) throw new Error('周波数時系列を読み込んでください。');
  const reference = +$('reference-frequency').value, fractional = $('frequency-kind').value === 'fractional';
  frequencyResult = {...frequencyAnalysis(frequencyRows, reference, fractional), reference, fractional};
  $('bias-hz').textContent = fmt(frequencyResult.biasHz); $('fractional-bias').textContent = fmt(frequencyResult.mean); $('frequency-std').textContent = fmt(frequencyResult.std);
  $('frequency-summary').textContent = `${frequencyRows.length} 点 · Δt = ${frequencyResult.dt.toPrecision(4)} s · ${frequencyResult.duration.toPrecision(4)} s`;
  $('adev-body').replaceChildren(); for (const a of frequencyResult.adev) { const tr = document.createElement('tr'); tr.append(textEl('td', a.tau.toPrecision(5)), textEl('td', fmt(a.value, 5)), textEl('td', a.pairs)); $('adev-body').append(tr); }
  $('export-adev').disabled = false; drawAllan(); showNotice('周波数時系列を解析しました。平均偏差は基準値との差であり、校正された確度・測定不確かさを示すものではありません。');
}); }
$('frequency-form').onsubmit = e => { e.preventDefault(); analyzeFrequency(); };
$('export-adev').onclick = () => { if (frequencyResult) download('overlapping-allan-deviation.csv', `# reference_Hz=${frequencyResult.reference}\n# input=${frequencyResult.fractional ? 'fractional' : 'Hz'}\n# relative_mean=${frequencyResult.mean}\n# bias_Hz=${frequencyResult.biasHz}\n# relative_sample_std=${frequencyResult.std}\ntau_s,allan_deviation,pairs\n` + frequencyResult.adev.map(a => `${a.tau},${a.value},${a.pairs}`).join('\n') + '\n'); };
for (const button of document.querySelectorAll('[data-tab]')) button.onclick = () => {
  const phase = button.dataset.tab === 'phase'; $('phase-panel').hidden = !phase; $('frequency-panel').hidden = phase;
  for (const b of document.querySelectorAll('[data-tab]')) { const active = b === button; b.classList.toggle('active', active); b.setAttribute('aria-selected', String(active)); }
  $('breadcrumb').textContent = phase ? '位相雑音' : '周波数解析'; $('page-title').textContent = phase ? '位相雑音解析' : '周波数解析';
  $('page-description').textContent = phase ? 'TWDI の伝達特性を補正し、光源本来のノイズを読み解く。' : '周波数の安定度と基準値からの偏差を、時系列から評価する。'; $('notice').hidden = true;
  requestAnimationFrame(() => phase ? drawSpectrum() : drawAllan());
};
// Keyboard navigation for the two analysis tabs.
for (const b of document.querySelectorAll('[data-tab]')) b.onkeydown = e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const tabs = [...document.querySelectorAll('[data-tab]')]; const target = e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs[1] : tabs.find(t => t !== b); target.focus(); target.click(); } };
function demo() {
  if (!$('phase-panel').hidden) {
    const rows = Array.from({length: 450}, (_, i) => { const f = 10 ** (1 + i * 5 / 449); return [f, -45 - 23 * Math.log10(f / 10) + 5 * Math.exp(-((Math.log10(f) - 3.7) ** 2) / .015) + 1.1 * Math.sin(i * .22)]; });
    addDataset('サンプル · TWDI測定', rows, {kind: 'synthetic'}); addDataset('サンプル · 装置雑音', rows.map(([f]) => [f, -110 - 8 * Math.log10(f / 10)]), {kind: 'synthetic'});
    $('operand-b').value = datasets.at(-1).id; showNotice('合成サンプルを読み込みました。実測データではありません。');
  } else {
    let state = 42; const rand = () => { state = (1664525 * state + 1013904223) >>> 0; return (state + .5) / 4294967296; };
    frequencyRows = Array.from({length: 4096}, (_, i) => [i, 1e7 + .025 + .1 * Math.sqrt(-2 * Math.log(rand())) * Math.cos(2 * Math.PI * rand())]);
    $('reference-frequency').value = 1e7; $('frequency-kind').value = 'hz'; $('frequency-filename').textContent = '合成サンプル · 4096 点 / 1 s'; analyzeFrequency(); showNotice('合成の周波数時系列を解析しました。実測データではありません。');
  }
}
$('demo-button').onclick = demo;
function chart(canvasId, series, {logY = false, xLabel, yLabel}) {
  const canvas = $(canvasId), bounds = canvas.getBoundingClientRect(); if (!bounds.width || !bounds.height) return;
  const dpr = window.devicePixelRatio || 1; canvas.width = Math.round(bounds.width * dpr); canvas.height = Math.round(bounds.height * dpr);
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  const w = bounds.width, h = bounds.height, p = {l: 65, r: 20, t: 26, b: 53};
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity, n = 0;
  for (const s of series) for (const [x, y] of s.rows) { if (x > 0 && y !== null && Number.isFinite(y) && (!logY || y > 0)) { const xx = Math.log10(x), yy = logY ? Math.log10(y) : y; xmin = Math.min(xmin, xx); xmax = Math.max(xmax, xx); ymin = Math.min(ymin, yy); ymax = Math.max(ymax, yy); n++; } }
  if (!n) { xmin = logY ? 0 : 1; xmax = logY ? 4 : 6; ymin = logY ? -13 : -160; ymax = logY ? -8 : -20; }
  else { if (xmin === xmax) { xmin -= .5; xmax += .5; } const gap = Math.max((ymax - ymin) * .12, logY ? .2 : 5); ymin -= gap; ymax += gap; }
  const X = x => p.l + (Math.log10(x) - xmin) / (xmax - xmin) * (w - p.l - p.r);
  const Y = y => h - p.b - ((logY ? Math.log10(y) : y) - ymin) / (ymax - ymin) * (h - p.t - p.b);
  ctx.font = '10px -apple-system, sans-serif'; ctx.fillStyle = '#94a2ae';
  const powerLabel = exponent => `10${String(exponent).split('').map(c => ({'-':'⁻','0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹'}[c] || c)).join('')}`;
  const grid = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.strokeStyle = '#edf1f4'; ctx.lineWidth = 1; ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
  let xticks = []; for (let i = Math.ceil(xmin); i <= Math.floor(xmax); i++) xticks.push(i); if (xticks.length < 2) xticks = [xmin, xmax];
  ctx.textAlign = 'center'; for (const t of xticks) { const x = X(10 ** t); grid(x, p.t, x, h - p.b); ctx.fillText(Number.isInteger(t) ? powerLabel(t) : (10 ** t).toPrecision(2), x, h - p.b + 20); }
  ctx.textAlign = 'right';
  for (let i = 0; i <= 5; i++) { const value = ymin + (ymax - ymin) * i / 5, y = Y(logY ? 10 ** value : value); grid(p.l, y, w - p.r, y); ctx.fillText(logY ? (10 ** value).toExponential(1) : value.toFixed(0), p.l - 10, y + 3); }
  ctx.fillStyle = '#81909d'; ctx.font = '10px -apple-system, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(xLabel, p.l + (w - p.l - p.r) / 2, h - 9);
  ctx.save(); ctx.translate(13, p.t + (h - p.t - p.b) / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(yLabel, 0, 0); ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.rect(p.l, p.t, w - p.l - p.r, h - p.t - p.b); ctx.clip();
  for (const s of series) { ctx.beginPath(); ctx.strokeStyle = s.color; ctx.lineWidth = 1.7; let connected = false;
    for (const [x, y] of s.rows) { if (x <= 0 || y === null || !Number.isFinite(y) || (logY && y <= 0)) { connected = false; continue; } if (connected) ctx.lineTo(X(x), Y(y)); else ctx.moveTo(X(x), Y(y)); connected = true; } ctx.stroke();
    if (logY) for (const [x, y] of s.rows) if (x > 0 && y > 0) { ctx.beginPath(); ctx.fillStyle = s.color; ctx.arc(X(x), Y(y), 3, 0, 2 * Math.PI); ctx.fill(); }
  } ctx.restore();
  if (!n) { ctx.fillStyle = '#91a3af'; ctx.textAlign = 'center'; ctx.font = '12px sans-serif'; ctx.fillText('データを読み込むか、サンプルを選択してください', p.l + (w - p.l - p.r) / 2, (h - p.b + p.t) / 2); }
}
function drawSpectrum() { chart('spectrum-chart', datasets, {xLabel: 'オフセット周波数  f [Hz]', yLabel: 'L(f) [dBc/Hz]'}); }
function drawAllan() { chart('allan-chart', frequencyResult ? [{color: '#169f91', rows: frequencyResult.adev.map(a => [a.tau, a.value])}] : [], {logY: true, xLabel: '平均化時間  τ [s]', yLabel: 'アラン偏差  σᵧ(τ)'}); }
new ResizeObserver(() => { drawSpectrum(); drawAllan(); }).observe(document.querySelector('main'));
renderDatasets(); renderRecords(); clearFrequency(); updateDelay();

import {parseCSV, previewCSV} from './analysis.mjs?v=csv-preview-1';
const $ = id => document.getElementById(id);
let active = false;
function el(tag, text, className) { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; }
export async function chooseCSVImport(file, {startLine = 3, xColumn = 1, yColumn = 2, kind = 'spectrum', validate = rows => rows} = {}) {
  if (active) throw new Error('開いている CSV プレビューを先に確定またはキャンセルしてください。');
  if (file.size > 20 * 1024 * 1024) throw new Error('20 MB 以下のファイルを指定してください。');
  active = true;
  let text;
  try { text = await file.text(); } catch(e) { active = false; throw e; }
  const preview = previewCSV(text), dialog = $('import-dialog');
  $('preview-filename').textContent = file.name;
  $('preview-file-info').textContent = `${(file.size / 1024).toFixed(1)} KB · ${preview.totalLines.toLocaleString()} 行 · 先頭 ${preview.rows.length} 行をプレビュー`;
  $('preview-skip').value = Math.max(0, startLine - 1); $('preview-x').value = xColumn; $('preview-y').value = yColumn;
  $('preview-error').hidden = true;
  $('preview-x-label').textContent = kind === 'frequency' ? 'X 列：時刻 [s]' : 'X 列：オフセット周波数 [Hz]';
  $('preview-y-label').textContent = kind === 'frequency' ? 'Y 列：周波数 / 分数周波数' : 'Y 列：位相雑音 [dBc/Hz]';
  function options() { return {startLine: +$('preview-skip').value + 1, xColumn: +$('preview-x').value, yColumn: +$('preview-y').value}; }
  function render() {
    const c = options(); $('preview-error').hidden = true;
    $('preview-selection').textContent = `先頭 ${c.startLine - 1} 行をスキップ → ${c.startLine} 行目から · X = ${c.xColumn} 列 · Y = ${c.yColumn} 列`;
    const columns = Array.from({length: Math.min(preview.columnCount, 30)}, (_, i) => i + 1);
    for (const n of [c.xColumn, c.yColumn]) if (Number.isSafeInteger(n) && n > 0 && n <= preview.columnCount && !columns.includes(n)) columns.push(n);
    columns.sort((a,b) => a-b);
    const head = $('preview-head'); head.replaceChildren(); const tr = document.createElement('tr'); tr.append(el('th', '行 / 読込開始'));
    for (const n of columns) { const th = el('th', `${n} 列目`); th.dataset.column = n; th.className = n === c.xColumn ? 'preview-x-col' : n === c.yColumn ? 'preview-y-col' : '';
      const controls = el('div','', 'preview-column-actions');
      for (const axis of ['x','y']) { const button = el('button',axis.toUpperCase()); button.type='button'; button.setAttribute('aria-label',`${n} 列目を ${axis.toUpperCase()} に設定`); button.classList.toggle('selected', n === c[axis+'Column']); button.onclick=()=>{ $('preview-'+axis).value=n; render(); }; controls.append(button); }
      th.append(controls); tr.append(th);
    } head.append(tr);
    const body = $('preview-body'); body.replaceChildren();
    for (const row of preview.rows) {
      const tr = document.createElement('tr'); tr.dataset.line = row.line;
      tr.classList.toggle('preview-skipped', row.line < c.startLine); tr.classList.toggle('preview-start',row.line === c.startLine);
      const td = document.createElement('td'), button = el('button', `${row.line}${row.line === c.startLine ? ' ▶' : ''}`, 'preview-row-button'); button.type='button'; button.title=`${row.line} 行目から読み込む`; button.onclick=()=>{$('preview-skip').value=row.line - 1;render();}; td.append(button); if(row.comment || row.blank)td.append(el('small',row.comment?'コメント':'空行')); tr.append(td);
      for (const n of columns) { const value = row.cells[n-1] ?? ''; const cell = el('td',value); cell.title=value; cell.className=n === c.xColumn?'preview-x-col':n === c.yColumn?'preview-y-col':''; tr.append(cell); }
      if(row.error) { tr.classList.add('preview-bad-row'); tr.title=row.error; } body.append(tr);
    }
    $('preview-limit').textContent = `${preview.truncated ? 'プレビューは先頭 40 行のみ。読み込み時はファイル全体を検証します。' : 'ファイル全行をプレビューしています。'}${preview.columnCount > 30 ? ' 最初の 30 列と選択した列を表示。列番号入力で他の列も選べます。' : ''} 空行・# コメントは読み込み時に無視します。先頭の列名・単位は最大 2 行自動スキップする場合があります。`;
  }
  for (const id of ['preview-skip','preview-x','preview-y']) $(id).oninput=render;
  render(); dialog.showModal();
  return await new Promise(resolve => {
    function finish(value) { dialog.oncancel=null; $('import-preview-form').onsubmit=null; $('preview-cancel').onclick=null; active=false; dialog.close(); resolve(value); }
    dialog.oncancel=e=>{e.preventDefault();finish(null);}; $('preview-cancel').onclick=()=>finish(null);
    $('import-preview-form').onsubmit=e=>{e.preventDefault();try {
      const c=options(); const rows=parseCSV(text,c.startLine,{xColumn:c.xColumn,yColumn:c.yColumn}); validate(rows);
      finish({text, rows, ...c});
    } catch(e) { $('preview-error').textContent=e.message; $('preview-error').hidden=false; } };
  });
}

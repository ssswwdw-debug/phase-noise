export const C = 299792458;
export function delaySeconds(lengthM, index, passes = 1) {
  if (!(Number.isFinite(lengthM) && Number.isFinite(index) && lengthM > 0 && index > 0) || ![1, 2].includes(passes)) throw new Error('ファイバー長と群屈折率は正数で指定してください。');
  return lengthM * index * passes / C;
}
export function transferPower(f, deltaMode, delay) {
  return 4 * deltaMode ** 2 * Math.sin(Math.PI * f * delay) ** 2;
}
export function correctTWDI(rows, {lengthM, index, passes = 1, modeA, modeB, floor = 1e-6}) {
  if (!Number.isSafeInteger(modeA) || !Number.isSafeInteger(modeB) || modeA === modeB) throw new Error('異なる整数のモード次数を指定してください。');
  if (!(floor > 0 && floor < 1)) throw new Error('ヌル除外閾値は 0 と 1 の間で指定してください。');
  const delay = delaySeconds(lengthM, index, passes);
  return rows.map(([f, db]) => {
    const normalized = Math.sin(Math.PI * f * delay) ** 2;
    return [f, normalized < floor ? null : db - 10 * Math.log10(transferPower(f, modeA - modeB, delay))];
  });
}
export function parseCSV(text, startLine = 1) {
  if (!Number.isSafeInteger(startLine) || startLine < 1) throw new Error('データ開始行は 1 以上の整数で指定してください。');
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((s, i) => ({text: s.trim(), line: i + 1})).slice(startLine - 1).filter(r => r.text && !r.text.startsWith('#'));
  const rows = [];
  let headerAllowed = true;
  for (const {text: line, line: lineNumber} of lines) {
    const cells = line.split(/[,;\t ]+/).map(s => s.trim());
    if (cells.length !== 2 || cells.some(s => !s)) throw new Error(`${lineNumber} 行目: 2 列の数値が必要です。`);
    const nums = cells.map(Number);
    if (nums.some(n => !Number.isFinite(n))) {
      if (headerAllowed && rows.length === 0 && cells.every(s => s && !Number.isFinite(Number(s)))) { headerAllowed = false; continue; }
      throw new Error(`${lineNumber} 行目: 無効な数値です。`);
    }
    headerAllowed = false;
    rows.push(nums);
  }
  if (rows.length < 2) throw new Error('少なくとも 2 点のデータが必要です。');
  return rows;
}
export function validateSpectrum(rows) {
  if (rows.some(([f, db], i) => !(f > 0 && Number.isFinite(db)) || (i > 0 && f <= rows[i - 1][0]))) throw new Error('オフセット周波数は正数・昇順・重複なし、レベルは有限値にしてください。');
  return rows;
}
function interpolate(rows, f) {
  if (f < rows[0][0] || f > rows.at(-1)[0]) return null;
  let lo = 0, hi = rows.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (rows[mid][0] > f) hi = mid; else lo = mid; }
  if (f === rows[lo][0]) return rows[lo][1];
  if (f === rows[hi][0]) return rows[hi][1];
  if (rows[lo][1] === null || rows[hi][1] === null) return null;
  const t = Math.log(f / rows[lo][0]) / Math.log(rows[hi][0] / rows[lo][0]);
  return rows[lo][1] + t * (rows[hi][1] - rows[lo][1]);
}
export function combineSpectra(a, b, operation) {
  if (!['add', 'subtract'].includes(operation)) throw new Error('不明な演算です。');
  return a.map(([f, db]) => {
    const other = interpolate(b, f);
    if (db === null || other === null) return [f, null];
    // Stable linear-power operation, preserving the dBc/Hz convention.
    const high = Math.max(db, other);
    const p = 10 ** ((db - high) / 10) + (operation === 'add' ? 1 : -1) * 10 ** ((other - high) / 10);
    return [f, p > 0 ? high + 10 * Math.log10(p) : null];
  });
}
export function frequencyAnalysis(rows, reference, fractional = false) {
  if (!(reference > 0 && Number.isFinite(reference))) throw new Error('基準周波数は正数で指定してください。');
  if (rows.length < 4) throw new Error('アラン偏差には 4 点以上の時系列が必要です。');
  const dt = rows[1][0] - rows[0][0];
  if (!(dt > 0) || rows.some((r, i) => i && Math.abs((r[0] - rows[i - 1][0]) - dt) > Math.max(1e-9, dt * 1e-5))) throw new Error('時刻は昇順・等間隔にしてください（相対許容差 1e-5）。');
  if (rows.some(r => r.some(v => !Number.isFinite(v)))) throw new Error('時系列には有限値を指定してください。');
  const y = rows.map(r => fractional ? r[1] : (r[1] - reference) / reference);
  const mean = y.reduce((a, b) => a + b, 0) / y.length;
  const std = Math.sqrt(y.reduce((s, v) => s + (v - mean) ** 2, 0) / (y.length - 1));
  const sum = [0]; for (const v of y) sum.push(sum.at(-1) + v);
  const adev = [];
  for (let m = 1; m <= Math.floor(y.length / 2); m *= 2) {
    const count = y.length - 2 * m + 1;
    let squares = 0;
    for (let i = 0; i < count; i++) {
      const diff = (sum[i + 2 * m] - 2 * sum[i + m] + sum[i]) / m;
      squares += diff * diff;
    }
    adev.push({tau: dt * m, value: Math.sqrt(squares / (2 * count)), pairs: count});
  }
  return {y, mean, std, biasHz: mean * reference, meanHz: reference * (1 + mean), duration: rows.at(-1)[0] - rows[0][0], dt, adev};
}
export function spectrumCSV(rows) { return 'offset_Hz,L_dBc_per_Hz\n' + rows.map(([f, db]) => `${f},${db === null ? '' : db}`).join('\n') + '\n'; }

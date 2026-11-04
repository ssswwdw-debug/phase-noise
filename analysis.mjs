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
    const cycles = f * delay;
    const sine = Math.abs(Math.sin(Math.PI * cycles));
    // DC is singular, but positive frequencies in the first rising lobe are
    // invertible. Apply the configurable mask only around nonzero delay nulls.
    const nearest = Math.round(cycles);
    const atNull = nearest >= 1 && Math.abs(cycles - nearest) <= 8 * Number.EPSILON * Math.max(1, cycles);
    if (!(f > 0) || !Number.isFinite(db) || sine === 0 || atNull || (cycles >= 0.5 && sine ** 2 < floor)) return [f, null];
    const correctionDB = 10 * Math.log10(4) + 20 * Math.log10(Math.abs(modeA - modeB)) + 20 * Math.log10(sine);
    return [f, db - correctionDB];
  });
}
export function parseCSV(text, startLine = 1) {
  if (!Number.isSafeInteger(startLine) || startLine < 1) throw new Error('データ開始行は 1 以上の整数で指定してください。');
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((s, i) => ({text: s.trim(), line: i + 1})).slice(startLine - 1).filter(r => r.text && !r.text.startsWith('#'));
  const rows = [];
  let headerRows = 0;
  for (const {text: line, line: lineNumber} of lines) {
    const cells = line.split(/[,;\t ]+/).map(s => s.trim());
    if (cells.length !== 2 || cells.some(s => !s)) throw new Error(`${lineNumber} 行目: 2 列の数値が必要です。`);
    const nums = cells.map(Number);
    if (nums.some(n => !Number.isFinite(n))) {
      if (headerRows < 2 && rows.length === 0 && cells.every(s => s && !Number.isFinite(Number(s)))) { headerRows++; continue; }
      throw new Error(`${lineNumber} 行目: 無効な数値です。`);
    }
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

export function spectrumOffsets(rows, offsets = [1000, 10000, 100000]) {
  return offsets.map(offsetHz => {
    if (!rows.length || offsetHz < rows[0][0] || offsetHz > rows.at(-1)[0]) return {offsetHz, value: null, status: 'out_of_range', lowerHz: null, upperHz: null};
    let lo = 0, hi = rows.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (rows[mid][0] > offsetHz) hi = mid; else lo = mid; }
    const exact = rows[lo][0] === offsetHz ? lo : rows[hi][0] === offsetHz ? hi : -1;
    const value = interpolate(rows, offsetHz);
    return {offsetHz, value, status: value === null ? 'masked' : exact >= 0 ? 'exact' : 'interpolated', lowerHz: exact >= 0 ? offsetHz : rows[lo][0], upperHz: exact >= 0 ? offsetHz : rows[hi][0]};
  });
}
export function offsetSummaryCSV(datasets) {
  const quote = value => '"' + String(value).replaceAll('"', '""') + '"';
  const lines = ['spectrum,offset_Hz,L_dBc_per_Hz,status,lower_Hz,upper_Hz'];
  for (const d of datasets) for (const p of spectrumOffsets(d.rows)) lines.push([quote(d.name), p.offsetHz, p.value ?? '', p.status, p.lowerHz ?? '', p.upperHz ?? ''].join(','));
  return lines.join('\n') + '\n';
}

// Supplementary Note 2C, Eq. (S8): the optical i-MZI floor contains
// both in-loop and out-of-loop fiber contributions. It is not raw delay PSD.
export function fiberEquivalent(rows, {inputKind = 'optical', repetitionHz, wavelengthNm, lengthM, index, passes = 1, floor = 1e-6, minFrequencyHz = 100} = {}) {
  if (!['optical', 'rep'].includes(inputKind)) throw new Error('ファイバー雑音の入力形式を選択してください。');
  if (!(Number.isFinite(minFrequencyHz) && minFrequencyHz >= 0)) throw new Error('適用下限は 0 以上の有限値で指定してください。');
  let equivalent;
  if (inputKind === 'optical') {
    if (!(Number.isFinite(repetitionHz) && repetitionHz > 0 && Number.isFinite(wavelengthNm) && wavelengthNm > 0)) throw new Error('繰返し周波数と光波長は正数で指定してください。');
    const carrierHz = C / (wavelengthNm * 1e-9);
    const ratioDB = 20 * (Math.log10(repetitionHz) - Math.log10(carrierHz));
    // |H_out|^2 = 4 sin^2(pi f tau_out); no mode-difference factor here.
    const converted = rows.map(([f, db]) => [f, db === null ? null : db + ratioDB]);
    equivalent = correctTWDI(converted, {lengthM, index, passes, floor, modeA: 0, modeB: 1});
  } else equivalent = rows.map(([f, db]) => [f, db]);
  return equivalent.map(([f, db]) => [f, f <= minFrequencyHz ? null : db]);
}
export function applyFiberNoise(targetRows, fiberRows, {operation = 'subtract', targetKind = 'rep', targetConfig, ...fiberConfig} = {}) {
  if (!['add', 'subtract'].includes(operation) || !['rep', 'mixer'].includes(targetKind)) throw new Error('ファイバー雑音の処理・対象形式が不正です。');
  const targetRep = targetKind === 'mixer' ? correctTWDI(targetRows, targetConfig || {}) : targetRows.map(([f, db]) => [f, db]);
  const fiberRep = fiberEquivalent(fiberRows, fiberConfig);
  const result = combineSpectra(targetRep, fiberRep, operation);
  if (!result.some(r => r[1] !== null)) throw new Error('有効な結果がありません。重複周波数範囲、適用下限、差し引く雑音レベルを確認してください。');
  return {targetRep, fiberRep, result};
}

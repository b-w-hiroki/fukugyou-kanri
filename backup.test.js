const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/g).at(-1).slice(8, -9).split('  // ---- 初期化 ----')[0];
const item = (id = 1) => ({ id, type: 'income', date: '2026-04-05', desc: '案件A', amount: 1234, category: '案件収入' });
const packet = entries => JSON.stringify({ app: 'fukugyou-kanri', version: 1, entries });
function setup({ raw = JSON.stringify([item()]), failWrites = false, confirm = true } = {}) {
  let stored = raw, writes = 0, prompts = 0, downloaded;
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', textContent: '', style: {}, click() {} });
    return nodes.get(id);
  };
  const ctx = {
    Blob, Date, JSON,
    localStorage: {
      getItem: () => stored,
      setItem(key, value) { writes++; if (failWrites) throw Error('quota'); stored = value; },
    },
    document: { getElementById: node, createElement: () => ({ click() {} }) },
    confirm: () => { prompts++; return confirm; }, alert() {},
    URL: { createObjectURL: blob => { downloaded = blob; return 'blob:test'; }, revokeObjectURL() {} },
    setTimeout: callback => callback(),
  };
  vm.createContext(ctx); vm.runInContext(script, ctx);
  vm.runInContext('renderTable = updateMonthSummary = populateYearSelects = renderAnnual = () => {};', ctx);
  return { ctx, node, entries: () => JSON.parse(vm.runInContext('JSON.stringify(entries)', ctx)), stored: () => stored,
    writes: () => writes, prompts: () => prompts, download: () => downloaded };
}

test('JSON backup includes every transaction despite a month filter and round trips', async () => {
  const h = setup({ raw: JSON.stringify([item(), { ...item(2), date: '2025-02-01', desc: '<img src=x onerror=alert(1)>', category: '__proto__' }]) });
  h.node('filter-month').value = '2026-04';
  h.ctx.exportBackup(); const text = await h.download().text();
  const data = JSON.parse(text); assert.equal(data.entries.length, 2);
  const target = setup({ raw: '[]' }); assert.equal(target.ctx.restoreBackupText(text), true);
  assert.deepEqual(target.entries(), data.entries);
  assert.equal(target.node('filter-month').value, '');
});

test('cancelled restore leaves disk and memory byte-for-byte unchanged', () => {
  const h = setup({ confirm: false }), before = h.stored();
  assert.equal(h.ctx.restoreBackupText(packet([item(2)])), false);
  assert.equal(h.stored(), before); assert.deepEqual(h.entries(), [item()]); assert.equal(h.writes(), 0);
});

for (const [name, value] of [
  ['malformed JSON', '{'], ['wrong app', '{}'], ['unsupported version', JSON.stringify({ app: 'fukugyou-kanri', version: 2, entries: [] })],
  ['non-array', packet(null)], ['null record', packet([null])], ['duplicate id', packet([item(), item()])],
  ['invalid date', packet([{ ...item(), date: '2026-02-30' }])], ['markup date', packet([{ ...item(), date: '<img>' }])],
  ['negative amount', packet([{ ...item(), amount: -1 }])], ['decimal amount', packet([{ ...item(), amount: 1.2 }])],
  ['unsafe amount', packet([{ ...item(), amount: Number.MAX_SAFE_INTEGER + 1 }])],
  ['unsafe sum', packet([{ ...item(), amount: Number.MAX_SAFE_INTEGER }, item(2)])],
  ['invalid type', packet([{ ...item(), type: 'other' }])], ['invalid text', packet([{ ...item(), desc: {} }])],
]) {
  test(`${name} is rejected before confirmation or writing`, () => {
    const h = setup(), before = h.stored();
    assert.equal(h.ctx.restoreBackupText(value), false);
    assert.equal(h.stored(), before); assert.deepEqual(h.entries(), [item()]);
    assert.equal(h.writes(), 0); assert.equal(h.prompts(), 0);
  });
}

test('failed restore write does not replace memory or disk', () => {
  const h = setup({ failWrites: true }), before = h.stored();
  assert.equal(h.ctx.restoreBackupText(packet([item(2)])), false);
  assert.equal(h.stored(), before); assert.deepEqual(h.entries(), [item()]);
});

test('failed add and delete do not mutate memory, clear the form, or change disk', () => {
  const h = setup({ failWrites: true }), before = h.stored();
  for (const [id, value] of Object.entries({ 'f-date': '2026-04-06', 'f-desc': 'new', 'f-amount': '100', 'f-type': 'income', 'f-category': 'その他' })) h.node(id).value = value;
  h.ctx.addEntry(); assert.deepEqual(h.entries(), [item()]); assert.equal(h.node('f-desc').value, 'new');
  h.ctx.deleteEntry(1); assert.deepEqual(h.entries(), [item()]); assert.equal(h.stored(), before);
});

test('corrupt stored data remains intact and can be downloaded as recovery text', async () => {
  const raw = '{broken'; const h = setup({ raw });
  assert.equal(h.ctx.save([item(2)]), false); assert.equal(h.stored(), raw); assert.equal(h.writes(), 0);
  h.ctx.exportBackup(); assert.equal(await h.download().text(), raw);
  assert.equal(h.ctx.restoreBackupText(packet([item(2)])), true); assert.deepEqual(h.entries(), [item(2)]);
});

test('oversized files are rejected before reading and picker can retry', async () => {
  const h = setup(); const input = { value: 'selected', files: [{ size: 10 * 1024 * 1024 + 1, text() { assert.fail('must not read'); } }] };
  await h.ctx.importBackupFile(input); assert.equal(input.value, ''); assert.equal(h.writes(), 0);
  input.files = [{ size: 1, text: async () => packet([item(3)]) }];
  await h.ctx.importBackupFile(input); assert.deepEqual(h.entries(), [item(3)]);
});

test('overlapping file selections do not start a second restore', async () => {
  const h = setup(); let finish;
  const first = h.ctx.importBackupFile({ value: 'a', files: [{ size: 1, text: () => new Promise(resolve => { finish = resolve; }) }] });
  await h.ctx.importBackupFile({ value: 'b', files: [{ size: 1, text() { assert.fail('duplicate read'); } }] });
  finish(packet([item(3)])); await first; assert.equal(h.prompts(), 1); assert.deepEqual(h.entries(), [item(3)]);
});

test('annual summary no longer treats a flat percentage of revenue as withholding tax', () => {
  assert.ok(!html.includes('totalIncome * 0.2021'));
  assert.ok(html.includes('源泉徴収・所得税はこの集計から算出しません'));
});


test('maximum imported ID does not block future transactions and timestamp collisions are safe', () => {
  for (const existingId of [Number.MAX_SAFE_INTEGER, 1]) {
    const h = setup({ raw: JSON.stringify([item(existingId)]) });
    h.ctx.Date = class extends Date { static now() { return 1; } };
    for (const [id, value] of Object.entries({ 'f-date': '2026-04-06', 'f-desc': 'next', 'f-amount': '100', 'f-type': 'income', 'f-category': 'その他' })) h.node(id).value = value;
    h.ctx.addEntry();
    assert.equal(h.entries().length, 2);
    assert.equal(new Set(h.entries().map(e => e.id)).size, 2);
    assert.ok(h.entries().every(e => Number.isSafeInteger(e.id)));
  }
});

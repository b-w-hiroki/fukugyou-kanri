const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/g).at(-1).slice(8, -9);

function element(tag = 'div') {
  return {
    tag, children: [], style: {}, textContent: '', className: '',
    appendChild(child) { this.children.push(child); },
    insertCell() { const child = element('td'); this.children.push(child); return child; },
    addEventListener(name, handler) { this[name] = handler; },
    click() { this.clicked = true; }
  };
}

test('description is rendered as literal text and delete remains wired', () => {
  const tbody = element('tbody');
  const empty = element();
  const nodes = { 'table-body': tbody, 'empty-msg': empty };
  const ctx = { document: {
    getElementById: id => nodes[id],
    createElement: element
  }, fmt: value => String(value), filteredEntries: () => [{
    date: '2026-04-05', type: 'income', desc: '<img src=x onerror=alert(1)>',
    category: 'その他', amount: 100, id: 7
  }], deleteEntry: id => { ctx.deleted = id; } };
  vm.createContext(ctx);
  vm.runInContext(script.match(/function renderTable\(\) \{[\s\S]*?\n  \}/)[0], ctx);
  ctx.renderTable();
  assert.equal(tbody.children[0].children[2].textContent, '<img src=x onerror=alert(1)>');
  tbody.children[0].children[5].children[0].click();
  assert.equal(ctx.deleted, 7);
});

test('CSV quotes Japanese text, commas, quotes and newlines, and neutralizes formulas', async () => {
  let blob;
  const ctx = {
    filteredEntries: () => [
      { date: '2026-04-05', type: 'income', desc: '日本語,"引用"\n次行', category: 'その他', amount: 100 },
      { date: '2026-04-06', type: 'expense', desc: '=1+1', category: 'その他', amount: 200 }
    ],
    Blob: class { constructor(parts) { blob = parts.join(''); } },
    URL: { createObjectURL: () => 'blob:test' },
    document: { createElement: element },
  };
  vm.createContext(ctx);
  vm.runInContext(script.match(/function csvCell\(value\) \{[\s\S]*?\n  \}/)[0], ctx);
  vm.runInContext(script.match(/function exportCSV\(\) \{[\s\S]*?\n  \}/)[0], ctx);
  ctx.exportCSV();
  assert.match(blob, /^\uFEFF"日付","種別","内容","カテゴリ","金額"\r\n/);
  assert.ok(blob.includes('"日本語,""引用""\n次行"'));
  assert.ok(blob.includes('"\'=1+1"'));
  assert.ok(blob.includes('\r\n"2026-04-06"'));
});

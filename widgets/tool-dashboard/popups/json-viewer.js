// JSON 格式化結果視窗：資料 { text, theme } 由儀表盤的 JSON 格式化工具傳入（window.popup.getData）
// 直接以排版後的文字逐行建立收合結構，不重新解析數值，大整數、1.0、1e3 都原樣顯示與複製。
const $ = (id) => document.getElementById(id);

const RENDER_BUDGET = 20000; // 一次最多建立的列數；超過時較深的節點先收合，展開時才建立
const MAX_INDENT = 16;       // 顯示縮排的層數上限，避免極深的巢狀把內容擠到看不見

const CHEVRON = '<svg class="icon" width="10" height="10" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

let text = '';
let lines = [];
let closeOf = new Map();  // 開頭列 → 結尾列
let countOf = new Map();  // 開頭列 → 直接子項目數
let depthOf = [];         // 每一列的層數
let copyTimer = null;

/** 分析每一列的巢狀關係（字串不含換行，且開頭列必以 { [ 結尾，字串列必以引號或逗號結尾） */
function analyze() {
  lines = text.split('\n');
  closeOf = new Map();
  countOf = new Map();
  depthOf = new Array(lines.length);
  const stack = [];
  lines.forEach((line, i) => {
    const trimmed = line.trimStart();
    if (trimmed[0] === '}' || trimmed[0] === ']') closeOf.set(stack.pop(), i);
    else if (stack.length) countOf.set(stack[stack.length - 1], countOf.get(stack[stack.length - 1]) + 1);
    depthOf[i] = stack.length;
    if (/[{[]$/.test(line)) {
      countOf.set(i, 0);
      stack.push(i);
    }
  });
}

function createRow(i, className = '') {
  const depth = Math.min(depthOf[i], MAX_INDENT);
  const row = document.createElement('div');
  row.className = `row${className ? ` ${className}` : ''}`;
  row.style.setProperty('--d', depth);
  row.append('  '.repeat(depth) + lines[i].trimStart());
  return row;
}

function setCollapsed(node, collapsed) {
  node.classList.toggle('collapsed', collapsed);
  node.querySelector(':scope > .row > .toggle').setAttribute('aria-expanded', String(!collapsed));
}

/** 建立可收合的節點；預算用完時先收合，子節點等展開時才建立 */
function createNode(i, budget) {
  const closer = closeOf.get(i);
  const node = document.createElement('div');
  node.className = 'node';
  node.dataset.line = i;

  const row = createRow(i);
  const toggle = document.createElement('button');
  toggle.className = 'toggle';
  toggle.type = 'button';
  toggle.innerHTML = CHEVRON;
  toggle.setAttribute('aria-label', `${lines[i].trim()} 收合或展開`);
  row.prepend(toggle);
  const closeText = lines[closer].trim();
  const sum = document.createElement('span');
  sum.className = 'sum';
  sum.textContent = ` … ${closeText}  ${countOf.get(i)} 項`;
  row.append(sum);

  const kids = document.createElement('div');
  kids.className = 'kids';
  node.append(row, kids, createRow(closer, 'closer'));

  budget.left -= 2;
  if (budget.left > 0) {
    renderKids(node, kids, budget);
    setCollapsed(node, false);
  } else {
    setCollapsed(node, true);
  }
  return node;
}

/** 建立節點的直接子項目 */
function renderKids(node, kids, budget) {
  const open = Number(node.dataset.line);
  const end = closeOf.get(open);
  const frag = document.createDocumentFragment();
  for (let i = open + 1; i < end;) {
    if (closeOf.has(i)) {
      frag.append(createNode(i, budget));
      i = closeOf.get(i) + 1;
    } else {
      frag.append(createRow(i));
      budget.left -= 1;
      i += 1;
    }
  }
  kids.append(frag);
  node.dataset.loaded = '1';
}

function expand(node) {
  if (!node.dataset.loaded) renderKids(node, node.querySelector(':scope > .kids'), { left: RENDER_BUDGET });
  setCollapsed(node, false);
}

function resetCopy() {
  clearTimeout(copyTimer);
  $('copy').classList.remove('done');
  $('copy').querySelector('span').textContent = '複製';
}

function render(d) {
  if (!d) return;
  document.body.dataset.theme = d.theme === 'light' ? 'light' : 'dark';
  text = String(d.text ?? '');
  analyze();
  resetCopy();

  const budget = { left: RENDER_BUDGET };
  const tree = $('tree');
  tree.textContent = '';
  tree.append(closeOf.has(0) ? createNode(0, budget) : createRow(0));

  const tooBig = lines.length > RENDER_BUDGET;
  $('lines').textContent = `${lines.length.toLocaleString()} 行`;
  $('notice').hidden = !tooBig;
  $('notice').textContent = tooBig ? '內容較大，較深的節點已先收合，可逐層展開；複製仍包含完整內容。' : '';
  $('collapse-all').disabled = !closeOf.size;
  $('expand-all').disabled = !closeOf.size || tooBig;
  $('expand-all').title = tooBig ? '內容太大，請逐層展開' : '';
  $('content').scrollTop = 0;
}

// ---- 收合、展開 ----
$('tree').addEventListener('click', (e) => {
  const toggle = e.target.closest('.toggle');
  if (!toggle) return;
  const node = toggle.closest('.node');
  if (node.classList.contains('collapsed')) expand(node);
  else setCollapsed(node, true);
});

$('expand-all').addEventListener('click', () => {
  // 展開途中才建立的節點也要處理，所以每一輪重新尋找
  for (let list = $('tree').querySelectorAll('.node.collapsed'); list.length; list = $('tree').querySelectorAll('.node.collapsed')) {
    list.forEach(expand);
  }
});

// 根節點保持展開，才看得到第一層的項目
$('collapse-all').addEventListener('click', () => {
  $('tree').querySelectorAll('.kids .node').forEach((node) => setCollapsed(node, true));
  const root = $('tree').querySelector('.node');
  if (root) expand(root);
  $('content').scrollTop = 0;
});

// ---- 複製：一律是完整內容，與目前收合狀態無關 ----
$('copy').addEventListener('click', async () => {
  await window.popup.copyText(text);
  $('copy').classList.add('done');
  $('copy').querySelector('span').textContent = '已複製';
  clearTimeout(copyTimer);
  copyTimer = setTimeout(resetCopy, 1500);
});

// ---- 關閉 ----
$('close').addEventListener('click', () => window.popup.close());
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.popup.close();
});

window.popup.onData(render);
window.popup.getData().then(render);

'use strict';
/* ЖЕЛЕЗО — домашний журнал тренировок на резине. Telegram Mini App без сервера:
   данные в localStorage + Telegram CloudStorage (синхронизация между устройствами). */

const tg = window.Telegram && window.Telegram.WebApp;
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const haptic = (t = 'light') => { try { tg?.HapticFeedback?.impactOccurred(t); } catch (e) {} };
const notify = (t = 'success') => { try { tg?.HapticFeedback?.notificationOccurred(t); } catch (e) {} };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const GROUPS = [
  ['chest','Грудь'],['back','Спина'],['shoulders','Плечи'],['biceps','Бицепс'],['triceps','Трицепс'],['forearms','Предплечья'],
  ['abs','Пресс'],['quads','Квадрицепс'],['hamstrings','Бицепс бедра'],['glutes','Ягодицы'],['hips','Бёдра вн./нар.'],['calves','Икры, голень'],
];
const GN = Object.fromEntries(GROUPS);
const EQUIP = [['band','Резина на стенке'],['mini','Мини-резина'],['bw','Свой вес'],['bar','Турник / брусья'],['wheel','Ролик для пресса'],['bench','Лавка / тумба']];
const EQN = Object.fromEntries(EQUIP);
const ANCH = {n:'низ',m:'грудь',f:'лицо',h:'верх'};
const LVL = {1:'лёгкое',2:'среднее',3:'сложное'};
const NUMS = ['❶','❷','❸','❹','❺','❻','❼','❽','❾','❿','⓫','⓬','⓭','⓮','⓯'];
const MONTHS = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
const MONTHS_P = ['январе','феврале','марте','апреле','мае','июне','июле','августе','сентябре','октябре','ноябре','декабре'];
const MONTHS_G = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const RATES = [['1','Тяжко'],['2','Норм'],['3','Мощно'],['4','Огонь']];

/* ---------------- storage ---------------- */
const DEF = {
  settings: { ts: 0, gym: false, rnd: { groups: [], type: 'mix', n: 5 }, eq: {band:true,mini:true,bw:true,bar:true,wheel:true,bench:true}, rest: 60, defSets: 3, defRounds: 3,
    bands: [ {id:'y',name:'Жёлтая',c:'#f2d024'},{id:'r',name:'Красная',c:'#d8261c'},{id:'g',name:'Зелёная',c:'#2f9e44'},{id:'b',name:'Синяя',c:'#1c6dd0'},{id:'k',name:'Чёрная',c:'#111111'} ] },
  favs: { ts: 0, list: [] },
  custom: { ts: 0, list: [] },
  programs: { ts: 0, list: null },
};
const S = {
  settings: null, favs: null, custom: null, programs: null,
  workouts: [], draft: null,
  // ui
  tab: 'cover', sel: [], groups: [], eqf: 'all', q: '', mode: 'mega', rounds: 3, jm: null, round: 0, coverImg: null,
};
const LS = {
  get(k) { try { return JSON.parse(localStorage.getItem('zh_' + k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem('zh_' + k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem('zh_' + k); } catch (e) {} },
};
const cloudOK = () => !!(tg && tg.CloudStorage && tg.isVersionAtLeast && tg.isVersionAtLeast('6.9'));
const Cloud = {
  // значения > 4000 символов режем на части: key = "~N", key_0..key_N-1
  set(key, str) {
    if (!cloudOK()) return;
    const cs = tg.CloudStorage;
    try {
      if (str.length <= 4000) { cs.setItem(key, str, () => {}); return; }
      const parts = Math.ceil(str.length / 4000);
      for (let i = 0; i < parts; i++) cs.setItem(key + '_' + i, str.slice(i * 4000, (i + 1) * 4000), () => {});
      cs.setItem(key, '~' + parts, () => {});
    } catch (e) {}
  },
  del(keys) { if (cloudOK()) try { tg.CloudStorage.removeItems(keys, () => {}); } catch (e) {} },
  keys() { return new Promise(r => { if (!cloudOK()) return r([]); try { tg.CloudStorage.getKeys((e, k) => r(e ? [] : k || [])); } catch (e) { r([]); } }); },
  getMany(keys) {
    return new Promise(r => {
      if (!cloudOK() || !keys.length) return r({});
      const out = {}; let left = 0; const chunks = [];
      for (let i = 0; i < keys.length; i += 50) chunks.push(keys.slice(i, i + 50));
      left = chunks.length;
      chunks.forEach(ch => { try { tg.CloudStorage.getItems(ch, (e, v) => { if (!e && v) Object.assign(out, v); if (--left === 0) r(out); }); } catch (e) { if (--left === 0) r(out); } });
    });
  },
};
function saveBlob(name) { S[name].ts = Date.now(); LS.set(name, S[name]); Cloud.set(name, JSON.stringify(S[name])); }
function saveWorkout(w) { LS.set('workouts', S.workouts); Cloud.set('w_' + w.id, JSON.stringify(w)); }
function saveDraft() { // локально сразу, в облако — не чаще раза в 3 сек
  LS.set('draft', S.draft); clearTimeout(saveDraft.t);
  if (!S.draft) { Cloud.del(['draft']); return; }
  saveDraft.t = setTimeout(() => S.draft && Cloud.set('draft', JSON.stringify(S.draft)), 3000);
}

function loadLocal() {
  for (const k of ['settings','favs','custom','programs']) S[k] = Object.assign(structuredClone(DEF[k]), LS.get(k) || {});
  S.settings.eq = Object.assign({}, DEF.settings.eq, S.settings.eq);
  S.settings.rnd = Object.assign({}, DEF.settings.rnd, S.settings.rnd);
  S.workouts = LS.get('workouts') || [];
  S.draft = LS.get('draft');
  S.coverImg = LS.get('cover');
  if (!S.programs.list) S.programs.list = starterPrograms();
  S.rounds = S.settings.defRounds;
}
async function syncCloud() {
  if (!cloudOK()) return;
  const keys = await Cloud.keys();
  if (!keys.length) { // первый запуск на этом аккаунте — выгружаем всё, что есть локально
    for (const k of ['settings','favs','custom','programs']) if (S[k].ts) Cloud.set(k, JSON.stringify(S[k]));
    S.workouts.forEach(w => Cloud.set('w_' + w.id, JSON.stringify(w)));
    return;
  }
  const raw = await Cloud.getMany(keys);
  const partKeys = [];
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'string' && v[0] === '~') for (let i = 0; i < +v.slice(1); i++) partKeys.push(k + '_' + i);
  Object.assign(raw, await Cloud.getMany(partKeys));
  const val = k => { const v = raw[k]; if (v == null || v === '') return null; if (v[0] === '~') { let s = ''; for (let i = 0; i < +v.slice(1); i++) s += raw[k + '_' + i] || ''; return s; } return v; };
  const parse = s => { try { return JSON.parse(s); } catch (e) { return null; } };
  let changed = false;
  for (const k of ['settings','favs','custom','programs']) {
    const c = parse(val(k));
    if (c && (c.ts || 0) > (S[k].ts || 0)) { S[k] = Object.assign(structuredClone(DEF[k]), c); LS.set(k, S[k]); changed = true; }
    else if (S[k].ts && (!c || (c.ts || 0) < S[k].ts)) Cloud.set(k, JSON.stringify(S[k]));
  }
  const have = new Set(S.workouts.map(w => w.id));
  const deleted = new Set(LS.get('deleted') || []);
  const isW = k => /^w_[^_]+$/.test(k); // части длинных значений выглядят как w_<id>_N
  for (const k of keys) if (isW(k)) {
    const id = k.slice(2);
    if (have.has(id) || deleted.has(id)) continue;
    const w = parse(val(k)); if (w && w.id) { S.workouts.push(w); have.add(id); changed = true; }
  }
  const cloudIds = new Set(keys.filter(isW).map(k => k.slice(2)));
  S.workouts.forEach(w => { if (!cloudIds.has(w.id)) Cloud.set('w_' + w.id, JSON.stringify(w)); });
  if (!S.draft) { const d = parse(val('draft')); if (d && d.items) { S.draft = d; LS.set('draft', d); changed = true; } }
  if (changed) { S.workouts.sort((a, b) => a.start - b.start); LS.set('workouts', S.workouts); render(); }
}

/* ---------------- exercises ---------------- */
let EX = [], EXI = {};
function buildIndex() {
  EX = window.EXERCISES.concat(S.custom.list.map(c => Object.assign({ own: 1, e: ['band'], m: [], l: 1 }, c)));
  EXI = Object.fromEntries(EX.map(e => [e.id, e]));
}
const exById = id => EXI[id] || { id, n: 'Удалённое упражнение', g: 'abs', e: [], m: [] };
const byName = n => (EX.find(e => e.n === n) || {}).id;
function starterPrograms() {
  const mk = (name, mode, rounds, names) => ({ id: uid(), name, mode, rounds, items: names.map(n => window.EXERCISES.find(e => e.n === n)?.id).filter(Boolean) });
  return [
    mk('Ноги — мегасет', 'mega', 3, ['Испанский присед', 'Сгибания ног лёжа с резиной', 'Подъёмы на носки (голень) с резиной']),
    mk('Грудь, руки, пресс — мегасет', 'mega', 3, ['Ролик для пресса (раскатка с колен)', 'Жим от груди двумя руками стоя (спиной к стенке)', 'Сведения сверху (кроссовер на низ груди)', 'Сгибания на бицепс стоя с резиной', 'Разгибания на трицепс с канатом (верхний блок)']),
    mk('Спина, плечи, пресс — мегасет', 'mega', 3, ['Скручивания на пресс лёжа', 'Тяга к поясу в наклоне двумя руками', 'Тяга к лицу (Facepull)', 'Махи на дельту из-за спины']),
  ];
}
function eqAllowed(e) { return (!e.gym || S.settings.gym) && (e.e || []).every(q => S.settings.eq[q] !== false); }
function lastFor(exId, beforeTs = Infinity) {
  for (let i = S.workouts.length - 1; i >= 0; i--) {
    const w = S.workouts[i]; if (w.start >= beforeTs) continue;
    const it = w.items.find(x => x.ex === exId);
    if (it && it.sets.some(s => s.r)) return { w, it };
  }
  return null;
}
const bandName = id => (S.settings.bands.find(b => b.id === id) || {}).name || '';
const bandsTxt = ids => (ids || []).map(bandName).filter(Boolean).join('+');
function setsTxt(sets) {
  const done = sets.filter(s => s.r);
  if (!done.length) return '—';
  const parts = done.map(s => s.r + (s.b && s.b.length ? ' (' + bandsTxt(s.b).toLowerCase() + ')' : ''));
  // сжимаем «15 15 15» → «3×15»
  if (parts.every(p => p === parts[0])) return (parts.length > 1 ? parts.length + '×' : '') + parts[0];
  return parts.join(' · ');
}

/* ---------------- helpers ---------------- */
const pad = n => String(n).padStart(2, '0');
const fmtDate = ts => { const d = new Date(ts); return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear(); };
const fmtTime = ts => { const d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const fmtDur = ms => { const m = Math.max(1, Math.round(ms / 60000)); return m < 60 ? m + ' мин' : Math.floor(m / 60) + ' ч ' + pad(m % 60) + ' мин'; };
const clock = ms => { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600); return (h ? h + ':' : '') + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60); };
const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return n + ' ' + (m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c); };
function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 2000); }
function wGroups(w) { const c = {}; w.items.forEach(it => { const g = exById(it.ex).g; c[g] = (c[g] || 0) + 1; }); return Object.keys(c).sort((a, b) => c[b] - c[a]); }
function wTitle(w) {
  if (w.title) return w.title;
  const g = wGroups(w).map((x, i) => i ? GN[x].toLowerCase() : GN[x]).slice(0, 3);
  return g.length ? g.join(', ').replace(/, ([^,]*)$/, ' и $1') : 'Тренировка';
}
function wStats(w) {
  let sets = 0, reps = 0;
  w.items.forEach(it => it.sets.forEach(s => { if (s.r) { sets++; reps += +s.r || 0; } }));
  return { sets, reps, ex: w.items.length, dur: (w.end || Date.now()) - w.start };
}
const issueNo = w => S.workouts.indexOf(w) + 1;
function openLink(u) { if (tg?.openLink) tg.openLink(u); else window.open(u, '_blank'); }
async function copy(t) {
  try { await navigator.clipboard.writeText(t); toast('Скопировано'); return; } catch (e) {}
  const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); toast('Скопировано'); } catch (e) { toast('Не удалось скопировать'); } ta.remove();
}

/* ---------------- render ---------------- */
function render() {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
  const scr = $('#screen');
  scr.innerHTML = ({ cover: vCover, build: vBuild, journal: vJournal, more: vMore, live: vLive }[S.tab] || vCover)();
  renderLivebar();
  if (tg?.BackButton) { if (S.tab === 'live' || S.tab === 'cover') tg.BackButton.hide(); else tg.BackButton.show(); }
}
function go(tab) { S.tab = tab; render(); window.scrollTo(0, 0); }

/* ---------- cover ---------- */
function vCover() {
  const now = new Date();
  const ws = S.workouts;
  const mon = ws.filter(w => { const d = new Date(w.start); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); });
  const last = ws[ws.length - 1];
  const user = tg?.initDataUnsafe?.user;
  const photo = S.coverImg || user?.photo_url;
  const name = (user?.first_name || 'Чемпион');
  const issue = ws.length + 1;
  const streak = weekStreak();
  const monReps = mon.reduce((a, w) => a + wStats(w).reps, 0);
  const lastLine = last ? `Прошлый номер: «${esc(wTitle(last))}», ${fmtDate(last.start)}` : 'Первый номер журнала — собери тренировку в конструкторе';
  return `
  <section class="cover">
    ${photo ? `<div class="cover-photo" style="background-image:url('${esc(photo)}')"></div>` : `<div class="cover-noimg">${issue}</div>`}
    <div class="mast-top"><span>Выпуск №${issue}</span><span>${MONTHS[now.getMonth()]} ${now.getFullYear()}</span></div>
    <div class="masthead">ЖЕЛЕЗО</div>
    <div class="mast-sub"><b>ДОМА</b><span>Журнал бодибилдинга на резине</span></div>
    <div class="lines">
      <div><div class="cl-kick">Эксклюзив</div><div class="cl-big">${esc(name)}:<br><em>тренировка №${issue}</em></div></div>
      ${streak > 1 ? `<div class="cl-mid">${plural(streak, 'неделя', 'недели', 'недель')} без пропусков</div>` : ''}
      ${monReps ? `<div class="cl-mid"><span class="yel">${monReps.toLocaleString('ru')}</span> повторов за месяц</div>` : ''}
      <div class="cl-serif">${lastLine}</div>
    </div>
    <div class="wrap" style="margin-top:22px;display:flex;flex-direction:column;gap:12px">
      ${S.draft ? `<button class="btn yel" data-act="resume">Продолжить тренировку ▸</button>` : `<button class="btn yel" data-act="random">🎲 Случайная тренировка</button><button class="btn" data-act="go-build">Собрать самому</button>`}
      <div class="row">
        <button class="btn dark sm" data-act="programs">Мои программы</button>
        ${last ? `<button class="btn dark sm" data-act="repeat" data-id="${last.id}">Повторить прошлую</button>` : `<button class="btn dark sm" data-act="go-journal">Дневник</button>`}
      </div>
    </div>
    <div class="cover-bottom"><div class="barcode"></div><div class="stamp"><b>${mon.length}</b><span>${['тренировка','тренировки','тренировок'][plural(mon.length,0,1,2).split(' ')[1]]}<br>в ${MONTHS_P[now.getMonth()]}</span></div><div class="price">Цена: пот и дисциплина<br>${ws.length ? plural(ws.length, 'тренировка', 'тренировки', 'тренировок') + ' в архиве' : 'Архив пуст'}</div></div>
  </section>`;
}
function weekStreak() {
  if (!S.workouts.length) return 0;
  const wk = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
  const set = new Set(S.workouts.map(w => wk(w.start)));
  let cur = wk(Date.now()); let n = 0;
  if (!set.has(cur)) cur -= 7 * 864e5;
  while (set.has(cur)) { n++; cur = wk(cur - 3 * 864e5); }
  return n;
}

/* ---------- constructor ---------- */
function filteredEx() {
  const q = S.q.trim().toLowerCase();
  const favs = new Set(S.favs.list);
  let list = EX.filter(e => eqAllowed(e));
  if (S.groups.length) list = list.filter(e => S.groups.includes(e.g));
  if (S.eqf === 'fav') list = list.filter(e => favs.has(e.id));
  else if (S.eqf !== 'all') list = list.filter(e => (e.e || []).includes(S.eqf));
  if (q) list = list.filter(e => e.n.toLowerCase().includes(q) || (e.en || '').toLowerCase().includes(q));
  const score = e => (favs.has(e.id) ? 0 : 10) + (e.own ? 0 : e.pro ? 1 : 3) + (e.e[0] === 'band' ? 0 : 1);
  return list.sort((a, b) => score(a) - score(b) || a.n.localeCompare(b.n, 'ru'));
}
function exRow(e) {
  const on = S.sel.includes(e.id), fav = S.favs.list.includes(e.id);
  return `<li class="ex">
    <button class="main" data-act="ex-info" data-id="${e.id}">
      <div class="nm">${fav ? '<span class="fav">★ </span>' : ''}${esc(e.n)}</div>
      <div class="meta"><span>${GN[e.g] || ''}</span>${e.a ? `<span class="anch ${e.a}"><i></i>${ANCH[e.a]}</span>` : ''}<span>${(e.e || []).map(q => EQN[q]).join(' · ')}</span>${e.own ? '<span class="pro">своё</span>' : e.pro ? '<span class="pro">классика</span>' : ''}</div>
    </button>
    <button class="add ${on ? 'on' : ''}" data-act="toggle-ex" data-id="${e.id}">${on ? '✓' : '+'}</button>
  </li>`;
}
function vBuild() {
  const cnt = g => EX.filter(e => e.g === g && eqAllowed(e)).length;
  const list = filteredEx();
  const eqChips = [['all', 'Всё'], ['fav', '★ Избранное'], ...EQUIP.filter(([k]) => S.settings.eq[k] !== false)];
  return `
  <header class="pagehead"><div class="kick">Рубрика · конструктор</div><h1>${S.addingLive ? 'Добавь в тренировку' : 'Собери тренировку'}</h1><p>${S.addingLive ? 'Нажми «+» у упражнения — оно сразу встанет в текущую тренировку.' : 'Выбери мышцы, отметь упражнения — и в бой.'}</p></header>
  ${S.addingLive ? '' : `<div class="wrap" style="padding-top:12px"><button class="btn yel sm" style="width:100%" data-act="random">🎲 Некогда выбирать? Собери случайно</button></div>`}
  <div class="groups">${GROUPS.map(([k, n]) => `<button class="grp ${S.groups.includes(k) ? 'on' : ''}" data-act="grp" data-g="${k}">${n}<small>${cnt(k)} упр.</small></button>`).join('')}</div>
  <div class="chips">${eqChips.map(([k, n]) => `<button class="chip ${S.eqf === k ? 'on' : ''}" data-act="eqf" data-k="${k}">${n}</button>`).join('')}</div>
  <label class="search"><span class="mute">⌕</span><input id="q" type="search" placeholder="Поиск: тяга, бицепс, face pull…" value="${esc(S.q)}" autocomplete="off"></label>
  <div class="rubric"><span class="tag">${list.length}</span><h2>${S.groups.length === 1 ? GN[S.groups[0]] : S.groups.length ? 'Подборка' : 'Все упражнения'}</h2><button class="r" data-act="new-ex">+ своё</button></div>
  <ul class="exlist" id="exlist">${list.slice(0, 200).map(exRow).join('') || '<div class="empty">Ничего не нашлось. Добавь своё упражнение — кнопка «+ своё».</div>'}</ul>
  ${list.length > 200 ? `<div class="empty">Показаны первые 200 — уточни поиск или выбери мышцы.</div>` : ''}
  <div style="height:${S.sel.length ? 70 : 10}px"></div>
  ${S.addingLive ? `<div class="dock"><button class="btn yel" data-act="resume">← Вернуться к тренировке</button></div>` : S.sel.length ? `<div class="dock"><button class="btn" data-act="setlist">Сет-лист <span class="count">${S.sel.length}</span> — дальше ▸</button></div>` : ''}`;
}
function sheetSetlist() {
  openSheet(`
    <div class="sh-head"><h3>Сет-лист</h3><button class="sh-x" data-act="close">×</button></div>
    <ul class="sl">${S.sel.map((id, i) => `<li><span class="num">${i + 1}</span><span class="nm">${esc(exById(id).n)}</span>
      <button class="mv" data-act="sl-up" data-i="${i}">↑</button><button class="mv" data-act="sl-del" data-i="${i}">✕</button></li>`).join('')}</ul>
    <div class="seg"><button class="${S.mode === 'mega' ? 'on' : ''}" data-act="mode" data-m="mega">Мегасет (круг)</button><button class="${S.mode === 'sets' ? 'on' : ''}" data-act="mode" data-m="sets">По подходам</button></div>
    <p class="mute" style="margin:0 16px;font-size:14px;font-style:italic">${S.mode === 'mega' ? 'Все упражнения подряд без отдыха, отдых — после круга.' : 'Сначала все подходы одного упражнения, потом следующее.'}</p>
    <div class="stepper"><span class="lbl">${S.mode === 'mega' ? 'Кругов (сетов)' : 'Подходов на упражнение'}</span><span class="ctl"><button data-act="rnd" data-d="-1">−</button><b>${S.rounds}</b><button data-act="rnd" data-d="1">+</button></span></div>
    <div class="sh-actions">
      <button class="btn" data-act="start">Начать тренировку</button>
      <div class="row"><button class="btn dark sm" data-act="save-prog">Сохранить как программу</button><button class="btn dark sm" data-act="sl-clear">Очистить</button></div>
    </div>`);
}

/* ---------- рандомайзер ---------- */
const PRESETS = [
  ['Всё тело', ['chest','back','shoulders','quads','hamstrings','abs']],
  ['Верх', ['chest','back','shoulders','biceps','triceps']],
  ['Низ', ['quads','hamstrings','glutes','calves']],
  ['Толкай', ['chest','shoulders','triceps']],
  ['Тяни', ['back','biceps']],
  ['Руки', ['biceps','triceps','forearms']],
];
const BIG = ['chest','back','quads','shoulders','hamstrings','glutes'];
const KN = { c: 'база', i: 'изоляция' };
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const baseKey = n => n.toLowerCase().replace(/\(.*?\)|«.*?»/g, '').replace(/одной рукой|одной ногой|двумя руками|поочерёдн\S*|с резиной|на стенке|стоя|сидя|лёжа/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
function pickOne(g, k, taken) {
  const usedKeys = new Set(taken.map(id => baseKey(exById(id).n)));
  const recent = new Set(S.workouts.slice(-3).flatMap(w => w.items.map(it => it.ex)));
  const favs = new Set(S.favs.list);
  const ok = e => e.g === g && !e.gym && eqAllowed(e) && !taken.includes(e.id) && !usedKeys.has(baseKey(e.n));
  const tiers = [ // от «чистого бодибилдинга» к любому подходящему
    e => ok(e) && (!k || e.k === k) && !['mob','bal','af','ply','pos'].includes(e.cl) && (e.l || 1) <= 2,
    e => ok(e) && (!k || e.k === k) && !['mob','af','ply'].includes(e.cl),
    e => ok(e) && !['mob','af'].includes(e.cl),
    e => ok(e),
  ];
  for (const t of tiers) {
    const pool = EX.filter(t); if (!pool.length) continue;
    const w = pool.map(e => (e.own || e.pro ? 3 : e.cl === 'bb' ? 1.5 : 1) * (favs.has(e.id) ? 4 : 1) * ((e.e || [])[0] === 'band' ? 2 : 1) * (recent.has(e.id) ? 0.3 : 1));
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < pool.length; i++) { r -= w[i]; if (r <= 0) return pool[i].id; }
    return pool[pool.length - 1].id;
  }
  return null;
}
function genRandom() {
  const cfg = S.settings.rnd;
  const groups = cfg.groups.length ? cfg.groups.slice() : PRESETS[0][1].slice();
  const order = shuffle(groups.filter(g => BIG.includes(g))).concat(shuffle(groups.filter(g => !BIG.includes(g))));
  const per = {}; const ids = [];
  for (let i = 0; i < cfg.n; i++) {
    const g = order[i % order.length]; per[g] = (per[g] || 0) + 1;
    const first = ['chest','back','quads','hamstrings','glutes'].includes(g) ? 'c' : 'i'; // в миксе крупные начинают с базы, плечи и мелкие — с изоляции
    const k = cfg.type === 'base' ? 'c' : cfg.type === 'iso' ? 'i' : (per[g] % 2 ? first : (first === 'c' ? 'i' : 'c'));
    const id = pickOne(g, k, ids); if (id) ids.push(id);
  }
  // база вперёд, изоляция в конце
  S.rndIds = ids.filter(id => exById(id).k !== 'i').concat(ids.filter(id => exById(id).k === 'i'));
}
function sheetRandom(keep) {
  const cfg = S.settings.rnd;
  const presetOn = i => { const p = PRESETS[i][1]; return cfg.groups.length === p.length && p.every(g => cfg.groups.includes(g)); };
  openSheet(`
    <div class="sh-head"><h3>🎲 Случайная тренировка</h3><button class="sh-x" data-act="close">×</button></div>
    <div class="chips wrapc">${PRESETS.map(([n], i) => `<button class="chip ${presetOn(i) ? 'on' : ''}" data-act="rnd-preset" data-i="${i}">${n}</button>`).join('')}</div>
    <div class="chips wrapc">${GROUPS.map(([k, n]) => `<button class="chip ${cfg.groups.includes(k) ? 'on' : ''}" data-act="rnd-grp" data-k="${k}">${n}</button>`).join('')}</div>
    <p class="mute hint">${cfg.groups.length ? 'Мышцы: ' + cfg.groups.map(g => GN[g].toLowerCase()).join(', ') : 'Мышцы не выбраны — будет всё тело'}</p>
    <div class="seg">${[['base', 'База'], ['mix', 'Микс'], ['iso', 'Изоляция']].map(([k, n]) => `<button class="${cfg.type === k ? 'on' : ''}" data-act="rnd-type" data-k="${k}">${n}</button>`).join('')}</div>
    <div class="stepper"><span class="lbl">Упражнений</span><span class="ctl"><button data-act="rnd-n" data-d="-1">−</button><b>${cfg.n}</b><button data-act="rnd-n" data-d="1">+</button></span></div>
    <div class="rubric" style="padding-top:6px"><span class="tag">Выпало</span><button class="r" data-act="rnd-all">🎲 перебросить всё</button></div>
    <ul class="sl">${S.rndIds.map((id, i) => { const e = exById(id); return `<li><span class="num">${i + 1}</span>
      <button class="nm" data-act="ex-info" data-id="${id}">${esc(e.n)}<small>${GN[e.g]} · ${KN[e.k] || ''}${e.a ? ' · крепление: ' + ANCH[e.a] : ''}</small></button>
      <button class="mv" data-act="rnd-one" data-i="${i}">🎲</button><button class="mv" data-act="rnd-del" data-i="${i}">✕</button></li>`; }).join('') || '<div class="empty">Под такие условия ничего не нашлось.</div>'}</ul>
    <div class="seg"><button class="${S.mode === 'mega' ? 'on' : ''}" data-act="rnd-mode" data-m="mega">Мегасет (круг)</button><button class="${S.mode === 'sets' ? 'on' : ''}" data-act="rnd-mode" data-m="sets">По подходам</button></div>
    <div class="stepper"><span class="lbl">${S.mode === 'mega' ? 'Кругов' : 'Подходов'}</span><span class="ctl"><button data-act="rnd-r" data-d="-1">−</button><b>${S.rounds}</b><button data-act="rnd-r" data-d="1">+</button></span></div>
    <div class="sh-actions"><button class="btn dark sm" data-act="rnd-edit">Поправить в конструкторе</button></div>
    <div class="sticky-go"><button class="btn" data-act="rnd-go" ${S.rndIds.length ? '' : 'disabled'}>Поехали! ${S.rndIds.length} упр. ▸</button></div>`, false, keep);
}
function rndChanged() { saveBlob('settings'); genRandom(); haptic(); sheetRandom(true); }

/* ---------- exercise info ---------- */
function sheetEx(id) {
  const e = exById(id); const fav = S.favs.list.includes(id); const on = S.sel.includes(id);
  const hist = [];
  for (let i = S.workouts.length - 1; i >= 0 && hist.length < 6; i--) { const it = S.workouts[i].items.find(x => x.ex === id); if (it && it.sets.some(s => s.r)) hist.push([S.workouts[i], it]); }
  let best = 0; S.workouts.forEach(w => w.items.forEach(it => { if (it.ex === id) it.sets.forEach(s => best = Math.max(best, +s.r || 0)); }));
  openSheet(`
    <div class="sh-head"><h3>${esc(e.n)}</h3><button class="sh-x" data-act="close">×</button></div>
    <dl class="kv">
      <dt>Мышцы</dt><dd>${GN[e.g] || ''}${e.m && e.m.length ? ' — ' + esc(e.m.join(', ')) : ''}</dd>
      ${e.a ? `<dt>Крепление</dt><dd>резина на стенке: <b>${ANCH[e.a]}</b></dd>` : ''}
      <dt>Инвентарь</dt><dd>${(e.e || []).map(q => EQN[q]).join(', ')}</dd>
      ${e.l ? `<dt>Уровень</dt><dd>${LVL[e.l]}</dd>` : ''}
      ${e.en ? `<dt>В оригинале</dt><dd class="mute">${esc(e.en)}</dd>` : ''}
      ${best ? `<dt>Рекорд</dt><dd><b class="red">${best}</b> повторов в подходе</dd>` : ''}
    </dl>
    ${e.t ? `<div class="tip"><b>Техника</b>${esc(e.t)}</div>` : ''}
    ${hist.length ? `<div class="rubric" style="padding-top:6px"><span class="tag">История</span></div><div class="hist">${hist.map(([w, it]) => `<div class="hr"><span>${fmtDate(w.start)}</span><span>${esc(setsTxt(it.sets))}</span></div>`).join('')}</div>` : ''}
    <div class="sh-actions">
      ${S.tab === 'live' ? '' : S.addingLive ? `<button class="btn" data-act="toggle-ex" data-id="${id}">+ В тренировку</button>` : `<button class="btn ${on ? 'dark' : ''}" data-act="toggle-ex" data-id="${id}" data-close="1">${on ? 'Убрать из сет-листа' : '+ В сет-лист'}</button>`}
      <div class="row">
        <button class="btn dark sm" data-act="fav" data-id="${id}">${fav ? '★ В избранном' : '☆ В избранное'}</button>
        ${e.v ? `<button class="btn dark sm" data-act="video" data-u="${esc(e.v)}">▶ Видео</button>` : `<button class="btn dark sm" data-act="yt" data-q="${esc(e.en || e.n + ' резина')}">▶ Найти видео</button>`}
      </div>
      ${e.own ? `<button class="btn ghost sm" data-act="del-own" data-id="${id}">Удалить упражнение</button>` : ''}
    </div>`);
}
function sheetNewEx() {
  openSheet(`
    <div class="sh-head"><h3>Своё упражнение</h3><button class="sh-x" data-act="close">×</button></div>
    <label class="field"><span>Название</span><input id="ne-n" placeholder="Например: тяга резины к поясу одной рукой"></label>
    <label class="field"><span>Мышцы</span><select id="ne-g">${GROUPS.map(([k, n]) => `<option value="${k}" ${S.groups[0] === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <label class="field"><span>Крепление резины</span><select id="ne-a"><option value="">без крепления</option>${Object.entries(ANCH).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></label>
    <label class="field"><span>Заметка по технике (необязательно)</span><textarea id="ne-t" rows="2"></textarea></label>
    <div class="sh-actions"><button class="btn" data-act="save-own">Сохранить</button></div>`);
}

/* ---------- live workout ---------- */
function startWorkout(items, mode, rounds, title) {
  const now = Date.now();
  S.draft = {
    id: uid(), start: now, mode, rounds, title: title || '',
    items: items.map(ex => {
      const prev = lastFor(ex);
      const n = mode === 'mega' ? rounds : rounds;
      const ps = prev ? prev.it.sets.filter(s => s.r) : [];
      return { ex, sets: Array.from({ length: n }, (_, i) => { const p = ps[Math.min(i, ps.length - 1)]; return { r: '', p: p ? +p.r : '', b: p ? (p.b || []).slice() : [], d: 0 }; }) };
    }),
  };
  S.round = 0; S.sel = []; saveDraft(); closeSheet(); notify(); go('live');
}
function vLive() {
  const d = S.draft; if (!d) { S.tab = 'cover'; return vCover(); }
  const mega = d.mode === 'mega';
  let body = '';
  if (mega) {
    const R = d.rounds;
    const roundDone = r => d.items.every(it => it.sets[r] && it.sets[r].d);
    body += `<div class="round-tabs">${Array.from({ length: R }, (_, r) => `<button class="${r === S.round ? 'on' : ''} ${roundDone(r) ? 'done' : ''}" data-act="round" data-r="${r}">Круг ${r + 1}</button>`).join('')}<button data-act="add-round">+ круг</button></div>`;
    body += d.items.map((it, i) => wxCard(it, i, [S.round])).join('');
  } else {
    body += d.items.map((it, i) => wxCard(it, i, it.sets.map((_, k) => k))).join('');
  }
  return `
  <div class="live-top"><div><div class="lt">${mega ? `Мегасет · круг ${S.round + 1} из ${d.rounds}` : 'По подходам'}</div><div class="clock" id="clock">${clock(Date.now() - d.start)}</div></div>
    <button class="btn sm" data-act="finish">Финиш ▸</button></div>
  ${body}
  <div class="wrap" style="margin-top:10px;display:flex;flex-direction:column;gap:10px">
    <button class="btn dark sm" data-act="live-add" style="width:100%">+ Добавить упражнение</button>
    <button class="btn ghost sm" data-act="cancel-w" style="width:100%">Отменить тренировку</button>
  </div>
  <div style="height:90px"></div>
  ${restEl()}`;
}
function wxCard(it, i, setIdx) {
  const e = exById(it.ex);
  const prev = lastFor(it.ex, S.draft.start);
  return `<div class="wx" data-i="${i}">
    <div class="wx-h"><span class="n">${i + 1}</span><div class="t"><b>${esc(e.n)}</b><small>${GN[e.g] || ''}${e.a ? ' · крепление: ' + ANCH[e.a] : ''}</small></div>
      <button class="info" data-act="ex-info" data-id="${e.id}">i</button></div>
    ${prev ? `<div class="prev">Прошлый раз (${fmtDate(prev.w.start)}): <b>${esc(setsTxt(prev.it.sets))}</b></div>` : ''}
    ${setIdx.map(k => setRow(it, i, k)).join('')}
    ${S.draft.mode === 'sets' ? `<button class="addset" data-act="add-set" data-i="${i}">+ подход</button>` : ''}
  </div>`;
}
function setRow(it, i, k) {
  const s = it.sets[k]; if (!s) return '';
  return `<div class="set">
    <span class="sn">${S.draft.mode === 'mega' ? '' : (k + 1) + '.'}</span>
    <div class="reps"><button data-act="rep" data-i="${i}" data-k="${k}" data-d="-1">−</button><input inputmode="numeric" pattern="[0-9]*" data-i="${i}" data-k="${k}" value="${esc(s.r)}" placeholder="${esc(s.p || 'повт')}"><button data-act="rep" data-i="${i}" data-k="${k}" data-d="1">+</button></div>
    <div class="bands">${S.settings.bands.map(b => `<button class="bd ${s.b.includes(b.id) ? 'on' : ''}" data-act="band" data-i="${i}" data-k="${k}" data-b="${b.id}"><i style="background:${esc(b.c)}"></i>${esc(b.name)}</button>`).join('')}</div>
    <button class="ok ${s.d ? 'on' : ''}" data-act="done" data-i="${i}" data-k="${k}">✓</button>
  </div>`;
}
let rest = null; // {end}
function restEl() { if (!rest) return ''; return `<div class="rest" id="rest"><b id="rest-t">${clock(rest.end - Date.now())}</b><span>Отдых</span><button data-act="rest-add">+30</button><button data-act="rest-stop">Хватит</button></div>`; }
function startRest(sec) { rest = { end: Date.now() + sec * 1000 }; const el = $('#rest'); if (el) el.remove(); $('#screen').insertAdjacentHTML('beforeend', restEl()); }
function tick() {
  const c = $('#clock'); if (c && S.draft) c.textContent = clock(Date.now() - S.draft.start);
  if (rest) {
    const left = rest.end - Date.now(); const t = $('#rest-t');
    if (left <= 0) { rest = null; $('#rest')?.remove(); notify('warning'); toast('Отдых окончен — работаем!'); }
    else if (t) t.textContent = clock(left);
  }
  renderLivebar();
}
function renderLivebar() {
  const lb = $('#livebar');
  if (S.draft && S.tab !== 'live') { lb.hidden = false; lb.innerHTML = `<span>● Идёт тренировка</span><span>${clock(Date.now() - S.draft.start)} ▸</span>`; }
  else lb.hidden = true;
}
function curRound() { // первый незакрытый круг
  const d = S.draft; if (!d || d.mode !== 'mega') return;
  let r = 0; while (r < d.rounds - 1 && d.items.every(it => it.sets[r] && it.sets[r].d)) r++;
  S.round = r;
}
async function finishWorkout() {
  const d = S.draft; if (!d) return;
  d.items.forEach(it => it.sets.forEach(s => { if (!s.r && s.d && s.p) s.r = s.p; }));
  d.items.forEach(it => { it.sets = it.sets.filter(s => s.r).map(s => ({ r: +s.r, b: s.b })); });
  d.items = d.items.filter(it => it.sets.length);
  if (!d.items.length) { if (!await ask('Ни одного подхода не записано. Удалить тренировку?')) return; S.draft = null; saveDraft(); go('cover'); return; }
  d.end = Date.now();
  const w = d; S.workouts.push(w); S.draft = null; rest = null;
  saveWorkout(w); saveDraft(); notify();
  go('journal'); sheetReport(w.id, true);
}

/* ---------- journal ---------- */
function vJournal() {
  const now = new Date();
  if (!S.jm) S.jm = [now.getFullYear(), now.getMonth()];
  const [Y, M] = S.jm;
  const first = new Date(Y, M, 1); const days = new Date(Y, M + 1, 0).getDate(); const off = (first.getDay() + 6) % 7;
  const inMon = S.workouts.filter(w => { const d = new Date(w.start); return d.getFullYear() === Y && d.getMonth() === M; });
  const perDay = {}; inMon.forEach(w => { const dd = new Date(w.start).getDate(); perDay[dd] = (perDay[dd] || 0) + 1; });
  let cal = ['пн','вт','ср','чт','пт','сб','вс'].map(x => `<div class="dw">${x}</div>`).join('');
  for (let i = 0; i < off; i++) cal += '<div></div>';
  for (let dd = 1; dd <= days; dd++) {
    const today = Y === now.getFullYear() && M === now.getMonth() && dd === now.getDate();
    cal += `<div class="d ${perDay[dd] ? 'w' : ''} ${perDay[dd] > 1 ? 'w2' : ''} ${today ? 't' : ''}">${dd}</div>`;
  }
  const st = inMon.reduce((a, w) => { const s = wStats(w); a.sets += s.sets; a.reps += s.reps; a.min += s.dur / 60000; return a; }, { sets: 0, reps: 0, min: 0 });
  // мышцы за 30 дней (подходы)
  const since = Date.now() - 30 * 864e5; const mg = {};
  S.workouts.filter(w => w.start >= since).forEach(w => w.items.forEach(it => { const g = exById(it.ex).g; mg[g] = (mg[g] || 0) + it.sets.length; }));
  const mx = Math.max(1, ...Object.values(mg));
  // 12 недель
  const wk = []; const mon0 = new Date(); mon0.setHours(0, 0, 0, 0); mon0.setDate(mon0.getDate() - ((mon0.getDay() + 6) % 7));
  for (let i = 11; i >= 0; i--) { const a = mon0.getTime() - i * 7 * 864e5, b = a + 7 * 864e5; wk.push(S.workouts.filter(w => w.start >= a && w.start < b).length); }
  const wmx = Math.max(3, ...wk);
  const list = inMon.slice().reverse();
  return `
  <header class="pagehead"><div class="kick">Рубрика · архив номеров</div><h1>Дневник</h1><p>Каждая тренировка — новый выпуск журнала.</p></header>
  <div class="month"><button data-act="mon" data-d="-1">‹</button><b>${MONTHS[M]} ${Y}</b><button data-act="mon" data-d="1">›</button></div>
  <div class="cal">${cal}</div>
  <div class="stats"><div class="stat"><b>${inMon.length}</b><span>тренировок</span></div><div class="stat"><b>${st.sets}</b><span>подходов</span></div><div class="stat"><b>${st.reps.toLocaleString('ru')}</b><span>повторов</span></div></div>
  <div class="rubric"><span class="tag">Номера</span><h2>${MONTHS[M]}</h2></div>
  ${list.length ? list.map(issueRow).join('') : '<div class="empty">В этом месяце тренировок нет.</div>'}
  ${S.workouts.length ? `
  <div class="rubric"><span class="tag">Анализ</span><h2>Мышцы · 30 дней</h2><span class="r">подходы</span></div>
  <div class="bars">${Object.keys(mg).length ? GROUPS.filter(([k]) => mg[k]).sort((a, b) => mg[b[0]] - mg[a[0]]).map(([k, n]) => `<div class="bar"><span>${n}</span><span class="tr"><i style="width:${mg[k] / mx * 100}%"></i></span><b>${mg[k]}</b></div>`).join('') : '<div class="empty">За 30 дней пусто</div>'}</div>
  <div class="rubric"><span class="tag">Режим</span><h2>12 недель</h2><span class="r">трен./нед.</span></div>
  <div class="weeks" style="margin-top:14px">${wk.map((n, i) => `<div class="${i === 11 ? 'c' : ''}" style="height:${n / wmx * 100}%">${n ? `<b>${n}</b>` : ''}</div>`).join('')}</div>
  <div class="wlbl"><span>12 нед. назад</span><span>эта неделя</span></div>
  <div class="stats"><div class="stat"><b>${S.workouts.length}</b><span>всего</span></div><div class="stat"><b>${weekStreak()}</b><span>недель подряд</span></div><div class="stat"><b>${Math.round(S.workouts.reduce((a, w) => a + wStats(w).dur, 0) / 3600000)}</b><span>часов в железе</span></div></div>` : ''}
  <div style="height:20px"></div>`;
}
function issueRow(w) {
  const s = wStats(w);
  return `<button class="issue" data-act="report" data-id="${w.id}">
    <div class="no"><b>${issueNo(w)}</b><span>выпуск</span></div>
    <div class="bd2"><small>${fmtDate(w.start)} · ${fmtTime(w.start)} · ${fmtDur(s.dur)}</small><h4>${esc(wTitle(w))}</h4>
    <p>${w.items.map(it => esc(exById(it.ex).n)).join(' / ')}</p></div></button>`;
}
function channelText(w) {
  const lines = [`🗓️ ТРЕНИРОВКА // ${fmtDate(w.start)} (${fmtTime(w.start)})`];
  if (w.mode === 'mega') lines.push(`🔄 Мегасет — ${plural(w.rounds, 'сет', 'сета', 'сетов')}`);
  else lines.push(`🏋️ По подходам — ${fmtDur(w.end - w.start)}`);
  lines.push('');
  w.items.forEach((it, i) => lines.push(`${NUMS[i] || (i + 1) + '.'} ${exById(it.ex).n} — ${setsTxt(it.sets)}`));
  if (w.note) lines.push('', w.note);
  return lines.join('\n');
}
function sheetReport(id, fresh) {
  const w = S.workouts.find(x => x.id === id); if (!w) return;
  const s = wStats(w);
  const d = new Date(w.start);
  const deck = `${d.getDate()} ${MONTHS_G[d.getMonth()]}, ${fmtTime(w.start)}. ${w.mode === 'mega' ? plural(w.rounds, 'круг', 'круга', 'кругов') + ' мегасета' : 'Работа по подходам'} — ${fmtDur(s.dur)} чистого железа.`;
  openSheet(`
    <div class="art">
      <div class="art-kick"><b>Выпуск №${issueNo(w)}</b><span>${fresh ? 'Свежий номер' : 'Отчёт'}</span><button class="sh-x" data-act="close" style="margin-top:-8px">×</button></div>
      <h2>${esc(wTitle(w))}</h2>
      <p class="deck">${deck}</p>
      <div class="art-stats"><div><b>${s.ex}</b><span>упражн.</span></div><div><b>${s.sets}</b><span>подходов</span></div><div><b>${s.reps}</b><span>повторов</span></div><div><b>${Math.max(1, Math.round(s.dur / 60000))}</b><span>минут</span></div></div>
      <div class="art-tbl">${w.items.map((it, i) => { const e = exById(it.ex); return `<div class="art-ex"><span class="n">${i + 1}</span><div class="x"><b>${esc(e.n)}</b><small>${GN[e.g] || ''}</small><div class="sets">${esc(setsTxt(it.sets))}</div></div></div>`; }).join('')}</div>
      ${w.note && !fresh ? `<div class="note">${esc(w.note)}</div>` : ''}
      <div class="rubric" style="border:0;padding-bottom:4px"><span class="tag">Самочувствие</span></div>
      <div class="rate">${RATES.map(([k, n]) => `<button class="${w.rate === k ? 'on' : ''}" data-act="rate" data-id="${w.id}" data-k="${k}">${n}</button>`).join('')}</div>
      <label class="field"><span>Название выпуска</span><input id="rp-title" value="${esc(w.title || '')}" placeholder="${esc(wTitle(Object.assign({}, w, { title: '' })))}"></label>
      <label class="field"><span>Заметки</span><textarea id="rp-note" rows="3" placeholder="Как прошло, что поменять в следующий раз…">${esc(w.note || '')}</textarea></label>
      <div class="sh-actions">
        <button class="btn dark" data-act="rp-save" data-id="${w.id}">Сохранить</button>
        <div class="row"><button class="btn ghost sm" data-act="rp-copy" data-id="${w.id}">Текст для канала</button><button class="btn ghost sm" data-act="rp-share" data-id="${w.id}">Отправить</button></div>
        <div class="row"><button class="btn ghost sm" data-act="repeat" data-id="${w.id}">Повторить</button><button class="btn ghost sm" data-act="rp-del" data-id="${w.id}">Удалить</button></div>
      </div>
    </div>`, true);
}

/* ---------- more ---------- */
function vMore() {
  const st = S.settings;
  return `
  <header class="pagehead"><div class="kick">Рубрика · редакция</div><h1>Ещё</h1><p>Программы, резины, инвентарь и резервная копия.</p></header>
  <div class="rubric"><span class="tag">Программы</span><h2>Мои программы</h2><span class="r">${S.programs.list.length}</span></div>
  ${S.programs.list.map(progRow).join('') || '<div class="empty">Собери тренировку в конструкторе и сохрани её как программу.</div>'}
  <div class="rubric"><span class="tag">Резины</span><h2>Мои резины</h2><button class="r" data-act="band-add">+ добавить</button></div>
  <p class="mute" style="margin:8px 16px 4px;font-size:14px;font-style:italic">От лёгкой к тяжёлой. В подходе можно отметить несколько сразу.</p>
  ${st.bands.map((b, i) => `<div class="bandrow"><input type="color" value="${esc(b.c)}" data-band-c="${i}"><input type="text" value="${esc(b.name)}" data-band-n="${i}"><button data-act="band-del" data-i="${i}">✕</button></div>`).join('')}
  <div class="rubric"><span class="tag">Инвентарь</span><h2>Что есть дома</h2></div>
  ${EQUIP.map(([k, n]) => `<button class="toggle ${st.eq[k] !== false ? 'on' : ''}" data-act="eq" data-k="${k}"><span>${n}</span><i></i></button>`).join('')}
  <button class="toggle ${st.gym ? 'on' : ''}" data-act="gym"><span>Гимнастика (флаги, планш, стойки на руках)</span><i></i></button>
  <div class="rubric"><span class="tag">Режим</span><h2>Настройки</h2></div>
  <div class="stepper"><span class="lbl">Отдых, сек</span><span class="ctl"><button data-act="rest-set" data-d="-15">−</button><b>${st.rest}</b><button data-act="rest-set" data-d="15">+</button></span></div>
  <div class="rubric"><span class="tag">Обложка</span><h2>Фото на обложку</h2></div>
  <div class="wrap row" style="padding-top:10px"><label class="btn dark sm" style="cursor:pointer">Выбрать фото<input type="file" accept="image/*" id="cover-file" hidden></label>${S.coverImg ? '<button class="btn ghost sm" data-act="cover-del">Убрать</button>' : ''}</div>
  <div class="rubric"><span class="tag">Архив</span><h2>Резервная копия</h2></div>
  <p class="mute" style="margin:8px 16px;font-size:14px;font-style:italic">${cloudOK() ? 'Дневник хранится в облаке Telegram и доступен с любого твоего устройства.' : 'Сейчас данные хранятся только в этом браузере.'} Копию можно сохранить файлом на всякий случай.</p>
  <div class="wrap row"><button class="btn dark sm" data-act="export">Скачать копию</button><label class="btn dark sm" style="cursor:pointer">Загрузить<input type="file" accept=".json,application/json" id="import-file" hidden></label></div>
  <div class="foot">ЖЕЛЕЗО · домашний журнал тренировок. База упражнений — на основе Functional Fitness Exercise Database (Strength to Overcome), переведено и отобрано для тренировок дома; видео — с их YouTube-канала.</div>`;
}
function progRow(p) {
  return `<div class="prog"><div class="t"><b>${esc(p.name)}</b><small>${p.mode === 'mega' ? 'Мегасет × ' + p.rounds : 'Подходы × ' + p.rounds} · ${p.items.map(id => exById(id).n).join(', ')}</small></div>
    <button class="btn sm" data-act="prog-go" data-id="${p.id}">▸</button><button class="btn dark sm" data-act="prog-edit" data-id="${p.id}">✎</button></div>`;
}
function sheetPrograms() {
  openSheet(`<div class="sh-head"><h3>Мои программы</h3><button class="sh-x" data-act="close">×</button></div>
    ${S.programs.list.map(progRow).join('') || '<div class="empty">Программ пока нет.</div>'}
    <div class="sh-actions"><button class="btn dark" data-act="go-build">Собрать новую</button></div>`);
}

/* ---------- sheet ---------- */
function openSheet(html, paper, keepScroll) {
  const sh = $('#sheet'); const b = $('.sheet-body', sh);
  b.className = 'sheet-body' + (paper ? ' paper' : '') + (sh.hidden ? ' anim' : ''); b.innerHTML = html; const st = b.scrollTop; sh.hidden = false; b.scrollTop = keepScroll ? st : 0;
  if (tg?.BackButton) tg.BackButton.show();
}
function closeSheet() { $('#sheet').hidden = true; if (tg?.BackButton && (S.tab === 'cover' || S.tab === 'live')) tg.BackButton.hide(); }
const sheetOpen = () => !$('#sheet').hidden;


/* диалоги: в Telegram — нативные окна, в браузере — стандартные */
const tgPopups = () => !!(tg && tg.isVersionAtLeast && tg.isVersionAtLeast('6.2') && tg.platform !== 'unknown');
function ask(msg) { return new Promise(r => { if (tgPopups()) { try { tg.showConfirm(msg, ok => r(!!ok)); return; } catch (e) {} } r(window.confirm(msg)); }); }
function askChoice(msg, btns) {
  return new Promise(r => {
    if (tgPopups()) { try { tg.showPopup({ message: msg, buttons: btns.map(([id, text]) => id === 'no' ? { id, type: 'cancel' } : id === 'del' ? { id, type: 'destructive', text } : { id, type: 'default', text }) }, id => r(id || 'no')); return; } catch (e) {} }
    r(window.confirm(msg + ' — изменить? (Отмена — удалить)') ? 'edit' : 'del');
  });
}
function askText(title, def) {
  return new Promise(r => {
    askText.cb = r;
    openSheet(`<div class="sh-head"><h3>${esc(title)}</h3><button class="sh-x" data-act="ask-cancel">×</button></div>
      <label class="field"><input id="ask-in" value="${esc(def || '')}" maxlength="40"></label>
      <div class="sh-actions"><button class="btn" data-act="ask-ok">Сохранить</button></div>`);
    setTimeout(() => $('#ask-in')?.focus(), 100);
  });
}

/* ---------------- actions ---------------- */
const A = {
  'go-build': () => { closeSheet(); go('build'); },
  random: () => { if (S.draft) return go('live'); genRandom(); sheetRandom(); },
  'rnd-preset': el => { const p = PRESETS[+el.dataset.i][1]; const c = S.settings.rnd; const same = c.groups.length === p.length && p.every(g => c.groups.includes(g)); c.groups = same ? [] : p.slice(); c.n = Math.max(c.n, Math.min(8, c.groups.length)); rndChanged(); },
  'rnd-grp': el => { const c = S.settings.rnd, g = el.dataset.k; c.groups = c.groups.includes(g) ? c.groups.filter(x => x !== g) : [...c.groups, g]; rndChanged(); },
  'rnd-type': el => { S.settings.rnd.type = el.dataset.k; rndChanged(); },
  'rnd-n': el => { const c = S.settings.rnd; c.n = Math.min(12, Math.max(2, c.n + +el.dataset.d)); rndChanged(); },
  'rnd-all': () => { genRandom(); haptic('medium'); sheetRandom(true); },
  'rnd-one': el => {
    const i = +el.dataset.i; const old = exById(S.rndIds[i]); const others = S.rndIds.filter((_, j) => j !== i).concat(old.id);
    const nid = pickOne(old.g, old.k, others) || pickOne(old.g, null, others);
    if (nid) S.rndIds[i] = nid; else toast('Других вариантов нет'); haptic(); sheetRandom(true);
  },
  'rnd-del': el => { S.rndIds.splice(+el.dataset.i, 1); sheetRandom(true); },
  'rnd-mode': el => { S.mode = el.dataset.m; sheetRandom(true); },
  'rnd-r': el => { S.rounds = Math.min(10, Math.max(1, S.rounds + +el.dataset.d)); sheetRandom(true); },
  'rnd-go': () => { if (S.rndIds.length) startWorkout(S.rndIds.slice(), S.mode, S.rounds, ''); },
  'rnd-edit': () => { S.sel = S.rndIds.slice(); closeSheet(); go('build'); sheetSetlist(); },

  'go-journal': () => go('journal'),
  resume: () => { S.addingLive = false; curRound(); go('live'); },
  programs: () => sheetPrograms(),
  grp: el => { const g = el.dataset.g; S.groups = S.groups.includes(g) ? S.groups.filter(x => x !== g) : [...S.groups, g]; haptic(); rerenderBuild(); },
  eqf: el => { S.eqf = el.dataset.k; rerenderBuild(); },
  'toggle-ex': el => {
    const id = el.dataset.id;
    if (S.addingLive && S.draft) { addToLive(id); return; }
    S.sel = S.sel.includes(id) ? S.sel.filter(x => x !== id) : [...S.sel, id]; haptic();
    if (el.dataset.close) closeSheet();
    rerenderBuild();
  },
  'ex-info': el => sheetEx(el.dataset.id),
  fav: el => { const id = el.dataset.id; const l = S.favs.list; S.favs.list = l.includes(id) ? l.filter(x => x !== id) : [...l, id]; saveBlob('favs'); haptic(); sheetEx(id); if (S.tab === 'build') rerenderBuild(); },
  video: el => openLink(el.dataset.u),
  yt: el => openLink('https://www.youtube.com/results?search_query=' + encodeURIComponent(el.dataset.q)),
  'new-ex': () => sheetNewEx(),
  'save-own': () => {
    const n = $('#ne-n').value.trim(); if (!n) return toast('Впиши название');
    const c = { id: 'u' + uid(), n, g: $('#ne-g').value, a: $('#ne-a').value, t: $('#ne-t').value.trim() };
    S.custom.list.push(c); saveBlob('custom'); buildIndex(); S.sel.push(c.id); closeSheet(); toast('Добавлено в сет-лист'); render();
  },
  'del-own': async el => { if (!await ask('Удалить своё упражнение? В дневнике оно останется как «удалённое».')) return; S.custom.list = S.custom.list.filter(c => c.id !== el.dataset.id); S.sel = S.sel.filter(x => x !== el.dataset.id); saveBlob('custom'); buildIndex(); closeSheet(); render(); },
  setlist: () => sheetSetlist(),
  'sl-up': el => { const i = +el.dataset.i; if (i > 0) { [S.sel[i - 1], S.sel[i]] = [S.sel[i], S.sel[i - 1]]; } sheetSetlist(); },
  'sl-del': el => { S.sel.splice(+el.dataset.i, 1); if (!S.sel.length) { closeSheet(); } else sheetSetlist(); rerenderBuild(); },
  'sl-clear': () => { S.sel = []; closeSheet(); rerenderBuild(); },
  mode: el => { S.mode = el.dataset.m; sheetSetlist(); },
  rnd: el => { S.rounds = Math.min(10, Math.max(1, S.rounds + +el.dataset.d)); sheetSetlist(); },
  start: async () => { if (S.draft && !await ask('Уже идёт тренировка. Начать новую? Текущая будет отменена.')) return; startWorkout(S.sel, S.mode, S.rounds, S.editProg ? (S.programs.list.find(p => p.id === S.editProg) || {}).name : ''); S.editProg = null; },
  'save-prog': async () => {
    const ex = S.editProg && S.programs.list.find(p => p.id === S.editProg);
    const name = await askText('Название программы', ex ? ex.name : (S.groups.map(g => GN[g]).join(', ') || 'Моя тренировка'));
    if (!name) return;
    if (ex) Object.assign(ex, { name, mode: S.mode, rounds: S.rounds, items: S.sel.slice() });
    else S.programs.list.push({ id: uid(), name, mode: S.mode, rounds: S.rounds, items: S.sel.slice() });
    saveBlob('programs'); toast('Программа сохранена');
  },
  'prog-go': async el => { const p = S.programs.list.find(x => x.id === el.dataset.id); if (!p) return; if (S.draft && !await ask('Уже идёт тренировка. Начать новую?')) return; startWorkout(p.items.filter(id => EXI[id]), p.mode, p.rounds, p.name); },
  'prog-edit': async el => {
    const p = S.programs.list.find(x => x.id === el.dataset.id); if (!p) return;
    const act = await askChoice('«' + p.name + '»', [['edit', 'Изменить'], ['del', 'Удалить'], ['no', 'Отмена']]);
    if (act === 'edit') { S.sel = p.items.slice(); S.mode = p.mode; S.rounds = p.rounds; S.editProg = p.id; closeSheet(); go('build'); sheetSetlist(); }
    else if (act === 'del' && await ask('Точно удалить программу «' + p.name + '»?')) { S.programs.list = S.programs.list.filter(x => x !== p); saveBlob('programs'); closeSheet(); render(); }
  },
  repeat: async el => { const w = S.workouts.find(x => x.id === el.dataset.id); if (!w) return; if (S.draft && !await ask('Уже идёт тренировка. Начать новую?')) return; startWorkout(w.items.map(it => it.ex), w.mode, w.mode === 'mega' ? w.rounds : Math.max(...w.items.map(it => it.sets.length)), w.title); },
  // live
  round: el => { S.round = +el.dataset.r; render(); },
  'add-round': () => { const d = S.draft; d.rounds++; d.items.forEach(it => { const last = it.sets[it.sets.length - 1] || { b: [] }; it.sets.push({ r: '', p: last.r || last.p || '', b: (last.b || []).slice(), d: 0 }); }); S.round = d.rounds - 1; saveDraft(); render(); },
  'add-set': el => { const it = S.draft.items[+el.dataset.i]; const last = it.sets[it.sets.length - 1] || { b: [] }; it.sets.push({ r: '', p: last.r || last.p || '', b: (last.b || []).slice(), d: 0 }); saveDraft(); render(); },
  rep: el => { const s = S.draft.items[+el.dataset.i].sets[+el.dataset.k]; const cur = s.r === '' ? (+s.p || 9) : +s.r; s.r = Math.max(0, cur + +el.dataset.d) || ''; haptic(); saveDraft(); const inp = el.parentNode.querySelector('input'); inp.value = s.r; },
  band: el => { const s = S.draft.items[+el.dataset.i].sets[+el.dataset.k]; const b = el.dataset.b; s.b = s.b.includes(b) ? s.b.filter(x => x !== b) : [...s.b, b]; el.classList.toggle('on'); haptic(); saveDraft(); },
  done: el => {
    const d = S.draft; const i = +el.dataset.i, k = +el.dataset.k; const s = d.items[i].sets[k];
    s.d = s.d ? 0 : 1; if (s.d && !s.r && s.p) s.r = s.p;
    const nx = d.items[i].sets[k + 1]; // переносим повторы и резину в следующий подход/круг
    if (s.d && nx && !nx.d) { if (!nx.r && s.r) nx.p = s.r; if (s.b.length) nx.b = s.b.slice(); }
    haptic('medium'); saveDraft();
    if (s.d) {
      if (d.mode === 'mega') {
        const all = d.items.every(it => it.sets[k] && it.sets[k].d);
        if (all) { notify(); if (k < d.rounds - 1) { S.round = k + 1; render(); startRest(S.settings.rest); toast(`Круг ${k + 1} готов!`); } else { render(); toast('Все круги сделаны — жми «Финиш»'); } return; }
      } else startRest(S.settings.rest);
    }
    render();
  },
  'rest-add': () => { if (rest) rest.end += 30000; },
  'rest-stop': () => { rest = null; $('#rest')?.remove(); },
  'live-add': () => { S.tab = 'build'; S.addingLive = true; render(); toast('Выбери упражнение и нажми «+»'); },
  finish: async () => { if (await ask('Закончить тренировку и записать в дневник?')) finishWorkout(); },
  'cancel-w': async () => { if (await ask('Отменить тренировку? Записанные подходы пропадут.')) { S.draft = null; rest = null; saveDraft(); go('cover'); } },
  // journal
  mon: el => { let [y, m] = S.jm; m += +el.dataset.d; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } S.jm = [y, m]; render(); },
  report: el => sheetReport(el.dataset.id),
  rate: el => { const w = S.workouts.find(x => x.id === el.dataset.id); w.rate = w.rate === el.dataset.k ? '' : el.dataset.k; saveWorkout(w); el.parentNode.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === w.rate)); haptic(); },
  'rp-save': el => { const w = S.workouts.find(x => x.id === el.dataset.id); w.title = $('#rp-title').value.trim(); w.note = $('#rp-note').value.trim(); saveWorkout(w); closeSheet(); render(); toast('Сохранено'); },
  'rp-copy': el => { const w = S.workouts.find(x => x.id === el.dataset.id); copy(channelText(w)); },
  'rp-share': el => { const w = S.workouts.find(x => x.id === el.dataset.id); const u = 'https://t.me/share/url?url=' + encodeURIComponent(' ') + '&text=' + encodeURIComponent(channelText(w)); if (tg?.openTelegramLink) tg.openTelegramLink(u); else openLink(u); },
  'rp-del': async el => { if (!await ask('Удалить этот выпуск из дневника?')) return; const id = el.dataset.id; S.workouts = S.workouts.filter(x => x.id !== id); LS.set('workouts', S.workouts); const del = LS.get('deleted') || []; del.push(id); LS.set('deleted', del.slice(-200)); Cloud.del(['w_' + id]); closeSheet(); render(); },
  // more
  'band-add': () => { S.settings.bands.push({ id: uid(), name: 'Новая', c: '#888888' }); saveBlob('settings'); render(); },
  'band-del': el => { if (S.settings.bands.length <= 1) return; S.settings.bands.splice(+el.dataset.i, 1); saveBlob('settings'); render(); },
  gym: () => { S.settings.gym = !S.settings.gym; saveBlob('settings'); render(); },
  eq: el => { const k = el.dataset.k; S.settings.eq[k] = S.settings.eq[k] === false; saveBlob('settings'); render(); },
  'rest-set': el => { S.settings.rest = Math.min(300, Math.max(15, S.settings.rest + +el.dataset.d)); saveBlob('settings'); render(); },
  'cover-del': () => { S.coverImg = null; LS.del('cover'); render(); },
  export: () => {
    const data = JSON.stringify({ app: 'zhelezo', v: 1, settings: S.settings, favs: S.favs, custom: S.custom, programs: S.programs, workouts: S.workouts });
    const name = 'zhelezo-' + fmtDate(Date.now()) + '.json';
    if (tg?.downloadFile && tg.isVersionAtLeast('8.0')) { /* в Telegram скачивание из blob недоступно — копируем */ }
    try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' })); a.download = name; a.click(); } catch (e) {}
    copy(data);
  },
  close: () => closeSheet(),
  'ask-ok': () => { const v = $('#ask-in').value.trim(); closeSheet(); askText.cb && askText.cb(v); askText.cb = null; },
  'ask-cancel': () => { closeSheet(); askText.cb && askText.cb(''); askText.cb = null; },
};
function addToLive(id) {
  const d = S.draft; if (d.items.some(it => it.ex === id)) return toast('Уже в тренировке');
  const n = d.mode === 'mega' ? d.rounds : S.settings.defSets;
  const prev = lastFor(id); const ps = prev ? prev.it.sets : [];
  d.items.push({ ex: id, sets: Array.from({ length: n }, (_, i) => { const p = ps[Math.min(i, ps.length - 1)]; return { r: '', p: p ? +p.r : '', b: p ? (p.b || []).slice() : [], d: 0 }; }) });
  saveDraft(); closeSheet(); S.addingLive = false; go('live'); toast('Добавлено');
}
function rerenderBuild() {
  if (S.tab !== 'build') return;
  const y = window.scrollY; render(); window.scrollTo(0, y);
}

/* ---------------- events ---------------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (t) { const f = A[t.dataset.act]; if (f) { e.preventDefault(); f(t); } return; }
  if (e.target.classList.contains('sheet-bg')) closeSheet();
  const tab = e.target.closest('#tabs button'); if (tab) { closeSheet(); S.addingLive = false; go(tab.dataset.tab); }
  if (e.target.closest('#livebar')) { curRound(); go('live'); }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'q') { S.q = t.value; clearTimeout(rerenderBuild.t); rerenderBuild.t = setTimeout(() => { const ul = $('#exlist'); const list = filteredEx(); if (ul) ul.innerHTML = list.slice(0, 200).map(exRow).join('') || '<div class="empty">Ничего не нашлось.</div>'; const tag = $('.rubric .tag'); if (tag) tag.textContent = list.length; }, 120); }
  if (t.matches('.reps input')) { const s = S.draft.items[+t.dataset.i].sets[+t.dataset.k]; s.r = t.value.replace(/\D/g, '').slice(0, 3); saveDraft(); }
  if (t.dataset.bandN != null) { S.settings.bands[+t.dataset.bandN].name = t.value.slice(0, 14); clearTimeout(t._s); t._s = setTimeout(() => saveBlob('settings'), 400); }
  if (t.dataset.bandC != null) { S.settings.bands[+t.dataset.bandC].c = t.value; saveBlob('settings'); }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'cover-file' && t.files[0]) resizeImg(t.files[0], 900).then(u => { S.coverImg = u; LS.set('cover', u); toast('Обложка обновлена'); go('cover'); });
  if (t.id === 'import-file' && t.files[0]) t.files[0].text().then(async txt => {
    try {
      const d = JSON.parse(txt); if (d.app !== 'zhelezo') throw 0;
      if (!await ask(`Загрузить копию: ${d.workouts.length} тренировок? Тренировки объединятся с текущими.`)) return;
      for (const k of ['settings','favs','custom','programs']) if (d[k]) { S[k] = d[k]; saveBlob(k); }
      const have = new Set(S.workouts.map(w => w.id));
      d.workouts.forEach(w => { if (!have.has(w.id)) { S.workouts.push(w); Cloud.set('w_' + w.id, JSON.stringify(w)); } });
      S.workouts.sort((a, b) => a.start - b.start); LS.set('workouts', S.workouts); buildIndex(); toast('Копия загружена'); render();
    } catch (er) { toast('Это не файл копии'); }
  });
});
function resizeImg(file, max) {
  return new Promise(res => { const img = new Image(); img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', .8)); }; img.src = URL.createObjectURL(file); });
}
function onBack() {
  if (sheetOpen()) return closeSheet();
  if (S.addingLive) { S.addingLive = false; return go('live'); }
  if (S.tab !== 'cover' && S.tab !== 'live') go('cover');
}

/* ---------------- boot ---------------- */
(function boot() {
  if (tg) {
    try {
      tg.ready(); tg.expand();
      tg.setHeaderColor?.('#0b0b0b'); tg.setBackgroundColor?.('#0b0b0b'); tg.setBottomBarColor?.('#050505');
      if (tg.isVersionAtLeast?.('7.7')) tg.disableVerticalSwipes();
      tg.BackButton?.onClick(onBack);
      if (tg.isVersionAtLeast?.('6.2')) tg.enableClosingConfirmation?.();
    } catch (e) {}
  }
  loadLocal(); buildIndex();
  if (S.draft) { S.tab = 'live'; curRound(); }
  render();
  setInterval(tick, 1000);
  syncCloud().then(() => { buildIndex(); });
})();

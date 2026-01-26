const DATA_URL = "https://opensheet.elk.sh/1mJTfT3OJfCzYZCVscKaXxnzhCy3eEzv97GxOlkcGVLg/WebExport";

// Spaltennamen aus WebExport:
const COL_DISZIPLIN = "Disziplin";
const COL_VORLESUNG = "Vorlesung";
const COL_SUBGRUPPE = "Subgruppe";
const COL_LERNZIEL  = "Lernziel";

const grid = document.getElementById("grid");
const statusEl = document.getElementById("status");
const searchEl = document.getElementById("search");
const onlyOpenEl = document.getElementById("onlyOpen");
const filterStarEl = document.getElementById("filterStar");
const filterRepeatEl = document.getElementById("filterRepeat");
const resetDoneBtn = document.getElementById("resetDone");
const nextOpenBtn = document.getElementById("nextOpen");
const randomPickBtn = document.getElementById("randomPick");
const spotlightEl = document.getElementById("spotlight");
const progressFillEl = document.getElementById("progressFill");
const progressLabelEl = document.getElementById("progressLabel");

const SEMESTER_MAP_URL = "semester_map.json";

// Neuer Storage-Key (State inkl. done/star/repeat)
const STORAGE_STATE_KEY = "lernziele_state_v2";
// alter Key (Kompatibilität)
const STORAGE_DONE_KEY_OLD = "lernziele_done_v1";

let raw = [];
let semesterMap = null;
let stateMap = loadStateMap(); // key -> {done:boolean, star:boolean, repeat:boolean}

init();

async function init(){
  // Daten laden
  const res = await fetch(DATA_URL);
  if (!res.ok) {
    statusEl.textContent = `Fehler beim Laden der Daten (HTTP ${res.status}). Prüfe DATA_URL/Freigabe/Tabname.`;
    return;
  }
  raw = await res.json();

  // Semester-Mapping laden (optional)
  try {
    const m = await fetch(SEMESTER_MAP_URL);
    if (m.ok) semesterMap = await m.json();
  } catch {
    semesterMap = null;
  }

  // Defensive: leere Felder zu String machen
  raw = raw
    .map(r => ({
      Disziplin: String(r[COL_DISZIPLIN] ?? "").trim(),
      Vorlesung: String(r[COL_VORLESUNG] ?? "").trim(),
      Subgruppe: String(r[COL_SUBGRUPPE] ?? "").trim(),
      Lernziel:  String(r[COL_LERNZIEL]  ?? "").trim(),
    }))
    .filter(r => r.Lernziel.length > 0);

  // UI Events
  searchEl.addEventListener("input", render);
  onlyOpenEl.addEventListener("change", render);
  filterStarEl.addEventListener("change", render);
  filterRepeatEl.addEventListener("change", render);

  resetDoneBtn.addEventListener("click", () => {
    stateMap = {};
    saveStateMap(stateMap);
    render();
  });

  nextOpenBtn.addEventListener("click", () => pickAndFocus({ mode: "nextOpen" }));
  randomPickBtn.addEventListener("click", () => pickAndFocus({ mode: "random" }));

  render();
}

function render(){
  const q = searchEl.value.trim().toLowerCase();
  const onlyOpen = onlyOpenEl.checked;
  const onlyStar = filterStarEl.checked;
  const onlyRepeat = filterRepeatEl.checked;

  // 1) Filter
  const rows = raw.filter(r => {
    const key = makeKey(r);
    const st = getState(key);

    if (onlyOpen && st.done) return false;
    if (onlyStar && !st.star) return false;
    if (onlyRepeat && !st.repeat) return false;

    if (!q) return true;

    return (
      r.Disziplin.toLowerCase().includes(q) ||
      r.Vorlesung.toLowerCase().includes(q) ||
      r.Subgruppe.toLowerCase().includes(q) ||
      r.Lernziel.toLowerCase().includes(q)
    );
  });

  // 2) Tree: Disziplin -> Vorlesung -> Subgruppe -> [rows]
  const tree = {};
  for (const r of rows){
    const d = r.Disziplin || "Ohne Disziplin";
    const v = r.Vorlesung || "Ohne Vorlesung";
    const s = r.Subgruppe || "Ohne Subgruppe";

    tree[d] ??= {};
    tree[d][v] ??= {};
    tree[d][v][s] ??= [];
    tree[d][v][s].push(r);
  }

  // 3) Status + Progress
  const doneAll = countDone(raw);
  const totalAll = raw.length;
  const pct = totalAll ? Math.round((doneAll / totalAll) * 100) : 0;

  statusEl.textContent =
    `Angezeigt: ${rows.length} / ${raw.length} · ` +
    `Erledigt: ${doneAll} / ${totalAll} · ` +
    `★: ${countFlag(raw, "star")} · 🔁: ${countFlag(raw, "repeat")} · Speicherung pro Browser`;

  progressLabelEl.textContent = `Fortschritt: ${pct}%`;
  progressFillEl.style.width = `${pct}%`;

  // 4) Ansicht: Semester (wenn Map vorhanden), sonst fallback Disziplin
  renderBySemester(tree, semesterMap);
}

/* ---------------- Semester-Ansicht ---------------- */

function renderBySemester(tree, semesterMap) {
  grid.innerHTML = "";

  // Fallback: keine Map -> Disziplinen direkt rendern
  if (!semesterMap || !Array.isArray(semesterMap.assignments)) {
    const disciplines = Object.keys(tree).sort((a,b)=>a.localeCompare(b,"de"));
    renderDisciplineList(tree, disciplines, grid);
    return;
  }

  // Index: semester -> [disziplin,...]
  const idx = {};
  for (const a of semesterMap.assignments) {
    const sem = Number(a.semester);
    const dis = String(a.disziplin || "").trim();
    if (!sem || !dis) continue;
    idx[sem] ??= [];
    idx[sem].push(dis);
  }

  const tracks = Array.isArray(semesterMap.tracks) && semesterMap.tracks.length
    ? semesterMap.tracks
    : [
        { name: "Vorklinik", semesters: [1,2,3,4] },
        { name: "Klinik", semesters: [5,6,7,8,9,10] }
      ];

  for (const t of tracks) {
    const trackDetails = document.createElement("details");
    trackDetails.open = true;
    trackDetails.className = "card";
    trackDetails.dataset.key = "T:" + stableHashInt(t.name);
    trackDetails.dataset.track = t.name.toLowerCase().includes("vor") ? "vorklinik" : "klinik";

    const sum = document.createElement("summary");
    sum.className = "cardHead";

    // Track Fortschritt
    const trackStats = calcTrackStats(tree, idx, t);
    sum.textContent = `${t.name} · ${trackStats.done}/${trackStats.total} erledigt`;
    trackDetails.appendChild(sum);

    const body = document.createElement("div");
    body.className = "cardBody";

    for (const sem of (t.semesters || [])) {
      const semDetails = document.createElement("details");
      semDetails.open = false;
      semDetails.dataset.key = "S:" + stableHashInt(t.name + "||" + sem);
      semDetails.classList.add("semester");
      semDetails.dataset.sem = String(sem);

      const semSum = document.createElement("summary");

      const wanted = (idx[sem] || []).filter(d => tree[d]);
      const semStats = calcSemesterStats(tree, wanted);
      semSum.textContent = `${sem}. Semester · ${semStats.done}/${semStats.total} erledigt`;
      semDetails.appendChild(semSum);

      const listWrap = document.createElement("div");
      listWrap.style.padding = "0 0 10px";

      if (wanted.length === 0) {
        const p = document.createElement("div");
        p.className = "smallmeta";
        p.style.padding = "0 12px 10px";
        p.textContent = "Keine Disziplinen zugeordnet.";
        semDetails.appendChild(p);
      } else {
        renderDisciplineList(tree, wanted, listWrap);
        semDetails.appendChild(listWrap);
      }

      body.appendChild(semDetails);
    }

    trackDetails.appendChild(body);
    grid.appendChild(trackDetails);
  }
}

/* ---------------- Disziplin-Renderer ---------------- */

function renderDisciplineList(tree, disciplineNames, mountEl) {
  const target = mountEl || grid;

  for (const d of disciplineNames) {
    const card = document.createElement("details");
    card.className = "card";
    card.open = false;
    card.dataset.key = "D:" + stableHashInt(d);

    const color = disciplineColor(d);
    const total = countLeaf(tree[d]);
    const done = countDoneInObj(tree[d]);

    const head = document.createElement("summary");
    head.className = "cardHead";
    head.style.background = `linear-gradient(135deg, ${color.bg1}, ${color.bg2})`;

    const titleWrap = document.createElement("div");
    const h = document.createElement("h2");
    h.className = "disziplin";
    h.textContent = d;
    titleWrap.appendChild(h);

    const badge = document.createElement("div");
    badge.className = "badge";
    badge.textContent = `${done}/${total} erledigt`;

    head.appendChild(titleWrap);
    head.appendChild(badge);

    const body = document.createElement("div");
    body.className = "cardBody";

    // Vorlesungen: standardmäßig zugeklappt
    const lectures = Object.keys(tree[d]).sort((a,b)=>a.localeCompare(b,"de"));
    for (const v of lectures){
      const det = document.createElement("details");
      det.open = false;
      det.dataset.key = "V:" + stableHashInt(d + "||" + v);

      const sum = document.createElement("summary");

      const vStats = calcLectureStats(tree[d][v]);
      sum.textContent = `${v} · ${vStats.done}/${vStats.total} erledigt`;
      det.appendChild(sum);

      // Subgruppen als Titel
      const subgroups = Object.keys(tree[d][v]).sort((a,b)=>a.localeCompare(b,"de"));
      for (const s of subgroups){
        const sTitle = document.createElement("div");
        sTitle.className = "subgroupTitle";
        sTitle.textContent = s;
        det.appendChild(sTitle);

        const ul = document.createElement("ul");
        ul.className = "list";

        for (const r of tree[d][v][s]){
          const key = makeKey(r);
          const st = getState(key);

          const li = document.createElement("li");
          li.className = "item" + (st.done ? " done" : "");
          li.dataset.key = key;

          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.checked = st.done;

          cb.addEventListener("change", () => {
            const now = getState(key);
            now.done = cb.checked;
            setState(key, now);

            li.classList.toggle("done", cb.checked);

            // Wenn Lernmodus "Nur offene" aktiv ist, entferne nur dieses Item (kein re-render, nichts klappt zu)
            if (onlyOpenEl.checked && cb.checked) {
              li.remove();
            }

            // Status/Progress updaten (leichtgewichtig)
            updateTopProgressOnly();
          });

          const txt = document.createElement("div");
          txt.className = "lzText";
          txt.textContent = r.Lernziel;

          const actions = document.createElement("div");
          actions.className = "itemActions";

          const starBtn = document.createElement("button");
          starBtn.type = "button";
          starBtn.className = "iconBtn star" + (st.star ? " on" : "");
          starBtn.textContent = "★";
          starBtn.title = "Als wichtig markieren";
          starBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const now = getState(key);
            now.star = !now.star;
            setState(key, now);
            starBtn.classList.toggle("on", now.star);
            updateTopProgressOnly();
            if (filterStarEl.checked && !now.star) li.remove();
          });

          const repBtn = document.createElement("button");
          repBtn.type = "button";
          repBtn.className = "iconBtn rep" + (st.repeat ? " on" : "");
          repBtn.textContent = "🔁";
          repBtn.title = "Zum Wiederholen markieren";
          repBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const now = getState(key);
            now.repeat = !now.repeat;
            setState(key, now);
            repBtn.classList.toggle("on", now.repeat);
            updateTopProgressOnly();
            if (filterRepeatEl.checked && !now.repeat) li.remove();
          });

          actions.appendChild(starBtn);
          actions.appendChild(repBtn);

          li.appendChild(cb);
          li.appendChild(txt);
          li.appendChild(actions);

          ul.appendChild(li);
        }

        det.appendChild(ul);
      }

      body.appendChild(det);
    }

    card.appendChild(head);
    card.appendChild(body);
    target.appendChild(card);
  }
}

/* ---------------- Spotlight / Picker ---------------- */

function pickAndFocus({ mode }) {
  const q = searchEl.value.trim().toLowerCase();
  const onlyOpen = onlyOpenEl.checked;
  const onlyStar = filterStarEl.checked;
  const onlyRepeat = filterRepeatEl.checked;

  // Kandidaten aus RAW (nicht aus DOM), damit stabil
  const candidates = raw.filter(r => {
    const key = makeKey(r);
    const st = getState(key);

    if (onlyOpen && st.done) return false;
    if (onlyStar && !st.star) return false;
    if (onlyRepeat && !st.repeat) return false;

    if (!q) return true;

    return (
      r.Disziplin.toLowerCase().includes(q) ||
      r.Vorlesung.toLowerCase().includes(q) ||
      r.Subgruppe.toLowerCase().includes(q) ||
      r.Lernziel.toLowerCase().includes(q)
    );
  });

  if (candidates.length === 0) {
    showSpotlight(null, "Keine passenden Lernziele gefunden.");
    return;
  }

  let chosen = null;

  if (mode === "nextOpen") {
    // "Nächstes offenes": erstes Element, das noch nicht done ist (bei onlyOpen sowieso)
    chosen = candidates.find(r => !getState(makeKey(r)).done) || candidates[0];
  } else {
    // random
    chosen = candidates[Math.floor(Math.random() * candidates.length)];
  }

  const key = makeKey(chosen);
  showSpotlight(chosen);

  // Stelle in der Liste sichtbar machen:
  // Dafür brauchen wir ein frisches render (falls durch Filter nicht da) -> wir sind schon in aktuellem Filterzustand,
  // also einfach versuchen zu springen; wenn nicht da: render() und erneut springen.
  const ok = jumpToKey(key);
  if (!ok) {
    render();
    setTimeout(() => jumpToKey(key), 60);
  }
}

function showSpotlight(row, message=null) {
  if (!row && message) {
    spotlightEl.classList.remove("hidden");
    spotlightEl.innerHTML = `
      <div class="spotTop">
        <div class="spotTitle">Hinweis</div>
        <div class="spotMeta"></div>
      </div>
      <div class="spotBody">${escapeHtml(message)}</div>
    `;
    return;
  }

  if (!row) {
    spotlightEl.classList.add("hidden");
    spotlightEl.innerHTML = "";
    return;
  }

  const key = makeKey(row);
  const st = getState(key);

  spotlightEl.classList.remove("hidden");
  spotlightEl.innerHTML = `
    <div class="spotTop">
      <div>
        <div class="spotTitle">Fokus-Lernziel</div>
        <div class="spotMeta">${escapeHtml(row.Disziplin)} · ${escapeHtml(row.Vorlesung)} · ${escapeHtml(row.Subgruppe)}</div>
      </div>
      <div class="spotMeta">${st.done ? "✔ erledigt" : "offen"} ${st.star ? " · ★" : ""} ${st.repeat ? " · 🔁" : ""}</div>
    </div>
    <div class="spotBody">${escapeHtml(row.Lernziel)}</div>
    <div class="spotBtns">
      <button class="btn" type="button" id="spotJump">In Liste anzeigen</button>
      <button class="btn" type="button" id="spotToggleDone">${st.done ? "Als offen markieren" : "Als erledigt markieren"}</button>
      <button class="btn" type="button" id="spotToggleStar">${st.star ? "★ entfernen" : "★ wichtig"}</button>
      <button class="btn" type="button" id="spotToggleRepeat">${st.repeat ? "🔁 entfernen" : "🔁 wiederholen"}</button>
    </div>
  `;

  document.getElementById("spotJump").onclick = () => jumpToKey(key);
  document.getElementById("spotToggleDone").onclick = () => {
    const now = getState(key);
    now.done = !now.done;
    setState(key, now);
    updateTopProgressOnly();
    render();
    showSpotlight(row);
  };
  document.getElementById("spotToggleStar").onclick = () => {
    const now = getState(key);
    now.star = !now.star;
    setState(key, now);
    updateTopProgressOnly();
    render();
    showSpotlight(row);
  };
  document.getElementById("spotToggleRepeat").onclick = () => {
    const now = getState(key);
    now.repeat = !now.repeat;
    setState(key, now);
    updateTopProgressOnly();
    render();
    showSpotlight(row);
  };
}

function jumpToKey(key) {
  const el = document.querySelector(`[data-key="${cssEscape(key)}"]`);
  if (!el) return false;

  // Alle parent-details öffnen
  let p = el.parentElement;
  while (p) {
    if (p.tagName && p.tagName.toLowerCase() === "details") p.open = true;
    p = p.parentElement;
  }

  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.animate(
    [{ backgroundColor: "rgba(245,158,11,.18)" }, { backgroundColor: "rgba(17,24,39,.03)" }, { backgroundColor: "transparent" }],
    { duration: 900, easing: "ease-out" }
  );
  return true;
}

/* ---------------- Stats helpers ---------------- */

function calcSemesterStats(tree, wantedDisciplines) {
  let total = 0;
  let done = 0;
  for (const d of wantedDisciplines) {
    total += countLeaf(tree[d]);
    done += countDoneInObj(tree[d]);
  }
  return { total, done };
}

function calcTrackStats(tree, idx, track) {
  let total = 0;
  let done = 0;
  for (const sem of (track.semesters || [])) {
    const wanted = (idx[sem] || []).filter(d => tree[d]);
    const s = calcSemesterStats(tree, wanted);
    total += s.total;
    done += s.done;
  }
  return { total, done };
}

function calcLectureStats(subObj) {
  // subObj = tree[d][v] = {subgruppe: [rows]}
  let total = 0, done = 0;
  for (const items of Object.values(subObj)) {
    for (const r of items) {
      total++;
      if (getState(makeKey(r)).done) done++;
    }
  }
  return { total, done };
}

function countDoneInObj(vorlesungenObj){
  let n = 0;
  for (const subObj of Object.values(vorlesungenObj)){
    for (const items of Object.values(subObj)){
      for (const r of items){
        if (getState(makeKey(r)).done) n++;
      }
    }
  }
  return n;
}

function countDone(allRows){
  let n = 0;
  for (const r of allRows){
    if (getState(makeKey(r)).done) n++;
  }
  return n;
}

function countFlag(allRows, flag){
  let n = 0;
  for (const r of allRows){
    if (getState(makeKey(r))[flag]) n++;
  }
  return n;
}

function countLeaf(vorlesungenObj){
  let total = 0;
  for (const subObj of Object.values(vorlesungenObj)){
    for (const items of Object.values(subObj)){
      total += items.length;
    }
  }
  return total;
}

/* ---------------- State (localStorage) ---------------- */

function getState(key){
  return stateMap[key] || { done:false, star:false, repeat:false };
}

function setState(key, st){
  stateMap[key] = { done: !!st.done, star: !!st.star, repeat: !!st.repeat };
  saveStateMap(stateMap);
}

function loadStateMap(){
  // 1) neues Format
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_STATE_KEY) || "{}");
    if (v && typeof v === "object") return v;
  } catch {}

  // 2) Migration: altes done-map übernehmen
  try {
    const old = JSON.parse(localStorage.getItem(STORAGE_DONE_KEY_OLD) || "{}");
    if (old && typeof old === "object") {
      const migrated = {};
      for (const [k, val] of Object.entries(old)) {
        migrated[k] = { done: !!val, star:false, repeat:false };
      }
      localStorage.setItem(STORAGE_STATE_KEY, JSON.stringify(migrated));
      return migrated;
    }
  } catch {}

  return {};
}

function saveStateMap(map){
  localStorage.setItem(STORAGE_STATE_KEY, JSON.stringify(map));
}

/* ---------------- Lightweight top update ---------------- */

function updateTopProgressOnly(){
  // Nur Gesamtprogress oben aktualisieren (ohne komplettes render)
  const doneAll = countDone(raw);
  const totalAll = raw.length;
  const pct = totalAll ? Math.round((doneAll / totalAll) * 100) : 0;
  progressLabelEl.textContent = `Fortschritt: ${pct}%`;
  progressFillEl.style.width = `${pct}%`;
}

/* ---------------- Keys / utils ---------------- */

function makeKey(r){
  return stableHash(`${r.Disziplin}||${r.Vorlesung}||${r.Subgruppe}||${r.Lernziel}`);
}

function disciplineColor(name){
  const palette = [
    { bg1:"#fde68a", bg2:"#fbcfe8" },
    { bg1:"#bfdbfe", bg2:"#ddd6fe" },
    { bg1:"#bbf7d0", bg2:"#bae6fd" },
    { bg1:"#fecaca", bg2:"#fed7aa" },
    { bg1:"#e9d5ff", bg2:"#c7d2fe" },
    { bg1:"#99f6e4", bg2:"#bfdbfe" },
    { bg1:"#fca5a5", bg2:"#fde68a" },
    { bg1:"#d9f99d", bg2:"#a7f3d0" },
  ];
  const idx = stableHashInt(name) % palette.length;
  return palette[idx];
}

function stableHash(str){
  let h = 5381;
  for (let i=0; i<str.length; i++){
    h = ((h << 5) + h) + str.charCodeAt(i);
    h = h >>> 0;
  }
  return "k" + h.toString(16);
}
function stableHashInt(str){
  let h = 2166136261;
  for (let i=0; i<str.length; i++){
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function escapeHtml(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

// für querySelector mit data-key (sehr selten nötig, aber sicher)
function cssEscape(s){
  return String(s).replaceAll('"','\\"');
}

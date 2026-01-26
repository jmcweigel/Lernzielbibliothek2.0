const DATA_URL = "https://opensheet.elk.sh/1mJTfT3OJfCzYZCVscKaXxnzhCy3eEzv97GxOlkcGVLg/WebExport";

// Spaltennamen aus WebExport:
const COL_DISZIPLIN = "Disziplin";
const COL_VORLESUNG = "Vorlesung";
const COL_SUBGRUPPE = "Subgruppe";
const COL_LERNZIEL  = "Lernziel";

const grid = document.getElementById("grid");
const statusEl = document.getElementById("status");
const searchEl = document.getElementById("search");
const hideDoneEl = document.getElementById("hideDone");
const resetDoneBtn = document.getElementById("resetDone");

const STORAGE_KEY = "lernziele_done_v1";
const SEMESTER_MAP_URL = "semester_map.json";

let raw = [];
let semesterMap = null;           // <-- GLOBAL, damit render() Zugriff hat
let doneMap = loadDoneMap();

init();

async function init(){
  // Daten laden (Lernziele)
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
  hideDoneEl.addEventListener("change", render);

  resetDoneBtn.addEventListener("click", () => {
    doneMap = {};
    saveDoneMap(doneMap);
    render();
  });

  render();
}

function render(){
  const q = searchEl.value.trim().toLowerCase();
  const hideDone = hideDoneEl.checked;

  // 1) Filter
  const rows = raw.filter(r => {
    const key = makeKey(r);
    const isDone = !!doneMap[key];

    if (hideDone && isDone) return false;
    if (!q) return true;

    return (
      r.Disziplin.toLowerCase().includes(q) ||
      r.Vorlesung.toLowerCase().includes(q) ||
      r.Subgruppe.toLowerCase().includes(q) ||
      r.Lernziel.toLowerCase().includes(q)
    );
  });

  // 2) Tree aufbauen: Disziplin -> Vorlesung -> Subgruppe -> [rows]
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

  // 3) Status
  statusEl.textContent =
    `Angezeigt: ${rows.length} / ${raw.length} Lernziele · ` +
    `Erledigt (dieser Browser): ${countDone(raw)} · Speicherung pro Nutzer/Browser`;

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

  // Index: semester -> [disziplin, disziplin, ...] (Duplikate erlaubt)
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
    sum.textContent = t.name;
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
      semSum.textContent = `${sem}. Semester`;
      semDetails.appendChild(semSum);

      const listWrap = document.createElement("div");
      listWrap.style.padding = "0 0 10px";

      // Nur Disziplinen rendern, die in tree existieren
      const wanted = (idx[sem] || []).filter(d => tree[d]);

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

/* ---------------- Disziplin-Renderer (wiederverwendbar) ---------------- */

function renderDisciplineList(tree, disciplineNames, mountEl) {
  const target = mountEl || grid;

  for (const d of disciplineNames) {
    const card = document.createElement("details");
    card.className = "card";
    card.open = false;
    card.dataset.key = "D:" + stableHashInt(d);

    const color = disciplineColor(d);

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
    badge.textContent = `${countLeaf(tree[d])} Lernziele`;

    head.appendChild(titleWrap);
    head.appendChild(badge);

    const body = document.createElement("div");
    body.className = "cardBody";

    // Vorlesungen: zunächst zugeklappt, aber sichtbar als Titel
    const lectures = Object.keys(tree[d]).sort((a,b)=>a.localeCompare(b,"de"));
    for (const v of lectures){
      const det = document.createElement("details");
      det.open = false; // <-- Vorlesungen standardmäßig zu
      det.dataset.key = "V:" + stableHashInt(d + "||" + v);

      const sum = document.createElement("summary");
      sum.textContent = v;
      det.appendChild(sum);

      // Subgruppen als fette Titel (kein extra Ordner)
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
          const isDone = !!doneMap[key];

          const li = document.createElement("li");
          li.className = "item" + (isDone ? " done" : "");

          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.checked = isDone;

          cb.addEventListener("change", () => {
            doneMap[key] = cb.checked;
            if (!cb.checked) delete doneMap[key];
            saveDoneMap(doneMap);
            li.classList.toggle("done", cb.checked);

            // Wichtig: Wenn "Erledigte ausblenden" aktiv und abgehakt -> nur dieses Item entfernen
            // (kein komplettes render(), dadurch klappt nichts zu)
            if (hideDoneEl.checked && cb.checked) {
              li.remove();
              // Status einmal aktualisieren (leichtgewichtig)
              statusEl.textContent =
                `Angezeigt: (gefiltert) · Erledigt (dieser Browser): ${countDone(raw)} · Speicherung pro Nutzer/Browser`;
            }
          });

          const txt = document.createElement("div");
          txt.className = "lzText";
          txt.textContent = r.Lernziel;

          li.appendChild(cb);
          li.appendChild(txt);
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

/* ---------- helpers ---------- */

function makeKey(r){
  // Stabile Key-Erzeugung pro Lernziel (wenn Text geändert wird, ändert sich der Key)
  return stableHash(`${r.Disziplin}||${r.Vorlesung}||${r.Subgruppe}||${r.Lernziel}`);
}

function loadDoneMap(){
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
  catch { return {}; }
}

function saveDoneMap(map){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

function countDone(allRows){
  let n = 0;
  for (const r of allRows){
    if (doneMap[makeKey(r)]) n++;
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

// Pastellige Disziplinfarben (deterministisch)
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

// Kleine stabile Hashes (ohne libs)
function stableHash(str){
  // djb2-like
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

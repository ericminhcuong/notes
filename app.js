/* Mes notes — carnet hors ligne, synchronisé avec Google Drive (dossier « Mes notes »). */
(() => {
"use strict";

/* ===== Réglages (le CLIENT_ID est fourni à la mise en ligne) ===== */
const CONFIG = {
  CLIENT_ID: "666589011481-lmckcdvh35ung8lvbsagrgbm3je65u40.apps.googleusercontent.com",                       // identifiant OAuth Google (application Web)
  FOLDER: "Mes notes",                 // dossier créé dans le Drive
  SCOPE: "https://www.googleapis.com/auth/drive.file",
};

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const uid = p => p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ===== Stockage sur l'appareil (IndexedDB) ===== */
let _db;
function idb(){ return _db || (_db = new Promise((ok, ko) => {
  const r = indexedDB.open("mesnotes", 1);
  r.onupgradeneeded = () => { r.result.createObjectStore("notes", {keyPath:"id"}); r.result.createObjectStore("kv"); };
  r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
})); }
async function tx(store, mode, fn){ const d = await idb(); return new Promise((ok, ko) => { const t = d.transaction(store, mode); const s = t.objectStore(store); const res = fn(s); t.oncomplete = () => ok(res && res.result !== undefined ? res.result : res); t.onerror = () => ko(t.error); }); }
const dbAll = () => tx("notes", "readonly", s => s.getAll());
const dbPut = n => tx("notes", "readwrite", s => s.put(n));
const dbPutMany = arr => tx("notes", "readwrite", s => arr.forEach(n => s.put(n)));
const dbDel = id => tx("notes", "readwrite", s => s.delete(id));
const kvGet = k => tx("kv", "readonly", s => s.get(k));
const kvSet = (k, v) => tx("kv", "readwrite", s => s.put(v, k));

/* ===== État ===== */
const S = { notes:{}, q:"", main:{kind:"note", id:null}, showAll:60, archive:null, archShow:150, afolder:"" };
let FOLD = {pinned:false, notes:false}; try{ Object.assign(FOLD, JSON.parse(localStorage.getItem("mn.fold")||"{}")); }catch(e){}
const live = () => Object.values(S.notes).filter(n => !n.deleted);
const plainNotes = () => live().filter(n => n.kind === "note" && !n._new);
function special(kind, title){
  let n = live().find(x => x.kind === kind);
  if(!n){ n = {id:kind, kind, title, body:"", pinned:false, created:Date.now(), updated:Date.now(), dirty:true}; S.notes[n.id] = n; dbPut(n); }
  return n;
}
async function save(n){ n.dirty = true; S.notes[n.id] = n; const c = {...n}; delete c._new; await dbPut(c); scheduleSync(); }

/* ===== Dates ===== */
function fmtShort(ms){ if(!ms) return ""; const d=new Date(ms), n=new Date();
  if(d.toDateString()===n.toDateString()) return d.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"});
  if(n-d < 6*864e5) return d.toLocaleDateString("fr-FR",{weekday:"long"});
  return d.toLocaleDateString("fr-FR",{day:"2-digit",month:"2-digit",year:"2-digit"}); }
const fmtLong = ms => ms ? new Date(ms).toLocaleDateString("fr-FR",{day:"numeric",month:"long",year:"numeric"})+" à "+new Date(ms).toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}) : "";
const fullText = n => (n.title||"") + (n.body ? "\n" + n.body : "");
const snippet = n => (n.body||"").replace(/^---\n[\s\S]*?\n---\n?/,"").replace(/[#*>\[\]_`-]/g," ").replace(/\s+/g," ").trim().slice(0,90);
const setPane = p => $("#app").dataset.pane = p;

/* ===== À faire : une note-liste « - [ ] … » ===== */
function parseTodos(body){ return (body||"").split("\n").map(l => l.match(/^\s*[-*] \[( |x|X)\] (.*)$/)).filter(Boolean).map((m,i)=>({i, done:m[1]!==" ", text:m[2]})); }
function writeTodos(list){ const open=list.filter(t=>!t.done), done=list.filter(t=>t.done);
  return open.map(t=>`- [ ] ${t.text}`).join("\n") + (done.length ? "\n\n## Fait\n" + done.map(t=>`- [x] ${t.text}`).join("\n") : "") + "\n"; }
function todoNote(){ return special("todo", "À faire"); }

/* ===== Barre de côté ===== */
function noteItem(n){
  const on = S.main.kind==="note" && S.main.id===n.id;
  return `<button class="item ${on?"on":""}" data-nid="${esc(n.id)}"><div class="t">${esc(n.title||"Nouvelle note")}</div><div class="s"><span class="d">${esc(fmtShort(n.updated))}</span>${esc(snippet(n))||"Aucun texte"}</div></button>`;
}
function renderSide(){
  const q = S.q.trim().toLowerCase();
  let ns = plainNotes();
  if(q) ns = ns.filter(n => fullText(n).toLowerCase().includes(q));
  ns.sort((a,b)=>b.updated-a.updated);
  const pinned = ns.filter(n=>n.pinned), rest = ns.filter(n=>!n.pinned);
  const openTodos = parseTodos((live().find(n=>n.kind==="todo")||{}).body).filter(t=>!t.done).length;
  const fold = (key,label,count,inner) => { const open = q ? true : FOLD[key];
    return `<button class="fold" data-fold="${key}" aria-expanded="${open}"><span class="chev">›</span>${label}<span class="n">${count||""}</span></button>` + (open ? `<div class="sub">${inner}</div>` : ""); };
  let h = "";
  if(!q){
    h += `<button class="item row ${S.main.kind==="codes"?"on":""}" data-go="codes">Codes</button>`;
    h += `<button class="item row ${S.main.kind==="todo"?"on":""}" data-go="todo">À faire <span class="n">${openTodos||""}</span></button>`;
  }
  if(pinned.length || !q) h += fold("pinned","Épinglées",pinned.length, pinned.length ? pinned.map(noteItem).join("") : `<div class="more">Aucune note épinglée</div>`);
  let inner = rest.length ? rest.slice(0, q?200:S.showAll).map(noteItem).join("") : `<div class="more">${q?"Aucune note":"Pas encore de note"}</div>`;
  if(!q && rest.length > S.showAll) inner += `<button class="more" data-act="showmore">Afficher les ${rest.length-S.showAll} autres…</button>`;
  h += fold("notes","Notes",rest.length,inner);
  if(q){
    if(S.archive && S.archive.length){ const am = archMatches(q,""); if(am.length) h += `<div class="s-label">Archive Evernote (${am.length})</div>` + am.slice(0,40).map(([n,i])=>`<button class="item" data-aid="${i}"><div class="t">${esc(n.t||"Sans titre")}</div><div class="s"><span class="d">${esc(fmtShort(n.u))}</span>${esc(n.f||"")}</div></button>`).join(""); }
    else if(!S.archive) h += `<button class="more" data-act="searcharch">Chercher aussi dans l'archive Evernote…</button>`;
  } else {
    h += `<button class="item row ${S.main.kind==="archive"?"on":""}" data-go="archive">Archive Evernote <span class="n">${S.archCount||""}</span></button>`;
  }
  $("#side").innerHTML = h;
}
$("#q").addEventListener("input", e => { clearTimeout(e.target._t); e.target._t = setTimeout(() => { S.q = e.target.value; renderSide(); }, 120); });
$("#side").addEventListener("click", e => {
  const fb = e.target.closest("[data-fold]"); if(fb && !S.q.trim()){ const k=fb.dataset.fold; FOLD[k]=!FOLD[k]; try{ localStorage.setItem("mn.fold", JSON.stringify(FOLD)); }catch(_){} renderSide(); return; }
  const a = e.target.closest("[data-act]")?.dataset.act;
  if(a==="showmore"){ S.showAll += 200; renderSide(); return; }
  if(a==="searcharch"){ loadArchive().then(renderSide); return; }
  const g = e.target.closest("[data-go]"); if(g){ const k=g.dataset.go; if(k==="codes") show({kind:"codes", id:special("codes","Codes").id}); else show({kind:k}); return; }
  const n = e.target.closest("[data-nid]"); if(n){ show({kind:"note", id:n.dataset.nid}); return; }
  const ar = e.target.closest("[data-aid]"); if(ar){ show({kind:"anote", idx:+ar.dataset.aid}); return; }
});
$("#newBtn").onclick = () => newNote();

/* ===== Page de droite ===== */
const ico = {
  pinOff:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 3h6l-1 6 4 4H6l4-4z"/></svg>`,
  pinOn:`<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="color:var(--accent)"><path d="M12 17v5"/><path d="M9 3h6l-1 6 4 4H6l4-4z"/></svg>`,
  trash:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/></svg>`,
  neu:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
};
const backBtn = `<button class="back" data-act="back">‹ Notes</button>`;
function show(m){ leaveNote(); S.main = m; renderMain(); renderSide(); setPane("main"); $(".page").scrollTop = 0; }
function grow(t){ t.style.height="auto"; t.style.height=Math.max(t.scrollHeight, innerHeight*0.7)+"px"; }
function editor(n, editable=true){
  $("#page").innerHTML = `<textarea id="text" spellcheck="true" placeholder="Écris…" ${editable?"":"readonly"}>${esc(fullText(n))}</textarea><div class="links" id="links"></div>`;
  const t = $("#text"); grow(t);
  if(editable) t.addEventListener("input", () => { grow(t); dirty = true; scheduleCommit(); });
  renderLinks();
}
function renderMain(){
  const m = S.main, bar = $("#bar");
  if(m.kind==="note" || m.kind==="codes"){
    const n = S.notes[m.id]; if(!n || n.deleted){ newNote(); return; }
    const plain = n.kind==="note";
    bar.innerHTML = `${backBtn}
      ${plain?`<button class="icon" data-act="pin" title="${n.pinned?"Désépingler":"Épingler"}">${n.pinned?ico.pinOn:ico.pinOff}</button>`:""}
      <span class="when" id="when">${n._new?"":esc(fmtLong(n.updated))}</span>
      ${plain?`<button class="icon" data-act="del" title="Supprimer">${ico.trash}</button>`:""}
      <button class="icon" data-act="new" title="Nouvelle note">${ico.neu}</button>`;
    editor(n);
    if(n._new) setTimeout(() => $("#text") && $("#text").focus(), 30);
  } else if(m.kind==="todo"){
    bar.innerHTML = `${backBtn}<span class="when"></span>`;
    const list = parseTodos(todoNote().body), open = list.filter(t=>!t.done), done = list.filter(t=>t.done);
    const row = t => `<div class="todo" data-ti="${t.i}"><button class="chk ${t.done?"done":""}" data-act="toggle" aria-label="Cocher"></button><div class="tt ${t.done?"done":""}" contenteditable="${!t.done}" data-act="edit">${esc(t.text)}</div><button class="x" data-act="tdel" aria-label="Supprimer">×</button></div>`;
    $("#page").innerHTML = `<h2>À faire</h2><input class="add" id="addTodo" placeholder="+ Ajouter (Entrée)">` +
      (open.length ? open.map(row).join("") : `<div class="empty">Rien à faire.</div>`) +
      (done.length ? `<details><summary>Fait (${done.length})</summary>${done.map(row).join("")}</details>` : "");
    $("#addTodo").addEventListener("keydown", e => { if(e.key==="Enter" && !e.isComposing){ const v=e.target.value.trim(); if(v){ const l=parseTodos(todoNote().body); l.unshift({text:v,done:false}); setTodos(l); renderMain(); $("#addTodo").focus(); } } });
  } else if(m.kind==="archive"){
    bar.innerHTML = `${backBtn}<span class="when"></span>`; renderArchive();
  } else if(m.kind==="anote"){
    const n = S.archive && S.archive[m.idx]; if(!n){ show({kind:"archive"}); return; }
    bar.innerHTML = `${backBtn}<span class="when">Archive Evernote${n.f?" · "+esc(n.f):""}</span><button class="keep" data-act="keep">Ramener dans mes notes</button>`;
    editor({title:n.t, body:n.b}, false);
  }
}
function setTodos(list){ const n = todoNote(); n.body = writeTodos(list); n.updated = Date.now(); save(n); renderSide(); }

/* écriture : la première ligne est le titre */
let dirty = false, commitT = null;
function scheduleCommit(){ clearTimeout(commitT); commitT = setTimeout(commit, 500); }
function commit(){
  clearTimeout(commitT); if(!dirty) return; dirty = false;
  const n = S.notes[S.main.id], t = $("#text"); if(!n || !t || t.readOnly) return;
  const v = t.value; if(!v.trim() && n.kind==="note") return;
  const i = v.indexOf("\n");
  n.title = (i<0?v:v.slice(0,i)).trim().replace(/^#+\s*/,"").slice(0,120) || (n.kind==="codes"?"Codes":"");
  n.body = i<0 ? "" : v.slice(i+1); n.updated = Date.now(); delete n._new;
  save(n); const w=$("#when"); if(w) w.textContent = fmtLong(n.updated);
  renderSide(); renderLinks();
}
function leaveNote(){
  if(!(S.main.kind==="note" || S.main.kind==="codes")) return;
  commit();
  const n = S.notes[S.main.id], t = $("#text");
  if(n && n.kind==="note" && t && !t.value.trim()){ if(n._new){ delete S.notes[n.id]; } else { n.deleted = true; n.updated = Date.now(); save(n); } }
}
function newNote(){
  leaveNote();
  const n = {id:uid("n"), kind:"note", title:"", body:"", pinned:false, created:Date.now(), updated:Date.now(), _new:true};
  S.notes[n.id] = n; S.main = {kind:"note", id:n.id}; renderMain(); renderSide(); setPane("main");
}
const findByTitle = t => { t = t.split("|")[0].split("#")[0].trim().toLowerCase(); return plainNotes().find(n => (n.title||"").toLowerCase() === t); };
function renderLinks(){
  const el = $("#links"), t = $("#text"); if(!el || !t) return;
  const links = [...new Set([...t.value.matchAll(/\[\[([^\]]+)\]\]/g)].map(m=>m[1]))].map(l=>[l, findByTitle(l)]).filter(x=>x[1]);
  el.innerHTML = links.length ? "Liens : " + links.map(([l,n]) => `<button data-open="${esc(n.id)}">${esc(l)}</button>`).join("") : "";
}

$("#bar").addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if(!b) return; const a = b.dataset.act;
  if(a==="back"){ leaveNote(); if(S.main.kind==="anote"){ S.main={kind:"archive"}; renderMain(); } else { renderSide(); setPane("list"); } return; }
  if(a==="new"){ newNote(); return; }
  if(a==="pin"){ commit(); const n=S.notes[S.main.id]; if(!n || n._new){ toast("Écris d'abord quelque chose"); return; } n.pinned=!n.pinned; save(n); renderMain(); renderSide(); return; }
  if(a==="del"){ if(!b.dataset.armed){ b.dataset.armed="1"; b.style.color="#d33"; toast("Touche encore pour supprimer"); setTimeout(()=>{ delete b.dataset.armed; b.style.color=""; },2500); return; }
    const n=S.notes[S.main.id]; dirty=false; if(n){ if(n._new) delete S.notes[n.id]; else { n.deleted=true; n.updated=Date.now(); save(n); } } toast("Note supprimée"); S.main={kind:"note",id:null}; newNote(); return; }
  if(a==="keep"){ const x=S.archive[S.main.idx]; const n={id:uid("n"), kind:"note", title:x.t||"", body:x.b||"", pinned:false, created:x.u||Date.now(), updated:Date.now()};
    save(n); toast("Copiée dans tes notes"); S.main={kind:"note", id:n.id}; renderMain(); renderSide(); }
});
$("#page").addEventListener("click", e => {
  const o = e.target.closest("[data-open]"); if(o){ show({kind:"note", id:o.dataset.open}); return; }
  const tr = e.target.closest("[data-ti]");
  if(tr){ const i=+tr.dataset.ti, a=e.target.closest("[data-act]")?.dataset.act, l=parseTodos(todoNote().body), t=l.find(x=>x.i===i); if(!t) return;
    if(a==="toggle"){ t.done=!t.done; setTodos(l); renderMain(); }
    else if(a==="tdel"){ setTodos(l.filter(x=>x!==t)); renderMain(); }
    return; }
  const a = e.target.closest("[data-act]")?.dataset.act;
  if(a==="import"){ $("#fileIn").click(); return; }
  if(a==="amore"){ S.archShow += 300; renderArchive(); return; }
  const af = e.target.closest("[data-afolder]"); if(af){ S.afolder=af.dataset.afolder; S.archShow=150; renderArchive(); return; }
  const ar = e.target.closest("[data-aid]"); if(ar){ S.main={kind:"anote", idx:+ar.dataset.aid}; renderMain(); $(".page").scrollTop=0; }
});
$("#page").addEventListener("focusout", e => {
  if(e.target.dataset && e.target.dataset.act==="edit"){ const i=+e.target.closest("[data-ti]").dataset.ti, l=parseTodos(todoNote().body), t=l.find(x=>x.i===i), v=e.target.innerText.trim();
    if(!t) return; if(!v) setTodos(l.filter(x=>x!==t)); else if(v!==t.text){ t.text=v; setTodos(l); } }
});
$("#page").addEventListener("keydown", e => { if(e.target.dataset && e.target.dataset.act==="edit" && e.key==="Enter"){ e.preventDefault(); e.target.blur(); } });
addEventListener("keydown", e => { if((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==="n"){ e.preventDefault(); newNote(); } });
addEventListener("pagehide", () => commit());
document.addEventListener("visibilitychange", () => { if(document.hidden){ commit(); syncSoon(0); } else syncSoon(500); });

/* ===== Archive Evernote (sur l'appareil seulement) ===== */
async function loadArchive(){ if(S.archive) return; S.archive = (await kvGet("archive")) || []; S.archCount = S.archive.length; }
function archMatches(q, folder){ q=(q||"").trim().toLowerCase();
  return (S.archive||[]).map((n,i)=>[n,i]).filter(([n]) => (!folder || (n.f||"").split(" / ")[0]===folder) && (!q || (n._l || (n._l=(n.t+"\n"+n.b+"\n"+n.f).toLowerCase())).includes(q))); }
async function renderArchive(){
  await loadArchive(); const page = $("#page");
  if(!S.archive.length){ page.innerHTML = `<h2>Archive Evernote</h2><div class="empty">Pas encore sur cet appareil.<br><br><button class="pill primary" data-act="import">Importer le fichier de notes</button></div>`; return; }
  const folders = [...new Set(S.archive.map(n=>(n.f||"").split(" / ")[0]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"fr"));
  const m = archMatches("", S.afolder);
  page.innerHTML = `<h2>Archive Evernote</h2><div class="chips"><button class="chip" data-afolder="" aria-pressed="${!S.afolder}">Tout</button>${folders.map(f=>`<button class="chip" data-afolder="${esc(f)}" aria-pressed="${S.afolder===f}">${esc(f)}</button>`).join("")}</div>` +
    m.slice(0,S.archShow).map(([n,i])=>`<button class="arow" data-aid="${i}"><div class="t">${esc(n.t||"Sans titre")}</div><div class="s">${esc(fmtShort(n.u))} · ${esc(n.f||"")} — ${esc((n.b||"").replace(/\s+/g," ").slice(0,100))}</div></button>`).join("") +
    (m.length>S.archShow ? `<div class="hint"><button class="pill" data-act="amore">Afficher plus (${m.length-S.archShow})</button></div>` : "") +
    `<div class="hint">Pour chercher dans l'archive, utilise la recherche à gauche.</div>`;
}

/* ===== Import d'un fichier préparé (notes + codes + à faire + archive) ===== */
$("#fileIn").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = ""; if(!f) return;
  status("Lecture du fichier…", "off");
  let d; try{ d = JSON.parse(await f.text()); }catch(_){ toast("Fichier illisible"); setStatus(); return; }
  const have = new Set(live().map(n => n.src).filter(Boolean)), add = [];
  for(const x of (d.notes||[])){ if(have.has(x.src)) continue;
    add.push({id:uid("n"), kind:"note", title:x.title, body:x.body||"", pinned:!!x.pinned, created:x.created||Date.now(), updated:x.updated||Date.now(), src:x.src, dirty:true}); }
  if(d.codes){ const c = special("codes","Codes"); if(!c.body.trim()){ c.body = d.codes; c.updated = Date.now(); c.dirty = true; add.push(c); } }
  if(d.todo){ const t = todoNote(); if(!t.body.trim()){ t.body = d.todo; t.updated = Date.now(); t.dirty = true; add.push(t); } }
  for(const n of add) S.notes[n.id] = n;
  await dbPutMany(add);
  if(d.archive && d.archive.length){ S.archive = d.archive; S.archCount = d.archive.length; await kvSet("archive", d.archive); }
  toast(`${add.length} notes ajoutées${d.archive?` · archive : ${d.archive.length}`:""}`);
  renderSide(); renderMain(); setStatus(); scheduleSync();
});

/* ===== Synchronisation Google Drive ===== */
let syncErrMsg = "", token = null, tokenExp = 0, folderId = null, syncing = false, syncT = null, lastSync = 0, syncErr = "";
try{ const t = JSON.parse(sessionStorage.getItem("mn.tok")||"null"); if(t && t.exp > Date.now()+60e3){ token=t.tok; tokenExp=t.exp; } }catch(_){}
const linked = () => !!localStorage.getItem("mn.linked");
const haveToken = () => token && tokenExp > Date.now() + 60e3;
function authUrl(prompt){
  const p = new URLSearchParams({client_id:CONFIG.CLIENT_ID, redirect_uri:location.origin+location.pathname, response_type:"token", scope:CONFIG.SCOPE, include_granted_scopes:"true", state:"mn"});
  if(prompt) p.set("prompt", prompt); const hint = localStorage.getItem("mn.hint"); if(hint) p.set("login_hint", hint);
  return "https://accounts.google.com/o/oauth2/v2/auth?" + p;
}
function connectDrive(silent){ if(!CONFIG.CLIENT_ID){ toast("La synchro Drive n'est pas encore réglée"); return; } commit(); location.href = authUrl(silent ? "none" : "consent"); }
// retour de Google : le jeton est dans l'adresse
(function readRedirect(){
  if(!location.hash.includes("access_token") && !location.hash.includes("error=")) return;
  const h = new URLSearchParams(location.hash.slice(1)); history.replaceState(null, "", location.pathname);
  if(h.get("access_token")){ token=h.get("access_token"); tokenExp=Date.now()+(+h.get("expires_in")||3600)*1000;
    try{ sessionStorage.setItem("mn.tok", JSON.stringify({tok:token, exp:tokenExp})); localStorage.setItem("mn.linked","1"); }catch(_){} }
  else if(h.get("error")){ syncErr = "reconnect"; syncErrMsg = "Google : " + h.get("error"); }
})();
async function api(path, opt={}){
  const r = await fetch(path.startsWith("http") ? path : "https://www.googleapis.com/" + path, {...opt, headers:{...(opt.headers||{}), Authorization:"Bearer "+token}});
  if(r.status===401){ token=null; tokenExp=0; throw new Error("auth"); }
  if(!r.ok) throw new Error("http "+r.status);
  return r;
}
const q = s => encodeURIComponent(s);
async function ensureFolder(){
  if(folderId) return folderId;
  folderId = await kvGet("folderId");
  if(folderId){ try{ const r = await (await api(`drive/v3/files/${folderId}?fields=id,trashed`)).json(); if(!r.trashed) return folderId; }catch(e){ if(e.message==="auth") throw e; } }
  const r = await (await api(`drive/v3/files?q=${q("appProperties has { key='mnroot' and value='1' } and trashed=false")}&fields=files(id)`)).json();
  if(r.files && r.files.length) folderId = r.files[0].id;
  else folderId = (await (await api("drive/v3/files?fields=id", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({name:CONFIG.FOLDER, mimeType:"application/vnd.google-apps.folder", appProperties:{mnroot:"1"}})})).json()).id;
  await kvSet("folderId", folderId); return folderId;
}
const safeName = t => (t||"Sans titre").replace(/[\/\\:*?"<>|]/g," ").replace(/\s+/g," ").trim().slice(0,100) || "Sans titre";
const fileName = n => n.kind==="codes" ? "Codes.md" : n.kind==="todo" ? "À faire.md" : safeName(n.title) + ".md";
async function upload(n){
  const meta = {name:fileName(n), mimeType:"text/markdown", appProperties:{mnid:n.id, kind:n.kind, pinned:n.pinned?"1":"0", created:String(n.created||0)}};
  const content = n.kind==="note" ? fullText(n) : (n.body||"");
  if(!n.driveId) meta.parents = [folderId];
  const bd = "mnb" + Math.random().toString(36).slice(2);
  const body = `--${bd}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${bd}\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n${content}\r\n--${bd}--`;
  const url = n.driveId ? `https://www.googleapis.com/upload/drive/v3/files/${n.driveId}?uploadType=multipart&fields=id,modifiedTime` : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime`;
  return (await api(url, {method: n.driveId?"PATCH":"POST", headers:{"Content-Type":`multipart/related; boundary=${bd}`}, body})).json();
}
function fromDrive(f, text){
  const ap = f.appProperties||{}, kind = ap.kind || (f.name==="Codes.md"?"codes":f.name==="À faire.md"?"todo":"note");
  const n = {id: ap.mnid || uid("n"), kind, pinned: ap.pinned==="1", created: +ap.created || Date.parse(f.modifiedTime), updated: Date.parse(f.modifiedTime), driveId:f.id, driveMod:f.modifiedTime, dirty:false};
  if(kind==="note"){ const i=text.indexOf("\n"); n.title=(i<0?text:text.slice(0,i)).trim().replace(/^#+\s*/,"") || f.name.replace(/\.md$/,""); n.body=i<0?"":text.slice(i+1); }
  else { n.title = kind==="codes"?"Codes":"À faire"; n.body = text; }
  return n;
}
async function sync(){
  if(syncing || !navigator.onLine || !CONFIG.CLIENT_ID || !linked()) { setStatus(); return; }
  if(!haveToken()){ setStatus(); return; }
  syncing = true; setStatus();
  try{
    await ensureFolder();
    // 1. ce qui a changé dans le Drive
    let files=[], pt="";
    do{ const r = await (await api(`drive/v3/files?q=${q(`'${folderId}' in parents and trashed=false`)}&fields=nextPageToken,files(id,name,modifiedTime,appProperties)&pageSize=1000${pt?"&pageToken="+pt:""}`)).json(); files=files.concat(r.files||[]); pt=r.nextPageToken; } while(pt);
    const byDrive = {}; Object.values(S.notes).forEach(n => { if(n.driveId) byDrive[n.driveId]=n; });
    const seen = new Set(), changed = [];
    for(const f of files){
      seen.add(f.id);
      let local = byDrive[f.id] || (f.appProperties && S.notes[f.appProperties.mnid]);
      if(!local && (f.appProperties||{}).kind && f.appProperties.kind!=="note") local = live().find(n=>n.kind===f.appProperties.kind && !n.driveId);
      if(local && local.driveMod === f.modifiedTime) continue;
      if(files.length>5) status(`Réception des notes… ${seen.size}/${files.length}`, "off");
      const text = await (await api(`drive/v3/files/${f.id}?alt=media`)).text();
      const remote = fromDrive(f, text);
      if(local && local.dirty){
        if(local.deleted) continue;                              // supprimée ici : la suppression gagne
        if(fullText(local)===fullText(remote)){ local.driveId=f.id; local.driveMod=f.modifiedTime; changed.push(local); continue; }
        const copy = {...remote, id:uid("n"), driveId:null, driveMod:null, kind:"note", title:(remote.title||"Note")+" (version du Drive)", dirty:true}; // conflit : on garde les deux
        if(remote.kind!=="note") copy.body = remote.body;
        S.notes[copy.id]=copy; changed.push(copy);
        local.driveId=f.id; local.driveMod=f.modifiedTime; changed.push(local); continue;
      }
      if(local){ remote.id = local.id; remote.src = local.src; }
      S.notes[remote.id] = remote; changed.push(remote);
    }
    // supprimées dans le Drive
    for(const n of Object.values(S.notes)) if(n.driveId && !seen.has(n.driveId) && !n.dirty){ delete S.notes[n.id]; dbDel(n.id); }
    if(changed.length) await dbPutMany(changed.map(n=>{ const c={...n}; delete c._new; return c; }));
    // 2. envoyer ce qui a changé ici
    const out = Object.values(S.notes).filter(n => n.dirty && !n._new);
    let i=0;
    for(const n of out){
      i++; if(out.length>5) status(`Envoi vers le Drive… ${i}/${out.length}`, "off");
      if(n.deleted){ if(n.driveId){ try{ await api(`drive/v3/files/${n.driveId}`, {method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify({trashed:true})}); }catch(e){ if(e.message==="auth") throw e; } } delete S.notes[n.id]; await dbDel(n.id); continue; }
      const r = await upload(n); n.driveId=r.id; n.driveMod=r.modifiedTime; n.dirty=false; await dbPut(n);
      if(out.length>20) await sleep(60);
    }
    lastSync = Date.now(); syncErr = "";
    if(changed.length && S.main.kind==="welcome"){ newNote(); renderSide(); if(innerWidth<=520) setPane("list"); }
    else if(changed.length){ renderSide(); if(!(S.main.kind==="note"&&dirty)) { const cur=S.notes[S.main.id]; if(S.main.kind!=="note" || (cur && !cur._new && document.activeElement?.id!=="text")) renderMain(); } }
  }catch(e){ syncErr = e.message==="auth" ? "reconnect" : "net"; syncErrMsg = e.message; }
  syncing = false; setStatus();
}
function scheduleSync(){ clearTimeout(syncT); syncT = setTimeout(sync, 3000); setStatus(); }
function syncSoon(ms){ clearTimeout(syncT); syncT = setTimeout(sync, ms); }
setInterval(() => sync(), 60000);
addEventListener("online", () => { setStatus(); syncSoon(500); });
addEventListener("offline", () => setStatus());

/* ===== Ligne d'état ===== */
function status(txt, cls){ $("#dot").className = "dot " + (cls||""); $("#status").textContent = txt; const w=$("#wStatus"); if(w) w.textContent = "État : " + txt + (syncErrMsg?" · "+syncErrMsg:""); }
function setStatus(){
  const pending = Object.values(S.notes).filter(n => n.dirty && !n._new).length, b = $("#syncBtn");
  b.hidden = true;
  if(!CONFIG.CLIENT_ID){ status("Sur cet appareil", "local"); return; }
  if(!linked()){ status("Sur cet appareil", "local"); b.hidden=false; b.textContent="Relier au Drive"; b.onclick=()=>connectDrive(false); return; }
  if(!navigator.onLine){ status("Hors ligne" + (pending?` · ${pending} à envoyer`:""), "off"); return; }
  if(syncErr==="reconnect" || !haveToken()){ status(pending?`${pending} à envoyer`:"Drive en pause", "off"); b.hidden=false; b.textContent="Synchroniser"; b.onclick=()=>connectDrive(true); return; }
  if(syncing){ status("Synchronisation…", "off"); return; }
  if(syncErr==="net"){ status("Drive injoignable" + (pending?` · ${pending} à envoyer`:""), "off"); return; }
  status(pending ? `${pending} à envoyer` : "À jour", pending ? "off" : "");
}

function toast(t){ const el=$("#toast"); el.textContent=t; el.classList.add("show"); clearTimeout(toast._t); toast._t=setTimeout(()=>el.classList.remove("show"),2000); }

/* ===== Démarrage ===== */
(async () => {
  try{ (await dbAll()).forEach(n => S.notes[n.id] = n); }catch(e){ toast("Stockage indisponible sur cet appareil"); }
  S.archCount = ((await kvGet("archive").catch(()=>null)) || []).length;
  newNote(); setStatus();
  if(!plainNotes().length && !live().some(n=>n.kind!=="note")){
    S.main = {kind:"welcome"};
    $("#bar").innerHTML = `${backBtn}<span class="when"></span>`;
    $("#page").innerHTML = `<h2>Bienvenue</h2><div class="hint">Ton carnet est vide sur cet appareil.<br><br>
      ${CONFIG.CLIENT_ID ? `<button class="pill primary" id="wDrive">Relier au Google Drive</button> pour retrouver tes notes.<br><br>` : ""}
      Ou <button class="pill" data-act="import">Importer le fichier de notes</button> préparé par Claude.<br><br>
      <button class="pill" id="wNew">Commencer une note</button><br><br><span id="wStatus"></span></div>`;
    const wd=$("#wDrive"); if(wd) wd.onclick=()=>connectDrive(false);
    $("#wNew").onclick=()=>newNote(); setStatus();
  }
  if(linked() && navigator.onLine && CONFIG.CLIENT_ID){
    if(haveToken()) syncSoon(300);
    else if(!sessionStorage.getItem("mn.tried")){ sessionStorage.setItem("mn.tried","1"); connectDrive(true); }  // reconnexion silencieuse, une fois par session
  }
  if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(()=>{});
})();
})();

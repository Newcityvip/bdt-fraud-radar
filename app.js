// ===================== CONFIG =====================
// ✅ Use your latest working API (the one that returns total_matches ~2800+)
const API_BASE = "https://script.google.com/macros/s/AKfycbwxfjB-XCs5wq1Non1eB3KNEq5gN-mGJTZzGPC-vpzYCgMLWx1JDIkVH3Gjrs-VQ6lWGA/exec";

// Columns definition (key -> label)
const COLS = [
  ["username","Username"],
  ["lastActivityAt","Last Activity"],
  ["riskScore","Risk Score"],
  ["riskLevel","Risk Level"],
  ["reasons","Reasons"],
  ["totalDeposit","Total Deposit"],
  ["totalWithdrawal","Total Withdrawal"],
  ["net","Net"],
  ["depositCnt","Deposit Cnt"],
  ["withdrawCnt","Withdraw Cnt"],
  ["uniqueBanks","Unique Banks"],
  ["sharedBankUsers","Shared Bank Users"],
  ["sharedIpUsers","Shared IP Users"],
  ["fastWithdraw","Fast Withdraw?"],
  ["accountStatus","Account Status"],
  ["vip","VIP"],
];

// Default visible columns (more compact, fits screen better)
const DEFAULT_VISIBLE = new Set([
  "username","lastActivityAt","riskScore","riskLevel","reasons",
  "totalDeposit","totalWithdrawal","net","depositCnt","withdrawCnt",
  "sharedBankUsers","sharedIpUsers","fastWithdraw"
]);

// ===================== HELPERS =====================
const $ = (id) => document.getElementById(id);

function esc(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function toNum(x){
  const n = parseFloat(String(x ?? "").replace(/,/g,"").trim());
  return Number.isFinite(n) ? n : 0;
}

function setStatus(msg, isErr=false){
  const el = $("status");
  el.style.color = isErr ? "#ef4444" : "#16a34a";
  el.textContent = msg;
}

function buildUrl(params){
  const u = new URL(API_BASE);
  // always request pure JSON
  u.searchParams.set("format","json");
  Object.entries(params).forEach(([k,v])=>{
    if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, v);
  });
  return u.toString();
}

// Try fetch JSON; if blocked by CORS, fallback to JSONP
async function fetchJsonSmart(url){
  try {
    const res = await fetch(url, { method:"GET", cache:"no-store" });
    if(!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } catch (_) {
    // JSONP fallback
    return await jsonp(url);
  }
}

function jsonp(url){
  return new Promise((resolve,reject)=>{
    const cbName = "cb_" + Math.random().toString(36).slice(2);
    const s = document.createElement("script");
    const t = setTimeout(()=>{ cleanup(); reject(new Error("JSONP timeout")); }, 20000);

    function cleanup(){
      clearTimeout(t);
      delete window[cbName];
      s.remove();
    }

    window[cbName] = (data)=>{ cleanup(); resolve(data); };
    s.onerror = ()=>{ cleanup(); reject(new Error("JSONP failed")); };

    const join = url.includes("?") ? "&" : "?";
    s.src = url + join + "callback=" + cbName;
    document.body.appendChild(s);
  });
}

// ===================== STATE =====================
let allRows = [];
let totalMatches = 0;
let offset = 0;
let isLoading = false;

let visibleCols = loadCols();

// ===================== COLUMNS =====================
function loadCols(){
  try{
    const raw = localStorage.getItem("bdtFraudCols");
    if(!raw) return new Set(DEFAULT_VISIBLE);
    const arr = JSON.parse(raw);
    return new Set(arr);
  }catch{
    return new Set(DEFAULT_VISIBLE);
  }
}
function saveCols(){
  localStorage.setItem("bdtFraudCols", JSON.stringify([...visibleCols]));
}

function renderThead(){
  const tr = $("theadRow");
  tr.innerHTML = "";
  for(const [key,label] of COLS){
    if(!visibleCols.has(key)) continue;
    const th = document.createElement("th");
    th.textContent = label;
    if(key === "username") th.className = "stickyUser";
    tr.appendChild(th);
  }
}

function openColumnsModal(){
  const modal = $("modal");
  const list = $("colList");
  list.innerHTML = "";

  for(const [key,label] of COLS){
    const item = document.createElement("div");
    item.className = "colItem";
    item.innerHTML = `
      <input type="checkbox" ${visibleCols.has(key) ? "checked":""} data-col="${esc(key)}" />
      <div><b>${esc(label)}</b><div style="font-size:12px;color:#64748b">${esc(key)}</div></div>
    `;
    list.appendChild(item);
  }

  list.querySelectorAll("input[type=checkbox]").forEach(chk=>{
    chk.addEventListener("change", ()=>{
      const k = chk.getAttribute("data-col");
      if(chk.checked) visibleCols.add(k);
      else visibleCols.delete(k);
      saveCols();
      renderThead();
      renderBody();
    });
  });

  modal.style.display = "grid";
}

// ===================== FILTERS =====================
function getFilters(){
  const days = parseInt(($("days").value || "3").trim(), 10);
  const minScore = parseInt(($("minScore").value || "3").trim(), 10);

  // If blank/NaN (your current issue), force defaults
  const safeDays = Number.isFinite(days) && days > 0 ? days : 3;
  const safeMin = Number.isFinite(minScore) && minScore >= 0 ? minScore : 3;

  const riskLevel = ($("riskLevel").value || "ATTN").toUpperCase();
  const q = ($("searchUser").value || "").trim().toLowerCase();

  const limit = parseInt(($("pageSize").value || "300").trim(), 10) || 300;

  return { days: safeDays, minScore: safeMin, riskLevel, q, limit };
}

function applyClientFilters(rows){
  const { riskLevel, q, minScore } = getFilters();

  return rows.filter(r=>{
    const rs = toNum(r.riskScore);
    if(rs < minScore) return false;

    // ATTENTION mode = MED/HIGH only
    const lvl = String(r.riskLevel || "").toUpperCase();
    if(riskLevel === "ATTN" && !(lvl === "MED" || lvl === "HIGH")) return false;
    if(riskLevel !== "ALL" && riskLevel !== "ATTN" && lvl !== riskLevel) return false;

    if(q && !String(r.username||"").toLowerCase().includes(q)) return false;
    return true;
  });
}

// ===================== RENDER =====================
function renderCounters(){
  $("loadedCnt").textContent = String(allRows.length);
  $("totalCnt").textContent = String(totalMatches || 0);
  $("offsetCnt").textContent = String(offset);
  const shown = applyClientFilters(allRows).length;
  $("showingCnt").textContent = String(shown);

  // empty state
  $("emptyState").style.display = shown === 0 && allRows.length > 0 ? "grid" : "none";
  if(allRows.length === 0) $("emptyState").style.display = "none";
}

function pill(level){
  const lv = String(level||"LOW").toUpperCase();
  const c = (lv === "HIGH") ? "HIGH" : (lv === "MED" ? "MED" : "LOW");
  return `<span class="pill ${c}">${esc(lv)}</span>`;
}

function fmt(n){
  const x = Number(n || 0);
  return x.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function renderBody(){
  const tbody = $("tbody");
  const rows = applyClientFilters(allRows);

  tbody.innerHTML = rows.map(r=>{
    const tds = [];

    for(const [key] of COLS){
      if(!visibleCols.has(key)) continue;

      let val = r[key];

      if(key === "username"){
        tds.push(`<td class="stickyUser">${esc(val || "")}</td>`);
        continue;
      }
      if(key === "riskLevel"){
        tds.push(`<td>${pill(val)}</td>`);
        continue;
      }
      if(key === "reasons"){
        tds.push(`<td class="muted">${esc(val || "")}</td>`);
        continue;
      }
      if(key === "net"){
        const nn = toNum(val);
        tds.push(`<td class="${nn < 0 ? "neg" : "pos"}">${esc(fmt(nn))}</td>`);
        continue;
      }
      if(["totalDeposit","totalWithdrawal"].includes(key)){
        tds.push(`<td>${esc(fmt(toNum(val)))}</td>`);
        continue;
      }

      // date fields already formatted by API "YYYY-MM-DD HH:mm:ss"
      tds.push(`<td>${esc(val ?? "")}</td>`);
    }

    return `<tr>${tds.join("")}</tr>`;
  }).join("");

  renderCounters();
}

// ===================== LOADING =====================
async function loadFirstPage(){
  if(isLoading) return;
  isLoading = true;

  // reset
  allRows = [];
  totalMatches = 0;
  offset = 0;
  renderBody();
  renderCounters();

  const { days, minScore, limit } = getFilters();

  setStatus("Loading…", false);
  try{
    const url = buildUrl({ days, minScore, limit, offset });
    const data = await fetchJsonSmart(url);

    if(!data || data.ok !== true) throw new Error(data?.error || "API error");

    totalMatches = Number(data.total_matches || 0);
    const rows = Array.isArray(data.rows) ? data.rows : [];
    allRows = rows;
    offset = rows.length;

    setStatus(`Loaded ${allRows.length} of ${totalMatches}`, false);
    renderBody();

    // show empty state if nothing matches from API
    if(allRows.length === 0){
      $("emptyState").style.display = "grid";
      $("emptyState").querySelector(".emptyTitle").textContent = "No results returned from API";
      $("emptyState").querySelector(".emptySub").innerHTML =
        `Try lowering <b>Min Risk Score</b> or increasing <b>Days</b>.`;
    }
  }catch(e){
    console.error(e);
    setStatus("Error: " + e.message, true);
  }finally{
    isLoading = false;
  }
}

async function loadMore(){
  if(isLoading) return;
  const { days, minScore, limit } = getFilters();

  // no more
  if(offset >= totalMatches && totalMatches > 0) return;

  isLoading = true;
  setStatus(`Loading more… (${offset}/${totalMatches || "?"})`, false);

  try{
    const url = buildUrl({ days, minScore, limit, offset });
    const data = await fetchJsonSmart(url);
    if(!data || data.ok !== true) throw new Error(data?.error || "API error");

    totalMatches = Number(data.total_matches || totalMatches || 0);

    const rows = Array.isArray(data.rows) ? data.rows : [];
    allRows = allRows.concat(rows);
    offset += rows.length;

    setStatus(`Loaded ${allRows.length} of ${totalMatches}`, false);
    renderBody();
  }catch(e){
    console.error(e);
    setStatus("Error: " + e.message, true);
  }finally{
    isLoading = false;
  }
}

// Auto-load on scroll
function hookScrollAutoLoad(){
  const wrap = $("tableWrap");
  wrap.addEventListener("scroll", ()=>{
    const mode = $("autoLoad").value || "ON";
    if(mode !== "ON") return;
    if(isLoading) return;
    const nearBottom = (wrap.scrollTop + wrap.clientHeight) >= (wrap.scrollHeight - 180);
    if(nearBottom) loadMore();
  });
}

// Export only currently visible filtered rows
function exportCSV(){
  const rows = applyClientFilters(allRows);
  const headers = COLS.filter(([k])=>visibleCols.has(k)).map(([,label])=>label);

  const keys = COLS.filter(([k])=>visibleCols.has(k)).map(([k])=>k);

  const lines = [];
  lines.push(headers.map(csvSafe).join(","));
  rows.forEach(r=>{
    const line = keys.map(k=>csvSafe(String(r[k] ?? ""))).join(",");
    lines.push(line);
  });

  const blob = new Blob([lines.join("\n")], {type:"text/csv;charset=utf-8"});
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u;
  a.download = "bdt_fraud_radar_attention.csv";
  a.click();
  URL.revokeObjectURL(u);
}
function csvSafe(s){
  const v = String(s ?? "");
  if(v.includes(",") || v.includes('"') || v.includes("\n")) return `"${v.replaceAll('"','""')}"`;
  return v;
}

// ===================== INIT =====================
window.addEventListener("DOMContentLoaded", ()=>{
  // fix your “0 rows” issue: force defaults even if inputs empty
  if(!$("days").value) $("days").value = "3";
  if(!$("minScore").value) $("minScore").value = "3";
  if(!$("riskLevel").value) $("riskLevel").value = "ATTN";

  renderThead();
  renderBody();
  renderCounters();

  $("reloadBtn").addEventListener("click", loadFirstPage);
  $("loadMoreBtn").addEventListener("click", loadMore);
  $("exportBtn").addEventListener("click", exportCSV);

  $("columnsBtn").addEventListener("click", openColumnsModal);
  $("closeModal").addEventListener("click", ()=> $("modal").style.display = "none");
  $("modal").addEventListener("click", (e)=>{ if(e.target.id === "modal") $("modal").style.display = "none"; });

  $("showAllCols").addEventListener("click", ()=>{
    visibleCols = new Set(COLS.map(([k])=>k));
    saveCols();
    renderThead();
    renderBody();
  });

  $("hideSomeCols").addEventListener("click", ()=>{
    visibleCols = new Set(DEFAULT_VISIBLE);
    saveCols();
    renderThead();
    renderBody();
  });

  // re-render on filter changes (client-side)
  ["days","minScore","riskLevel","searchUser","pageSize","autoLoad"].forEach(id=>{
    $(id).addEventListener("input", ()=>{
      // If days/minScore changed, reload from API first page
      if(id === "days" || id === "minScore") loadFirstPage();
      else renderBody();
    });
  });

  hookScrollAutoLoad();

  // first load
  loadFirstPage();
});

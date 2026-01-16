// === IMPORTANT: put your Apps Script web app URL here ===
const API_URL = "https://script.google.com/macros/s/AKfycbz-0K46B3G1lJpO83kAKkhdkywwgDNOOaqLQCY8_8Kz_7lt8W3Ca1D-w06VokuB2ThOXg/exec";

let lastRows = [];

const $ = (id) => document.getElementById(id);

function setStatus(msg) { $("status").textContent = msg || ""; }
function setErr(msg) { $("err").textContent = msg || ""; }

function fmt(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return v.toLocaleString();
  return String(v);
}

function toLocal(dt) {
  if (!dt) return "";
  const d = new Date(dt);
  if (isNaN(d.getTime())) return String(dt);
  return d.toLocaleString();
}

async function loadData() {
  setErr("");
  setStatus("Loading...");

  const days = Number($("days").value || 3);
  const minScore = Number($("minScore").value || 5);
  const limit = Number($("limit").value || 500);

  const url = `${API_URL}?days=${encodeURIComponent(days)}&minScore=${encodeURIComponent(minScore)}&limit=${encodeURIComponent(limit)}&t=${Date.now()}`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();

    // try parse JSON
    let data;
    try { data = JSON.parse(text); }
    catch (e) {
      throw new Error("API did not return JSON. Response was:\n\n" + text.slice(0, 800));
    }

    if (!data.ok) {
      throw new Error("API Error: " + (data.error || "Unknown") + "\n" + (data.stack || ""));
    }

    lastRows = data.rows || [];
    renderTable(lastRows);

    setStatus(`Loaded ${lastRows.length} records (minScore=${minScore}, days=${days})`);
  } catch (err) {
    lastRows = [];
    renderTable([]);
    setErr(String(err.message || err));
    setStatus("Failed");
  }
}

function renderTable(rows) {
  const tb = $("tbody");
  tb.innerHTML = "";

  for (const r of rows) {
    const tr = document.createElement("tr");
    const reasons = Array.isArray(r.reasons) ? r.reasons.join(" • ") : "";

    tr.innerHTML = `
      <td>${fmt(r.username)}</td>
      <td><span class="pill ${fmt(r.riskLevel)}">${fmt(r.riskLevel)}</span></td>
      <td>${fmt(r.riskScore)}</td>
      <td class="reasons">${fmt(reasons)}</td>
      <td>${fmt(r.action)}</td>
      <td>${fmt(r.totalDep)}</td>
      <td>${fmt(r.totalWd)}</td>
      <td>${fmt(r.netProfit)}</td>
      <td>${fmt(r.depToWdHours)}</td>
      <td>${fmt(r.night)}</td>
      <td>${fmt(r.bankWallet)}</td>
      <td>${fmt(r.bankCount)}</td>
      <td>${fmt(r.ip)}</td>
      <td>${fmt(r.ipCount)}</td>
      <td>${fmt(r.vip)}</td>
      <td>${toLocal(r.regTime)}</td>
      <td>${toLocal(r.lastBetTime)}</td>
      <td>${fmt(r.channel)}</td>
    `;
    tb.appendChild(tr);
  }
}

function exportCSV() {
  if (!lastRows.length) {
    alert("No data to export");
    return;
  }

  const headers = [
    "username","riskLevel","riskScore","reasons","action","totalDep","totalWd","netProfit","depToWdHours",
    "night","bankWallet","bankCount","ip","ipCount","vip","regTime","lastBetTime","channel"
  ];

  const lines = [];
  lines.push(headers.join(","));

  for (const r of lastRows) {
    const row = headers.map((h) => {
      let v = r[h];
      if (h === "reasons" && Array.isArray(v)) v = v.join(" | ");
      if (v === null || v === undefined) v = "";
      v = String(v).replaceAll('"', '""');
      return `"${v}"`;
    });
    lines.push(row.join(","));
  }

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `fraud_alerts_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

$("btnLoad").addEventListener("click", loadData);
$("btnExport").addEventListener("click", exportCSV);

// Auto-load on open
loadData();

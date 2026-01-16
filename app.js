// ====== CONFIG ======
const API_URL = "https://script.google.com/macros/s/AKfycbx5qpQ_1gi9DSRgCSLrt8opWrWvNE3Wkl089ekNXcyD6uegazM3C2dR4-TPVpsaT8PVzQ/exec";

// Risk rules (you can tune later)
const RULES = {
  MIN_SCORE_DEFAULT: 3,
  SHARED_BANK_MIN_USERS: 2,
  SHARED_IP_MIN_USERS: 3,
  FAST_WITHDRAW_HOURS: 6,
  NET_PROFIT_MIN: 5000,
};

// ====== UI ======
const elStatus = document.getElementById("status");
const tbody = document.getElementById("tbody");
const minScoreEl = document.getElementById("minScore");
const riskLevelEl = document.getElementById("riskLevel");
const searchUserEl = document.getElementById("searchUser");

document.getElementById("reloadBtn").addEventListener("click", load);
document.getElementById("exportBtn").addEventListener("click", exportCSV);

minScoreEl.value = RULES.MIN_SCORE_DEFAULT;
[minScoreEl, riskLevelEl, searchUserEl].forEach(el => el.addEventListener("input", render));

// ====== JSONP Loader (bypass CORS) ======
function jsonp(url) {
  return new Promise((resolve, reject) => {
    const cbName = "cb_" + Math.random().toString(36).slice(2);
    const script = document.createElement("script");
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("JSONP timeout"));
    }, 20000);

    function cleanup() {
      clearTimeout(timeout);
      delete window[cbName];
      script.remove();
    }

    window[cbName] = (data) => {
      cleanup();
      resolve(data);
    };

    script.src = url + (url.includes("?") ? "&" : "?") + "callback=" + cbName;
    script.onerror = () => { cleanup(); reject(new Error("JSONP load failed")); };
    document.body.appendChild(script);
  });
}

// ====== DATA ======
let fullRows = []; // computed fraud rows

function num(x) {
  const n = parseFloat(String(x || "").replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

function parseTime(s) {
  // your sheet times look like "1/16/2026 13:14" or "2026/01/16 13:14:00"
  const t = new Date(s);
  return isNaN(t.getTime()) ? null : t;
}

function hoursBetween(a, b) {
  if (!a || !b) return null;
  return Math.abs(b.getTime() - a.getTime()) / 36e5;
}

// ====== MAIN ======
async function load() {
  elStatus.textContent = "Loading data from API...";
  tbody.innerHTML = "";

  try {
    const data = await jsonp(API_URL);
    if (!data || !data.ok) throw new Error(data?.error || "API returned error");

    const deposit = data.deposit?.rows || [];
    const withdraw = data.withdraw?.rows || [];
    const member = data.member?.rows || [];

    fullRows = buildFraudRows({ deposit, withdraw, member });
    elStatus.textContent = `Loaded. Candidates: ${fullRows.length}`;
    render();

  } catch (e) {
    console.error(e);
    elStatus.textContent = "Error: " + e.message;
  }
}

function buildFraudRows({ deposit, withdraw, member }) {
  // ---- Build per-user aggregates ----
  const u = {}; // username -> stats

  function ensure(user) {
    const key = String(user || "").trim();
    if (!key) return null;
    if (!u[key]) {
      u[key] = {
        username: key,
        depTotal: 0, depCnt: 0, depFirst: null,
        wdTotal: 0, wdCnt: 0, wdFirst: null,
        banks: new Set(),
        ip: "",
        vip: "",
        accountStatus: "",
      };
    }
    return u[key];
  }

  // Deposit fields (based on your RAW headers)
  for (const r of deposit) {
    const user = ensure(r["Username"]);
    if (!user) continue;
    user.depTotal += num(r["Deposit Amount"] || r["Deposit amount"]);
    user.depCnt += 1;
    const t = parseTime(r["Created Time"]);
    if (t && (!user.depFirst || t < user.depFirst)) user.depFirst = t;

    const bank = String(r["From Bank Acc No"] || r["From Wallet/Account No"] || "").trim();
    if (bank) user.banks.add(bank);
  }

  // Withdrawal fields (based on your RAW headers)
  for (const r of withdraw) {
    const user = ensure(r["Username"]);
    if (!user) continue;
    user.wdTotal += num(r["Withdrawal Amount"] || r["Amount"]);
    user.wdCnt += 1;
    const t = parseTime(r["Created Time"]);
    if (t && (!user.wdFirst || t < user.wdFirst)) user.wdFirst = t;

    const bank = String(r["Bank Acc No"] || r["Bank Account / Wallet"] || "").trim();
    if (bank) user.banks.add(bank);
  }

  // Member fields (based on your RAW headers)
  for (const r of member) {
    const user = ensure(r["Username"]);
    if (!user) continue;
    user.ip = String(r["Last Login IP"] || "").trim();
    user.vip = String(r["VIP"] || "").trim();
    user.accountStatus = String(r["Account Status"] || r["Status"] || "").trim();
  }

  // ---- Shared Bank Map ----
  const bankToUsers = new Map(); // bank -> Set(users)
  for (const k of Object.keys(u)) {
    for (const b of u[k].banks) {
      if (!bankToUsers.has(b)) bankToUsers.set(b, new Set());
      bankToUsers.get(b).add(k);
    }
  }

  // ---- Shared IP Map ----
  const ipToUsers = new Map(); // ip -> Set(users)
  for (const k of Object.keys(u)) {
    const ip = u[k].ip;
    if (!ip) continue;
    if (!ipToUsers.has(ip)) ipToUsers.set(ip, new Set());
    ipToUsers.get(ip).add(k);
  }

  // ---- Compute Risk Rows ----
  const out = [];
  for (const k of Object.keys(u)) {
    const s = u[k];

    // shared bank users = max shared users count across any bank
    let sharedBankUsers = 0;
    for (const b of s.banks) {
      sharedBankUsers = Math.max(sharedBankUsers, (bankToUsers.get(b)?.size || 0));
    }

    const sharedIPUsers = s.ip ? (ipToUsers.get(s.ip)?.size || 0) : 0;

    const net = s.depTotal - s.wdTotal;
    const fastHrs = (s.depFirst && s.wdFirst) ? hoursBetween(s.depFirst, s.wdFirst) : null;
    const fastWithdraw = fastHrs !== null && fastHrs <= RULES.FAST_WITHDRAW_HOURS;

    // ---- scoring (simple + effective) ----
    let score = 0;
    const reasons = [];

    if (sharedBankUsers >= RULES.SHARED_BANK_MIN_USERS && sharedBankUsers > 1) {
      score += 3;
      reasons.push(`Shared bank account with ${sharedBankUsers - 1} other user(s)`);
    }

    if (sharedIPUsers >= RULES.SHARED_IP_MIN_USERS && sharedIPUsers > 1) {
      score += 2;
      reasons.push(`Shared login IP with ${sharedIPUsers - 1} other user(s)`);
    }

    if (fastWithdraw) {
      score += 2;
      reasons.push(`Fast withdraw (${fastHrs.toFixed(1)}h) after first deposit`);
    }

    if (net <= -RULES.NET_PROFIT_MIN) {
      // withdrew much more than deposited
      score += 3;
      reasons.push(`Net negative beyond threshold (${net.toFixed(2)})`);
    }

    if (s.wdCnt >= 3 && s.depCnt <= 1) {
      score += 2;
      reasons.push(`Many withdrawals with low deposit count (wd ${s.wdCnt} vs dep ${s.depCnt})`);
    }

    // Decide risk level
    let level = "LOW";
    if (score >= 6) level = "HIGH";
    else if (score >= 3) level = "MEDIUM";

    // ✅ Only keep “possible fraud”
    if (score >= RULES.MIN_SCORE_DEFAULT) {
      out.push({
        username: s.username,
        score,
        level,
        reasons: reasons.join(" | "),
        depTotal: s.depTotal,
        wdTotal: s.wdTotal,
        net,
        depCnt: s.depCnt,
        wdCnt: s.wdCnt,
        uniqueBanks: s.banks.size,
        sharedBankUsers,
        sharedIPUsers,
        fastWithdraw: fastWithdraw ? "YES" : "NO",
        accountStatus: s.accountStatus,
        vip: s.vip,
      });
    }
  }

  // Sort highest risk first
  out.sort((a, b) => b.score - a.score || b.net - a.net);
  return out;
}

function render() {
  const minScore = num(minScoreEl.value) || RULES.MIN_SCORE_DEFAULT;
  const riskLevel = riskLevelEl.value;
  const q = String(searchUserEl.value || "").trim().toLowerCase();

  const rows = fullRows.filter(r => {
    if (r.score < minScore) return false;
    if (riskLevel !== "ALL" && r.level !== riskLevel) return false;
    if (q && !r.username.toLowerCase().includes(q)) return false;
    return true;
  });

  tbody.innerHTML = rows.map(r => {
    return `
      <tr>
        <td><b>${escapeHtml(r.username)}</b></td>
        <td>${r.score}</td>
        <td><span class="badge ${r.level}">${r.level}</span></td>
        <td class="small">${escapeHtml(r.reasons || "-")}</td>
        <td>${fmt(r.depTotal)}</td>
        <td>${fmt(r.wdTotal)}</td>
        <td>${fmt(r.net)}</td>
        <td>${r.depCnt}</td>
        <td>${r.wdCnt}</td>
        <td>${r.uniqueBanks}</td>
        <td>${r.sharedBankUsers}</td>
        <td>${r.sharedIPUsers}</td>
        <td>${r.fastWithdraw}</td>
        <td>${escapeHtml(r.accountStatus || "")}</td>
        <td>${escapeHtml(r.vip || "")}</td>
      </tr>
    `;
  }).join("");

  elStatus.textContent = `Showing ${rows.length} / ${fullRows.length} candidates`;
}

function exportCSV() {
  const minScore = num(minScoreEl.value) || RULES.MIN_SCORE_DEFAULT;
  const riskLevel = riskLevelEl.value;
  const q = String(searchUserEl.value || "").trim().toLowerCase();

  const rows = fullRows.filter(r => {
    if (r.score < minScore) return false;
    if (riskLevel !== "ALL" && r.level !== riskLevel) return false;
    if (q && !r.username.toLowerCase().includes(q)) return false;
    return true;
  });

  const headers = [
    "Username","Risk Score","Risk Level","Reasons",
    "Total Deposit","Total Withdrawal","Net",
    "Deposit Count","Withdrawal Count",
    "Unique Banks","Shared Bank Users","Shared IP Users",
    "Fast Withdraw","Account Status","VIP"
  ];

  const lines = [headers.join(",")];
  for (const r of rows) {
    const line = [
      r.username, r.score, r.level, r.reasons,
      r.depTotal, r.wdTotal, r.net,
      r.depCnt, r.wdCnt,
      r.uniqueBanks, r.sharedBankUsers, r.sharedIPUsers,
      r.fastWithdraw, r.accountStatus, r.vip
    ].map(csvSafe).join(",");
    lines.push(line);
  }

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "bdt_fraud_candidates.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvSafe(v) {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function fmt(n) {
  const x = Number(n || 0);
  return x.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// auto load
load();

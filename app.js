const API_URL = "https://script.google.com/macros/s/AKfycbw6zvTwHZ3-9XIxh6S1eA1Q9H8ZmwgeomL1_IxyjJcWrhRpuStQmO1JKbhkKCrkYmNfKw/exec";

fetch(API_URL)
  .then(res => res.json())
  .then(data => renderTable(data))
  .catch(err => {
    document.getElementById("fraudTable").innerHTML =
      "<tr><td>Error loading data</td></tr>";
    console.error(err);
  });

function renderTable(data) {
  let html = `
    <tr>
      <th>Username</th>
      <th>VIP</th>
      <th>Deposit</th>
      <th>Withdraw</th>
      <th>Net</th>
      <th>Score</th>
      <th>Risk</th>
      <th>Reasons</th>
    </tr>
  `;

  data.forEach(u => {
    const cls = u.level === "HIGH" ? "high" : "medium";
    html += `
      <tr class="${cls}">
        <td>${u.username}</td>
        <td>${u.vip}</td>
        <td>${u.deposits}</td>
        <td>${u.withdrawals}</td>
        <td>${u.net}</td>
        <td>${u.score}</td>
        <td>${u.level}</td>
        <td>${u.reasons}</td>
      </tr>
    `;
  });

  document.getElementById("fraudTable").innerHTML = html;
}

function exportCSV() {
  let rows = [];
  document.querySelectorAll("table tr").forEach(tr => {
    let row = [];
    tr.querySelectorAll("th,td").forEach(td => row.push(td.innerText));
    rows.push(row.join(","));
  });

  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "fraud_alerts.csv";
  a.click();
}

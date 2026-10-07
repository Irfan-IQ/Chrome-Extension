/**
 * System Benchmark Report Script
 * 30-Trial Performance Telemetry Data
 */

const trials = [
  {"Trial":1,"Before_CPU_%":1.17,"Before_RAM_Priv_MiB":394.49,"Before_RAM_PSS_MiB":670.55,"During_Peak_CPU_%":19.67,"During_Avg_CPU_%":13.58,"During_Peak_RAM_Priv_MiB":683.85,"During_Peak_RAM_PSS_MiB":1041.74,"After_CPU_%":4.39,"After_RAM_Priv_MiB":396.09,"After_RAM_PSS_MiB":674.23,"Delta_Peak_PSS_MiB":371.19,"Memory_Leak_PSS_MiB":3.68},
  {"Trial":2,"Before_CPU_%":2.41,"Before_RAM_Priv_MiB":392.42,"Before_RAM_PSS_MiB":672.6,"During_Peak_CPU_%":18.75,"During_Avg_CPU_%":15.87,"During_Peak_RAM_Priv_MiB":680.04,"During_Peak_RAM_PSS_MiB":1090.25,"After_CPU_%":6.43,"After_RAM_Priv_MiB":394.28,"After_RAM_PSS_MiB":671.91,"Delta_Peak_PSS_MiB":417.65,"Memory_Leak_PSS_MiB":-0.69},
  {"Trial":3,"Before_CPU_%":1.82,"Before_RAM_Priv_MiB":394.25,"Before_RAM_PSS_MiB":669.61,"During_Peak_CPU_%":16.72,"During_Avg_CPU_%":12.27,"During_Peak_RAM_Priv_MiB":744.84,"During_Peak_RAM_PSS_MiB":948.88,"After_CPU_%":5.03,"After_RAM_Priv_MiB":398.49,"After_RAM_PSS_MiB":670.42,"Delta_Peak_PSS_MiB":279.27,"Memory_Leak_PSS_MiB":0.81},
  {"Trial":4,"Before_CPU_%":2.02,"Before_RAM_Priv_MiB":390.18,"Before_RAM_PSS_MiB":673.74,"During_Peak_CPU_%":3.64,"During_Avg_CPU_%":2.88,"During_Peak_RAM_Priv_MiB":691.78,"During_Peak_RAM_PSS_MiB":922.34,"After_CPU_%":5.31,"After_RAM_Priv_MiB":398.11,"After_RAM_PSS_MiB":669.16,"Delta_Peak_PSS_MiB":248.6,"Memory_Leak_PSS_MiB":-4.58},
  {"Trial":5,"Before_CPU_%":4.24,"Before_RAM_Priv_MiB":392.06,"Before_RAM_PSS_MiB":670.6,"During_Peak_CPU_%":10.78,"During_Avg_CPU_%":11.11,"During_Peak_RAM_Priv_MiB":700.34,"During_Peak_RAM_PSS_MiB":1057.21,"After_CPU_%":4.67,"After_RAM_Priv_MiB":395.46,"After_RAM_PSS_MiB":669.02,"Delta_Peak_PSS_MiB":386.61,"Memory_Leak_PSS_MiB":-1.58},
  {"Trial":6,"Before_CPU_%":3.96,"Before_RAM_Priv_MiB":392.83,"Before_RAM_PSS_MiB":666.86,"During_Peak_CPU_%":26.77,"During_Avg_CPU_%":16.71,"During_Peak_RAM_Priv_MiB":737.52,"During_Peak_RAM_PSS_MiB":1049.23,"After_CPU_%":5.46,"After_RAM_Priv_MiB":395.77,"After_RAM_PSS_MiB":670.83,"Delta_Peak_PSS_MiB":382.37,"Memory_Leak_PSS_MiB":3.97},
  {"Trial":7,"Before_CPU_%":3.35,"Before_RAM_Priv_MiB":393.26,"Before_RAM_PSS_MiB":671.59,"During_Peak_CPU_%":20.31,"During_Avg_CPU_%":17.39,"During_Peak_RAM_Priv_MiB":744.25,"During_Peak_RAM_PSS_MiB":1036.08,"After_CPU_%":4.1,"After_RAM_Priv_MiB":396.48,"After_RAM_PSS_MiB":671.87,"Delta_Peak_PSS_MiB":364.49,"Memory_Leak_PSS_MiB":0.28},
  {"Trial":8,"Before_CPU_%":3.69,"Before_RAM_Priv_MiB":392.93,"Before_RAM_PSS_MiB":666.9,"During_Peak_CPU_%":9.09,"During_Avg_CPU_%":6.21,"During_Peak_RAM_Priv_MiB":681.36,"During_Peak_RAM_PSS_MiB":1024.16,"After_CPU_%":3.89,"After_RAM_Priv_MiB":395.64,"After_RAM_PSS_MiB":671.58,"Delta_Peak_PSS_MiB":357.26,"Memory_Leak_PSS_MiB":4.68},
  {"Trial":9,"Before_CPU_%":3.9,"Before_RAM_Priv_MiB":391.2,"Before_RAM_PSS_MiB":667.66,"During_Peak_CPU_%":18.98,"During_Avg_CPU_%":16.48,"During_Peak_RAM_Priv_MiB":789.7,"During_Peak_RAM_PSS_MiB":1040.67,"After_CPU_%":6.13,"After_RAM_Priv_MiB":395.38,"After_RAM_PSS_MiB":671.13,"Delta_Peak_PSS_MiB":373.01,"Memory_Leak_PSS_MiB":3.47},
  {"Trial":10,"Before_CPU_%":2.12,"Before_RAM_Priv_MiB":394.04,"Before_RAM_PSS_MiB":671.21,"During_Peak_CPU_%":15.02,"During_Avg_CPU_%":11.45,"During_Peak_RAM_Priv_MiB":815.94,"During_Peak_RAM_PSS_MiB":1038.5,"After_CPU_%":5.51,"After_RAM_Priv_MiB":397.63,"After_RAM_PSS_MiB":669.95,"Delta_Peak_PSS_MiB":367.29,"Memory_Leak_PSS_MiB":-1.26},
  {"Trial":11,"Before_CPU_%":2.01,"Before_RAM_Priv_MiB":394.27,"Before_RAM_PSS_MiB":668.52,"During_Peak_CPU_%":9.59,"During_Avg_CPU_%":5.71,"During_Peak_RAM_Priv_MiB":749.12,"During_Peak_RAM_PSS_MiB":973.96,"After_CPU_%":5.88,"After_RAM_Priv_MiB":396.1,"After_RAM_PSS_MiB":670.4,"Delta_Peak_PSS_MiB":305.44,"Memory_Leak_PSS_MiB":1.88},
  {"Trial":12,"Before_CPU_%":1.15,"Before_RAM_Priv_MiB":397.97,"Before_RAM_PSS_MiB":670.38,"During_Peak_CPU_%":26.16,"During_Avg_CPU_%":17.84,"During_Peak_RAM_Priv_MiB":744.15,"During_Peak_RAM_PSS_MiB":1018.67,"After_CPU_%":7.41,"After_RAM_Priv_MiB":396.79,"After_RAM_PSS_MiB":668.1,"Delta_Peak_PSS_MiB":348.29,"Memory_Leak_PSS_MiB":-2.28},
  {"Trial":13,"Before_CPU_%":3.22,"Before_RAM_Priv_MiB":397.5,"Before_RAM_PSS_MiB":668.27,"During_Peak_CPU_%":13.55,"During_Avg_CPU_%":8.89,"During_Peak_RAM_Priv_MiB":762.6,"During_Peak_RAM_PSS_MiB":981.34,"After_CPU_%":6.01,"After_RAM_Priv_MiB":395.78,"After_RAM_PSS_MiB":667.63,"Delta_Peak_PSS_MiB":313.07,"Memory_Leak_PSS_MiB":-0.64},
  {"Trial":14,"Before_CPU_%":4.43,"Before_RAM_Priv_MiB":396.22,"Before_RAM_PSS_MiB":664.59,"During_Peak_CPU_%":32.92,"During_Avg_CPU_%":21.35,"During_Peak_RAM_Priv_MiB":784.81,"During_Peak_RAM_PSS_MiB":1133.56,"After_CPU_%":6.28,"After_RAM_Priv_MiB":396.3,"After_RAM_PSS_MiB":671.29,"Delta_Peak_PSS_MiB":468.97,"Memory_Leak_PSS_MiB":6.7},
  {"Trial":15,"Before_CPU_%":2.64,"Before_RAM_Priv_MiB":392.48,"Before_RAM_PSS_MiB":670.52,"During_Peak_CPU_%":19.32,"During_Avg_CPU_%":15.77,"During_Peak_RAM_Priv_MiB":683.02,"During_Peak_RAM_PSS_MiB":1053.27,"After_CPU_%":5.18,"After_RAM_Priv_MiB":398.24,"After_RAM_PSS_MiB":674.32,"Delta_Peak_PSS_MiB":382.75,"Memory_Leak_PSS_MiB":3.8},
  {"Trial":16,"Before_CPU_%":2.76,"Before_RAM_Priv_MiB":393.24,"Before_RAM_PSS_MiB":673.84,"During_Peak_CPU_%":21.55,"During_Avg_CPU_%":18.23,"During_Peak_RAM_Priv_MiB":739.39,"During_Peak_RAM_PSS_MiB":1057.48,"After_CPU_%":4.04,"After_RAM_Priv_MiB":396.88,"After_RAM_PSS_MiB":671.18,"Delta_Peak_PSS_MiB":383.64,"Memory_Leak_PSS_MiB":-2.66},
  {"Trial":17,"Before_CPU_%":3.27,"Before_RAM_Priv_MiB":392.93,"Before_RAM_PSS_MiB":672.33,"During_Peak_CPU_%":14.25,"During_Avg_CPU_%":8.29,"During_Peak_RAM_Priv_MiB":708.2,"During_Peak_RAM_PSS_MiB":1041.52,"After_CPU_%":0.3,"After_RAM_Priv_MiB":395.73,"After_RAM_PSS_MiB":670.36,"Delta_Peak_PSS_MiB":369.19,"Memory_Leak_PSS_MiB":-1.97},
  {"Trial":18,"Before_CPU_%":5.36,"Before_RAM_Priv_MiB":391.86,"Before_RAM_PSS_MiB":672.24,"During_Peak_CPU_%":6.12,"During_Avg_CPU_%":5.15,"During_Peak_RAM_Priv_MiB":769.75,"During_Peak_RAM_PSS_MiB":989.15,"After_CPU_%":3.47,"After_RAM_Priv_MiB":394.02,"After_RAM_PSS_MiB":668.62,"Delta_Peak_PSS_MiB":316.91,"Memory_Leak_PSS_MiB":-3.62},
  {"Trial":19,"Before_CPU_%":3.54,"Before_RAM_Priv_MiB":394.13,"Before_RAM_PSS_MiB":671.74,"During_Peak_CPU_%":10.05,"During_Avg_CPU_%":7.94,"During_Peak_RAM_Priv_MiB":612.82,"During_Peak_RAM_PSS_MiB":970.66,"After_CPU_%":2.16,"After_RAM_Priv_MiB":397.63,"After_RAM_PSS_MiB":672.28,"Delta_Peak_PSS_MiB":298.92,"Memory_Leak_PSS_MiB":0.54},
  {"Trial":20,"Before_CPU_%":3.0,"Before_RAM_Priv_MiB":395.55,"Before_RAM_PSS_MiB":670.63,"During_Peak_CPU_%":14.71,"During_Avg_CPU_%":12.75,"During_Peak_RAM_Priv_MiB":747.03,"During_Peak_RAM_PSS_MiB":1034.23,"After_CPU_%":5.65,"After_RAM_Priv_MiB":397.35,"After_RAM_PSS_MiB":669.75,"Delta_Peak_PSS_MiB":363.6,"Memory_Leak_PSS_MiB":-0.88},
  {"Trial":21,"Before_CPU_%":2.14,"Before_RAM_Priv_MiB":387.69,"Before_RAM_PSS_MiB":671.86,"During_Peak_CPU_%":9.09,"During_Avg_CPU_%":6.26,"During_Peak_RAM_Priv_MiB":754.21,"During_Peak_RAM_PSS_MiB":988.0,"After_CPU_%":4.43,"After_RAM_Priv_MiB":396.9,"After_RAM_PSS_MiB":673.34,"Delta_Peak_PSS_MiB":316.14,"Memory_Leak_PSS_MiB":1.48},
  {"Trial":22,"Before_CPU_%":4.21,"Before_RAM_Priv_MiB":392.29,"Before_RAM_PSS_MiB":670.21,"During_Peak_CPU_%":14.23,"During_Avg_CPU_%":11.93,"During_Peak_RAM_Priv_MiB":763.56,"During_Peak_RAM_PSS_MiB":1054.49,"After_CPU_%":4.33,"After_RAM_Priv_MiB":395.21,"After_RAM_PSS_MiB":668.61,"Delta_Peak_PSS_MiB":384.28,"Memory_Leak_PSS_MiB":-1.6},
  {"Trial":23,"Before_CPU_%":3.75,"Before_RAM_Priv_MiB":393.18,"Before_RAM_PSS_MiB":671.05,"During_Peak_CPU_%":6.15,"During_Avg_CPU_%":4.1,"During_Peak_RAM_Priv_MiB":677.29,"During_Peak_RAM_PSS_MiB":936.57,"After_CPU_%":3.56,"After_RAM_Priv_MiB":392.5,"After_RAM_PSS_MiB":668.45,"Delta_Peak_PSS_MiB":265.52,"Memory_Leak_PSS_MiB":-2.6},
  {"Trial":24,"Before_CPU_%":4.32,"Before_RAM_Priv_MiB":393.63,"Before_RAM_PSS_MiB":672.01,"During_Peak_CPU_%":4.62,"During_Avg_CPU_%":3.41,"During_Peak_RAM_Priv_MiB":682.35,"During_Peak_RAM_PSS_MiB":982.72,"After_CPU_%":5.82,"After_RAM_Priv_MiB":398.26,"After_RAM_PSS_MiB":675.43,"Delta_Peak_PSS_MiB":310.71,"Memory_Leak_PSS_MiB":3.42},
  {"Trial":25,"Before_CPU_%":1.8,"Before_RAM_Priv_MiB":395.88,"Before_RAM_PSS_MiB":671.32,"During_Peak_CPU_%":23.04,"During_Avg_CPU_%":19.46,"During_Peak_RAM_Priv_MiB":757.24,"During_Peak_RAM_PSS_MiB":1053.94,"After_CPU_%":6.45,"After_RAM_Priv_MiB":396.67,"After_RAM_PSS_MiB":669.31,"Delta_Peak_PSS_MiB":382.62,"Memory_Leak_PSS_MiB":-2.01},
  {"Trial":26,"Before_CPU_%":3.71,"Before_RAM_Priv_MiB":398.55,"Before_RAM_PSS_MiB":677.27,"During_Peak_CPU_%":21.11,"During_Avg_CPU_%":18.24,"During_Peak_RAM_Priv_MiB":715.34,"During_Peak_RAM_PSS_MiB":1117.84,"After_CPU_%":6.76,"After_RAM_Priv_MiB":397.02,"After_RAM_PSS_MiB":670.01,"Delta_Peak_PSS_MiB":440.57,"Memory_Leak_PSS_MiB":-7.26},
  {"Trial":27,"Before_CPU_%":2.34,"Before_RAM_Priv_MiB":395.12,"Before_RAM_PSS_MiB":667.65,"During_Peak_CPU_%":15.19,"During_Avg_CPU_%":10.66,"During_Peak_RAM_Priv_MiB":688.0,"During_Peak_RAM_PSS_MiB":1055.9,"After_CPU_%":5.15,"After_RAM_Priv_MiB":396.11,"After_RAM_PSS_MiB":670.4,"Delta_Peak_PSS_MiB":388.25,"Memory_Leak_PSS_MiB":2.75},
  {"Trial":28,"Before_CPU_%":1.99,"Before_RAM_Priv_MiB":394.34,"Before_RAM_PSS_MiB":668.42,"During_Peak_CPU_%":18.77,"During_Avg_CPU_%":14.47,"During_Peak_RAM_Priv_MiB":657.85,"During_Peak_RAM_PSS_MiB":1036.75,"After_CPU_%":4.88,"After_RAM_Priv_MiB":397.4,"After_RAM_PSS_MiB":674.37,"Delta_Peak_PSS_MiB":368.33,"Memory_Leak_PSS_MiB":5.95},
  {"Trial":29,"Before_CPU_%":2.24,"Before_RAM_Priv_MiB":391.86,"Before_RAM_PSS_MiB":670.72,"During_Peak_CPU_%":22.35,"During_Avg_CPU_%":16.32,"During_Peak_RAM_Priv_MiB":737.1,"During_Peak_RAM_PSS_MiB":1157.71,"After_CPU_%":3.98,"After_RAM_Priv_MiB":396.38,"After_RAM_PSS_MiB":669.93,"Delta_Peak_PSS_MiB":486.99,"Memory_Leak_PSS_MiB":-0.79},
  {"Trial":30,"Before_CPU_%":1.27,"Before_RAM_Priv_MiB":393.32,"Before_RAM_PSS_MiB":666.7,"During_Peak_CPU_%":13.34,"During_Avg_CPU_%":10.4,"During_Peak_RAM_Priv_MiB":779.37,"During_Peak_RAM_PSS_MiB":1032.22,"After_CPU_%":2.98,"After_RAM_Priv_MiB":396.07,"After_RAM_PSS_MiB":668.61,"Delta_Peak_PSS_MiB":365.52,"Memory_Leak_PSS_MiB":1.91}
];

const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
const stdev = arr => {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
};
const minv = arr => Math.min(...arr);
const maxv = arr => Math.max(...arr);
const fmtStats = (arr, unit, dp = 2) =>
  `&sigma; ${stdev(arr).toFixed(dp)}${unit} · min ${minv(arr).toFixed(dp)}${unit} · max ${maxv(arr).toFixed(dp)}${unit}`;

document.addEventListener('DOMContentLoaded', () => {
  renderKPIs();
  initCpuChart();
});

function renderKPIs() {
  const beforeCpu = trials.map(d => d['Before_CPU_%']);
  const peakCpu   = trials.map(d => d['During_Peak_CPU_%']);
  const dPss      = trials.map(d => d['Delta_Peak_PSS_MiB']);
  const leak      = trials.map(d => d['Memory_Leak_PSS_MiB']);

  document.getElementById('kpiAvgBeforeCpu').innerText = `${mean(beforeCpu).toFixed(2)}%`;
  document.getElementById('kpiAvgPeakCpu').innerText   = `${mean(peakCpu).toFixed(2)}%`;
  document.getElementById('kpiAvgDeltaPSS').innerText  = `${mean(dPss).toFixed(1)} MiB`;

  const avgLeak = mean(leak);
  const sign = avgLeak > 0 ? '+' : '';
  document.getElementById('kpiAvgLeak').innerText = `${sign}${avgLeak.toFixed(2)} MiB`;

  document.getElementById('kpiStatsBeforeCpu').innerHTML = fmtStats(beforeCpu, '%');
  document.getElementById('kpiStatsPeakCpu').innerHTML   = fmtStats(peakCpu, '%');
  document.getElementById('kpiStatsDeltaPSS').innerHTML  = fmtStats(dPss, ' MiB', 1);
  document.getElementById('kpiStatsLeak').innerHTML      = fmtStats(leak, ' MiB');
}

// Chart 1: CPU Lifecycle
function initCpuChart() {
  const ctx = document.getElementById('cpuChart').getContext('2d');
  new Chart(ctx, {
    type: 'line',
    data: {
      labels: trials.map(d => `Trial ${d.Trial}`),
      datasets: [
        {
          label: 'Peak CPU Burst (%)',
          data: trials.map(d => d['During_Peak_CPU_%']),
          borderColor: '#dc2626',
          backgroundColor: 'rgba(220, 38, 38, 0.08)',
          fill: true,
          tension: 0.25,
          pointRadius: 3
        },
        {
          label: 'Average Workload CPU (%)',
          data: trials.map(d => d['During_Avg_CPU_%']),
          borderColor: '#d97706',
          tension: 0.25,
          pointRadius: 3
        },
        {
          label: 'After Closing CPU (%)',
          data: trials.map(d => d['After_CPU_%']),
          borderColor: '#059669',
          borderDash: [4, 4],
          pointRadius: 2
        },
        {
          label: 'Resting Idle CPU (%)',
          data: trials.map(d => d['Before_CPU_%']),
          borderColor: '#94a3b8',
          borderDash: [2, 2],
          pointRadius: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 14, font: { family: 'Inter', size: 12 } } },
        tooltip: { mode: 'index', intersect: false }
      },
      scales: {
        x: { grid: { color: '#f1f5f9' }, ticks: { color: '#64748b', maxRotation: 45 } },
        y: {
          grid: { color: '#e2e8f0' },
          ticks: { color: '#64748b' },
          title: { display: true, text: 'Processor Usage (%)', font: { weight: 600 } }
        }
      }
    }
  });
}

// Chart 2: RAM Footprint (PSS vs Private)
function initRamComparisonChart() {
  const ctx = document.getElementById('ramComparisonChart').getContext('2d');
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: trials.map(d => `T${d.Trial}`),
      datasets: [
        {
          label: 'Total Memory / PSS (MiB)',
          data: trials.map(d => d['During_Peak_RAM_PSS_MiB']),
          backgroundColor: '#0284c7',
          borderRadius: 4
        },
        {
          label: 'Private Exclusive Memory (MiB)',
          data: trials.map(d => d['During_Peak_RAM_Priv_MiB']),
          backgroundColor: '#38bdf8',
          borderRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 14, font: { family: 'Inter', size: 12 } } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#64748b' } },
        y: {
          grid: { color: '#e2e8f0' },
          ticks: { color: '#64748b' },
          title: { display: true, text: 'Memory in Megabytes (MiB)', font: { weight: 600 } }
        }
      }
    }
  });
}

// Chart 3: Memory Surge (Delta Peak PSS)
function initDeltaPssChart() {
  const ctx = document.getElementById('deltaPssChart').getContext('2d');
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: trials.map(d => `Trial ${d.Trial}`),
      datasets: [{
        label: 'Extra Working Memory Needed (MiB)',
        data: trials.map(d => d['Delta_Peak_PSS_MiB']),
        backgroundColor: '#0369a1',
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 14, font: { family: 'Inter', size: 12 } } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#64748b', maxRotation: 45 } },
        y: {
          grid: { color: '#e2e8f0' },
          ticks: { color: '#64748b' },
          title: { display: true, text: 'Extra RAM Needed (MiB)', font: { weight: 600 } }
        }
      }
    }
  });
}

// Chart 4: Memory Leak Diagnostics
function initLeakChart() {
  const ctx = document.getElementById('leakChart').getContext('2d');
  const leakVals = trials.map(d => d['Memory_Leak_PSS_MiB']);

  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: trials.map(d => `Trial ${d.Trial}`),
      datasets: [{
        label: 'Memory Left Behind (MiB)',
        data: leakVals,
        backgroundColor: leakVals.map(v => v >= 0 ? 'rgba(220, 38, 38, 0.75)' : 'rgba(5, 150, 105, 0.75)'),
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#64748b', maxRotation: 45 } },
        y: {
          grid: { color: '#e2e8f0' },
          ticks: { color: '#64748b' },
          title: { display: true, text: 'Memory Difference (MiB)', font: { weight: 600 } }
        }
      }
    }
  });
}

function renderTable(data) {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '';

  data.forEach(row => {
    const leak = row['Memory_Leak_PSS_MiB'];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>Trial ${row['Trial']}</strong></td>
      <td>${row['Before_CPU_%'].toFixed(2)}%</td>
      <td>${row['During_Peak_CPU_%'].toFixed(2)}%</td>
      <td>${row['During_Avg_CPU_%'].toFixed(2)}%</td>
      <td>${row['After_CPU_%'].toFixed(2)}%</td>
      <td>${row['Before_RAM_PSS_MiB'].toFixed(2)}</td>
      <td>${row['During_Peak_RAM_PSS_MiB'].toFixed(2)}</td>
      <td>${row['After_RAM_PSS_MiB'].toFixed(2)}</td>
      <td>${row['During_Peak_RAM_Priv_MiB'].toFixed(2)}</td>
      <td>${row['Delta_Peak_PSS_MiB'].toFixed(2)}</td>
      <td class="${leak >= 0 ? 'leak-pos' : 'leak-neg'}">${leak >= 0 ? '+' : ''}${leak.toFixed(2)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function setupEvents() {
  document.getElementById('trialSearch').addEventListener('input', e => {
    const query = e.target.value.toLowerCase().trim();
    const filtered = trials.filter(d =>
      d.Trial.toString().includes(query) ||
      d['During_Peak_CPU_%'].toString().includes(query) ||
      d['Memory_Leak_PSS_MiB'].toString().includes(query)
    );
    renderTable(filtered);
  });

  document.getElementById('btnExportCSV').addEventListener('click', () => {
    const headers = Object.keys(trials[0]).join(',');
    const rows = trials.map(r => Object.values(r).join(','));
    const blob = new Blob([[headers, ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'benchmark_30_trials_report.csv';
    a.click();
    URL.revokeObjectURL(url);
  });
}

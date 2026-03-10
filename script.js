// ── State ──────────────────────────────────────────────────────────────────
let currentSymbol   = 'BTC';
let currentCurrency = 'USD';
let currentDays     = 30;
let portfolio       = {};   // { symbol: { qty, avgPrice, stopLoss, takeProfit } }
let tradeLog        = [];
let cash            = 100000;
let totalTrades     = 0;
let wins            = 0;

// ── Config ─────────────────────────────────────────────────────────────────
const RATES = { USD: 1, INR: 83, EUR: 0.92, GBP: 0.78, JPY: 150, AUD: 1.5 };
const SYM   = { USD: '$', INR: '₹', EUR: '€', GBP: '£', JPY: '¥', AUD: 'A$' };

const ASSETS = {
  AAPL:     { base: 180,   name: 'Apple' },
  GOOGL:    { base: 140,   name: 'Google' },
  TSLA:     { base: 250,   name: 'Tesla' },
  MSFT:     { base: 330,   name: 'Microsoft' },
  AMZN:     { base: 130,   name: 'Amazon' },
  RELIANCE: { base: 2400,  name: 'Reliance' },
  TCS:      { base: 3500,  name: 'TCS' },
  XAU:      { base: 1900,  name: 'Gold' },
  XAG:      { base: 25,    name: 'Silver' },
  WTI:      { base: 75,    name: 'Crude Oil' },
  BTC:      { base: 45000, name: 'Bitcoin' },
  ETH:      { base: 3000,  name: 'Ethereum' },
};

// ── Price data ─────────────────────────────────────────────────────────────
let priceData = {};

function generatePrices(base, days = 90) {
  let rows = [];
  let price = base;
  const vol = base * 0.022;
  for (let i = 0; i < days; i++) {
    const change = (Math.random() - 0.48) * vol;
    price = Math.max(price + change, 1);
    rows.push({
      close:  price,
      volume: Math.floor(Math.random() * 1500000 + 500000),
    });
  }
  return rows;
}

// ── Math helpers ───────────────────────────────────────────────────────────
function movingAverage(prices, period) {
  return prices.map((_, i) => {
    if (i < period - 1) return null;
    const slice = prices.slice(i - period + 1, i + 1);
    return slice.reduce((a, b) => a + b, 0) / period;
  });
}

function calcRSI(prices, period = 14) {
  const rsi = prices.map(() => null);
  for (let i = period; i < prices.length; i++) {
    let gains = 0, losses = 0;
    for (let j = i - period; j < i; j++) {
      const d = prices[j + 1] - prices[j];
      if (d >= 0) gains += d; else losses -= d;
    }
    rsi[i] = 100 - 100 / (1 + gains / (losses || 0.001));
  }
  return rsi;
}

function calcVolatility(prices) {
  if (prices.length < 2) return 0;
  const returns = prices.slice(1).map((p, i) => (p - prices[i]) / prices[i]);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  return (Math.sqrt(variance * 252) * 100).toFixed(1);
}

function calcMaxDrawdown(prices) {
  let peak = prices[0], maxDD = 0;
  for (const p of prices) {
    if (p > peak) peak = p;
    const dd = (peak - p) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  return (maxDD * 100).toFixed(1);
}

// ── Formatting ─────────────────────────────────────────────────────────────
// fmt() takes a USD value, converts to currentCurrency, and formats it.
// Always pass raw USD values — never pre-multiply by rate before calling fmt().
function fmt(val, dec = 2) {
  const cs        = SYM[currentCurrency] || '$';
  const rate      = RATES[currentCurrency] || 1;
  const converted = Number(val) * rate;
  return cs + converted.toLocaleString('en-US', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

// ── Chart references ───────────────────────────────────────────────────────
let priceChart, volumeChart, rsiChart, predictionChart, allocationChart;

function destroyChart(c) {
  if (c) try { c.destroy(); } catch (e) {}
}

// ── Init ────────────────────────────────────────────────────────────────────
function init() {
  // Generate price data
  for (const sym in ASSETS) priceData[sym] = generatePrices(ASSETS[sym].base);

  // Build asset buttons
  const container = document.getElementById('assetButtons');
  for (const sym in ASSETS) {
    const btn = document.createElement('button');
    btn.className = 'asset-btn' + (sym === currentSymbol ? ' active' : '');
    btn.id = 'btn-' + sym;
    btn.textContent = sym;
    btn.onclick = () => selectAsset(sym);
    container.appendChild(btn);
  }

  buildMarketList();
  loadAsset();
  updatePortfolioPanel();

  document.getElementById('quantityInput').addEventListener('input', updatePreview);

  // Live price jitter every 2.5s
  setInterval(() => {
    for (const sym in ASSETS) {
      const rows = priceData[sym];
      const last = rows[rows.length - 1].close;
      const vol  = ASSETS[sym].base * 0.0015;
      rows[rows.length - 1].close = Math.max(last + (Math.random() - 0.5) * vol, 1);
    }
    updateLivePrices();
    checkStopLossTP();
  }, 2500);
}

// ── Asset selection ─────────────────────────────────────────────────────────
function selectAsset(sym) {
  document.querySelectorAll('.asset-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('btn-' + sym)?.classList.add('active');
  currentSymbol = sym;
  loadAsset();
}

function setTimeframe(days, btn) {
  currentDays = days;
  document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  loadAsset();
}

// ── Load & render current asset ─────────────────────────────────────────────
function loadAsset() {
  const rate   = RATES[currentCurrency];
  const rows   = priceData[currentSymbol].slice(-currentDays);
  const prices = rows.map(r => r.close * rate);
  const vols   = rows.map(r => r.volume);
  const labels = rows.map((_, i) => 'D' + (i + 1));

  const lastP  = prices[prices.length - 1];
  const firstP = prices[0];
  const chgAmt = lastP - firstP;
  const chgPct = (chgAmt / firstP * 100).toFixed(2);
  const up     = chgAmt >= 0;

  // Asset info bar
  document.getElementById('abSymbol').textContent = currentSymbol;
  document.getElementById('abName').textContent   = ASSETS[currentSymbol].name;
  document.getElementById('abPrice').textContent  = fmt(lastP);
  const abChg = document.getElementById('abChange');
  abChg.textContent = (up ? '+' : '') + fmt(chgAmt) + ' (' + (up ? '+' : '') + chgPct + '%)';
  abChg.className   = 'ab-val ' + (up ? 'green' : 'red');
  document.getElementById('abHigh').textContent = fmt(Math.max(...prices));
  document.getElementById('abLow').textContent  = fmt(Math.min(...prices));

  // Trade panel mini display
  document.getElementById('saSymbol').textContent = currentSymbol;
  document.getElementById('saPrice').textContent  = fmt(lastP);
  const saChg = document.getElementById('saChange');
  saChg.textContent = (up ? '+' : '') + chgPct + '%';
  saChg.className   = 'sa-change ' + (up ? 'up' : 'dn');

  // Signal
  const ma5  = movingAverage(prices, 5);
  const rsi  = calcRSI(prices);
  const rsiLast = rsi.filter(v => v !== null).slice(-1)[0] ?? 50;
  const maLast  = ma5.filter(v => v !== null).slice(-1)[0] ?? lastP;
  let signal = 'Neutral', sigClass = 'neutral';
  if (lastP > maLast && rsiLast < 65)  { signal = 'Buy ↑';    sigClass = 'buy'; }
  if (lastP < maLast && rsiLast > 35)  { signal = 'Sell ↓';   sigClass = 'sell'; }
  if (rsiLast > 75)                    { signal = 'Overbought'; sigClass = 'sell'; }
  if (rsiLast < 25)                    { signal = 'Oversold';   sigClass = 'buy'; }
  const sigEl = document.getElementById('signalText');
  sigEl.textContent = signal;
  sigEl.className   = 'sig-value ' + sigClass;

  // Stats panel
  document.getElementById('stVol').textContent = calcVolatility(prices) + '%';
  document.getElementById('stDD').textContent  = '-' + calcMaxDrawdown(prices) + '%';

  drawCharts(labels, prices, vols, ma5, rsi);
  updatePreview();
}

// ── Charts ──────────────────────────────────────────────────────────────────
const BASE_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 300 },
  plugins: {
    legend: { display: false },
    tooltip: { mode: 'index', intersect: false }
  },
  scales: {
    x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } },
    y: { grid: { color: '#f1f5f9' }, position: 'right' }
  }
};

function drawCharts(labels, prices, vols, ma5, rsi) {
  destroyChart(priceChart);
  destroyChart(volumeChart);
  destroyChart(rsiChart);
  destroyChart(predictionChart);

  // Price + MA
  priceChart = new Chart(document.getElementById('priceChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Price',
          data: prices,
          borderColor: '#3b82f6',
          borderWidth: 2,
          pointRadius: 0,
          fill: true,
          backgroundColor: 'rgba(59,130,246,0.06)',
          tension: 0.3,
        },
        {
          label: 'MA(5)',
          data: ma5,
          borderColor: '#f97316',
          borderWidth: 1.5,
          pointRadius: 0,
          borderDash: [4, 4],
          tension: 0.3,
        },
      ],
    },
    options: BASE_OPTS,
  });

  // Volume — green/red by price direction
  const priceChanges = prices.map((p, i) => i === 0 ? 0 : p - prices[i - 1]);
  volumeChart = new Chart(document.getElementById('volumeChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Volume',
        data: vols,
        backgroundColor: priceChanges.map(c => c >= 0 ? 'rgba(22,163,74,0.5)' : 'rgba(220,38,38,0.5)'),
        borderWidth: 0,
      }],
    },
    options: {
      ...BASE_OPTS,
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } },
        y: { grid: { color: '#f1f5f9' }, position: 'right',
             ticks: { callback: v => (v / 1e6).toFixed(1) + 'M' } }
      }
    }
  });

  // RSI
  rsiChart = new Chart(document.getElementById('rsiChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'RSI',
        data: rsi,
        borderColor: '#8b5cf6',
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.3,
      }],
    },
    options: {
      ...BASE_OPTS,
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } },
        y: { grid: { color: '#f1f5f9' }, position: 'right', min: 0, max: 100,
             ticks: { stepSize: 30 } }
      }
    }
  });

  // 5-day forecast
  const lookback = Math.min(prices.length, 10);
  const recent   = prices.slice(-lookback);
  const trend    = (recent[recent.length - 1] - recent[0]) / lookback;
  const lastP    = prices[prices.length - 1];
  const futureLabels = ['+1', '+2', '+3', '+4', '+5'];
  const futurePrices = futureLabels.map((_, i) =>
    lastP + trend * (i + 1) + (Math.random() - 0.5) * Math.abs(trend) * 0.4
  );

  destroyChart(predictionChart);
  predictionChart = new Chart(document.getElementById('predictionChart'), {
    type: 'line',
    data: {
      labels: [...labels.slice(-5), ...futureLabels],
      datasets: [
        {
          label: 'Actual',
          data: [...prices.slice(-5), ...new Array(5).fill(null)],
          borderColor: '#3b82f6', borderWidth: 2, pointRadius: 0, tension: 0.3,
        },
        {
          label: 'Forecast',
          data: [...new Array(5).fill(null), lastP, ...futurePrices],
          borderColor: '#f59e0b', borderWidth: 2, borderDash: [5, 5],
          pointRadius: 3, pointBackgroundColor: '#f59e0b', tension: 0.3,
          fill: true, backgroundColor: 'rgba(245,158,11,0.06)',
        },
      ],
    },
    options: BASE_OPTS,
  });
}

// ── Trade: Buy ───────────────────────────────────────────────────────────────
function buyAsset() {
  const qty      = parseFloat(document.getElementById('quantityInput').value);
  if (!qty || qty <= 0) { toast('Enter a valid quantity.', 'error'); return; }

  const rate     = RATES[currentCurrency];
  const priceUSD = priceData[currentSymbol].slice(-1)[0].close;
  const costUSD  = qty * priceUSD;

  if (costUSD > cash) {
    toast('Not enough cash. Have ' + fmt(cash) + ', need ' + fmt(costUSD), 'error');
    return;
  }

  cash -= costUSD;

  if (!portfolio[currentSymbol]) {
    portfolio[currentSymbol] = { qty: 0, avgPrice: 0, stopLoss: null, takeProfit: null };
  }
  const h = portfolio[currentSymbol];
  h.avgPrice = (h.qty * h.avgPrice + qty * priceUSD) / (h.qty + qty);
  h.qty     += qty;

  const sl = parseFloat(document.getElementById('stopLossInput').value);
  const tp = parseFloat(document.getElementById('takeProfitInput').value);
  if (!isNaN(sl) && sl > 0) h.stopLoss   = sl / rate;
  if (!isNaN(tp) && tp > 0) h.takeProfit = tp / rate;

  totalTrades++;
  logTrade('BUY', currentSymbol, qty, priceUSD * rate);
  toast('Bought ' + qty.toFixed(4) + ' ' + currentSymbol + ' for ' + fmt(costUSD), 'success');
  updatePortfolioPanel();
  updateHeaderStats();
}

// ── Trade: Sell ──────────────────────────────────────────────────────────────
function sellAsset() {
  const qty = parseFloat(document.getElementById('quantityInput').value);
  if (!qty || qty <= 0) { toast('Enter a valid quantity.', 'error'); return; }
  if (!portfolio[currentSymbol] || portfolio[currentSymbol].qty < qty) {
    toast('Not enough shares to sell.', 'error'); return;
  }

  // All math in USD; fmt() converts for display
  const rate     = RATES[currentCurrency];
  const priceUSD = priceData[currentSymbol].slice(-1)[0].close;
  const pnlUSD   = (priceUSD - portfolio[currentSymbol].avgPrice) * qty;

  cash += qty * priceUSD;   // add back USD
  portfolio[currentSymbol].qty -= qty;
  if (portfolio[currentSymbol].qty < 0.0001) delete portfolio[currentSymbol];

  if (pnlUSD > 0) wins++;
  totalTrades++;
  logTrade('SELL', currentSymbol, qty, priceUSD * rate, pnlUSD * rate);
  toast('Sold ' + qty.toFixed(4) + ' ' + currentSymbol + ' — P&L: ' + fmt(pnlUSD), pnlUSD >= 0 ? 'success' : 'warning');
  updatePortfolioPanel();
  updateHeaderStats();
}

// ── Close full position ──────────────────────────────────────────────────────
function closePosition(sym) {
  if (!portfolio[sym]) return;
  const rate     = RATES[currentCurrency];
  const priceUSD = priceData[sym].slice(-1)[0].close;
  const qty      = portfolio[sym].qty;
  const pnlUSD   = (priceUSD - portfolio[sym].avgPrice) * qty;

  cash += qty * priceUSD;   // USD
  if (pnlUSD > 0) wins++;
  totalTrades++;
  logTrade('SELL', sym, qty, priceUSD * rate, pnlUSD * rate);
  delete portfolio[sym];
  toast('Closed ' + sym + ' — P&L: ' + fmt(pnlUSD), pnlUSD >= 0 ? 'success' : 'warning');
  updatePortfolioPanel();
  updateHeaderStats();
}

// ── Stop-loss / Take-profit check ────────────────────────────────────────────
// stopLoss and takeProfit are stored in USD; compare against USD price
function checkStopLossTP() {
  for (const sym in portfolio) {
    const priceUSD = priceData[sym].slice(-1)[0].close;
    const h        = portfolio[sym];
    if (h.stopLoss && priceUSD <= h.stopLoss) {
      toast('Stop-loss triggered: ' + sym, 'warning');
      closePosition(sym);
    } else if (h.takeProfit && priceUSD >= h.takeProfit) {
      toast('Take-profit hit: ' + sym, 'success');
      closePosition(sym);
    }
  }
}

// ── Portfolio panel ──────────────────────────────────────────────────────────
function updatePortfolioPanel() {
  const rate    = RATES[currentCurrency];
  const list    = document.getElementById('holdingsList');
  const symbols = Object.keys(portfolio);

  if (symbols.length === 0) {
    list.innerHTML = '<p class="empty">No positions open.</p>';
    document.getElementById('pfTotals').style.display = 'none';
  } else {
    // All stored values (avgPrice, cash) are in USD; multiply by rate for display
    let totalInvestedUSD = 0, totalValueUSD = 0;
    list.innerHTML = symbols.map(sym => {
      const h        = portfolio[sym];
      const priceUSD = priceData[sym].slice(-1)[0].close;
      const valUSD   = h.qty * priceUSD;
      const pnlUSD   = (priceUSD - h.avgPrice) * h.qty;
      const pct      = (pnlUSD / (h.qty * h.avgPrice) * 100).toFixed(1);
      totalInvestedUSD += h.qty * h.avgPrice;
      totalValueUSD    += valUSD;
      return `<div class="holding-item">
        <div class="hi-top">
          <span class="hi-sym">${sym}</span>
          <span class="hi-val">${fmt(valUSD)}</span>
        </div>
        <div class="hi-sub">
          <span>${h.qty.toFixed(4)} × ${fmt(h.avgPrice)}</span>
          <span class="hi-pnl ${pnlUSD >= 0 ? 'pos' : 'neg'}">${pnlUSD >= 0 ? '+' : ''}${fmt(pnlUSD)} (${pct}%)</span>
          <button class="close-btn" onclick="closePosition('${sym}')">✕</button>
        </div>
      </div>`;
    }).join('');

    const totalPnlUSD = totalValueUSD - totalInvestedUSD;
    document.getElementById('pfTotals').style.display = '';
    document.getElementById('pfValue').textContent = fmt(totalValueUSD);
    const pfPnl = document.getElementById('pfPnl');
    pfPnl.textContent = (totalPnlUSD >= 0 ? '+' : '') + fmt(totalPnlUSD);
    pfPnl.style.color = totalPnlUSD >= 0 ? '#16a34a' : '#dc2626';
  }

  // Stats
  document.getElementById('stTrades').textContent  = totalTrades;
  document.getElementById('stWins').textContent    = wins;
  document.getElementById('stWinRate').textContent = totalTrades > 0
    ? Math.round(wins / totalTrades * 100) + '%' : '—';

  updateAllocationChart();
}

// ── Header stats ─────────────────────────────────────────────────────────────
// cash and portfolio values are in USD; fmt() applies current currency rate
function updateHeaderStats() {
  let pvUSD = 0;
  for (const sym in portfolio)
    pvUSD += portfolio[sym].qty * priceData[sym].slice(-1)[0].close;

  document.getElementById('cashDisplay').textContent  = fmt(cash);
  document.getElementById('portfolioVal').textContent = fmt(pvUSD);
  document.getElementById('netWorth').textContent     = fmt(cash + pvUSD);
}

// ── Live price updates ───────────────────────────────────────────────────────
function updateLivePrices() {
  // Pass raw USD price — fmt() handles conversion
  const priceUSD = priceData[currentSymbol].slice(-1)[0].close;
  document.getElementById('abPrice').textContent = fmt(priceUSD);
  document.getElementById('saPrice').textContent = fmt(priceUSD);
  updatePreview();
  updateHeaderStats();
  buildMarketList();
}

// ── Cost preview ─────────────────────────────────────────────────────────────
// Show cost in current currency (fmt converts USD → selected currency)
function updatePreview() {
  const qty      = parseFloat(document.getElementById('quantityInput')?.value) || 0;
  const priceUSD = priceData[currentSymbol].slice(-1)[0].close;
  document.getElementById('costPreview').textContent = qty > 0 ? fmt(qty * priceUSD) : '—';
}

// ── Market list ───────────────────────────────────────────────────────────────
function buildMarketList() {
  document.getElementById('marketList').innerHTML = Object.keys(ASSETS).map(sym => {
    const rows    = priceData[sym];
    const lastUSD = rows[rows.length - 1].close;   // raw USD
    const prevUSD = rows[rows.length - 2].close;
    const chg     = ((lastUSD - prevUSD) / prevUSD * 100).toFixed(2);
    const up      = chg >= 0;
    return `<div class="mkt-item" onclick="selectAsset('${sym}')">
      <span class="mkt-sym">${sym}</span>
      <span class="mkt-price">${fmt(lastUSD)}</span>
      <span class="mkt-chg ${up ? 'up' : 'dn'}">${up ? '+' : ''}${chg}%</span>
    </div>`;
  }).join('');
}

// ── Allocation chart ──────────────────────────────────────────────────────────
function updateAllocationChart() {
  destroyChart(allocationChart);

  const syms   = Object.keys(portfolio);
  // Use USD values (fmt handles display conversion); proportions stay correct across currencies
  const values = syms.map(s => portfolio[s].qty * priceData[s].slice(-1)[0].close);
  const colors = ['#3b82f6','#22c55e','#f59e0b','#a855f7','#ef4444','#06b6d4','#f97316'];

  const labels = [...syms, 'Cash'];
  const data   = [...values, cash];   // cash is in USD
  const bg     = [...colors.slice(0, syms.length), '#cbd5e1'];

  allocationChart = new Chart(document.getElementById('allocationChart'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: bg, borderWidth: 2, borderColor: '#fff' }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '58%',
      plugins: { legend: { display: true, position: 'bottom', labels: { font: { size: 11 }, boxWidth: 10 } } }
    }
  });
}

// ── Trade log ────────────────────────────────────────────────────────────────
function logTrade(type, sym, qty, price, pnl) {
  tradeLog.unshift({ type, sym, qty, price, pnl });
  if (tradeLog.length > 40) tradeLog.pop();

  const el = document.getElementById('tradeHistory');
  el.innerHTML = tradeLog.slice(0, 15).map(t => {
    const isBuy = t.type === 'BUY';
    return `<div class="trade-item">
      <span class="t-badge ${isBuy ? 'buy' : 'sell'}">${t.type}</span>
      <span class="t-sym">${t.sym}</span>
      <span class="t-price">${fmt(t.price)}</span>
      ${t.pnl !== undefined
        ? `<span class="t-pnl ${t.pnl >= 0 ? 'pos' : 'neg'}">${t.pnl >= 0 ? '+' : ''}${fmt(t.pnl)}</span>`
        : ''}
    </div>`;
  }).join('') || '<p class="empty">No trades yet.</p>';
}

// ── Currency change ───────────────────────────────────────────────────────────
// All stored values (cash, avgPrice) are in USD.
// Switching currency just changes the display multiplier via fmt().
function changeCurrency() {
  currentCurrency = document.getElementById('currencySelect').value;
  loadAsset();          // redraws charts with new currency prices
  updatePortfolioPanel();
  updateHeaderStats();  // cash display converts USD → new currency
  buildMarketList();
}

// ── Toast ────────────────────────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const box = document.getElementById('toastBox');
  const el  = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), 3100);
}

// ── Start ────────────────────────────────────────────────────────────────────
init();

// ══════════════════════════════════════════════════════════════════
//  PRICE GROWTH PREDICTOR
// ══════════════════════════════════════════════════════════════════

let predHorizon = 14;
let predModel   = 'all';
let predictorChart;

function setHorizon(days, btn) {
  predHorizon = days;
  btn.closest('.seg-btns').querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  runPredictor();
}

function setModel(model, btn) {
  predModel = model;
  btn.closest('.seg-btns').querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  runPredictor();
}

// ── Linear Regression projection ─────────────────────────────────
// Fits a least-squares line through the last `lookback` prices,
// then extrapolates forward `horizon` days.
function linearRegressionForecast(prices, horizon, lookback = 30) {
  const data = prices.slice(-Math.min(lookback, prices.length));
  const n    = data.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  data.forEach((y, x) => { sumX += x; sumY += y; sumXY += x * y; sumX2 += x * x; });
  const slope     = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  return Array.from({ length: horizon }, (_, i) => intercept + slope * (n + i));
}

// ── EMA projection ────────────────────────────────────────────────
// Projects forward using the last EMA value and its recent delta.
function emaForecast(prices, horizon, period = 12) {
  const k   = 2 / (period + 1);
  let ema   = prices[0];
  for (let i = 1; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k);
  // Drift = avg daily return of the EMA over the last `period` days
  const recent = prices.slice(-period);
  const drift  = (recent[recent.length - 1] - recent[0]) / recent.length;
  return Array.from({ length: horizon }, (_, i) => ema + drift * (i + 1));
}

// ── Momentum projection ───────────────────────────────────────────
// Uses the average of last `window` daily returns, compounded forward.
function momentumForecast(prices, horizon, window = 10) {
  const slice   = prices.slice(-Math.min(window + 1, prices.length));
  const returns = slice.slice(1).map((p, i) => (p - slice[i]) / slice[i]);
  const avgRet  = returns.reduce((a, b) => a + b, 0) / returns.length;
  const last    = prices[prices.length - 1];
  return Array.from({ length: horizon }, (_, i) => last * Math.pow(1 + avgRet, i + 1));
}

// ── Confidence band ───────────────────────────────────────────────
// ± 1 standard deviation of daily returns × sqrt(t) (random walk)
function confidenceBands(basePrice, prices, horizon, multiplier = 1.0) {
  const returns = prices.slice(1).map((p, i) => (p - prices[i]) / prices[i]);
  const std     = Math.sqrt(returns.reduce((s, r) => s + r * r, 0) / returns.length);
  return Array.from({ length: horizon }, (_, i) => {
    const spread = basePrice * std * Math.sqrt(i + 1) * multiplier;
    return spread;
  });
}

// ── Main predictor runner ─────────────────────────────────────────
function runPredictor() {
  const rate   = RATES[currentCurrency];
  const allRows = priceData[currentSymbol];
  const prices = allRows.map(r => r.close * rate);
  const last   = prices[prices.length - 1];
  const h      = predHorizon;

  const linReg  = linearRegressionForecast(prices, h);
  const emaPrj  = emaForecast(prices, h);
  const momPrj  = momentumForecast(prices, h);
  const bands   = confidenceBands(last, prices, h);

  // Consensus = average of the three models
  const consensus = linReg.map((v, i) => (v + emaPrj[i] + momPrj[i]) / 3);

  // History (last 14 days for chart context)
  const histLen    = Math.min(14, prices.length);
  const histPrices = prices.slice(-histLen);
  const histLabels = histPrices.map((_, i) => `D-${histLen - i}`).reverse();
  const futLabels  = Array.from({ length: h }, (_, i) => `+${i + 1}`);
  const allLabels  = [...histLabels.reverse(), ...futLabels];

  // Pad history datasets with nulls for forecast zone
  const pad = arr => [...arr.map(() => null), ...arr.slice(-1), ...arr.slice(1)]; // won't use this
  const histArr    = [...histPrices, ...Array(h).fill(null)];
  const linArr     = [...Array(histLen).fill(null), last, ...linReg];
  const emaArr     = [...Array(histLen).fill(null), last, ...emaPrj];
  const momArr     = [...Array(histLen).fill(null), last, ...momPrj];
  const consArr    = [...Array(histLen).fill(null), last, ...consensus];
  const upperBand  = [...Array(histLen).fill(null), ...consensus.map((v, i) => v + bands[i])];
  const lowerBand  = [...Array(histLen).fill(null), ...consensus.map((v, i) => Math.max(v - bands[i], 0.01))];

  // Build datasets based on selected model
  const datasets = [
    {
      label: 'Historical',
      data: histArr,
      borderColor: '#64748b',
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.3,
      fill: false,
    },
  ];

  if (predModel === 'all' || predModel === 'linreg')
    datasets.push({ label: 'Linear Reg.', data: linArr, borderColor: '#f97316', borderWidth: 1.5, borderDash: [4,3], pointRadius: 0, tension: 0.3, fill: false });

  if (predModel === 'all' || predModel === 'ema')
    datasets.push({ label: 'EMA Proj.', data: emaArr, borderColor: '#8b5cf6', borderWidth: 1.5, borderDash: [4,3], pointRadius: 0, tension: 0.3, fill: false });

  if (predModel === 'all' || predModel === 'momentum')
    datasets.push({ label: 'Momentum', data: momArr, borderColor: '#06b6d4', borderWidth: 1.5, borderDash: [4,3], pointRadius: 0, tension: 0.3, fill: false });

  // Always show consensus
  datasets.push({ label: 'Consensus', data: consArr, borderColor: '#3b82f6', borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: '#3b82f6', tension: 0.3, fill: false });

  // Confidence band (upper & lower as filled area)
  datasets.push({ label: 'Upper Band', data: upperBand, borderColor: 'rgba(59,130,246,0.15)', borderWidth: 1, pointRadius: 0, fill: false, tension: 0.3 });
  datasets.push({ label: 'Lower Band', data: lowerBand, borderColor: 'rgba(59,130,246,0.15)', borderWidth: 1, pointRadius: 0, fill: '-1', backgroundColor: 'rgba(59,130,246,0.07)', tension: 0.3 });

  // Draw chart
  destroyChart(predictorChart);
  predictorChart = new Chart(document.getElementById('predictorChart'), {
    type: 'line',
    data: { labels: allLabels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      plugins: {
        legend: { display: true, position: 'top', labels: { font: { size: 10 }, boxWidth: 12, padding: 10 } },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } },
        y: {
          grid: { color: '#f1f5f9' },
          position: 'right',
          ticks: { callback: v => fmt(v, 0) }
        }
      }
    }
  });

  // Summary cards
  const endLinReg  = linReg[h - 1];
  const endEma     = emaPrj[h - 1];
  const endMom     = momPrj[h - 1];
  const endConsens = consensus[h - 1];

  function makeCard(label, price, modelName, extraClass = '') {
    const chg    = price - last;
    const chgPct = (chg / last * 100).toFixed(2);
    const up     = chg >= 0;
    return `<div class="pred-card ${extraClass}">
      <div class="pred-card-label">${label}</div>
      <div class="pred-card-price">${fmt(price)}</div>
      <div class="pred-card-change ${up ? 'up' : 'dn'}">${up ? '▲' : '▼'} ${up ? '+' : ''}${chgPct}%</div>
      <div class="pred-card-model">${modelName}</div>
    </div>`;
  }

  document.getElementById('predSummary').innerHTML =
    makeCard('Linear Reg.', endLinReg,  `End of ${h}-day`, '') +
    makeCard('EMA Proj.',   endEma,     `End of ${h}-day`, '') +
    makeCard('Momentum',    endMom,     `End of ${h}-day`, '') +
    makeCard('Consensus',   endConsens, `Avg of 3 models`, 'consensus');

  // Table — show every day up to the horizon (cap at 30 rows)
  const rows = Array.from({ length: h }, (_, i) => {
    const lr   = linReg[i];
    const em   = emaPrj[i];
    const mo   = momPrj[i];
    const con  = consensus[i];
    const chg  = ((con - last) / last * 100).toFixed(2);
    const up   = con >= last;
    function cell(v) {
      const c = v - last;
      const cls = c >= 0 ? 'up' : 'dn';
      return `<td class="${cls}">${fmt(v)}</td>`;
    }
    return `<tr>
      <td>Day +${i + 1}</td>
      ${cell(lr)}${cell(em)}${cell(mo)}
      <td class="consensus-cell">${fmt(con)}</td>
      <td class="${up ? 'up' : 'dn'}">${up ? '+' : ''}${chg}%</td>
    </tr>`;
  });

  document.getElementById('predTableBody').innerHTML = rows.join('');
}

// Hook predictor into loadAsset so it updates when asset/timeframe changes
const _origLoadAsset = loadAsset;
loadAsset = function() {
  _origLoadAsset();
  runPredictor();
};

// ══════════════════════════════════════════════════════════════════
//  ADD FUNDS MODAL
// ══════════════════════════════════════════════════════════════════

const PAYMENT_METHODS = [
  { id: 'card',     icon: '💳', label: 'Credit / Debit Card', fee: 0.015 },
  { id: 'bank',     icon: '🏦', label: 'Bank Transfer',       fee: 0.005 },
  { id: 'upi',      icon: '📱', label: 'UPI',                 fee: 0.0   },
  { id: 'paypal',   icon: '🅿️', label: 'PayPal',             fee: 0.02  },
  { id: 'crypto',   icon: '₿',  label: 'Crypto Wallet',       fee: 0.01  },
];

const QUICK_AMOUNTS_MAP = {
  USD: [100, 500, 1000, 5000],
  INR: [1000, 5000, 10000, 50000],
  EUR: [100, 500, 1000, 5000],
  GBP: [100, 500, 1000, 5000],
  JPY: [5000, 20000, 50000, 200000],
  AUD: [100, 500, 1000, 5000],
};

let selectedPaymentMethod = 'card';
let depositHistory = [];

function openFundsModal() {
  // Sync deposit currency to current currency
  document.getElementById('depositCurrency').value = currentCurrency;
  document.getElementById('depositSym').textContent = SYM[currentCurrency] || '$';

  buildPaymentMethods();
  buildQuickAmounts();
  updateDepositPreview();
  renderDepositHistory();

  document.getElementById('fundsModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeFundsModal() {
  document.getElementById('fundsModal').classList.remove('open');
  document.body.style.overflow = '';
}

function closeFundsModalOutside(e) {
  if (e.target === document.getElementById('fundsModal')) closeFundsModal();
}

function buildPaymentMethods() {
  document.getElementById('paymentMethods').innerHTML = PAYMENT_METHODS.map(m =>
    `<div class="pm-item ${m.id === selectedPaymentMethod ? 'active' : ''}" onclick="selectPaymentMethod('${m.id}')">
      <span class="pm-icon">${m.icon}</span>
      <span class="pm-label">${m.label}</span>
      <span class="pm-fee">${m.fee === 0 ? 'Free' : (m.fee * 100).toFixed(1) + '% fee'}</span>
    </div>`
  ).join('');
  showPaymentDetails(selectedPaymentMethod);
}

function selectPaymentMethod(id) {
  selectedPaymentMethod = id;
  buildPaymentMethods();
  updateDepositPreview();
}

function showPaymentDetails(id) {
  ['card','bank','upi','crypto'].forEach(k => {
    const el = document.getElementById(k + 'Details');
    if (el) el.style.display = (k === id) ? '' : 'none';
  });
}

function buildQuickAmounts() {
  const depCur = document.getElementById('depositCurrency').value;
  const amounts = QUICK_AMOUNTS_MAP[depCur] || [100, 500, 1000, 5000];
  const sym = SYM[depCur] || '$';
  document.getElementById('quickAmounts').innerHTML = amounts.map(a =>
    `<button class="quick-btn" onclick="setQuickAmount(${a})">${sym}${a.toLocaleString()}</button>`
  ).join('');
}

function setQuickAmount(amount) {
  document.getElementById('depositAmount').value = amount;
  updateDepositPreview();
}

function updateDepositPreview() {
  const depCur  = document.getElementById('depositCurrency').value;
  const amount  = parseFloat(document.getElementById('depositAmount').value) || 0;
  const sym     = SYM[depCur] || '$';
  const rate    = RATES[depCur] || 1;
  const method  = PAYMENT_METHODS.find(m => m.id === selectedPaymentMethod);
  const fee     = method ? method.fee : 0;

  // Update currency symbol in input
  document.getElementById('depositSym').textContent = sym;
  document.getElementById('depositCurrency').value  = depCur;
  buildQuickAmounts();

  const amountUSD = amount / rate;           // convert deposit to USD
  const feeUSD    = amountUSD * fee;
  const netUSD    = amountUSD - feeUSD;

  if (amount > 0) {
    document.getElementById('dpDeposit').textContent = sym + amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('dpUSD').textContent     = '$' + amountUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('dpFee').textContent     = fee === 0 ? 'Free' : ('$' + feeUSD.toFixed(2) + ' (' + (fee*100).toFixed(1) + '%)');
    document.getElementById('dpNet').textContent     = fmt(netUSD);
  } else {
    ['dpDeposit','dpUSD','dpFee','dpNet'].forEach(id => document.getElementById(id).textContent = '—');
  }
}

function confirmDeposit() {
  const depCur  = document.getElementById('depositCurrency').value;
  const amount  = parseFloat(document.getElementById('depositAmount').value) || 0;
  if (amount <= 0) { toast('Enter an amount to deposit.', 'error'); return; }

  const rate    = RATES[depCur] || 1;
  const method  = PAYMENT_METHODS.find(m => m.id === selectedPaymentMethod);
  const fee     = method ? method.fee : 0;
  const amountUSD = amount / rate;
  const feeUSD    = amountUSD * fee;
  const netUSD    = amountUSD - feeUSD;

  // Add to cash (stored in USD)
  cash += netUSD;

  // Log deposit
  const sym = SYM[depCur] || '$';
  depositHistory.unshift({
    amount, sym, currency: depCur, method: method.label,
    netUSD, fee: feeUSD,
    time: new Date().toLocaleTimeString(),
    date: new Date().toLocaleDateString(),
  });

  updateHeaderStats();
  toast(`${sym}${amount.toLocaleString()} deposited via ${method.label}!`, 'success');

  // Reset form
  document.getElementById('depositAmount').value = '';
  updateDepositPreview();
  renderDepositHistory();
}

function renderDepositHistory() {
  const section = document.getElementById('depositHistorySection');
  const list    = document.getElementById('depositHistoryList');
  if (depositHistory.length === 0) { section.style.display = 'none'; return; }

  section.style.display = '';
  list.innerHTML = depositHistory.slice(0, 8).map(d =>
    `<div class="dep-hist-item">
      <div class="dh-left">
        <span class="dh-method">${d.method}</span>
        <span class="dh-date">${d.date} ${d.time}</span>
      </div>
      <div class="dh-right">
        <span class="dh-amount">${d.sym}${d.amount.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
        <span class="dh-usd">= $${d.netUSD.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} USD</span>
      </div>
    </div>`
  ).join('');
}

function formatCardNumber(input) {
  let val = input.value.replace(/\D/g, '').slice(0, 16);
  input.value = val.replace(/(.{4})/g, '$1 ').trim();
}

function formatExpiry(input) {
  let val = input.value.replace(/\D/g, '').slice(0, 4);
  if (val.length >= 3) val = val.slice(0,2) + '/' + val.slice(2);
  input.value = val;
}

// Sync depositCurrency dropdown change
document.addEventListener('DOMContentLoaded', () => {
  const dc = document.getElementById('depositCurrency');
  if (dc) dc.addEventListener('change', () => {
    document.getElementById('depositSym').textContent = SYM[dc.value] || '$';
    buildQuickAmounts();
    updateDepositPreview();
  });
});
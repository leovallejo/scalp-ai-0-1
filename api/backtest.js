// Vercel Serverless Function - /api/backtest
// Inlines all logic (no local imports on Vercel serverless)

// --- Indicators ---
function ema(values, period) {
  if (!values || values.length < period) return null;
  const k = 2 / (period + 1);
  let result = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    result = values[i] * k + result * (1 - k);
  }
  return result;
}

function rsi(values, period = 14) {
  if (!values || values.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function atr(candles, period = 14) {
  if (!candles || candles.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    const tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    trs.push(tr);
  }
  const recent = trs.slice(-period);
  return recent.reduce((a, b) => a + b, 0) / recent.length;
}

function macd(values) {
  if (!values || values.length < 35) return null;
  const ema12 = ema(values.slice(-35), 12);
  const ema26 = ema(values.slice(-35), 26);
  if (!ema12 || !ema26) return null;
  return { hist: ema12 - ema26 };
}

// --- Binance fetch ---
const API_BASE = process.env.BINANCE_API_BASE || "https://api.binance.com";

async function fetchKlines(symbol, interval = "1m", limit = 500) {
  const url = `${API_BASE}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${Number(limit)}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.msg || `Binance request failed: ${res.status}`);
  if (!Array.isArray(data)) throw new Error("Invalid kline response");
  return data.map((k) => ({
    openTime: Number(k[0]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
    closeTime: Number(k[6]),
  }));
}

// --- Backtest engine ---
function buildSimpleSignal(candles) {
  const closes = candles.map((c) => c.close);
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const rsiVal = rsi(closes);
  const atrVal = atr(candles);
  const macdVal = macd(closes);
  if (!ema9 || !ema21 || !rsiVal || !atrVal || !macdVal) return null;

  let score = 0;
  if (ema9 > ema21) score += 1;
  else score -= 1;
  if (rsiVal < 40) score += 1;
  if (rsiVal > 60) score -= 1;
  if (macdVal.hist > 0) score += 1;
  else score -= 1;

  return {
    direction: score > 0 ? "LONG" : "SHORT",
    confidence: Math.min(Math.abs(score) / 3, 1),
    atr: atrVal,
  };
}

function runAutoBacktest(candles, config) {
  const { warmupBars = 50, holdBars = 20, minConfidence = 0.62 } = config;
  const trades = [];

  for (let i = warmupBars; i < candles.length - holdBars; i++) {
    const slice = candles.slice(0, i);
    const signal = buildSimpleSignal(slice);
    if (!signal || signal.confidence < minConfidence) continue;

    const entryCandle = candles[i];
    const exitCandle = candles[i + holdBars];
    const entry = entryCandle.close;
    const exit = exitCandle.close;
    const pnl = signal.direction === "LONG" ? exit - entry : entry - exit;
    const pnlR = pnl / (signal.atr || 1);

    trades.push({
      entryTime: entryCandle.openTime,
      direction: signal.direction,
      entry,
      exit,
      pnlR,
      outcome: pnl > 0 ? "WIN" : pnl < 0 ? "LOSS" : "BE",
    });
  }

  const wins = trades.filter((t) => t.outcome === "WIN").length;
  const losses = trades.filter((t) => t.outcome === "LOSS").length;
  const totalTrades = trades.length;
  const winRate = totalTrades ? (wins / totalTrades) * 100 : 0;
  const netR = trades.reduce((sum, t) => sum + t.pnlR, 0);

  let running = 0, peak = 0, maxDD = 0;
  trades.forEach((t) => {
    running += t.pnlR;
    peak = Math.max(peak, running);
    maxDD = Math.min(maxDD, running - peak);
  });

  return {
    summary: { totalTrades, wins, losses, winRate, netR, maxDrawdownR: maxDD },
    trades,
  };
}

// --- Handler ---
export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      symbol = "BTCUSDT",
      interval = "1m",
      limit = 800,
      holdBars = 20,
      minConfidence = 0.62,
    } = req.body || {};

    const maxBars = Number(process.env.MAX_BACKTEST_BARS || 1000);
    const bars = Math.min(Math.max(Number(limit) || 800, 1), maxBars);

    const candles = await fetchKlines(symbol, interval, bars);
    const result = runAutoBacktest(candles, {
      warmupBars: 60,
      holdBars: Number(holdBars),
      minConfidence: Number(minConfidence),
    });

    return res.json({ symbol, interval, bars, result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

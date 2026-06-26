// Vercel Serverless Function - /api/trade
// Handles GET /api/trade/journal, POST /api/trade/balance, POST /api/trade
//
// ⚠️  IMPORTANT: Vercel serverless functions are stateless — in-memory trade storage
// resets on every cold start. For persistent paper trades, replace the in-memory
// store below with a database (e.g. Vercel KV, PlanetScale, Supabase).

const API_BASE = process.env.BINANCE_API_BASE || "https://api.binance.com";

// --- In-memory store (resets on cold start — see note above) ---
let paperBalance = Number(process.env.INITIAL_PAPER_BALANCE || 1000);
const trades = [];

// --- Binance helpers ---
async function getJson(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.msg || `Binance request failed: ${res.status}`);
  return data;
}

async function fetchBookTicker(symbol) {
  const data = await getJson(
    `${API_BASE}/api/v3/ticker/bookTicker?symbol=${encodeURIComponent(symbol)}`
  );
  return {
    symbol: data.symbol,
    bidPrice: Number(data.bidPrice),
    bidQty: Number(data.bidQty),
    askPrice: Number(data.askPrice),
    askQty: Number(data.askQty),
  };
}

async function fetchTickerPrice(symbol) {
  const data = await getJson(
    `${API_BASE}/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`
  );
  return { symbol: data.symbol, price: Number(data.price) };
}

function calculatePaperPositionSize({ balance, riskPct = 0.01, entry, stopLoss }) {
  if (!balance || !entry || !stopLoss) return 0;
  const riskAmount = balance * riskPct;
  const stopDistance = Math.abs(entry - stopLoss);
  if (stopDistance <= 0) return 0;
  return riskAmount / stopDistance;
}

// --- Handler ---
export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();

  const { path } = req.query;

  // GET /api/trade/journal  (rewritten from vercel.json as ?path=journal)
  if (req.method === "GET" || path === "journal") {
    return res.json({
      paperBalance,
      trades: [...trades].reverse(),
    });
  }

  // POST /api/trade/balance
  if (path === "balance") {
    const { paperBalance: newBalance } = req.body || {};
    const num = Number(newBalance);
    if (Number.isFinite(num) && num > 0) paperBalance = num;
    return res.json({ ok: true, paperBalance });
  }

  // POST /api/trade
  if (req.method === "POST") {
    try {
      const {
        symbol = "BTCUSDT",
        direction = "LONG",
        confidence = 0.5,
        stopLoss = null,
        takeProfit = null,
        note = "",
      } = req.body || {};

      if (!["LONG", "SHORT"].includes(direction)) {
        return res.status(400).json({ error: "direction must be LONG or SHORT" });
      }

      const conf = Number(confidence);
      if (!Number.isFinite(conf) || conf < 0.62) {
        return res.status(400).json({ error: "confidence below paper-trade threshold (0.62)" });
      }

      const [ticker, book] = await Promise.all([
        fetchTickerPrice(symbol),
        fetchBookTicker(symbol),
      ]);

      const entry =
        direction === "LONG"
          ? Number(book.askPrice || ticker.price)
          : Number(book.bidPrice || ticker.price);

      if (!Number.isFinite(entry)) {
        throw new Error("Unable to determine entry price");
      }

      let sl = Number(stopLoss);
      let tp = Number(takeProfit);

      if (!Number.isFinite(sl) || !Number.isFinite(tp)) {
        const defaultRisk = entry * 0.003;
        sl = direction === "LONG" ? entry - defaultRisk : entry + defaultRisk;
        tp = direction === "LONG" ? entry + defaultRisk * 2 : entry - defaultRisk * 2;
      }

      const qty = calculatePaperPositionSize({
        balance: paperBalance,
        riskPct: Number(process.env.DEFAULT_RISK_PCT || 0.01),
        entry,
        stopLoss: sl,
      });

      const trade = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: "PAPER",
        symbol,
        direction,
        confidence: conf,
        entryPrice: entry,
        quantity: Number(qty.toFixed(6)),
        stopLoss: Number(sl.toFixed(8)),
        takeProfit: Number(tp.toFixed(8)),
        status: "OPEN_SIMULATED",
        note: String(note || ""),
        timestamp: new Date().toISOString(),
        executionInfo: {
          bidPrice: book.bidPrice,
          askPrice: book.askPrice,
          spread: Number((book.askPrice - book.bidPrice).toFixed(8)),
        },
      };

      trades.push(trade);

      return res.json({
        ok: true,
        message: "Paper trade created. No real-money order was sent.",
        trade,
        paperBalance,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}

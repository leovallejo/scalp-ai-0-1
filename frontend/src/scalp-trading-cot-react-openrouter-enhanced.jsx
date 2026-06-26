import { useState, useEffect } from "react";

const API_DEFAULT = import.meta.env.VITE_API_BASE || "http://localhost:3001";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];

const COLORS = {
  bg: "#05080a",
  surface: "#090f14",
  border: "#152230",
  green: "#00ff88",
  red: "#ff3b5c",
  amber: "#ffb700",
  text: "#cce8ff",
  muted: "#5a8aaa",
  cyan: "#00e5ff",
};

export default function ScalpEngine() {
  const [apiBase, setApiBase] = useState(API_DEFAULT);
  const [symbol, setSymbol] = useState("BTCUSDT");

  const [price, setPrice] = useState(null);
  const [change, setChange] = useState(null);

  const [result, setResult] = useState(null);
  const [aiText, setAiText] = useState("");

  const [backtest, setBacktest] = useState(null);
  const [journal, setJournal] = useState([]);
  const [paperBalance, setPaperBalance] = useState(1000);

  const [tab, setTab] = useState("ai");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  // Live Binance miniTicker
  useEffect(() => {
    const ws = new WebSocket(
      `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@miniTicker`
    );

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setPrice(Number(data.c));
      setChange(Number(data.P));
    };

    return () => ws.close();
  }, [symbol]);

  async function runAnalysis() {
    setLoading(true);
    setMessage("");

    const payload = {
      symbol,
      price,
      rsi: 44,
      stochRsi: { k: 33, d: 41 },
      macd: { hist: 0.001 },
      ema9: price ? price + 10 : null,
      ema21: price ? price - 5 : null,
      ema50: price ? price - 30 : null,
      atr: 120,
      bbPctB: 40,
      bbWidth: 1.1,
      fundingRate: 0.0005,
      fearGreed: 55,
      regime: "trending",
      mtf: { bias: "LONG", strength: 65 },
      orderBook: { bias: "LONG", imbalance: 12 },
      liquiditySweep: { type: "none" },
      fakeBreakout: { type: "none" },
      model: {
        direction: "LONG",
        probLong: 0.66,
        probShort: 0.34,
        confidence: 0.66,
        topSignals: [],
      },
    };

    try {
      const res = await fetch(`${apiBase}/api/ai-analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.text || data?.error || "AI route failed");
      }

      setResult(payload.model);
      setAiText(data.text || "");
      setTab("ai");
    } catch (err) {
      setAiText(`Error connecting to backend: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function runBacktest() {
    setMessage("");
    try {
      const res = await fetch(`${apiBase}/api/backtest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Backtest failed");
      }

      setBacktest(data.result);
      setTab("backtest");
    } catch (err) {
      setMessage(`Backtest error: ${err.message}`);
    }
  }

  async function createTrade() {
    if (!result) {
      setMessage("Run analysis first.");
      return;
    }

    try {
      const res = await fetch(`${apiBase}/api/trade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          direction: result.direction,
          confidence: result.confidence,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Paper trade failed");
      }

      setMessage(data.message || "Paper trade created");
      await loadJournal();
      setTab("journal");
    } catch (err) {
      setMessage(`Trade error: ${err.message}`);
    }
  }

  async function loadJournal() {
    try {
      const res = await fetch(`${apiBase}/api/trade/journal`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Journal fetch failed");
      }

      setJournal(data.trades || []);
      setPaperBalance(data.paperBalance || 0);
    } catch (err) {
      setMessage(`Journal error: ${err.message}`);
    }
  }

  async function updatePaperBalance() {
    try {
      const res = await fetch(`${apiBase}/api/trade/balance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paperBalance }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Balance update failed");
      }

      setMessage(`Paper balance updated: ${data.paperBalance}`);
      await loadJournal();
    } catch (err) {
      setMessage(`Balance error: ${err.message}`);
    }
  }

  useEffect(() => {
    loadJournal();
  }, [apiBase]);

  return (
    <div
      style={{
        background: COLORS.bg,
        color: COLORS.text,
        minHeight: "100vh",
        padding: 20,
        fontFamily: "monospace",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ margin: 0, color: COLORS.green }}>Precision Scalp Engine</h1>
          <div style={{ color: COLORS.muted, marginTop: 4 }}>
            OpenRouter · Backtest · Paper Trading
          </div>
        </div>

        {price && (
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 24, fontWeight: 700 }}>
              ${price.toLocaleString()}
            </div>
            <div style={{ color: change >= 0 ? COLORS.green : COLORS.red }}>
              {change?.toFixed(2)}%
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        <label style={{ display: "block", marginBottom: 6, color: COLORS.muted }}>
          Backend API Base
        </label>
        <input
          value={apiBase}
          onChange={(e) => setApiBase(e.target.value)}
          style={{
            width: "100%",
            padding: 8,
            background: COLORS.surface,
            color: COLORS.text,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 6,
          }}
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <label style={{ display: "block", marginBottom: 6, color: COLORS.muted }}>
          Pair
        </label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {SYMBOLS.map((s) => (
            <button
              key={s}
              onClick={() => setSymbol(s)}
              style={{
                padding: "6px 12px",
                background: symbol === s ? COLORS.green : COLORS.surface,
                color: symbol === s ? "#000" : COLORS.text,
                border: `1px solid ${symbol === s ? COLORS.green : COLORS.border}`,
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
        <button
          onClick={runAnalysis}
          style={{
            padding: "10px 16px",
            background: COLORS.green,
            color: "#000",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          {loading ? "Running..." : "Run Analysis"}
        </button>

        <button
          onClick={runBacktest}
          style={{
            padding: "10px 16px",
            background: COLORS.cyan,
            color: "#000",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          Run Backtest
        </button>

        <button
          onClick={createTrade}
          style={{
            padding: "10px 16px",
            background: COLORS.amber,
            color: "#000",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          Create Paper Trade
        </button>
      </div>

      <div style={{ marginTop: 16 }}>
        <label style={{ display: "block", marginBottom: 6, color: COLORS.muted }}>
          Paper Balance
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="number"
            value={paperBalance}
            onChange={(e) => setPaperBalance(Number(e.target.value))}
            style={{
              padding: 8,
              background: COLORS.surface,
              color: COLORS.text,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 6,
            }}
          />
          <button
            onClick={updatePaperBalance}
            style={{
              padding: "8px 14px",
              background: COLORS.surface,
              color: COLORS.text,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Save Balance
          </button>
        </div>
      </div>

      {message && (
        <div
          style={{
            marginTop: 16,
            padding: 10,
            background: COLORS.surface,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 6,
          }}
        >
          {message}
        </div>
      )}

      {result && (
        <div
          style={{
            marginTop: 20,
            padding: 16,
            background: COLORS.surface,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 8,
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 700 }}>
            {result.direction}
          </div>
          <div style={{ color: COLORS.muted }}>
            Confidence: {(result.confidence * 100).toFixed(1)}%
          </div>
          <div style={{ marginTop: 8 }}>
            LONG {(result.probLong * 100).toFixed(1)}% · SHORT {(result.probShort * 100).toFixed(1)}%
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 20, flexWrap: "wrap" }}>
        {["ai", "backtest", "journal"].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "8px 12px",
              background: tab === t ? COLORS.green : COLORS.surface,
              color: tab === t ? "#000" : COLORS.text,
              border: `1px solid ${tab === t ? COLORS.green : COLORS.border}`,
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      {tab === "ai" && (
        <div
          style={{
            marginTop: 16,
            padding: 16,
            background: COLORS.surface,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 8,
            whiteSpace: "pre-wrap",
          }}
        >
          {aiText || "Run analysis to get OpenRouter AI output."}
        </div>
      )}

      {tab === "backtest" && (
        <div
          style={{
            marginTop: 16,
            padding: 16,
            background: COLORS.surface,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 8,
          }}
        >
          {!backtest ? (
            <div style={{ color: COLORS.muted }}>
              Run a backtest to view results.
            </div>
          ) : (
            <>
              <div>Total Trades: {backtest.summary.totalTrades}</div>
              <div>Wins: {backtest.summary.wins}</div>
              <div>Losses: {backtest.summary.losses}</div>
              <div>Win Rate: {Number(backtest.summary.winRate).toFixed(2)}%</div>
              <div>Net R: {Number(backtest.summary.netR).toFixed(2)}</div>
              <div>Max Drawdown R: {Number(backtest.summary.maxDrawdownR).toFixed(2)}</div>

              <div style={{ marginTop: 14, color: COLORS.muted }}>Recent trades</div>
              <div style={{ marginTop: 8, maxHeight: 240, overflowY: "auto" }}>
                {backtest.trades.slice(0, 20).map((t, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: "8px 0",
                      borderBottom: `1px solid ${COLORS.border}`,
                    }}
                  >
                    <div>
                      {new Date(t.entryTime).toLocaleString()} · {t.direction} · {t.outcome}
                    </div>
                    <div style={{ color: COLORS.muted }}>
                      Entry {t.entry} → Exit {t.exit} · {Number(t.pnlR).toFixed(2)}R
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {tab === "journal" && (
        <div
          style={{
            marginTop: 16,
            padding: 16,
            background: COLORS.surface,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 8,
          }}
        >
          {journal.length === 0 ? (
            <div style={{ color: COLORS.muted }}>No paper trades yet.</div>
          ) : (
            journal.map((j) => (
              <div
                key={j.id}
                style={{
                  padding: "10px 0",
                  borderBottom: `1px solid ${COLORS.border}`,
                }}
              >
                <div>
                  {j.symbol} · {j.direction} · {j.status}
                </div>
                <div style={{ color: COLORS.muted }}>
                  Entry {j.entryPrice} · Qty {j.quantity} · SL {j.stopLoss} · TP {j.takeProfit}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      <div style={{ marginTop: 24, color: COLORS.muted, fontSize: 12 }}>
        Educational purposes only · Not financial advice · Paper trades only
      </div>
    </div>
  );
}

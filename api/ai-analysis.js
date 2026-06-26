// Vercel Serverless Function - /api/ai-analysis
// Replaces Express router with a plain handler export

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callOpenRouter({ model, messages, temperature, top_p, max_tokens, retries = 1 }) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("Missing OPENROUTER_API_KEY");
  }

  const payload = {
    model: model || process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4-5",
    messages,
    temperature: temperature ?? 0.2,
    top_p: top_p ?? 0.9,
    max_tokens: max_tokens ?? 280,
    stream: false,
  };

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
      const response = await fetch(OPENROUTER_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "https://scalp-ai.vercel.app",
          "X-OpenRouter-Title": process.env.OPENROUTER_APP_NAME || "Precision Scalp Engine",
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const errMsg =
          data?.error?.message ||
          data?.message ||
          `OpenRouter request failed with status ${response.status}`;
        throw new Error(errMsg);
      }

      return {
        text:
          data?.choices?.[0]?.message?.content ||
          data?.choices?.[0]?.text ||
          "OpenRouter analysis unavailable.",
        model: data?.model || payload.model,
        usage: data?.usage || null,
      };
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(700);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("Unexpected OpenRouter failure");
}

function safeFixed(value, decimals = 2) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(decimals) : "N/A";
}

function buildTradingPrompt(body) {
  const topSignals = Array.isArray(body?.model?.topSignals)
    ? body.model.topSignals
        .slice(0, 8)
        .map((s, i) => {
          return `${i + 1}. ${s.dir || "N/A"} | ${s.cat || "Signal"} | ${s.label || "No label"} | weight=${s.weight ?? "N/A"} | conf=${s.confidence ?? "N/A"}`;
        })
        .join("\n")
    : "No signals provided.";

  return `
You are an educational crypto trading analysis assistant.

IMPORTANT:
- This is educational analysis only.
- Do not promise profit.
- Do not recommend leverage.
- If the setup is mixed, recommend WAIT.
- Be concise and risk-aware.

Analyze this paper-signal snapshot:

Symbol: ${body.symbol}
Price: ${body.price}

Technical Data:
RSI: ${body.rsi}
StochRSI: K=${body.stochRsi?.k ?? "N/A"} D=${body.stochRsi?.d ?? "N/A"}
MACD histogram: ${body.macd?.hist ?? "N/A"}
EMA9/EMA21/EMA50: ${body.ema9} / ${body.ema21} / ${body.ema50}
ATR: ${body.atr}
BB pctB: ${body.bbPctB ?? "N/A"}
BB width: ${body.bbWidth ?? "N/A"}

Market Context:
Funding rate: ${body.fundingRate}
Fear & Greed: ${body.fearGreed}
Regime: ${body.regime}
MTF bias: ${body.mtf?.bias ?? "N/A"} (${body.mtf?.strength ?? "N/A"}%)
Order book bias: ${body.orderBook?.bias ?? "N/A"} (${body.orderBook?.imbalance ?? "N/A"}%)

Liquidity:
Liquidity sweep: ${body.liquiditySweep?.type ?? "none"}
Fake breakout / trap: ${body.fakeBreakout?.type ?? "none"}

Model Output:
Direction: ${body.model?.direction}
P(LONG): ${safeFixed((body.model?.probLong ?? 0) * 100, 1)}%
P(SHORT): ${safeFixed((body.model?.probShort ?? 0) * 100, 1)}%
Confidence: ${safeFixed((body.model?.confidence ?? 0) * 100, 1)}%

Top weighted signals:
${topSignals}

Return exactly this format:

Direction Bias: LONG / SHORT / WAIT
Strongest Confirmation: one sentence
Biggest Risk: one sentence
Final Call: LONG / SHORT / WAIT
Reason: max 2 sentences
`;
}

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const prompt = buildTradingPrompt(body);

    const result = await callOpenRouter({
      model: process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4-5",
      messages: [
        {
          role: "system",
          content:
            "You are a concise, risk-aware trading analysis assistant. You only provide educational market analysis, never guarantees.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.2,
      top_p: 0.9,
      max_tokens: 280,
      retries: 1,
    });

    return res.json({
      text: result.text,
      model: result.model,
      usage: result.usage,
    });
  } catch (err) {
    return res.status(500).json({
      text: `OpenRouter AI error: ${err.message}`,
    });
  }
}

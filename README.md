frontend/
  src/
    scalp-trading-cot-react-openrouter-enhanced.jsx

backend/
  package.json
  .env.example
  server.js
  routes/
    ai.js
    backtest.js
    trade.js
  services/
    openrouter.js
    binancePublic.js
    indicators.js
    riskManager.js
    backtestEngine.js
    paperTradeStore.js

How to run everything
1.Backend
cd backend
npm install
node server.js

2. Frontend
npm run dev -- -- host
or npm start


    
    

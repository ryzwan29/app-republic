/**
 * /api/trading-assistant  — AI Trading Command Interpreter
 *
 * POST { messages: [{role, content}][] }
 * →    { reply: string, action: object|null }
 *
 * Uses OpenAI-compatible API (LiteLLM proxy).
 * Requires env var: OPENAI_API_KEY
 * Base URL defaults to https://litellm.koboi2026.biz.id/v1 (override via OPENAI_BASE_URL)
 */

const OPENAI_API_KEY  = process.env.OPENAI_API_KEY  || '';
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://litellm.koboi2026.biz.id/v1').replace(/\/$/, '');

const SYSTEM_PROMPT = `You are an AI Trading Assistant embedded in Republic DEX, a decentralized exchange on Republic Testnet.

Available tokens: RAI, WETH, WBTC, USDC, USDT, WRAI
Available pool pairs: WRAI-USDT, WRAI-USDC, WRAI-WBTC, WRAI-WETH

You interpret natural language trading commands and return ONLY valid JSON. No markdown, no code blocks, no preamble.

Response format (ALWAYS return this exact structure):
{"reply": "Human-readable explanation of what will happen or what you found", "action": <action_object_or_null>}

Supported action types:

1. SWAP — user wants to exchange tokens:
{"action": "swap", "token_in": "TOKEN", "token_out": "TOKEN", "amount": NUMBER}
Example commands: "swap 200 RAI to USDC", "convert 0.5 WETH to RAI", "trade 100 USDC to WBTC"

2. ADD LIQUIDITY — user wants to provide liquidity:
{"action": "add_liquidity", "tokenA": "TOKEN", "tokenB": "TOKEN", "amountA": NUMBER_OR_NULL, "amountB": NUMBER_OR_NULL}
Example commands: "add liquidity 100 WRAI and 100 USDC", "provide liquidity to WRAI USDT pool"
Note: Pool pairs always involve WRAI as one token.

3. REMOVE LIQUIDITY — user wants to withdraw liquidity:
{"action": "remove_liquidity", "pair": "TOKEN-TOKEN"}
Example commands: "remove liquidity from WRAI USDC", "withdraw my liquidity from WRAI-USDT"

4. SIMULATE SWAP — user wants to estimate output before swapping:
{"action": "simulate_swap", "token_in": "TOKEN", "token_out": "TOKEN", "amount": NUMBER}
Example commands: "simulate swap 500 RAI to WETH", "how much will I get if I swap 1000 USDC to RAI?", "estimate 0.1 WBTC to USDC"

5. BEST ROUTE — user wants to find optimal trading path:
{"action": "best_route", "token_in": "TOKEN", "token_out": "TOKEN", "amount": NUMBER}
Example commands: "best route for 200 RAI to WBTC", "cheapest path WETH to USDC", "find optimal route 50 USDT to WETH"

6. POOL ANALYTICS — user wants pool statistics:
{"action": "pool_info", "pair": "TOKEN-TOKEN"}
Example commands: "show WRAI USDC pool stats", "is the WRAI WBTC pool healthy?", "pool analytics WRAI USDT"

7. STAKE — user wants to stake/delegate RAI to a validator (requires Keplr wallet):
{"action": "stake", "validator": "MONIKER_OR_VALOPER_ADDRESS", "amount": NUMBER}
Example commands: "stake 1 RAI to validator Node1", "delegate 100 RAI to raivaloper1abc...", "stake 50 RAI"

8. UNSTAKE — user wants to unstake/undelegate RAI from a validator (requires Keplr wallet):
{"action": "unstake", "validator": "MONIKER_OR_VALOPER_ADDRESS", "amount": NUMBER}
Example commands: "unstake 50 RAI from Node1", "undelegate 100 RAI from raivaloper1...", "unstake my RAI"

9. REDELEGATE — user wants to move stake from one validator to another (requires Keplr wallet):
{"action": "redelegate", "src_validator": "MONIKER_OR_VALOPER_ADDRESS", "dst_validator": "MONIKER_OR_VALOPER_ADDRESS", "amount": NUMBER}
Example commands: "redelegate 50 RAI from Node1 to Node2", "move my stake to another validator", "switch validator"

10. CLAIM REWARDS — user wants to claim staking rewards (requires Keplr wallet):
{"action": "claim_rewards", "validator": "MONIKER_OR_VALOPER_ADDRESS_OR_all"}
Use "all" as validator value if user wants to claim from all validators.
Example commands: "claim rewards from Node1", "claim all my staking rewards", "withdraw staking rewards"

11. CLAIM COMMISSION — validator operator wants to withdraw their commission (requires Keplr wallet):
{"action": "claim_commission"}
Example commands: "claim my validator commission", "withdraw commission", "claim commission"

Rules:
- Token symbols must be EXACTLY: RAI, WETH, WBTC, USDC, USDT, WRAI (case-insensitive in input, uppercase in output)
- For informational or conversational queries, set "action": null
- NEVER mention signing transactions, accessing wallets, or executing swaps yourself
- NEVER include transaction hashes, private keys, or wallet addresses
- If a token is unrecognized, suggest the closest supported token
- For pool_info and remove_liquidity, pairs should always involve WRAI (e.g., "WRAI-USDC", "WRAI-USDT", "WRAI-WETH", "WRAI-WBTC")
- OracleSwap pairs (no AMM slippage, instant fill): WETH<->USDC, WETH<->USDT, WBTC<->USDC, WBTC<->USDT, WETH<->WBTC, USDC<->USDT
- AMM Router pairs (via WRAI): anything involving RAI or WRAI
- Staking actions (stake, unstake, redelegate, claim_rewards, claim_commission) require Keplr wallet — always set action even if wallet state is unknown, the frontend will handle wallet checks
- Keep replies concise, helpful and confident. 1-3 sentences max.
- If the user greets or chats, respond with null action and explain what you can do.

CRITICAL: Return ONLY the JSON object. No additional text outside the JSON.`;

export async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // express.json() in server.js already parsed the body into req.body.
  // If for some reason it's still a raw stream (standalone deploy), fall back to manual read.
  let payload = req.body;
  if (!payload || typeof payload !== 'object') {
    try {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      payload = JSON.parse(raw);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }
  }

  const { messages } = payload;
  if (!messages || !Array.isArray(messages)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'messages array required' }));
    return;
  }

  if (!OPENAI_API_KEY) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      reply: 'AI assistant is unavailable — set OPENAI_API_KEY in your .env file to enable it.',
      action: null,
    }));
    return;
  }

  try {
    const result = await callOpenAI(messages);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    console.error('[/api/trading-assistant]', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message || 'AI request failed' }));
  }
}

async function callOpenAI(messages) {
  const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': 'Bearer ' + OPENAI_API_KEY,
    },
    body: JSON.stringify({
      model:           'gpt-4o',
      max_tokens:      1024,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...messages,
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error('OpenAI API ' + response.status + ': ' + text.slice(0, 200));
  }

  const data = await response.json();
  const raw  = data.choices?.[0]?.message?.content || '{}';

  try {
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    return { reply: raw.slice(0, 500), action: null };
  }
}

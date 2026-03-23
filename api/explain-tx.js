/**
 * /api/explain-tx  — AI Transaction Explainer
 *
 * POST { hash: string, txData: object, layer: 'evm' | 'cosmos' }
 * →    { summary, actions[], technical, status, fee }
 */

const OPENAI_API_KEY  = process.env.OPENAI_API_KEY  || '';
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://litellm.koboi2026.biz.id/v1').replace(/\/$/, '');

const SYSTEM_PROMPT = `You are an AI assistant embedded in Republic DEX, a decentralized exchange on Republic Testnet (Chain ID: raitestnet_77701-1, EVM: 77701). Your job is to explain blockchain transactions in plain, human-friendly language.

Given raw transaction data (EVM or Cosmos), analyze and return ONLY valid JSON — no markdown, no code blocks.

Response format:
{
  "summary": "One clear sentence: what this transaction did (e.g. 'Swapped 100 USDT for 98.5 RAI on Republic DEX')",
  "actions": ["Array of bullet-point actions in plain English, e.g. 'Transferred 100 USDT from 0xabc... to the AMM router'"],
  "technical": {
    "type": "Category of transaction: Token Transfer | Swap | Add Liquidity | Remove Liquidity | Contract Deploy | Staking | Governance | Native Transfer | Contract Call | Unknown",
    "method": "Function name called, if any (e.g. swapExactTokensForTokens) or null",
    "gasUsed": "Human-readable gas info if available",
    "details": "Any noteworthy technical detail in 1-2 sentences"
  },
  "status": "success | failed | pending",
  "fee": "Transaction fee in human-readable format if available, else null"
}

Context about Republic Testnet:
- Native token: RAI (EVM + Cosmos)
- EVM tokens: USDT, USDC, WBTC, WETH, WRAI
- AMM router: Uniswap V2-style
- Staking: Cosmos SDK staking module
- If you see common Uniswap/ERC-20 function signatures, decode them correctly.`;

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

  let body = '';
  for await (const chunk of req) body += chunk;

  let payload;
  try { payload = JSON.parse(body); }
  catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return;
  }

  const { hash, txData, layer } = payload;

  if (!OPENAI_API_KEY) {
    // Fallback: return structured mock when no key
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      summary: `${layer === 'evm' ? 'EVM' : 'Cosmos'} transaction ${hash?.slice(0, 10)}… on Republic Testnet.`,
      actions: ['No AI key configured — showing raw data only.'],
      technical: { type: 'Unknown', method: null, gasUsed: null, details: 'Set OPENAI_API_KEY to enable AI explanation.' },
      status: txData?.status ?? 'unknown',
      fee: null,
    }));
    return;
  }

  try {
    const userContent = `Transaction Hash: ${hash}\nLayer: ${layer}\n\nRaw Data:\n${JSON.stringify(txData, null, 2)}`;

    const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        temperature: 0.2,
        max_tokens: 800,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: userContent },
        ],
      }),
    });

    const raw = await response.json();
    const text = raw.choices?.[0]?.message?.content?.trim() || '{}';

    let parsed;
    try { parsed = JSON.parse(text); }
    catch { parsed = { summary: text, actions: [], technical: { type: 'Unknown', method: null, gasUsed: null, details: '' }, status: 'unknown', fee: null }; }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(parsed));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message || 'AI request failed' }));
  }
}
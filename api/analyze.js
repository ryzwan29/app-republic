/**
 * /api/analyze  — AI Contract Analysis Route
 *
 * POST  { functions: string[], unknownSelectors: string[], meta: object, bytecodeSize: number, address: string }
 * →     { contractType, summary, risks[] }
 *
 * Uses OpenAI GPT-4o.  Requires env var: OPENAI_API_KEY
 * Fetches verified source code from Blockscout if available.
 *
 * Local dev : served by the Vite middleware plugin in vite.config.js
 * Production: deploy as a serverless function (Vercel / Netlify / Cloudflare)
 */

const OPENAI_API_KEY    = process.env.OPENAI_API_KEY    || '';
const OPENAI_BASE_URL   = (process.env.OPENAI_BASE_URL  || 'https://api.openai.com/v1').replace(/\/$/, '');
const BLOCKSCOUT_URL    = (process.env.BLOCKSCOUT_URL   || 'https://republicscan.provewithryd.xyz').replace(/\/$/, '');

// Fetch verified source code from Blockscout (Etherscan-compatible API)
async function getSourceCode(address) {
  if (!address) return null;
  try {
    const url = `${BLOCKSCOUT_URL}/api?module=contract&action=getsourcecode&address=${address}`;
    const res  = await fetch(url);
    const data = await res.json();
    if (data.status === '1' && data.result?.[0]?.SourceCode) {
      return data.result[0].SourceCode;
    }
  } catch (err) {
    console.warn('[getSourceCode] failed:', err.message);
  }
  return null;
}

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

  const { functions = [], unknownSelectors = [], meta = {}, bytecodeSize = 0, address = '' } = payload;

  if (!OPENAI_API_KEY) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      contractType: 'Unknown',
      summary: 'AI analysis is unavailable — set OPENAI_API_KEY in your .env file to enable it.',
      risks: [],
    }));
    return;
  }

  try {
    // Try to get verified source code from Blockscout
    const sourceCode = await getSourceCode(address);
    const result     = await callOpenAI(functions, unknownSelectors, meta, bytecodeSize, sourceCode);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    console.error('[/api/analyze]', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message || 'AI request failed' }));
  }
}

async function callOpenAI(functions, unknownSelectors, meta, bytecodeSize, sourceCode) {
  const fnList = functions.length
    ? functions.map(f => '  * ' + f).join('\n')
    : '  (no recognised function signatures)';

  const metaLines = [];
  if (meta.name)                 metaLines.push('Name: '            + meta.name);
  if (meta.symbol)               metaLines.push('Symbol: '          + meta.symbol);
  if (meta.decimals != null)     metaLines.push('Decimals: '        + meta.decimals);
  if (meta.totalSupplyFormatted) metaLines.push('Total supply: '    + meta.totalSupplyFormatted + ' ' + (meta.symbol ?? ''));
  if (meta.owner)                metaLines.push('Owner: '           + meta.owner);
  if (meta.paused != null)       metaLines.push('Paused: '          + meta.paused);
  if (meta.implementation)       metaLines.push('Implementation (proxy): ' + meta.implementation);

  const unknownSection = unknownSelectors.length
    ? `\nUnrecognised selectors (${unknownSelectors.length} functions with no known ABI match — may be custom AMM/DEX methods):\n${unknownSelectors.map(s => '  ' + s).join('\n')}\n`
    : '';

  // Include verified source code in prompt if available (limit to 4000 chars to stay within token budget)
  const sourceSection = sourceCode
    ? `\nVerified Source Code (from Blockscout):\n\`\`\`solidity\n${sourceCode.slice(0, 4000)}${sourceCode.length > 4000 ? '\n... (truncated)' : ''}\n\`\`\`\n`
    : '\n(Source code not verified — analysis based on bytecode only)\n';

  const prompt = `You are a senior smart-contract security analyst.

A user wants to understand a smart contract on the RepublicAI network. Below is information extracted from its bytecode, on-chain state, and verified source code (if available).

${metaLines.length ? 'On-chain metadata:\n' + metaLines.join('\n') + '\n' : ''}Bytecode size: ${bytecodeSize} bytes

Detected function signatures:
${fnList}
${unknownSection}${sourceSection}
Classify this contract and explain it in plain English. Reply ONLY with a valid JSON object (no prose, no markdown fences) matching this schema exactly:

{
  "contractType": "<one of: ERC-20 Token | ERC-721 NFT | ERC-1155 Multi-Token | DEX / AMM | Staking | Lending | Governance | Multisig | Proxy | Utility | Unknown>",
  "summary": "<2-4 sentence plain-English description of what this contract does and how users interact with it>",
  "risks": [
    { "label": "<short risk name>", "level": "<high|medium|low>", "description": "<one sentence>" }
  ]
}

Base risks strictly on the detected functions or source code (e.g. mint, pause, upgrade, blacklist, flashLoan). If no suspicious functions exist, return an empty risks array. Maximum 6 risk items.`;

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
      messages:        [{ role: 'user', content: prompt }],
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
    return { contractType: 'Unknown', summary: raw.slice(0, 500), risks: [] };
  }
}
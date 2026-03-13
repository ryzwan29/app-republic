/**
 * contractProber.js
 *
 * Uses ethers.js + the configured RPC to probe an unknown smart contract.
 * No explorer API required — everything is derived from:
 *   1. eth_getCode  → raw bytecode
 *   2. PUSH4 selector scanning in the dispatcher table
 *   3. Matching against a local database of keccak256 selectors
 *   4. Calling known view functions to surface live data
 */

import { ethers } from 'ethers';
import { NETWORK } from './tokens.js';

// ── RPC provider (re-uses the same URL as the rest of the app) ────────────────
let _provider = null;
export function getAnalyzerProvider() {
  if (!_provider) {
    // Use Vite dev-server proxy (/rpc → RPC node) to avoid CORS in the browser.
    const rpcUrl = typeof window !== 'undefined'
      ? `${window.location.origin}/rpc`
      : NETWORK.rpcUrls[0];
    _provider = new ethers.JsonRpcProvider(rpcUrl);
  }
  return _provider;
}

// ── Known function signature database ────────────────────────────────────────
// Selector = keccak256(sig)[0:4] as hex.  We compute these at runtime so the
// list stays readable and doesn't need a build step.

const KNOWN_SIGNATURES = [
  // ── ERC-20 ──────────────────────────────────────────────────────────────────
  'name()',
  'symbol()',
  'decimals()',
  'totalSupply()',
  'balanceOf(address)',
  'transfer(address,uint256)',
  'transferFrom(address,address,uint256)',
  'approve(address,uint256)',
  'allowance(address,address)',
  // ERC-20 extensions
  'mint(address,uint256)',
  'burn(uint256)',
  'burn(address,uint256)',
  'burnFrom(address,uint256)',
  'cap()',
  'maxSupply()',
  'maxTotalSupply()',
  'increaseAllowance(address,uint256)',
  'decreaseAllowance(address,uint256)',

  // ── ERC-721 (NFT) ────────────────────────────────────────────────────────────
  'ownerOf(uint256)',
  'safeTransferFrom(address,address,uint256)',
  'safeTransferFrom(address,address,uint256,bytes)',
  'tokenURI(uint256)',
  'getApproved(uint256)',
  'setApprovalForAll(address,bool)',
  'isApprovedForAll(address,address)',
  'mint(address)',
  'mint(uint256)',
  'safeMint(address)',
  'safeMint(address,uint256)',
  'tokenOfOwnerByIndex(address,uint256)',
  'totalSupply()',
  'tokenByIndex(uint256)',
  'baseURI()',
  'setBaseURI(string)',

  // ── ERC-1155 ─────────────────────────────────────────────────────────────────
  'balanceOf(address,uint256)',
  'balanceOfBatch(address[],uint256[])',
  'safeTransferFrom(address,address,uint256,uint256,bytes)',
  'safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)',
  'uri(uint256)',
  'mintBatch(address,uint256[],uint256[],bytes)',

  // ── Ownable / Access Control ─────────────────────────────────────────────────
  'owner()',
  'renounceOwnership()',
  'transferOwnership(address)',
  'hasRole(bytes32,address)',
  'getRoleAdmin(bytes32)',
  'grantRole(bytes32,address)',
  'revokeRole(bytes32,address)',
  'renounceRole(bytes32,address)',
  'DEFAULT_ADMIN_ROLE()',
  'MINTER_ROLE()',
  'PAUSER_ROLE()',
  'BURNER_ROLE()',

  // ── Pausable ─────────────────────────────────────────────────────────────────
  'pause()',
  'unpause()',
  'paused()',

  // ── Upgradeable / Proxy ───────────────────────────────────────────────────────
  'upgradeTo(address)',
  'upgradeToAndCall(address,bytes)',
  'implementation()',
  'admin()',
  'changeAdmin(address)',
  'initialize()',
  'initialize(address)',
  'initialized()',
  'proxiableUUID()',

  // ── DEX / AMM (Uniswap V2 style) ──────────────────────────────────────────────
  'factory()',
  'token0()',
  'token1()',
  'getReserves()',
  'price0CumulativeLast()',
  'price1CumulativeLast()',
  'kLast()',
  'mint(address)',
  'burn(address)',
  'swap(uint256,uint256,address,bytes)',
  'skim(address)',
  'sync()',
  'MINIMUM_LIQUIDITY()',

  // ── DEX / AMM (custom & alternate signatures) ─────────────────────────────────
  'swap(address,uint256,uint256)',
  'swap(address,address,uint256,uint256)',
  'swap(uint256,address)',
  'swapTokens(address,address,uint256)',
  'swapTokens(uint256,uint256,address[],address)',
  'deposit(address,uint256)',
  'withdraw(address,uint256)',
  'addLiquidity(address,address,uint256,uint256)',
  'addLiquidity(uint256,uint256)',
  'removeLiquidity(uint256)',
  'removeLiquidity(address,uint256)',
  'getAmountOut(uint256,uint256,uint256)',
  'getAmountIn(uint256,uint256,uint256)',
  'getPrice(address,address)',
  'getPrice(address)',
  'price()',
  'reserve0()',
  'reserve1()',
  'reserves()',
  'totalLiquidity()',
  'liquidity(address)',
  'liquidityOf(address)',
  'poolInfo(uint256)',
  'userInfo(uint256,address)',
  'pendingReward(uint256,address)',
  'pendingTokens(uint256,address)',

  // ── DEX Router ────────────────────────────────────────────────────────────────
  'WETH()',
  'addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256)',
  'addLiquidityETH(address,uint256,uint256,uint256,address,uint256)',
  'removeLiquidity(address,address,uint256,uint256,uint256,address,uint256)',
  'removeLiquidityETH(address,uint256,uint256,uint256,address,uint256)',
  'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)',
  'swapExactETHForTokens(uint256,address[],address,uint256)',
  'swapExactTokensForETH(uint256,uint256,address[],address,uint256)',
  'getAmountsOut(uint256,address[])',
  'getAmountsIn(uint256,address[])',
  'quote(uint256,uint256,uint256)',

  // ── Staking / Yield ───────────────────────────────────────────────────────────
  'stake(uint256)',
  'stake(address,uint256)',
  'unstake(uint256)',
  'unstake(address,uint256)',
  'withdraw(uint256)',
  'withdraw()',
  'deposit(uint256)',
  'deposit()',
  'claimReward()',
  'claimReward(address)',
  'earned(address)',
  'rewardRate()',
  'totalStaked()',
  'getReward()',
  'exit()',
  'notifyRewardAmount(uint256)',
  'rewardPerToken()',
  'lastTimeRewardApplicable()',
  'periodFinish()',

  // ── Lending / Aave style ──────────────────────────────────────────────────────
  'borrow(address,uint256,uint256,uint16,address)',
  'repay(address,uint256,uint256,address)',
  'supply(address,uint256,address,uint16)',
  'liquidationCall(address,address,address,uint256,bool)',
  'getUserAccountData(address)',
  'getReserveData(address)',
  'flashLoan(address,address[],uint256[],uint256[],address,bytes,uint16)',
  'flashLoanSimple(address,address,uint256,bytes,uint16)',

  // ── Governance / DAO ──────────────────────────────────────────────────────────
  'propose(address[],uint256[],bytes[],string)',
  'castVote(uint256,uint8)',
  'castVoteWithReason(uint256,uint8,string)',
  'queue(uint256)',
  'execute(uint256)',
  'cancel(uint256)',
  'state(uint256)',
  'quorum(uint256)',
  'votingDelay()',
  'votingPeriod()',
  'delegate(address)',
  'delegates(address)',
  'getVotes(address,uint256)',
  'timelock()',

  // ── Multisig / Safe ───────────────────────────────────────────────────────────
  'execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)',
  'requiredSignatures()',
  'getOwners()',
  'isOwner(address)',
  'addOwnerWithThreshold(address,uint256)',
  'removeOwner(address,address,uint256)',
  'getThreshold()',
  'nonce()',

  // ── Misc / Utility ────────────────────────────────────────────────────────────
  'version()',
  'VERSION()',
  'DOMAIN_SEPARATOR()',
  'PERMIT_TYPEHASH()',
  'permit(address,address,uint256,uint256,uint8,bytes32,bytes32)',
  'nonces(address)',
  'supportsInterface(bytes4)',
  'multicall(bytes[])',
  'setFee(uint256)',
  'fee()',
  'feeRecipient()',
  'setFeeRecipient(address)',
  'whitelist(address)',
  'blacklist(address)',
  'isBlacklisted(address)',
  'isWhitelisted(address)',
  'setMerkleRoot(bytes32)',
  'merkleRoot()',
  'claim(uint256,bytes32[])',
];

// Pre-compute selector → signature map  (runs once on first import)
const SELECTOR_MAP = new Map(); // "0xaabbccdd" → "transfer(address,uint256)"
for (const sig of KNOWN_SIGNATURES) {
  const selector = ethers.id(sig).slice(0, 10); // "0x" + 8 hex chars
  SELECTOR_MAP.set(selector, sig);
}

// ── Risk-signal patterns ──────────────────────────────────────────────────────
export const RISK_PATTERNS = [
  { pattern: /^mint\b/i,        level: 'high',   label: 'Mint',           desc: 'Contract can create new tokens — check if minting is unrestricted.' },
  { pattern: /^burn\b/i,        level: 'medium', label: 'Burn',           desc: 'Tokens can be burned; confirm this is intentional.' },
  { pattern: /^pause\b/i,       level: 'high',   label: 'Pausable',       desc: 'An admin can freeze all transfers at any time.' },
  { pattern: /^upgrade/i,       level: 'high',   label: 'Upgradeable',    desc: 'Contract logic can be replaced — risk of malicious upgrade.' },
  { pattern: /^blacklist\b/i,   level: 'high',   label: 'Blacklist',      desc: 'Owner can block specific addresses from transacting.' },
  { pattern: /^whitelist\b/i,   level: 'medium', label: 'Whitelist',      desc: 'Only approved addresses may interact.' },
  { pattern: /^flashLoan\b/i,   level: 'medium', label: 'Flash Loan',     desc: 'Flash loans enabled — verify re-entrancy guards are in place.' },
  { pattern: /owner\b/i,        level: 'low',    label: 'Owner Control',  desc: 'Contract has an owner with privileged functions.' },
  { pattern: /setFee\b/i,       level: 'medium', label: 'Mutable Fees',   desc: 'Fees can be changed by the owner post-deployment.' },
  { pattern: /implementation/i, level: 'high',   label: 'Proxy',          desc: 'This appears to be a proxy — verify the implementation address.' },
  { pattern: /execTransaction/i,level: 'medium', label: 'Multisig',       desc: 'Multisig wallet; check threshold and signer count.' },
];

// ── Bytecode selector extraction ──────────────────────────────────────────────

/**
 * Scans EVM bytecode for PUSH4 (0x63) instructions and collects the
 * 4-byte values that follow them.  In Solidity's function dispatcher, each
 * function selector is loaded via PUSH4 before an EQ + JUMPI sequence.
 *
 * @param {string} bytecode — hex string from eth_getCode (with or without "0x")
 * @returns {Set<string>} — set of "0x????????" selector strings
 */
function extractSelectorsFromBytecode(bytecode) {
  const selectors = new Set();
  const hex = bytecode.startsWith('0x') ? bytecode.slice(2) : bytecode;
  const bytes = new Uint8Array(hex.match(/.{1,2}/g).map(b => parseInt(b, 16)));

  let i = 0;
  while (i < bytes.length) {
    const op = bytes[i];

    if (op === 0x63 && i + 4 < bytes.length) {
      // PUSH4 — grab the next 4 bytes as a selector candidate
      const sel =
        '0x' +
        bytes[i + 1].toString(16).padStart(2, '0') +
        bytes[i + 2].toString(16).padStart(2, '0') +
        bytes[i + 3].toString(16).padStart(2, '0') +
        bytes[i + 4].toString(16).padStart(2, '0');
      selectors.add(sel);
      i += 5;
      continue;
    }

    // Skip operand bytes for other PUSH opcodes so we don't misread data
    if (op >= 0x60 && op <= 0x7f) {
      // PUSH1..PUSH32
      i += op - 0x60 + 2;
      continue;
    }

    i++;
  }

  return selectors;
}

// ── Main probe function ───────────────────────────────────────────────────────

/**
 * Probe a contract address.
 *
 * @param {string} address
 * @returns {Promise<ProbeResult>}
 *
 * ProbeResult = {
 *   address: string,
 *   isContract: boolean,
 *   bytecodeSize: number,
 *   functions: FunctionInfo[],     // matched + enriched
 *   unknownSelectors: string[],    // PUSH4 values with no known signature
 * }
 *
 * FunctionInfo = {
 *   selector: string,
 *   signature: string,
 *   name: string,
 *   params: string,
 *   stateMutability: string,       // inferred
 * }
 */
export async function probeContract(address) {
  const provider = getAnalyzerProvider();

  // 1. Validate & normalise address
  const checksummed = ethers.getAddress(address);

  // 2. Fetch bytecode
  const bytecode = await provider.getCode(checksummed);
  if (!bytecode || bytecode === '0x') {
    throw new Error('No contract found at this address — it may be an EOA or not deployed on this network.');
  }

  const bytecodeSize = (bytecode.length - 2) / 2; // bytes

  // 3. Extract selectors from bytecode
  const rawSelectors = extractSelectorsFromBytecode(bytecode);

  // 4. Match against known signatures
  const matched = [];
  const unknownSelectors = [];

  for (const sel of rawSelectors) {
    if (SELECTOR_MAP.has(sel)) {
      const sig = SELECTOR_MAP.get(sel);
      const parenIdx = sig.indexOf('(');
      const name = sig.slice(0, parenIdx);
      const params = sig.slice(parenIdx + 1, -1);
      matched.push({
        selector: sel,
        signature: sig,
        name,
        params,
        stateMutability: inferMutability(name),
      });
    } else {
      unknownSelectors.push(sel);
    }
  }

  // Sort: view functions first, then state-mutating
  matched.sort((a, b) => {
    const order = { view: 0, pure: 1, payable: 2, nonpayable: 3 };
    return (order[a.stateMutability] ?? 3) - (order[b.stateMutability] ?? 3);
  });

  // 5. Try to call common view functions to enrich data
  const meta = await tryReadMeta(checksummed, provider);

  return {
    address: checksummed,
    isContract: true,
    bytecodeSize,
    meta,
    functions: matched,
    unknownSelectors,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function inferMutability(fnName) {
  const viewNames = [
    'name', 'symbol', 'decimals', 'totalSupply', 'balanceOf', 'allowance',
    'owner', 'paused', 'cap', 'maxSupply', 'maxTotalSupply', 'getReserves',
    'token0', 'token1', 'factory', 'WETH', 'MINIMUM_LIQUIDITY', 'kLast',
    'price0CumulativeLast', 'price1CumulativeLast', 'implementation', 'admin',
    'getOwners', 'isOwner', 'getThreshold', 'nonce', 'nonces',
    'version', 'VERSION', 'DOMAIN_SEPARATOR', 'PERMIT_TYPEHASH',
    'getAmountsOut', 'getAmountsIn', 'quote', 'rewardRate', 'totalStaked',
    'earned', 'rewardPerToken', 'lastTimeRewardApplicable', 'periodFinish',
    'hasRole', 'getRoleAdmin', 'DEFAULT_ADMIN_ROLE', 'MINTER_ROLE', 'PAUSER_ROLE',
    'supportsInterface', 'ownerOf', 'tokenURI', 'getApproved', 'isApprovedForAll',
    'uri', 'delegates', 'getVotes', 'votingDelay', 'votingPeriod', 'quorum',
    'state', 'timelock', 'requiredSignatures', 'fee', 'feeRecipient',
    'isBlacklisted', 'isWhitelisted', 'merkleRoot', 'getUserAccountData',
    'getReserveData', 'baseURI', 'initialized', 'proxiableUUID',
  ];
  const payableNames = ['deposit', 'addLiquidityETH', 'swapExactETHForTokens'];

  if (viewNames.includes(fnName)) return 'view';
  if (payableNames.includes(fnName)) return 'payable';
  return 'nonpayable';
}

/**
 * Try calling common view functions to collect on-chain metadata.
 * Failures are silently ignored — the contract may not implement them.
 */
async function tryReadMeta(address, provider) {
  const PROBE_ABI = [
    'function name() view returns (string)',
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)',
    'function totalSupply() view returns (uint256)',
    'function owner() view returns (address)',
    'function paused() view returns (bool)',
    'function implementation() view returns (address)',
  ];

  const contract = new ethers.Contract(address, PROBE_ABI, provider);
  const meta = {};

  const attempt = async (key, fn) => {
    try { meta[key] = await fn(); } catch { /* not implemented */ }
  };

  await Promise.all([
    attempt('name',        () => contract.name()),
    attempt('symbol',      () => contract.symbol()),
    attempt('decimals',    () => contract.decimals()),
    attempt('totalSupply', () => contract.totalSupply()),
    attempt('owner',       () => contract.owner()),
    attempt('paused',      () => contract.paused()),
    attempt('implementation', () => contract.implementation()),
  ]);

  // Format totalSupply with decimals if available
  if (meta.totalSupply !== undefined) {
    const dec = Number(meta.decimals ?? 18n);
    meta.totalSupplyFormatted = ethers.formatUnits(meta.totalSupply, dec);
    meta.totalSupply = meta.totalSupply.toString();
  }
  if (meta.decimals !== undefined) meta.decimals = Number(meta.decimals);

  return meta;
}
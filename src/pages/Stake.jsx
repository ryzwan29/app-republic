import { useState, useEffect, useMemo } from 'react';
import { useWallet } from '../App.jsx';
import { LoadingOverlay, Skeleton } from '../components/LoadingSpinner.jsx';
import { TokenIcon } from '../components/TokenSelector.jsx';
import {
  getValidators,
  getAllUserDelegations,
  getUserStakeInfo,
  getStakingAPR,
  stake,
  unstake,
  claimReward,
  claimAllRewards,
  redelegate,
  getValidatorInfoByDelegator,
  withdrawValidatorCommission,
  withdrawAllRewardsAndCommission,
  getValidatorCommission,
} from '../blockchain/staking.js';
import { formatBalance } from '../blockchain/evm.js';

// ─── Small helpers ────────────────────────────────────────────────────────────
function fmt(amount, decimals = 4) {
  const n = parseFloat(amount || 0);
  return isNaN(n) ? '0' : n.toFixed(decimals);
}

function highlightMatch(text, query) {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(${escaped})`, 'gi'), '<mark class="bg-blue-500/30 text-blue-300 rounded px-0.5">$1</mark>');
}

// ─── Icons ────────────────────────────────────────────────────────────────────
const IconRedelegate = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
    <path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
  </svg>
);

const IconStar = ({ color = '#eab308' }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill={color} stroke={color} strokeWidth="1">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
  </svg>
);

// ─── Component ────────────────────────────────────────────────────────────────
export default function Stake() {
  const {
    evmAddress, cosmosAddress, balances,
    connectEVM, connectKeplr,
    refreshBalances, addNotification,
  } = useWallet();

  // FIX: Keplr (cosmosAddress) selalu prioritas atas EVM untuk halaman Stake.
  // Kalau kedua wallet connect sekaligus, semua fitur Keplr (validator check,
  // delegations, commission) tetap jalan — tidak tertimpa oleh evmAddress.
  const activeAddress = cosmosAddress || evmAddress;
  const walletType    = cosmosAddress ? 'keplr' : evmAddress ? 'evm' : null;
  const isConnected   = !!activeAddress;

  // ── Core data ──
  const [validators,  setValidators]  = useState([]);
  const [apr,         setApr]         = useState('—');
  const [loading,     setLoading]     = useState(true);
  const [txPending,   setTxPending]   = useState(false);

  // Semua delegasi user: { [validatorAddress]: { stakedAmount, pendingReward } }
  const [userStakeInfo, setUserStakeInfo] = useState({});

  // ── Validator selection ──
  const [selectedValidator, setSelectedValidator] = useState(null);
  const [searchQuery,        setSearchQuery]       = useState('');

  // ── Tabs ──
  const [activeTab, setActiveTab] = useState('stake');

  // ── Amounts ──
  const [stakeAmount,   setStakeAmount]   = useState('');
  const [unstakeAmount, setUnstakeAmount] = useState('');

  // ── Redelegate modal ──
  const [showRedelegateModal, setShowRedelegateModal] = useState(false);
  const [redelegateAmount,    setRedelegateAmount]    = useState('');
  const [redelegateDst,       setRedelegateDst]       = useState(null);
  const [redelegateSearch,    setRedelegateSearch]    = useState('');

  // ── Validator identity (untuk Keplr) ──
  const [validatorInfo,        setValidatorInfo]        = useState(null);
  const [loadingValidatorCheck, setLoadingValidatorCheck] = useState(false);
  const [commissionAmount,     setCommissionAmount]     = useState('0');

  // ── Filtered lists ──
  const filteredValidators = useMemo(() => {
    if (!searchQuery.trim()) return validators;
    const q = searchQuery.toLowerCase();
    return validators.filter((v) => v.moniker?.toLowerCase().includes(q));
  }, [validators, searchQuery]);

  const filteredRedelegateDst = useMemo(() => {
    const q = redelegateSearch.toLowerCase();
    return validators.filter((v) => {
      if (selectedValidator && v.address === selectedValidator.address) return false;
      return !q || v.moniker?.toLowerCase().includes(q);
    });
  }, [validators, selectedValidator, redelegateSearch]);

  // ── Computed totals ──
  const totalStaked = useMemo(
    () => Object.values(userStakeInfo).reduce((s, i) => s + parseFloat(i.stakedAmount || 0), 0),
    [userStakeInfo]
  );
  const totalPendingRewards = useMemo(
    () => Object.values(userStakeInfo).reduce((s, i) => s + parseFloat(i.pendingReward || 0), 0),
    [userStakeInfo]
  );

  // Daftar validator yang user sudah delegasi (ada stakenya)
  const myDelegations = useMemo(() => {
    return validators.filter((v) => parseFloat(userStakeInfo[v.address]?.stakedAmount || 0) > 0);
  }, [validators, userStakeInfo]);

  // Semua validator address yg punya reward (untuk claim all)
  const delegatedValAddresses = useMemo(
    () => Object.keys(userStakeInfo).filter((a) => parseFloat(userStakeInfo[a]?.pendingReward || 0) > 0),
    [userStakeInfo]
  );

  const stakedOnSelected = parseFloat(userStakeInfo[selectedValidator?.address]?.stakedAmount || 0);
  const canRedelegate    = walletType === 'keplr' && selectedValidator && stakedOnSelected > 0;

  // ─── Data fetching ──────────────────────────────────────────────────────────
  // FIX: Pass alamat eksplisit ke fetchData agar tidak kena stale closure.
  // Saat MetaMask connect duluan lalu Keplr connect, React batch state update
  // sehingga cosmosAddress baru belum tentu terbaca di dalam fetchData()
  // kalau dipanggil tanpa argumen.
  useEffect(() => { fetchData(cosmosAddress, evmAddress); }, [evmAddress, cosmosAddress]);

  // Watch cosmosAddress langsung — pass sebagai argumen untuk hindari stale closure
  useEffect(() => {
    if (cosmosAddress) checkValidatorStatus(cosmosAddress);
    else setValidatorInfo(null);
  }, [cosmosAddress]);

  // FIX: Terima cosAddr dan evmAddr sebagai parameter eksplisit
  // agar tidak bergantung pada closure value yang mungkin stale.
  async function fetchData(cosAddr, evAddr) {
    setLoading(true);
    try {
      const [vals, aprVal] = await Promise.all([getValidators(), getStakingAPR()]);
      setValidators(vals);
      setApr(aprVal);

      // Gunakan parameter, bukan closure — ini kuncinya
      const addr = cosAddr || evAddr;
      if (addr) {
        await loadStakeInfo(vals, cosAddr, evAddr);
      }
    } catch (err) {
      addNotification('Error fetching validator data: ' + err.message, 'error');
    }
    setLoading(false);
  }

  // FIX: Terima cosAddr dan evAddr eksplisit — tidak pakai closure cosmosAddress
  async function loadStakeInfo(vals, cosAddr, evAddr) {
    // Kalau ada cosmosAddress (Keplr), selalu pakai Keplr path
    if (cosAddr) {
      const info = await getAllUserDelegations(cosAddr);
      setUserStakeInfo(info);
    } else {
      if (!evAddr) return;
      // EVM path: query per validator (contract)
      const info = {};
      for (const v of vals.slice(0, 20)) {
        try {
          info[v.address] = await getUserStakeInfo(evAddr, v.address, 'evm');
        } catch {
          info[v.address] = { stakedAmount: '0', pendingReward: '0' };
        }
      }
      setUserStakeInfo(info);
    }
  }

  async function checkValidatorStatus(addr) {
    // Terima addr sebagai parameter — tidak bergantung closure cosmosAddress yang bisa stale
    if (!addr) return;
    setLoadingValidatorCheck(true);
    try {
      const info = await getValidatorInfoByDelegator(addr);
      setValidatorInfo(info);
      if (info.isValidator) {
        const commission = await getValidatorCommission(info.operatorAddress);
        setCommissionAmount(commission);
      }
    } catch {
      setValidatorInfo({ isValidator: false });
    }
    setLoadingValidatorCheck(false);
  }

  async function refreshCommission() {
    if (validatorInfo?.isValidator) {
      const commission = await getValidatorCommission(validatorInfo.operatorAddress);
      setCommissionAmount(commission);
    }
  }

  // ─── Transaction handlers ────────────────────────────────────────────────────
  function handleConnect() {
    if (!cosmosAddress && connectKeplr) connectKeplr();
    else connectEVM();
  }

  async function handleStake() {
    if (!isConnected) { handleConnect(); return; }
    if (!selectedValidator) { addNotification('Please select a validator', 'warning'); return; }
    if (!stakeAmount || parseFloat(stakeAmount) <= 0) { addNotification('Enter stake amount', 'warning'); return; }
    if (parseFloat(stakeAmount) > parseFloat(balances.RAI || '0')) {
      addNotification('Insufficient RAI balance', 'error'); return;
    }

    setTxPending(true);
    try {
      await stake(selectedValidator.address, stakeAmount, walletType);
      addNotification(`✅ Staked ${stakeAmount} RAI to ${selectedValidator.moniker}`, 'success');
      setStakeAmount('');
      await Promise.all([fetchData(cosmosAddress, evmAddress), refreshBalances()]);
    } catch (err) {
      const msg = err.reason || err.message || 'Transaction failed';
      addNotification(msg.includes('rejected') ? 'Transaction rejected.' : `Stake failed: ${msg}`, 'error');
    } finally { setTxPending(false); }
  }

  async function handleUnstake() {
    if (!isConnected) { handleConnect(); return; }
    if (!selectedValidator) { addNotification('Please select a validator', 'warning'); return; }
    if (!unstakeAmount || parseFloat(unstakeAmount) <= 0) { addNotification('Enter unstake amount', 'warning'); return; }
    if (parseFloat(unstakeAmount) > stakedOnSelected) {
      addNotification('Amount exceeds staked balance', 'error'); return;
    }

    setTxPending(true);
    try {
      await unstake(selectedValidator.address, unstakeAmount, walletType);
      addNotification(`⏳ Unstaking ${unstakeAmount} RAI from ${selectedValidator.moniker}`, 'success');
      setUnstakeAmount('');
      await Promise.all([fetchData(cosmosAddress, evmAddress), refreshBalances()]);
    } catch (err) {
      const msg = err.reason || err.message || 'Transaction failed';
      addNotification(msg.includes('rejected') ? 'Transaction rejected.' : `Unstake failed: ${msg}`, 'error');
    } finally { setTxPending(false); }
  }

  async function handleClaim(validatorAddress, moniker) {
    if (!isConnected) { handleConnect(); return; }
    setTxPending(true);
    try {
      await claimReward(validatorAddress, walletType);
      addNotification(`✅ Rewards claimed from ${moniker || validatorAddress.slice(0, 16)}!`, 'success');
      await Promise.all([fetchData(cosmosAddress, evmAddress), refreshBalances()]);
    } catch (err) {
      const msg = err.reason || err.message || 'Transaction failed';
      addNotification(msg.includes('rejected') ? 'Transaction rejected.' : `Claim failed: ${msg}`, 'error');
    } finally { setTxPending(false); }
  }

  async function handleClaimAll() {
    if (!isConnected || walletType !== 'keplr') {
      addNotification('Claim All hanya tersedia untuk Keplr wallet', 'warning'); return;
    }
    if (!delegatedValAddresses.length) {
      addNotification('Tidak ada rewards yang bisa di-claim', 'warning'); return;
    }

    setTxPending(true);
    try {
      await claimAllRewards(delegatedValAddresses);
      addNotification(`✅ All rewards claimed dari ${delegatedValAddresses.length} validator!`, 'success');
      await Promise.all([fetchData(cosmosAddress, evmAddress), refreshBalances()]);
    } catch (err) {
      const msg = err.message || 'Transaction failed';
      addNotification(msg.includes('rejected') ? 'Transaction rejected.' : `Claim all failed: ${msg}`, 'error');
    } finally { setTxPending(false); }
  }

  async function handleWithdrawAll() {
    if (!isConnected || walletType !== 'keplr') return;
    const allValAddrs  = Object.keys(userStakeInfo);
    // FIX: Gunakan parseFloat untuk cek commission, bukan string === '0'
    // API bisa return "0.000000000000000000" yang !== '0' padahal nilainya nol
    const hasCommission = parseFloat(commissionAmount) > 0;
    const operatorAddr  = validatorInfo?.isValidator && hasCommission
      ? validatorInfo.operatorAddress
      : null;

    if (!allValAddrs.length && !operatorAddr) {
      addNotification('Tidak ada yang bisa di-withdraw', 'warning'); return;
    }

    setTxPending(true);
    try {
      await withdrawAllRewardsAndCommission(allValAddrs, operatorAddr);
      const label = operatorAddr ? 'All rewards + commission' : 'All rewards';
      addNotification(`✅ ${label} berhasil di-withdraw!`, 'success');
      await Promise.all([fetchData(cosmosAddress, evmAddress), refreshCommission(), refreshBalances()]);
    } catch (err) {
      const msg = err.message || 'Transaction failed';
      addNotification(msg.includes('rejected') ? 'Transaction rejected.' : `Withdraw all failed: ${msg}`, 'error');
    } finally { setTxPending(false); }
  }

  async function handleRedelegate() {
    if (!isConnected) { handleConnect(); return; }
    if (!selectedValidator) { addNotification('Pilih validator sumber', 'warning'); return; }
    if (!redelegateDst) { addNotification('Pilih validator tujuan', 'warning'); return; }
    if (!redelegateAmount || parseFloat(redelegateAmount) <= 0) { addNotification('Masukkan jumlah', 'warning'); return; }
    if (walletType !== 'keplr') { addNotification('Redelegate hanya tersedia untuk Keplr', 'warning'); return; }
    if (parseFloat(redelegateAmount) > stakedOnSelected) {
      addNotification('Amount melebihi staked amount', 'error'); return;
    }

    setTxPending(true);
    try {
      await redelegate(selectedValidator.address, redelegateDst.address, redelegateAmount, walletType);
      addNotification(`✅ Redelegated ${redelegateAmount} RAI → ${redelegateDst.moniker}`, 'success');
      setRedelegateAmount(''); setShowRedelegateModal(false); setRedelegateDst(null);
      await Promise.all([fetchData(cosmosAddress, evmAddress), refreshBalances()]);
    } catch (err) {
      const msg = err.reason || err.message || 'Transaction failed';
      addNotification(msg.includes('rejected') ? 'Transaction rejected.' : `Redelegate failed: ${msg}`, 'error');
    } finally { setTxPending(false); }
  }

  async function handleWithdrawCommission() {
    if (!validatorInfo?.isValidator) return;
    setTxPending(true);
    try {
      await withdrawValidatorCommission(validatorInfo.operatorAddress);
      addNotification('✅ Validator commission withdrawn!', 'success');
      await Promise.all([refreshCommission(), refreshBalances()]);
    } catch (err) {
      const msg = err.reason || err.message || 'Transaction failed';
      addNotification(msg.includes('rejected') ? 'Transaction rejected.' : `Withdraw commission failed: ${msg}`, 'error');
    } finally { setTxPending(false); }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      {txPending && <LoadingOverlay text="Processing transaction..." />}

      {/* ── Redelegate Modal ── */}
      {showRedelegateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
          <div className="glass-card p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-display font-bold text-white text-lg flex items-center gap-2">
                <IconRedelegate /> Redelegate
              </h3>
              <button
                onClick={() => { setShowRedelegateModal(false); setRedelegateDst(null); setRedelegateAmount(''); }}
                className="text-slate-500 hover:text-slate-300 transition-colors text-xl leading-none"
              >✕</button>
            </div>

            {/* Source */}
            <div className="mb-4 p-3 rounded-xl bg-black/30 border border-blue-900/30">
              <div className="text-xs text-slate-500 mb-1">From</div>
              <div className="font-display font-semibold text-white text-sm">{selectedValidator?.moniker}</div>
              <div className="text-xs text-slate-400 font-mono mt-0.5">
                Staked: {fmt(userStakeInfo[selectedValidator?.address]?.stakedAmount)} RAI
              </div>
            </div>

            {/* Amount */}
            <div className="mb-4">
              <div className="flex justify-between mb-1.5 text-xs text-slate-500">
                <span>Amount (RAI)</span>
                <button
                  onClick={() => setRedelegateAmount(userStakeInfo[selectedValidator?.address]?.stakedAmount || '0')}
                  className="text-blue-400 hover:text-blue-300"
                >MAX: {fmt(userStakeInfo[selectedValidator?.address]?.stakedAmount)}</button>
              </div>
              <div className="input-container p-3 flex items-center gap-2">
                <TokenIcon symbol="RAI" size={24} />
                <span className="text-sm text-slate-400 font-display">RAI</span>
                <input
                  type="number" value={redelegateAmount}
                  onChange={(e) => setRedelegateAmount(e.target.value)}
                  placeholder="0.0" className="input-field text-right"
                />
              </div>
            </div>

            {/* Destination search */}
            <div className="mb-4">
              <div className="text-xs text-slate-500 mb-2">Destination Validator</div>
              <div className="relative mb-2">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
                </svg>
                <input
                  type="text" value={redelegateSearch}
                  onChange={(e) => setRedelegateSearch(e.target.value)}
                  placeholder="Search destination..."
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-black/20 border border-blue-900/20 text-white text-sm placeholder:text-slate-600 focus:outline-none focus:border-blue-500/40"
                />
              </div>
              <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                {filteredRedelegateDst.map((v) => (
                  <button key={v.address} onClick={() => setRedelegateDst(v)}
                    className={`w-full p-3 rounded-xl text-left transition-all text-sm ${
                      redelegateDst?.address === v.address
                        ? 'bg-purple-900/30 border border-purple-500/40'
                        : 'bg-black/20 border border-blue-900/20 hover:border-blue-500/30'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-display font-semibold text-white">{v.moniker}</span>
                      <span className="text-xs text-slate-500 font-mono">{v.commission.toFixed(1)}% fee</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      VP: {parseFloat(v.votingPower).toLocaleString()} RAI
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {redelegateDst && (
              <div className="mb-4 p-3 rounded-xl bg-green-900/20 border border-green-500/20">
                <div className="text-xs text-green-400 mb-1">✓ To</div>
                <div className="font-display font-semibold text-white text-sm">{redelegateDst.moniker}</div>
                <div className="text-xs text-slate-400 font-mono mt-0.5">Commission: {redelegateDst.commission.toFixed(1)}%</div>
              </div>
            )}

            <button
              onClick={handleRedelegate}
              disabled={txPending || !redelegateDst || !redelegateAmount}
              className="w-full py-3 rounded-xl bg-purple-600/80 hover:bg-purple-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-display font-semibold transition-all"
            >
              Confirm Redelegate
            </button>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div className="mb-8">
        <h1 className="font-display font-bold text-3xl text-white mb-1">Stake</h1>
        <p className="text-slate-500 text-sm">Stake RAI to validators and earn staking rewards</p>

        {isConnected && (
          <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-slate-400">
            <span className={`w-2 h-2 rounded-full ${walletType === 'keplr' ? 'bg-purple-400' : 'bg-blue-400'}`} />
            {walletType === 'keplr' ? 'Keplr' : 'MetaMask'} connected:{' '}
            <span className="font-mono">{activeAddress?.slice(0, 14)}...</span>
            {walletType === 'keplr' && !loadingValidatorCheck && validatorInfo?.isValidator && (
              <span className="ml-2 px-2 py-0.5 rounded-full bg-yellow-500/20 border border-yellow-500/40 text-yellow-400 text-xs font-display">
                ✦ Validator
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Validator Commission Panel ── */}
      {walletType === 'keplr' && (
        <div className="mb-6">
          {loadingValidatorCheck ? (
            <div className="glass-card p-4 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-yellow-900/30 animate-pulse" />
              <div><Skeleton className="h-4 w-40 mb-1" /><Skeleton className="h-3 w-24" /></div>
            </div>
          ) : validatorInfo?.isValidator ? (
            <div className="glass-card p-5 border border-yellow-500/25 bg-yellow-900/5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <IconStar />
                    <span className="font-display font-semibold text-yellow-400 text-sm uppercase tracking-wide">Validator Node</span>
                  </div>
                  <div className="font-display font-bold text-white text-base">{validatorInfo.moniker}</div>
                  <div className="font-mono text-xs text-slate-500 mt-0.5 truncate max-w-xs">{validatorInfo.operatorAddress}</div>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs">
                    <span className="text-slate-500">Commission: <span className="text-white font-mono">{validatorInfo.commission?.toFixed(1)}%</span></span>
                    <span className={validatorInfo.jailed ? 'text-red-400' : 'text-green-400'}>
                      {validatorInfo.jailed ? '⚠ Jailed' : '● Active'}
                    </span>
                  </div>
                </div>

                <div className="text-right shrink-0 space-y-2">
                  <div>
                    <div className="text-xs text-slate-500 mb-1">Pending Commission</div>
                    <div className="font-mono font-bold text-yellow-400 text-2xl">{commissionAmount}</div>
                    <div className="text-xs text-slate-500">RAI</div>
                  </div>

                  <div className="flex flex-col gap-2">
                    {/* Withdraw commission only */}
                    <button
                      onClick={handleWithdrawCommission}
                      disabled={txPending || parseFloat(commissionAmount) <= 0}
                      className="px-4 py-2 rounded-xl bg-yellow-500/20 border border-yellow-500/40 text-yellow-400 text-sm font-display font-semibold hover:bg-yellow-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                    >
                      Withdraw Commission
                    </button>

                    {/* Withdraw all rewards + commission */}
                    {(totalPendingRewards > 0 || parseFloat(commissionAmount) > 0) && (
                      <button
                        onClick={handleWithdrawAll}
                        disabled={txPending}
                        className="px-4 py-2 rounded-xl bg-orange-500/20 border border-orange-500/40 text-orange-400 text-sm font-display font-semibold hover:bg-orange-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                      >
                        Withdraw All + Commission
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Staking APR',      value: `${apr}%`,                               color: 'text-green-400' },
          { label: 'RAI Balance',      value: `${formatBalance(balances.RAI)} RAI`,     color: 'text-white' },
          { label: 'My Staked',        value: `${formatBalance(totalStaked.toString())} RAI`, color: 'text-blue-400' },
          { label: 'Pending Rewards',  value: `${fmt(totalPendingRewards.toString())} RAI`, color: 'text-amber-400' },
        ].map((stat) => (
          <div key={stat.label} className="stat-card text-center">
            <div className={`font-display font-bold text-xl mb-1 ${stat.color}`}>{stat.value}</div>
            <div className="text-xs text-slate-500 font-display">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* ── My Delegations (Keplr only) ── */}
      {walletType === 'keplr' && myDelegations.length > 0 && (
        <div className="glass-card p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display font-semibold text-white">My Delegations</h2>
            <div className="flex items-center gap-2">
              {delegatedValAddresses.length > 0 && (
                <button
                  onClick={handleClaimAll}
                  disabled={txPending}
                  className="px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-400 text-xs font-display font-semibold hover:bg-amber-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  Claim All ({delegatedValAddresses.length})
                </button>
              )}
              <span className="text-xs text-slate-500">{myDelegations.length} validator</span>
            </div>
          </div>

          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {myDelegations.map((v) => {
              const info   = userStakeInfo[v.address] || {};
              const reward = parseFloat(info.pendingReward || 0);
              return (
                <div key={v.address}
                  className="flex items-center justify-between p-3 rounded-xl bg-black/20 border border-blue-900/20"
                >
                  <div className="min-w-0 mr-4">
                    <div className="font-display font-semibold text-white text-sm truncate">{v.moniker}</div>
                    <div className="text-xs text-slate-500 font-mono mt-0.5">
                      {fmt(info.stakedAmount)} RAI staked
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {reward > 0 && (
                      <div className="text-right mr-2">
                        <div className="text-xs text-amber-400 font-mono">{fmt(info.pendingReward, 6)}</div>
                        <div className="text-[10px] text-slate-600">RAI reward</div>
                      </div>
                    )}
                    {reward > 0 && (
                      <button
                        onClick={() => handleClaim(v.address, v.moniker)}
                        disabled={txPending}
                        className="px-2.5 py-1.5 rounded-lg bg-green-900/30 border border-green-500/30 text-green-400 text-xs font-display hover:bg-green-900/50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                      >
                        Claim
                      </button>
                    )}
                    <button
                      onClick={() => { setSelectedValidator(v); setActiveTab('unstake'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                      className="px-2.5 py-1.5 rounded-lg bg-red-900/20 border border-red-500/20 text-red-400 text-xs font-display hover:bg-red-900/40 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                      disabled={txPending}
                    >
                      Unstake
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Main grid ── */}
      <div className="grid lg:grid-cols-2 gap-6">

        {/* Validator list */}
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-semibold text-white text-lg">
              Validators
              {searchQuery && <span className="ml-2 text-xs text-slate-500 font-normal">{filteredValidators.length} found</span>}
            </h2>
            <span className="text-xs text-slate-500">{validators.length} active</span>
          </div>

          <div className="relative mb-4">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
            <input
              type="text" value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search validator..."
              className="w-full pl-9 pr-8 py-2.5 rounded-xl bg-black/20 border border-blue-900/20 text-white text-sm placeholder:text-slate-600 focus:outline-none focus:border-blue-500/40 transition-colors"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs">✕</button>
            )}
          </div>

          {loading ? (
            <div className="space-y-3">{[1,2,3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
          ) : filteredValidators.length === 0 ? (
            <div className="text-center py-8">
              {searchQuery
                ? <><p className="text-slate-400 text-sm">No validator found for "{searchQuery}"</p><button onClick={() => setSearchQuery('')} className="btn-secondary text-sm mt-3">Clear</button></>
                : <><p className="text-slate-400 text-sm">No active validators found</p><button onClick={fetchData} className="btn-secondary text-sm mt-4">Retry</button></>
              }
            </div>
          ) : (
            <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
              {filteredValidators.map((v) => {
                const stakeInfo  = userStakeInfo[v.address] || {};
                const isSelected = selectedValidator?.address === v.address;
                const hasDelegation = parseFloat(stakeInfo.stakedAmount || 0) > 0;
                return (
                  <button
                    key={v.address}
                    onClick={() => setSelectedValidator(v)}
                    className={`w-full p-4 rounded-xl transition-all duration-200 text-left ${
                      isSelected
                        ? 'bg-blue-900/30 border border-blue-500/40 shadow-glow-sm'
                        : 'bg-black/20 border border-blue-900/20 hover:border-blue-500/30'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500 text-xs font-mono">#{validators.indexOf(v) + 1}</span>
                        <span
                          className="font-display font-semibold text-white text-sm"
                          dangerouslySetInnerHTML={{ __html: highlightMatch(v.moniker, searchQuery) }}
                        />
                        {hasDelegation && (
                          <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" title="You have a delegation here" />
                        )}
                      </div>
                      <span className="text-xs text-slate-500 font-mono">{v.commission.toFixed(1)}% fee</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">
                        VP: <span className="text-slate-300 font-mono">{parseFloat(v.votingPower).toLocaleString()} RAI</span>
                      </span>
                      {hasDelegation && (
                        <span className="text-green-400 font-mono">My stake: {formatBalance(stakeInfo.stakedAmount)}</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right panel */}
        <div className="space-y-4">
          {/* Selected validator card */}
          {selectedValidator ? (
            <div className="glass-card p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="font-display font-semibold text-white">{selectedValidator.moniker}</div>
                  <div className="font-mono text-xs text-slate-500 mt-0.5">{selectedValidator.address.slice(0, 24)}...</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-500">Commission</div>
                  <div className="font-display font-semibold text-white">{selectedValidator.commission.toFixed(1)}%</div>
                </div>
              </div>

              <div className="gradient-divider my-3" />

              <div className="grid grid-cols-2 gap-3 text-xs mb-3">
                <div>
                  <span className="text-slate-500">My Staked</span>
                  <div className="font-mono text-white mt-0.5">
                    {formatBalance(userStakeInfo[selectedValidator.address]?.stakedAmount || '0')} RAI
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">Pending Reward</span>
                  <div className="font-mono text-amber-400 mt-0.5">
                    {fmt(userStakeInfo[selectedValidator.address]?.pendingReward || '0', 6)} RAI
                  </div>
                </div>
              </div>

              <div className="flex gap-2 flex-wrap">
                {parseFloat(userStakeInfo[selectedValidator.address]?.pendingReward || 0) > 0 && (
                  <button
                    onClick={() => handleClaim(selectedValidator.address, selectedValidator.moniker)}
                    className="flex-1 btn-secondary text-sm"
                    disabled={txPending}
                  >
                    Claim Rewards
                  </button>
                )}
                {canRedelegate && (
                  <button
                    onClick={() => { setShowRedelegateModal(true); setRedelegateSearch(''); }}
                    disabled={txPending}
                    className="flex-1 px-3 py-2 rounded-xl bg-purple-900/30 border border-purple-500/30 text-purple-400 text-sm font-display font-semibold hover:bg-purple-900/50 hover:border-purple-500/50 transition-all flex items-center justify-center gap-1.5"
                  >
                    <IconRedelegate /> Redelegate
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="glass-card p-5 text-center">
              <p className="text-slate-500 text-sm">Select a validator to stake</p>
            </div>
          )}

          {/* Stake / Unstake tabs */}
          <div className="glass-card p-6">
            <div className="flex gap-1 mb-5 p-1 bg-black/20 rounded-xl">
              <button onClick={() => setActiveTab('stake')}   className={`flex-1 tab-btn text-sm py-2 ${activeTab === 'stake'   ? 'active' : ''}`}>Stake</button>
              <button onClick={() => setActiveTab('unstake')} className={`flex-1 tab-btn text-sm py-2 ${activeTab === 'unstake' ? 'active' : ''}`}>Unstake</button>
            </div>

            {activeTab === 'stake' ? (
              <div>
                <div className="flex justify-between mb-1.5 text-xs text-slate-500">
                  <span>Stake Amount (RAI)</span>
                  <button onClick={() => setStakeAmount(balances.RAI || '0')} className="text-blue-400 hover:text-blue-300">
                    MAX: {formatBalance(balances.RAI)}
                  </button>
                </div>
                <div className="input-container p-3 mb-4 flex items-center gap-2">
                  <TokenIcon symbol="RAI" size={24} />
                  <span className="text-sm text-slate-400 font-display">RAI</span>
                  <input
                    type="number" value={stakeAmount}
                    onChange={(e) => setStakeAmount(e.target.value)}
                    placeholder="0.0" className="input-field text-right"
                  />
                </div>
                {stakeAmount && parseFloat(stakeAmount) > 0 && (
                  <div className="mb-4 text-xs text-slate-500 space-y-1">
                    <div className="flex justify-between"><span>Estimated APR</span><span className="text-green-400">{apr}%</span></div>
                    <div className="flex justify-between">
                      <span>Est. Daily Reward</span>
                      <span className="text-white">{(parseFloat(stakeAmount) * parseFloat(apr || 0) / 100 / 365).toFixed(4)} RAI</span>
                    </div>
                  </div>
                )}
                <button
                  onClick={handleStake}
                  disabled={txPending || (isConnected && !selectedValidator)}
                  className="btn-primary w-full py-3.5"
                >
                  {!isConnected ? 'Connect Wallet' : !selectedValidator ? 'Select Validator' : 'Stake RAI'}
                </button>
              </div>
            ) : (
              <div>
                <div className="flex justify-between mb-1.5 text-xs text-slate-500">
                  <span>Unstake Amount (RAI)</span>
                  {selectedValidator && (
                    <button
                      onClick={() => setUnstakeAmount(userStakeInfo[selectedValidator.address]?.stakedAmount || '0')}
                      className="text-blue-400 hover:text-blue-300"
                    >
                      MAX: {formatBalance(userStakeInfo[selectedValidator?.address]?.stakedAmount || '0')}
                    </button>
                  )}
                </div>
                <div className="input-container p-3 mb-4 flex items-center gap-2">
                  <TokenIcon symbol="RAI" size={24} />
                  <span className="text-sm text-slate-400 font-display">RAI</span>
                  <input
                    type="number" value={unstakeAmount}
                    onChange={(e) => setUnstakeAmount(e.target.value)}
                    placeholder="0.0" className="input-field text-right"
                  />
                </div>
                {walletType === 'keplr' && (
                  <p className="text-xs text-slate-600 mb-4">
                    ⏳ Unstaked tokens akan tersedia setelah unbonding period (~21 hari)
                  </p>
                )}
                <button
                  onClick={handleUnstake}
                  disabled={txPending || (isConnected && !selectedValidator)}
                  className="btn-danger w-full py-3.5"
                >
                  {!isConnected ? 'Connect Wallet' : !selectedValidator ? 'Select Validator' : 'Unstake RAI'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
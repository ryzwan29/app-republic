import { useState, useEffect, useMemo } from 'react';
import { useWallet } from '../App.jsx';
import { LoadingOverlay, Skeleton } from '../components/LoadingSpinner.jsx';
import { TokenIcon } from '../components/TokenSelector.jsx';
import { getValidators, getUserStakeInfo, getStakingAPR, stake, unstake, claimReward } from '../blockchain/staking.js';
import { formatBalance } from '../blockchain/evm.js';

export default function Stake() {
  // ✅ Ambil cosmosAddress dan connectKeplr dari context
  // Pastikan App.jsx expose: evmAddress, cosmosAddress, connectEVM, connectKeplr
  const {
    evmAddress,
    cosmosAddress,
    balances,
    connectEVM,
    connectKeplr,
    refreshBalances,
    addNotification,
  } = useWallet();

  // ✅ Tentukan wallet aktif — Keplr prioritas kalau EVM tidak connect
  const activeAddress = evmAddress || cosmosAddress;
  const walletType = evmAddress ? 'evm' : cosmosAddress ? 'keplr' : null;
  const isConnected = !!activeAddress;

  const [validators, setValidators] = useState([]);
  const [apr, setApr] = useState('—');
  const [loading, setLoading] = useState(true);
  const [txPending, setTxPending] = useState(false);
  const [selectedValidator, setSelectedValidator] = useState(null);
  const [stakeAmount, setStakeAmount] = useState('');
  const [unstakeAmount, setUnstakeAmount] = useState('');
  const [activeTab, setActiveTab] = useState('stake');
  const [userStakeInfo, setUserStakeInfo] = useState({});
  const [searchQuery, setSearchQuery] = useState('');

  const filteredValidators = useMemo(() => {
    if (!searchQuery.trim()) return validators;
    const q = searchQuery.toLowerCase();
    return validators.filter((v) => v.moniker?.toLowerCase().includes(q));
  }, [validators, searchQuery]);

  // ✅ Re-fetch kalau salah satu wallet connect/disconnect
  useEffect(() => {
    fetchData();
  }, [evmAddress, cosmosAddress]);

  async function fetchData() {
    setLoading(true);
    try {
      const [vals, aprVal] = await Promise.all([getValidators(), getStakingAPR()]);
      setValidators(vals);
      setApr(aprVal);

      // Fetch user stake info kalau ada wallet yang connect (EVM atau Keplr)
      if (activeAddress && vals.length) {
        const info = {};
        for (const v of vals.slice(0, 10)) {
          try {
            info[v.address] = await getUserStakeInfo(activeAddress, v.address);
          } catch {
            info[v.address] = { stakedAmount: '0', pendingReward: '0' };
          }
        }
        setUserStakeInfo(info);
      }
    } catch (err) {
      addNotification('Error fetching validator data: ' + err.message, 'error');
    }
    setLoading(false);
  }

  // ✅ Connect handler — connect sesuai wallet yang belum connect
  function handleConnect() {
    if (!cosmosAddress && connectKeplr) {
      connectKeplr();
    } else {
      connectEVM();
    }
  }

  async function handleStake() {
    if (!isConnected) { handleConnect(); return; }
    if (!selectedValidator) { addNotification('Please select a validator', 'warning'); return; }
    if (!stakeAmount || parseFloat(stakeAmount) === 0) { addNotification('Enter stake amount', 'warning'); return; }
    if (parseFloat(stakeAmount) > parseFloat(balances.RAI || '0')) {
      addNotification('Insufficient RAI balance', 'error'); return;
    }

    setTxPending(true);
    try {
      // ✅ Kirim walletType ke staking.js agar pilih signing path yang benar
      await stake(selectedValidator.address, stakeAmount, walletType);
      addNotification(`Staked ${stakeAmount} RAI to ${selectedValidator.moniker}`, 'success');
      setStakeAmount('');
      await Promise.all([fetchData(), refreshBalances()]);
    } catch (err) {
      const msg = err.reason || err.message || 'Transaction failed';
      addNotification(msg.includes('rejected') ? 'Transaction rejected.' : `Stake failed: ${msg}`, 'error');
    } finally {
      setTxPending(false);
    }
  }

  async function handleUnstake() {
    if (!isConnected) { handleConnect(); return; }
    if (!selectedValidator) { addNotification('Please select a validator', 'warning'); return; }
    if (!unstakeAmount || parseFloat(unstakeAmount) === 0) { addNotification('Enter unstake amount', 'warning'); return; }

    setTxPending(true);
    try {
      await unstake(selectedValidator.address, unstakeAmount, walletType);
      addNotification(`Unstaking ${unstakeAmount} RAI from ${selectedValidator.moniker}`, 'success');
      setUnstakeAmount('');
      await Promise.all([fetchData(), refreshBalances()]);
    } catch (err) {
      const msg = err.reason || err.message || 'Transaction failed';
      addNotification(msg.includes('rejected') ? 'Transaction rejected.' : `Unstake failed: ${msg}`, 'error');
    } finally {
      setTxPending(false);
    }
  }

  async function handleClaim(validatorAddress) {
    if (!isConnected) { handleConnect(); return; }

    setTxPending(true);
    try {
      await claimReward(validatorAddress, walletType);
      addNotification('Rewards claimed successfully!', 'success');
      await Promise.all([fetchData(), refreshBalances()]);
    } catch (err) {
      const msg = err.reason || err.message || 'Transaction failed';
      addNotification(msg.includes('rejected') ? 'Transaction rejected.' : `Claim failed: ${msg}`, 'error');
    } finally {
      setTxPending(false);
    }
  }

  const totalStaked = Object.values(userStakeInfo).reduce(
    (acc, info) => acc + parseFloat(info.stakedAmount || 0), 0
  );
  const totalPendingRewards = Object.values(userStakeInfo).reduce(
    (acc, info) => acc + parseFloat(info.pendingReward || 0), 0
  );

  // Label tombol submit
  function getStakeButtonLabel() {
    if (!isConnected) return 'Connect Wallet';
    if (!selectedValidator) return 'Select Validator';
    return 'Stake RAI';
  }

  function getUnstakeButtonLabel() {
    if (!isConnected) return 'Connect Wallet';
    if (!selectedValidator) return 'Select Validator';
    return 'Unstake RAI';
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      {txPending && <LoadingOverlay text="Processing staking transaction..." />}

      <div className="mb-8">
        <h1 className="font-display font-bold text-3xl text-white mb-1">Stake</h1>
        <p className="text-slate-500 text-sm">Stake RAI to validators and earn staking rewards</p>

        {/* ✅ Wallet status indicator */}
        {isConnected && (
          <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-slate-400">
            <span className={`w-2 h-2 rounded-full ${walletType === 'keplr' ? 'bg-purple-400' : 'bg-blue-400'}`} />
            {walletType === 'keplr' ? 'Keplr' : 'MetaMask'} connected:{' '}
            <span className="font-mono">{activeAddress.slice(0, 14)}...</span>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Staking APR', value: `${apr}%`, color: 'text-green-400' },
          { label: 'RAI Balance', value: formatBalance(balances.RAI) + ' RAI', color: 'text-white' },
          { label: 'My Staked', value: formatBalance(totalStaked.toString()) + ' RAI', color: 'text-blue-400' },
          { label: 'Pending Rewards', value: totalPendingRewards.toFixed(4) + ' RAI', color: 'text-amber-400' },
        ].map(stat => (
          <div key={stat.label} className="stat-card text-center">
            <div className={`font-display font-bold text-xl mb-1 ${stat.color}`}>{stat.value}</div>
            <div className="text-xs text-slate-500 font-display">{stat.label}</div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Validator list */}
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-semibold text-white text-lg">
              Validators
              {searchQuery && (
                <span className="ml-2 text-xs text-slate-500 font-normal">
                  {filteredValidators.length} found
                </span>
              )}
            </h2>
            <span className="text-xs text-slate-500">{validators.length} active</span>
          </div>

          {/* Search */}
          <div className="relative mb-4">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4"
              fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search validator..."
              className="w-full pl-9 pr-8 py-2.5 rounded-xl bg-black/20 border border-blue-900/20 text-white text-sm placeholder:text-slate-600 focus:outline-none focus:border-blue-500/40 transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors text-xs"
              >
                ✕
              </button>
            )}
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : filteredValidators.length === 0 ? (
            <div className="text-center py-8">
              {searchQuery ? (
                <>
                  <p className="text-slate-400 text-sm">No validator found for "{searchQuery}"</p>
                  <button onClick={() => setSearchQuery('')} className="btn-secondary text-sm mt-3">Clear search</button>
                </>
              ) : (
                <>
                  <p className="text-slate-400 text-sm">No active validators found</p>
                  <button onClick={fetchData} className="btn-secondary text-sm mt-4">Retry</button>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
              {filteredValidators.map((v) => {
                const stakeInfo = userStakeInfo[v.address] || { stakedAmount: '0', pendingReward: '0' };
                const isSelected = selectedValidator?.address === v.address;
                const monikerDisplay = searchQuery ? highlightMatch(v.moniker, searchQuery) : v.moniker;

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
                        <span className="text-slate-500 text-xs font-mono">
                          #{validators.indexOf(v) + 1}
                        </span>
                        <span
                          className="font-display font-semibold text-white text-sm"
                          dangerouslySetInnerHTML={{ __html: monikerDisplay }}
                        />
                      </div>
                      <span className="text-xs text-slate-500 font-mono">{v.commission.toFixed(1)}% fee</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">
                        Voting Power:{' '}
                        <span className="text-slate-300 font-mono">
                          {parseFloat(v.votingPower).toLocaleString()} RAI
                        </span>
                      </span>
                      {parseFloat(stakeInfo.stakedAmount) > 0 && (
                        <span className="text-green-400 font-mono">
                          My stake: {formatBalance(stakeInfo.stakedAmount)}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Stake/Unstake panel */}
        <div className="space-y-4">
          {selectedValidator ? (
            <div className="glass-card p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="font-display font-semibold text-white">{selectedValidator.moniker}</div>
                  <div className="font-mono text-xs text-slate-500 mt-0.5">
                    {selectedValidator.address.slice(0, 20)}...
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-500">Commission</div>
                  <div className="font-display font-semibold text-white">
                    {selectedValidator.commission.toFixed(1)}%
                  </div>
                </div>
              </div>
              <div className="gradient-divider my-3" />
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-slate-500">My Staked</span>
                  <div className="font-mono text-white mt-0.5">
                    {formatBalance(userStakeInfo[selectedValidator.address]?.stakedAmount || '0')} RAI
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">Pending Reward</span>
                  <div className="font-mono text-amber-400 mt-0.5">
                    {parseFloat(userStakeInfo[selectedValidator.address]?.pendingReward || '0').toFixed(6)} RAI
                  </div>
                </div>
              </div>
              {parseFloat(userStakeInfo[selectedValidator.address]?.pendingReward || '0') > 0 && (
                <button
                  onClick={() => handleClaim(selectedValidator.address)}
                  className="w-full btn-secondary text-sm mt-3"
                  disabled={txPending}
                >
                  Claim Rewards
                </button>
              )}
            </div>
          ) : (
            <div className="glass-card p-5 text-center">
              <p className="text-slate-500 text-sm">Select a validator to stake</p>
            </div>
          )}

          {/* Stake/Unstake form */}
          <div className="glass-card p-6">
            <div className="flex gap-1 mb-5 p-1 bg-black/20 rounded-xl">
              <button
                onClick={() => setActiveTab('stake')}
                className={`flex-1 tab-btn text-sm py-2 ${activeTab === 'stake' ? 'active' : ''}`}
              >
                Stake
              </button>
              <button
                onClick={() => setActiveTab('unstake')}
                className={`flex-1 tab-btn text-sm py-2 ${activeTab === 'unstake' ? 'active' : ''}`}
              >
                Unstake
              </button>
            </div>

            {activeTab === 'stake' ? (
              <div>
                <div className="flex justify-between mb-1.5 text-xs text-slate-500">
                  <span>Stake Amount (RAI)</span>
                  <button
                    onClick={() => setStakeAmount(balances.RAI || '0')}
                    className="text-blue-400 hover:text-blue-300"
                  >
                    MAX: {formatBalance(balances.RAI)}
                  </button>
                </div>
                <div className="input-container p-3 mb-4 flex items-center gap-2">
                  <TokenIcon symbol="RAI" size={24} />
                  <span className="text-sm text-slate-400 font-display">RAI</span>
                  <input
                    type="number"
                    value={stakeAmount}
                    onChange={e => setStakeAmount(e.target.value)}
                    placeholder="0.0"
                    className="input-field text-right"
                  />
                </div>
                {stakeAmount && (
                  <div className="mb-4 text-xs text-slate-500 space-y-1">
                    <div className="flex justify-between">
                      <span>Estimated APR</span>
                      <span className="text-green-400">{apr}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Est. Daily Reward</span>
                      <span className="text-white">
                        {(parseFloat(stakeAmount) * parseFloat(apr) / 100 / 365).toFixed(4)} RAI
                      </span>
                    </div>
                  </div>
                )}
                <button
                  onClick={handleStake}
                  disabled={txPending || (isConnected && !selectedValidator)}
                  className="btn-primary w-full py-3.5"
                >
                  {getStakeButtonLabel()}
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
                    type="number"
                    value={unstakeAmount}
                    onChange={e => setUnstakeAmount(e.target.value)}
                    placeholder="0.0"
                    className="input-field text-right"
                  />
                </div>
                <button
                  onClick={handleUnstake}
                  disabled={txPending || (isConnected && !selectedValidator)}
                  className="btn-danger w-full py-3.5"
                >
                  {getUnstakeButtonLabel()}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function highlightMatch(text, query) {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  return text.replace(
    regex,
    '<mark class="bg-blue-500/30 text-blue-300 rounded px-0.5">$1</mark>'
  );
}
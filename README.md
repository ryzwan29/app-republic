# Republic DEX — Testnet

A decentralized exchange (DEX) built for the Republic Testnet, supporting EVM + Cosmos ecosystem with MetaMask and Keplr wallet integration.

## Features

- **Token Swap** — AMM-based swaps for RAI/USDT, RAI/USDC, RAI/WRAI pairs (0.3% fee)
- **Liquidity Pools** — Add/remove liquidity, earn 0.2% from every swap
- **Staking** — Stake RAI to validators via EVM staking contract (~12.5% APR)
- **Faucet** — Claim testnet RAI, USDT, and USDC
- **Dashboard** — View balances, LP positions, staking info
- **Dual Wallet** — MetaMask (EVM) + Keplr (Cosmos) support

## Network

| Parameter | Value |
|-----------|-------|
| Network Name | Republic Testnet |
| Chain ID | 77701 |
| RPC | https://testnet-evm-republic.provewithryd.xyz |
| Currency | RAI |
| Cosmos Chain ID | raitestnet_77701-1 |
| Cosmos REST | https://testnet-api-republic.provewithryd.xyz |

## Setup

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## Contract Addresses

Before deploying, update contract addresses in `src/blockchain/tokens.js`:

```js
export const CONTRACTS = {
  USDT: '0x...',    // Your USDT ERC-20 contract
  USDC: '0x...',    // Your USDC ERC-20 contract
  WRAI: '0x...',    // Your Wrapped RAI contract
  ROUTER: '0x...',  // Uniswap V2-style AMM Router
  FACTORY: '0x...', // AMM Factory contract
  STAKING: '0x...', // EVM Staking contract
  FAUCET: '0x...',  // Faucet contract
};
```

## Architecture

```
src/
  blockchain/
    evm.js        # MetaMask connection, balances, network management
    cosmos.js     # Keplr, validator data from Cosmos REST API
    amm.js        # Swap, liquidity pool operations (ethers.js)
    staking.js    # EVM staking contract calls
    tokens.js     # Token config, ABIs, contract addresses

  components/
    Navbar.jsx         # Navigation with wallet button
    WalletConnect.jsx  # Connect/disconnect wallet dropdown
    TokenSelector.jsx  # Token picker with icon
    LoadingSpinner.jsx # Spinner + overlay + skeleton
    Notification.jsx   # Toast notifications

  pages/
    Home.jsx       # Landing page with chain stats
    Dashboard.jsx  # Wallet overview, balances, positions
    Swap.jsx       # Token swap with live quotes
    Liquidity.jsx  # Add/remove liquidity, pool stats
    Stake.jsx      # Validator list, stake/unstake/claim
    Faucet.jsx     # Claim testnet tokens
```

## Tech Stack

- **React** + **Vite**
- **ethers.js v6** — EVM interactions
- **TailwindCSS** — Styling with custom black/blue theme
- **react-router-dom** — Client-side routing
- Cosmos REST API — Validator & chain data

## Design

- Dark theme: black + blue gradient
- Glass card UI with soft glow borders
- Minimal neon buttons with hover animations
- Fully responsive (mobile, tablet, desktop)
- Syne + DM Sans + JetBrains Mono typography
export { CryptoError } from './errors.js';
export {
  BinanceClient,
  type TickerInfo,
  type Kline,
  type BalanceInfo,
  type OrderRequest,
  type OrderResult,
  type OrderSide,
  type OrderType,
} from './binance.js';
export { CoinGeckoClient, COINGECKO_ID_BY_SYMBOL, type CoinGeckoPrice } from './coingecko.js';
export {
  PriceFeed,
  baseOf,
  type PricePoint,
  type PriceSource,
  type PriceFeedOptions,
} from './prices.js';
export {
  sma,
  smaCross,
  rsi,
  rsiSignal,
  alertSignal,
  evaluateStrategy,
  validateStrategyParams,
  type StrategyKind,
  type StrategySignal,
  type SignalDirection,
  type StrategyParams,
} from './strategies.js';
export {
  RiskGuard,
  type RiskConfig,
  type OrderPlan,
  type PlanResult,
  type PlanSide,
  type TradeMode,
} from './risk.js';
export {
  generateEVMWallet,
  addressFromPublicKey,
  isValidEVMAddress,
  type EVMWallet,
} from './wallet.js';
export { generateCryptoConfig } from './random-config.js';
export { sanitizeCryptoConfig } from './sanitize.js';

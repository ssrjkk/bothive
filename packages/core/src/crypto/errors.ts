export class CryptoError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status?: number,
    /** Binance error code from the response body (e.g. -2013 "Order does not exist"). */
    public readonly binanceCode?: number,
  ) {
    super(message);
    this.name = 'CryptoError';
  }
}

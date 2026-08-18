import { describe, it, expect } from 'vitest';
import { generateCryptoConfig } from '../crypto/random-config.js';

describe('generateCryptoConfig', () => {
  it('always produces safe, schema-valid configs', () => {
    for (let i = 0; i < 100; i += 1) {
      const cfg = generateCryptoConfig();
      expect(cfg.tradeMode).toBe('dry');
      expect(cfg.strategyParams).toMatchObject({ autoTrade: false });

      const symbols = cfg.symbols as string[];
      expect(symbols.length).toBeGreaterThan(0);
      expect(symbols.every((s) => /^[A-Z0-9]{2,20}$/.test(s))).toBe(true);

      const pollInterval = cfg.pollInterval as number;
      expect(pollInterval).toBeGreaterThanOrEqual(15_000);
      expect(pollInterval).toBeLessThanOrEqual(120_000);

      const maxOrder = cfg.maxOrderValueUsdt as number;
      expect(maxOrder).toBeGreaterThanOrEqual(50);
      expect(maxOrder).toBeLessThanOrEqual(500);

      const amount = (cfg.strategyParams as Record<string, unknown>).autoTradeAmountUsdt as number;
      expect(amount).toBeGreaterThanOrEqual(1);
      expect(amount).toBeLessThanOrEqual(maxOrder);

      if (cfg.strategy === 'sma' || cfg.strategy === 'rsi') {
        expect(cfg.source).not.toBe('coingecko');
      }
      if (cfg.source === 'coingecko') {
        expect(cfg.strategy).toBe('alert');
        expect((cfg.coinIds as string[]).length).toBe(symbols.length);
      }
    }
  });

  it('varies across generations', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 25; i += 1) {
      seen.add(JSON.stringify(generateCryptoConfig()));
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

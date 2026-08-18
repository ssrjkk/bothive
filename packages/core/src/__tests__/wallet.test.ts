import { describe, it, expect } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { generateEVMWallet, isValidEVMAddress, addressFromPublicKey } from '../crypto/wallet.js';

describe('EVM wallet', () => {
  it('generates a valid 0x address and a 32-byte private key', () => {
    const wallet = generateEVMWallet();
    expect(wallet.address).toMatch(/^0x[0-9a-f]{40}$/);
    expect(wallet.privateKey).toMatch(/^[0-9a-f]{64}$/);
    expect(isValidEVMAddress(wallet.address)).toBe(true);
  });

  it('derives the well-known address for private key 1', () => {
    const privateKey = new Uint8Array(32);
    privateKey[31] = 1;
    const publicKey = secp256k1.getPublicKey(privateKey, false);
    expect(addressFromPublicKey(publicKey)).toBe('0x7e5f4552091a69125d5dfcb7b8c2659029395bdf');
  });

  it('generates unique wallets', () => {
    const a = generateEVMWallet();
    const b = generateEVMWallet();
    expect(a.address).not.toBe(b.address);
    expect(a.privateKey).not.toBe(b.privateKey);
  });

  it('derives addresses deterministically from the same private key', () => {
    const privateKey = new Uint8Array(32).fill(7);
    const pub1 = secp256k1.getPublicKey(privateKey, false);
    const pub2 = secp256k1.getPublicKey(privateKey, false);
    expect(addressFromPublicKey(pub1)).toBe(addressFromPublicKey(pub2));
  });

  it('rejects malformed addresses', () => {
    expect(isValidEVMAddress('0xabc')).toBe(false);
    expect(isValidEVMAddress(`${'a'.repeat(40)}`)).toBe(false);
    expect(isValidEVMAddress(`0x${'g'.repeat(40)}`)).toBe(false);
    expect(isValidEVMAddress(`0x${'A'.repeat(40)}`)).toBe(true);
  });
});

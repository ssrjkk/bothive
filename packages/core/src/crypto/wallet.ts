import { randomBytes } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex } from '@noble/hashes/utils.js';

export interface EVMWallet {
  /** EIP-55 lowercase hex address, 0x-prefixed (e.g. 0xabc...def). */
  address: string;
  /** 64-char hex private key (32 bytes), no 0x prefix. */
  privateKey: string;
}

/** Derives the standard EVM address from an uncompressed secp256k1 public key. */
export function addressFromPublicKey(publicKey: Uint8Array): string {
  const hash = keccak_256(publicKey.subarray(1));
  return `0x${bytesToHex(hash).slice(-40)}`;
}

/** Generates a fresh EVM wallet (secp256k1 keypair + keccak256 address). */
export function generateEVMWallet(): EVMWallet {
  const privateKey = randomBytes(32);
  const publicKey = secp256k1.getPublicKey(privateKey, false);
  return { address: addressFromPublicKey(publicKey), privateKey: bytesToHex(privateKey) };
}

export function isValidEVMAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

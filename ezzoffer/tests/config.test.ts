import test from 'node:test';
import assert from 'node:assert/strict';
import { effectivePacing, globalDailyCap, globalHourlyCap } from '../src/lib/config';

test('effectivePacing без глобального лимита использует лимит тарифа', () => {
  delete process.env.AUTOAPPLY_DAILY_CAP;
  delete process.env.AUTOAPPLY_HOURLY_CAP;
  const p = effectivePacing(100);
  assert.equal(p.dailyCap, 100);
  assert.equal(p.hourlyCap, 12);
  assert.ok(p.minDelayMs >= 45000);
  assert.ok(p.maxDelayMs >= p.minDelayMs);
});

test('effectivePacing учитывает глобальный потолок', () => {
  process.env.AUTOAPPLY_DAILY_CAP = '30';
  const p = effectivePacing(100);
  assert.equal(p.dailyCap, 30);
  delete process.env.AUTOAPPLY_DAILY_CAP;
});

test('глобальный потолок не поднимает лимит тарифа', () => {
  process.env.AUTOAPPLY_DAILY_CAP = '300';
  const p = effectivePacing(100);
  assert.equal(p.dailyCap, 100);
  delete process.env.AUTOAPPLY_DAILY_CAP;
});

test('часовой лимит из env', () => {
  process.env.AUTOAPPLY_HOURLY_CAP = '5';
  assert.equal(globalHourlyCap(), 5);
  delete process.env.AUTOAPPLY_HOURLY_CAP;
  assert.equal(globalDailyCap(), 0);
});

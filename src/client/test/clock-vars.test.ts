import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clockSig, clockVars, FADE_MINUTES, nightAlpha } from '../clock-vars.ts';

const at = (h: number, m = 0, s = 0): Date => new Date(2026, 8, 10, h, m, s);

test('nightAlpha：白天全 0、夜间全 1', () => {
  assert.equal(nightAlpha(12 * 60), 0, '12:00 白天');
  assert.equal(nightAlpha(6 * 60), 0, '06:00 归白天');
  assert.equal(nightAlpha(17 * 60 + 59), 0, '17:59 仍是白天');
  assert.equal(nightAlpha(18 * 60 + 30), 1, '18:30 已入夜');
  assert.equal(nightAlpha(23 * 60 + 59), 1, '23:59 夜间');
  assert.equal(nightAlpha(0), 1, '00:00 夜间');
  assert.equal(nightAlpha(5 * 60), 1, '05:00 夜间');
});

test('nightAlpha：边界前后各 10 分钟线性过渡，且卡在 0/1', () => {
  assert.equal(nightAlpha(18 * 60), 0, '18:00 起点=0');
  assert.equal(nightAlpha(18 * 60 + FADE_MINUTES / 2), 0.5, '18:05 = 0.5');
  assert.equal(nightAlpha(18 * 60 + FADE_MINUTES), 1, '18:10 到 1');
  assert.equal(nightAlpha(18 * 60 + FADE_MINUTES + 1), 1, '之后保持 1');
  assert.equal(nightAlpha(5 * 60 + 60 - FADE_MINUTES), 1, '05:50 = 1');
  assert.equal(nightAlpha(5 * 60 + 60 - FADE_MINUTES / 2), 0.5, '05:55 = 0.5');
  assert.equal(nightAlpha(6 * 60), 0, '06:00 回到 0');
  assert.equal(nightAlpha(6 * 60 + 1), 0, '06:01 仍是 0');
});

test('nightAlpha：越界输入按一天取模', () => {
  assert.equal(nightAlpha(12 * 60 + 1440), 0, '+24h 等价');
  assert.equal(nightAlpha(-60), 1, '-1h = 23:00 夜间');
});

test('clockVars：变量齐全、night_on/day_on 互斥、值域收敛', () => {
  const day = clockVars(at(9, 30));
  assert.equal(day.hour, 9);
  assert.equal(day.night_alpha, 0);
  assert.equal(day.day_on, 1);
  assert.equal(day.night_on, 0);
  const night = clockVars(at(21, 0));
  assert.equal(night.hour, 21);
  assert.equal(night.night_alpha, 1);
  assert.equal(night.night_on, 1);
  assert.equal(night.day_on, 0);
  const edge = clockVars(at(18, 5));
  assert.equal(edge.night_alpha, 0.5, '过渡期给中间值');
  assert.equal(edge.night_on, 0, '过渡期既不算完全夜间');
  assert.equal(edge.day_on, 0, '也不算完全白天');
});

test('clockVars：档位把"昼夜 × 高低档"乘成四个组合（场景无算术，只能喂成品）', () => {
  const pick = (v: Record<string, number>) => ({ hd_on: v.hd_on, night_sd: v.night_sd, night_hd: v.night_hd });
  assert.deepEqual(pick(clockVars(at(12, 0), { hd: false })), { hd_on: 0, night_sd: 0, night_hd: 0 }, '低档白天');
  assert.deepEqual(pick(clockVars(at(21, 0), { hd: false })), { hd_on: 0, night_sd: 1, night_hd: 0 }, '低档夜间');
  assert.deepEqual(pick(clockVars(at(12, 0), { hd: true })), { hd_on: 1, night_sd: 0, night_hd: 0 }, '高档白天（日层由 hd_on 盖住低档日层）');
  assert.deepEqual(pick(clockVars(at(21, 0), { hd: true })), { hd_on: 1, night_sd: 0, night_hd: 1 }, '高档夜间');
  const hdEdge = clockVars(at(18, 5), { hd: true });
  assert.equal(hdEdge.night_hd, 0.5, '高档位过渡期同样给中间值');
  assert.equal(hdEdge.night_sd, 0, '高档位低档夜层必须恒 0，否则两档图会叠在一起');
  assert.equal(clockVars(at(21, 0)).hd_on, 0, '缺省 = 低档');
});

test('clockSig：同分钟稳定、跨分钟变化、切档位也触发', () => {
  assert.equal(clockSig(clockVars(at(12, 0, 0))), clockSig(clockVars(at(12, 0, 59))), '同一分钟内不重复喂');
  assert.notEqual(clockSig(clockVars(at(12, 0))), clockSig(clockVars(at(13, 0))));
  assert.notEqual(clockSig(clockVars(at(18, 4))), clockSig(clockVars(at(18, 6))), '过渡期每个分钟级变化都生效');
  assert.notEqual(clockSig(clockVars(at(12, 0), { hd: true })), clockSig(clockVars(at(12, 0), { hd: false })), '切档位要能喂出去');
});

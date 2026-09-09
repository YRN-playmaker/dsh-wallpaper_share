/**
 * 播放时钟（design-runtime.md §4，R3）——web 层唯一读墙钟处（core/gl 不读）。
 * 累加器把 RAF 的 dt 折成单调 t；单帧钳制防"死亡螺旋"（切后台回来 dt 巨大时不硬追）。
 * 纯逻辑，Node 可测；不碰 DOM。
 */
export interface Clock {
  t: number;          // 当前时间（秒）
  playing: boolean;
  maxStep: number;    // 单帧最大推进（秒），超出钳制（后台/卡顿保护）
}

export function createClock(opts: { t0?: number; playing?: boolean; maxStep?: number } = {}): Clock {
  return { t: opts.t0 ?? 0, playing: opts.playing ?? true, maxStep: opts.maxStep ?? 0.25 };
}

/** 按真实经过 dt 推进；返回本帧实际 t。playing=false 时冻结。 */
export function advance(clock: Clock, dt: number): number {
  if (clock.playing) clock.t += Math.min(Math.max(dt, 0), clock.maxStep);
  return clock.t;
}

/** 直接跳转（scrub / seek / 快照定位）：不受 maxStep 约束。 */
export function seek(clock: Clock, t: number): number {
  clock.t = Math.max(0, t);
  return clock.t;
}

export function play(clock: Clock): void { clock.playing = true; }
export function pause(clock: Clock): void { clock.playing = false; }

/**
 * plan 对象池（design-runtime.md §2，R1.6）：编辑器/宿主 60fps 下 evaluate 零热分配。
 * 双缓冲交替——执行器消费 plan N 时，core 正在写 N+1；N-1 可安全回收。
 * 契约：池化 plan 的 steps/verts 在 acquire 两次后失效（文档化，非运行时强制）。
 */
import type { RenderStep } from './types.ts';

export interface PlanSlot {
  steps: RenderStep[];
  unsupported: Array<{ id: string; reason: string }>;
  vertBufs: Float32Array[];       // 全部长度 8（quad 顶点）
  nVerts: number;
}

export interface PlanPool {
  acquire(): PlanSlot;
  readonly slots: PlanSlot[];
}

export function createPool(size = 2): PlanPool {
  const slots: PlanSlot[] = Array.from({ length: size }, () => ({
    steps: [], unsupported: [], vertBufs: [], nVerts: 0,
  }));
  let i = 0;
  return {
    slots,
    acquire() {
      const s = slots[i % slots.length];
      i++;
      s.steps.length = 0;
      s.unsupported.length = 0;
      s.nVerts = 0;
      return s;
    },
  };
}

/** 从槽取一块 quad 顶点缓冲并填充（中心原点，视口px）。 */
export function slotVerts(s: PlanSlot, w: number, h: number): Float32Array {
  let b = s.vertBufs[s.nVerts];
  if (!b) b = s.vertBufs[s.nVerts] = new Float32Array(8);
  s.nVerts++;
  const hw = w / 2, hh = h / 2;
  b[0] = -hw; b[1] = -hh; b[2] = hw; b[3] = -hh; b[4] = hw; b[5] = hh; b[6] = -hw; b[7] = hh;
  return b;
}

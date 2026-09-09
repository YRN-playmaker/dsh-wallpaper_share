/**
 * DWP 1.0 协议类型 —— 与 dwp-spec/schemas/*.json 逐字段对齐。
 * 数值/颜色字段允许 "$变量名" 字符串（协议 §2/§4：直接替换，无表达式）。
 */

export type DwpNum = number | string;            // string 仅允许 "$name" 形式
export type DwpColor = string | number;          // "#rgb|#rgba|#rrggbb|#rrggbbaa" | "rgba(...)" | "$name"
export type Vec2 = [number, number];

export type BlendName =
  | 'normal' | 'lighter' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten'
  | 'color-dodge' | 'soft-light' | 'hard-light' | 'difference' | 'exclusion';

export type EffectName =
  | 'waterwaves' | 'waterripple' | 'shake' | 'scroll' | 'tint' | 'pulse' | 'filmgrain'
  | 'opacity' | 'vignette' | 'chromatic' | 'blur';

export type AnimProperty =
  | 'offset.x' | 'offset.y' | 'scale' | 'scale.x' | 'scale.y' | 'rotation' | 'alpha'
  | 'size.w' | 'size.h' | 'uvOffset' | 'color';

// ---------- 清单 ----------

export interface ParamDef {
  key: string;
  kind: 'slider' | 'color' | 'toggle' | 'select';
  label?: Record<string, string>;
  default: number | string | boolean;
  min?: number; max?: number; step?: number;
  options?: string[];
}

export interface Manifest {
  format: 'dwp/1.0';
  id: string;
  version: string;
  name: Record<string, string>;
  author?: { name?: string; github?: string; email?: string };
  license: string;
  rating: 'general' | 'mature';
  type: 'image' | 'video' | 'web' | 'scene';
  entry: string;
  preview: string;
  previewMotion?: string;
  resolution?: Vec2;
  tags?: string[];
  requires?: { features?: string[] };
  params?: ParamDef[];
  commercial?: {
    sale: 'itchio' | 'afdian' | 'gumroad' | 'lemonsqueezy' | 'other';
    slug: string;
    price: Record<string, number>;
    licenseText: string;
  };
}

// ---------- 场景 ----------

export interface Scene {
  canvas: { width: number; height: number; fit?: 'cover' | 'contain' | 'stretch'; background?: DwpColor };
  loop?: number;
  variables?: Record<string, number | string | boolean>;
  layers: Layer[];
  effects?: Effect[];
}

export interface Animation {
  kind: 'keyframes' | 'oscillate' | 'scroll';
  property?: AnimProperty;                       // oscillate/scroll 必填（clip 轨道内由 track key 提供，可省略）
  amplitude?: number; period?: number; phase?: number;   // oscillate
  perSecond?: number; wrap?: number;                    // scroll
  tracks?: Record<string, KeyframeTrack>;               // keyframes（图层多轨形态）
  // keyframes（clip 单轨直写形态，协议 §4.5 示例）：
  easing?: string; loop?: boolean; frames?: Array<[number, number | string]>;
}

export interface KeyframeTrack {
  easing?: string;                                // linear | ease | ease-in | ease-in-out | cubic-bezier(a,b,c,d)
  loop?: boolean;
  frames: Array<[number, number | string]>;       // [秒, 值]；值可 "$var"
}

export interface Bone { name: string; parent?: string | null; bind?: { offset?: Vec2; rotation?: number } }
export interface Part {
  src: string; bone: string; offset?: Vec2; rotation?: number; order?: number; alpha?: number;
  mesh?: { positions: number[]; uvs: number[]; indices: number[]; weights: number[][][] };
}
export interface Clip {
  name: string; active?: boolean; loop?: boolean;
  tracks: Record<string, Animation>;              // "bone.prop"
}

export interface Layer {
  id: string;
  type: 'image' | 'video' | 'solid' | 'text' | 'particle' | 'mesh';
  // 通用变换（协议 §3：anchor=视口归一化，offset/size=设计像素）
  anchor?: Vec2; offset?: Vec2; size?: Vec2 | null; origin?: Vec2;
  rotation?: DwpNum | { spin?: [DwpNum, DwpNum]; alignToVelocity?: boolean };
  scale?: DwpNum; alpha?: DwpNum; blend?: BlendName; parallax?: number; visible?: boolean;
  animation?: Animation;
  // 类型专属
  src?: string; texture?: string; radius?: number; color?: DwpColor;
  value?: string; font?: string; loop?: boolean; muted?: boolean;
  emitter?: { shape: 'box' | 'point'; size?: Vec2; rate?: DwpNum; burst?: number };
  life?: [number, number];
  velocity?: { direction?: DwpNum; spread?: number; speed?: [DwpNum, DwpNum] };
  rotationOverLife?: [DwpNum, DwpNum];
  sizeOverLife?: Array<[number, number]>;
  alphaOverLife?: Array<[number, number]>;
  colorOverLife?: DwpColor[];
  gravity?: number; drag?: number; maxCount?: number; seed?: number;
  bones?: Bone[]; parts?: Part[]; clips?: Clip[];
}

export interface Effect { type: EffectName; target: string; params?: Record<string, unknown> }

// ---------- RenderPlan v1（core ↔ 执行器契约，design-runtime.md §2） ----------

export type Mat6 = [number, number, number, number, number, number]; // a,b,c,d,e,f（DOMMatrix 序）
export type RGBA = [number, number, number, number];                  // 0..1

export interface RenderPlan {
  planVersion: 1;
  view: Mat6;                       // 视口px→裁剪空间（含 dpr；anchor/fit 已折进各 step 矩阵）
  clear: RGBA;
  steps: RenderStep[];
  unsupported: Array<{ id: string; reason: string }>;   // 未实现能力显式上报（不静默丢层）
}

export type RenderStep =
  | { op: 'quad'; layer: string; tex: string; verts: Float32Array; uv: Float32Array
      matrix: Mat6; blend: BlendName; alpha: number; tint?: RGBA; uvOffset?: [number, number] }
  | { op: 'text'; layer: string; run: TextRun; blend: BlendName; alpha: number }
  | { op: 'particles'; layer: string; tex: string; buffer: Float32Array; count: number; stride: number
      blend: BlendName; colorA: string; colorB: string }
  | { op: 'pass'; effect: EffectName; template: string; params: Record<string, number | number[]>
      inputs: string[]; target: string };

export interface TextRun {
  text: string; font: string; sizePx: number; weight?: number; color: RGBA;
  align: 'left' | 'center' | 'right'; baseline: 'top' | 'middle' | 'bottom';
  matrix: Mat6; letterSpacing?: number;
}

export interface Viewport { w: number; h: number }
export interface TimeContext {
  year: number; month: number; day: number;        // month 1..12
  hour: number; minute: number; second: number;
  weekday: string;                                  // 'Mon'…'Sun'
}
export interface FrameInput {
  t: number;
  viewport: Viewport;
  dpr?: number;
  timeContext?: TimeContext;                             // 缺省 = 占位符显示样例值（确定性）
  assetSizes?: Record<string, { w: number; h: number }>; // size:null 的纹理自然尺寸（宿主探测注入）
}

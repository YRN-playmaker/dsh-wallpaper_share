/**
 * GLSL ES 3.0 模板（design-runtime.md §3.3，R2）——gl 侧只有这些固定模板，
 * 不解释第三方 shader（协议护栏）。core 侧展开表产出的 template 名与此一一对应。
 * 预乘 alpha 空间（协议 §5.3）。
 */

/** 全屏三角形 VS：所有 post pass 共用，输出 uv∈[0,1]。 */
export const FS_QUAD_VS = `#version 300 es
precision highp float;
out vec2 vUv;
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// ---------- 图层 quad（直接混合族） ----------

export const QUAD_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
layout(location=1) in vec2 aUv;
uniform mat3 uView;   // 视口px -> clip（含 dpr + 相机 scroll/shake）
uniform mat3 uMtx;    // 图层局部矩阵（anchor/fit/动画/骨骼）
out vec2 vUv;
void main(){ vec3 c = uView * uMtx * vec3(aPos, 1.0); gl_Position = vec4(c.xy, 0.0, c.z); vUv = aUv; }`;

export const QUAD_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec4 uTint;        // 预乘色（solid 用纯 tint，image 用 #ffffff 直通）
uniform float uAlpha;
uniform vec2 uUvOffset;    // scroll 动画的 UV 平移
out vec4 o;
void main(){
  vec4 c = texture(uTex, vUv + uUvOffset);
  o = vec4(c.rgb * uTint.rgb, c.a * uTint.a) * uAlpha;
}`;

// ---------- 粒子（实例化 quad） ----------

export const PARTICLES_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;   // 单位四边形 ±0.5
layout(location=1) in vec4 aA;        // x,y,rot,sizeW
layout(location=2) in vec4 aB;        // sizeH,alpha,life01,reserved
uniform mat3 uView;
out vec2 vUv;
out float vLife;
out float vAlpha;
void main(){
  float r = radians(aA.z);
  float cs = cos(r), sn = sin(r);
  vec2 local = vec2(aCorner.x * aA.w, aCorner.y * aB.x);
  vec2 rot = vec2(local.x * cs - local.y * sn, local.x * sn + local.y * cs);
  vec3 c = uView * vec3(rot.x + aA.x, rot.y + aA.y, 1.0);
  gl_Position = vec4(c.xy, 0.0, c.z);
  vUv = aCorner + 0.5;
  vLife = aB.z;
  vAlpha = aB.y;
}`;

export const PARTICLES_FS = `#version 300 es
precision highp float;
in vec2 vUv;
in float vLife;
in float vAlpha;
uniform sampler2D uTex;
uniform vec4 uColorA;
uniform vec4 uColorB;
out vec4 o;
void main(){
  vec4 t = texture(uTex, vUv);
  vec3 col = mix(uColorA.rgb, uColorB.rgb, vLife);
  o = vec4(t.rgb * col, t.a) * (vAlpha * uColorA.a);
}`;

// ---------- post pass 模板（core 展开表 → 这些） ----------

/** distort：waterwaves(mode0 正弦)/waterripple(mode1 径向)。 */
export const DISTORT_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform float uAmp;      // 视口px
uniform float uFreq;     // 角频率
uniform float uSpeed;
uniform float uT;
uniform float uMode;     // 0=waves 1=ripple
uniform vec2 uRes;
out vec4 o;
void main(){
  vec2 d = vUv - 0.5;
  float phase = uT * uSpeed;
  float off;
  if (uMode < 0.5) off = sin(vUv.y * uFreq * uRes.y + phase);
  else off = sin(length(d) * uFreq * uRes.y - phase);
  vec2 uv = vUv + vec2(off * uAmp / uRes.x, off * uAmp * 0.5 / uRes.y);
  o = texture(uSrc, clamp(uv, 0.0, 1.0));
}`;

/** blurDown：2× downsample（4 tap 盒）。 */
export const BLUR_DOWN_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uTexel;
out vec4 o;
void main(){
  vec4 s = texture(uSrc, vUv + uTexel * vec2(-1,-1)) + texture(uSrc, vUv + uTexel * vec2(1,-1))
         + texture(uSrc, vUv + uTexel * vec2(-1,1)) + texture(uSrc, vUv + uTexel * vec2(1,1));
  o = s * 0.25;
}`;

/** 可分离高斯 X/Y（5 tap）。 */
function gauss(axis: 'x' | 'y'): string {
  const step = axis === 'x' ? 'vec2(1.0,0.0)' : 'vec2(0.0,1.0)';
  return `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uRadius;
out vec4 o;
void main(){
  vec2 d = uTexel * ${step} * uRadius;
  o = texture(uSrc, vUv) * 0.2270270270
    + (texture(uSrc, vUv + d) + texture(uSrc, vUv - d)) * 0.1945945946
    + (texture(uSrc, vUv + d * 2.0) + texture(uSrc, vUv - d * 2.0)) * 0.1216216216
    + (texture(uSrc, vUv + d * 3.0) + texture(uSrc, vUv - d * 3.0)) * 0.0540540541
    + (texture(uSrc, vUv + d * 4.0) + texture(uSrc, vUv - d * 4.0)) * 0.0162162162;
}`;
}
export const BLUR_X_FS = gauss('x');
export const BLUR_Y_FS = gauss('y');

/** blurCombine：半分辨率模糊结果上采样回全屏（双线性）。 */
export const BLUR_COMBINE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
out vec4 o;
void main(){ o = texture(uSrc, vUv); }`;

/** chromatic：RGB 三通道径向色散。 */
export const CHROMATIC_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform float uStrength;
out vec4 o;
void main(){
  vec2 d = (vUv - 0.5) * uStrength;
  o = vec4(texture(uSrc, vUv + d).r, texture(uSrc, vUv).g, texture(uSrc, vUv - d).b, 1.0);
}`;

/** overlay 族（kind 0=vignette 1=filmgrain 2=tint 3=pulse）。 */
export const OVERLAY_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform float uKind;
uniform float uIntensity;
uniform float uSpeed;
uniform float uT;
uniform float uMix;
uniform float uBrightness;
uniform vec4 uColor;
out vec4 o;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
void main(){
  vec4 c = texture(uSrc, vUv);
  if (uKind < 0.5) {
    vec2 q = (vUv - 0.5) * 2.0;
    float v = 1.0 - dot(q, q) * uIntensity;
    o = vec4(mix(uColor.rgb, c.rgb, clamp(v, 0.0, 1.0)) * mix(1.0, v, uColor.a), c.a);
  } else if (uKind < 1.5) {
    float g = hash(floor(vUv * 512.0) + floor(uT * uSpeed));
    o = vec4(c.rgb + (g - 0.5) * uIntensity, c.a);
  } else if (uKind < 2.5) {
    o = vec4(mix(c.rgb, uColor.rgb, uMix), c.a);
  } else {
    o = vec4(c.rgb * uBrightness, c.a);
  }
}`;

/** compositeBlend：把已渲染到 RT 的图层（预乘）按 CSS 非分离混合合成到场景。 */
export const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;   // 图层（预乘）
uniform sampler2D uDst;   // 场景（预乘）
uniform int uMode;        // 0=overlay 1=color-dodge 2=soft-light 3=hard-light 4=difference 5=exclusion
out vec4 o;
vec3 blendOverlay(vec3 s, vec3 d){ return d <= 0.5 ? 2.0*s*d : 1.0 - 2.0*(1.0-s)*(1.0-d); }
vec3 blendDodge(vec3 s, vec3 d){ return min(d / max(1.0 - s, 1e-4), 1.0); }
vec3 blendHardLight(vec3 s, vec3 d){ return blendOverlay(d, s); }
vec3 blendSoftLight(vec3 s, vec3 d){
  return (1.0 - 2.0*s) * d + 2.0 * s * mix(sqrt(d)*abs(d-0.5)+0.5-d, ((16.0*d-12.0)*d+4.0)*d, step(0.25, d));
}
void main(){
  vec4 S = texture(uSrc, vUv);
  vec4 D = texture(uDst, vUv);
  vec3 s = S.rgb, d = D.rgb;
  vec3 cb;
  if (uMode == 0) cb = blendOverlay(s, d);
  else if (uMode == 1) cb = blendDodge(s, d);
  else if (uMode == 2) cb = blendSoftLight(s, d);
  else if (uMode == 3) cb = blendHardLight(s, d);
  else if (uMode == 4) cb = abs(d - s);
  else cb = d + s - 2.0 * d * s;   // exclusion
  // 预乘 alpha 合成：结果 = (1-ad)*src + (1-as)*dst + src*dst 混合
  vec3 outc = (1.0 - D.a) * s + (1.0 - S.a) * d + cb * S.a * D.a;
  o = vec4(outc, S.a + D.a * (1.0 - S.a));
}`;

/** template 名 → 片元源（core 展开表用同名）。 */
export const PASS_FRAGMENTS: Record<string, string> = {
  distort: DISTORT_FS,
  blurDown: BLUR_DOWN_FS,
  blurX: BLUR_X_FS,
  blurY: BLUR_Y_FS,
  blurCombine: BLUR_COMBINE_FS,
  chromatic: CHROMATIC_FS,
  overlay: OVERLAY_FS,
};

//#region src/scene/ScenePuppet.ts
/** 按相对时间 t 在关键帧间线性插值（循环动画自动回卷处理） */
function sampleAnimation(anim, t) {
	const kf = anim.keyframes;
	if (kf.length === 0) return null;
	if (kf.length === 1) return {
		values: kf[0].values,
		t: kf[0].t
	};
	let peak = 0;
	for (let i = 1; i < kf.length; i++) if (kf[i].t > kf[peak].t) peak = i;
	const period = kf[peak].t - kf[0].t;
	if (period <= 0) {
		const n = kf.length;
		const idx = (t % n + n) % n;
		const i0 = Math.floor(idx);
		const frac = idx - i0;
		if (i0 + 1 >= n) return {
			values: kf[i0].values,
			t: i0
		};
		return {
			values: kf[i0].values.map((v, k) => v + (kf[i0 + 1].values[k] - v) * frac),
			t: i0 + frac
		};
	}
	const startT = kf[0].t;
	const curve = [];
	for (let i = 0; i <= peak; i++) curve.push({
		p: kf[i].t - startT,
		values: kf[i].values
	});
	for (let i = peak; i < kf.length; i++) curve.push({
		p: period - (kf[i].t - startT),
		values: kf[i].values
	});
	const mono = [];
	let lastP = -Infinity;
	for (const c of curve) if (c.p >= lastP) {
		mono.push(c);
		lastP = c.p;
	}
	if (mono.length < 2) return {
		values: kf[0].values,
		t: kf[0].t
	};
	const prog = (t % period + period) % period;
	let a = mono[0];
	for (let i = 1; i < mono.length; i++) {
		const b = mono[i];
		if (prog <= b.p) {
			const span = b.p - a.p;
			const frac = span > 0 ? Math.min(1, Math.max(0, (prog - a.p) / span)) : 0;
			return {
				values: a.values.map((v, k) => v + (b.values[k] - v) * frac),
				t: prog + startT
			};
		}
		a = b;
	}
	return {
		values: mono[mono.length - 1].values,
		t: prog + startT
	};
}
/**
* 采样 MDLA0006 新格式（9 列循环交错）某帧的每骨骼世界位姿（parent 链 2D 累乘）。
* 读值异常（越界/非有限/量级过大）的骨骼回退其 MDLS 局部 bind 矩阵（链乘继续，不炸）。
* 与官方引擎一致：角度相加、平移 = 父平移 + Rz(父角度)·局部平移。
*/
function samplePuppetRT(puppet, animIdx, frame) {
	const anim = puppet.animsV2[animIdx];
	if (anim === void 0) return [];
	const bones = puppet.bones;
	const nb = Math.max(bones.length, anim.boneCount);
	const out = new Array(nb);
	const totalFrames = Math.max(1, anim.frameCount);
	const f = (frame % totalFrames + totalFrames) % totalFrames;
	for (let b = 0; b < nb; b++) {
		const bone = bones[b];
		const parent = bone !== void 0 ? bone.parent : -1;
		const base = b * totalFrames * 3 + f * 3;
		const px = anim.localFrames[base];
		const py = anim.localFrames[base + 1];
		const rotZ = anim.localFrames[base + 2];
		if (Number.isFinite(px) && Number.isFinite(py) && Math.abs(px) < 1e4 && Math.abs(py) < 1e4 && Number.isFinite(rotZ)) {
			if (parent >= 0 && parent < nb && out[parent] !== null && out[parent] !== void 0) {
				const pa = out[parent].angle;
				const pc = Math.cos(pa);
				const ps = Math.sin(pa);
				out[b] = {
					angle: pa + rotZ,
					tx: out[parent].tx + px * pc - py * ps,
					ty: out[parent].ty + px * ps + py * pc
				};
			} else out[b] = {
				angle: rotZ,
				tx: px,
				ty: py
			};
		} else {
			const bind = bone !== void 0 ? bone.bind : null;
			if (bind !== null && bind.length >= 16) {
				const ang = Math.atan2(bind[1], bind[0]);
				if (parent >= 0 && parent < nb && out[parent] !== null && out[parent] !== void 0) {
					const pa = out[parent].angle;
					const pc = Math.cos(pa);
					const ps = Math.sin(pa);
					out[b] = {
						angle: pa + ang,
						tx: out[parent].tx + bind[12] * pc - bind[13] * ps,
						ty: out[parent].ty + bind[12] * ps + bind[13] * pc
					};
				} else out[b] = {
					angle: ang,
					tx: bind[12],
					ty: bind[13]
				};
			} else {
				const pr = parent >= 0 && parent < nb ? out[parent] ?? {
					angle: 0,
					tx: 0,
					ty: 0
				} : {
					angle: 0,
					tx: 0,
					ty: 0
				};
				out[b] = {
					angle: pr.angle,
					tx: pr.tx,
					ty: pr.ty
				};
			}
		}
	}
	return out;
}
//#endregion
//#region src/scene/PuppetSkin.ts
function mat4Identity() {
	return [
		1,
		0,
		0,
		0,
		0,
		1,
		0,
		0,
		0,
		0,
		1,
		0,
		0,
		0,
		0,
		1
	];
}
/** 列主序 4×4 乘法：out = a × b */
function mat4Mul(a, b) {
	const o = new Array(16);
	for (let c = 0; c < 4; c++) {
		const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
		for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b0 + a[4 + r] * b1 + a[8 + r] * b2 + a[12 + r] * b3;
	}
	return o;
}
/** 4×4 求逆（伴随矩阵法，支持任意可逆矩阵含非均匀缩放；列主序） */
function mat4Invert(m) {
	const a0 = m[0] * m[5] - m[4] * m[1];
	const a1 = m[0] * m[6] - m[4] * m[2];
	const a2 = m[0] * m[7] - m[4] * m[3];
	const a3 = m[1] * m[6] - m[5] * m[2];
	const a4 = m[1] * m[7] - m[5] * m[3];
	const a5 = m[2] * m[7] - m[6] * m[3];
	const b0 = m[8] * m[13] - m[12] * m[9];
	const b1 = m[8] * m[14] - m[12] * m[10];
	const b2 = m[8] * m[15] - m[12] * m[11];
	const b3 = m[9] * m[14] - m[13] * m[10];
	const b4 = m[9] * m[15] - m[13] * m[11];
	const b5 = m[10] * m[15] - m[14] * m[11];
	const det = a0 * b5 - a1 * b4 + a2 * b3 + a3 * b2 - a4 * b1 + a5 * b0;
	if (Math.abs(det) < 1e-12) return null;
	const id = 1 / det;
	const o = new Array(16);
	o[0] = (m[5] * b5 - m[6] * b4 + m[7] * b3) * id;
	o[1] = (-m[1] * b5 + m[2] * b4 - m[3] * b3) * id;
	o[2] = (m[13] * a5 - m[14] * a4 + m[15] * a3) * id;
	o[3] = (-m[9] * a5 + m[10] * a4 - m[11] * a3) * id;
	o[4] = (-m[4] * b5 + m[6] * b2 - m[7] * b1) * id;
	o[5] = (m[0] * b5 - m[2] * b2 + m[3] * b1) * id;
	o[6] = (-m[12] * a5 + m[14] * a2 - m[15] * a1) * id;
	o[7] = (m[8] * a5 - m[10] * a2 + m[11] * a1) * id;
	o[8] = (m[4] * b4 - m[5] * b2 + m[7] * b0) * id;
	o[9] = (-m[0] * b4 + m[1] * b2 - m[3] * b0) * id;
	o[10] = (m[12] * a4 - m[13] * a2 + m[15] * a0) * id;
	o[11] = (-m[8] * a4 + m[9] * a2 - m[11] * a0) * id;
	o[12] = (-m[4] * b3 + m[5] * b1 - m[6] * b0) * id;
	o[13] = (m[0] * b3 - m[1] * b1 + m[2] * b0) * id;
	o[14] = (-m[12] * a3 + m[13] * a1 - m[14] * a0) * id;
	o[15] = (m[8] * a3 - m[9] * a1 + m[10] * a0) * id;
	return o;
}
/** 4×4 仿射（列主序）：T(x,y,z) × Rz(θ) × S(x,y,z)。平移单位、旋转单位、缩放单位。 */
function mat4TRS(tx, ty, tz, rot, sx, sy, sz) {
	const c = Math.cos(rot);
	const s = Math.sin(rot);
	return [
		c * sx,
		s * sx,
		0,
		0,
		-s * sy,
		c * sy,
		0,
		0,
		0,
		0,
		sz,
		0,
		tx,
		ty,
		tz,
		1
	];
}
/**
* 由欧拉角（弧度，ZYX 顺序：R = Rz × Ry × Rx）构造旋转矩阵（列主序）。
* 0013 老格式动画帧的旋转 3 分量实为欧拉角（弧度）而非四元数——
* 睫毛等大幅旋转分量 |q| 可 > 1（如 -101° ≈ -1.77 rad），四元数解释必然错误。
*/
function mat4FromEuler(rx, ry, rz) {
	const c1 = Math.cos(rx), s1 = Math.sin(rx);
	const c2 = Math.cos(ry), s2 = Math.sin(ry);
	const c3 = Math.cos(rz), s3 = Math.sin(rz);
	return [
		c2 * c3,
		c2 * s3,
		-s2,
		0,
		s1 * s2 * c3 - c1 * s3,
		s1 * s2 * s3 + c1 * c3,
		s1 * c2,
		0,
		c1 * s2 * c3 + s1 * s3,
		c1 * s2 * s3 - s1 * c3,
		c1 * c2,
		0,
		0,
		0,
		0,
		1
	];
}
/** T × R(欧拉角) × S：0013 老格式动画帧 [pos3][euler3][scale3]。 */
function mat4TRSEuler(tx, ty, tz, rx, ry, rz, sx, sy, sz) {
	const R = mat4FromEuler(rx, ry, rz);
	return [
		R[0] * sx,
		R[1] * sx,
		R[2] * sx,
		R[3],
		R[4] * sy,
		R[5] * sy,
		R[6] * sy,
		R[7],
		R[8] * sz,
		R[9] * sz,
		R[10] * sz,
		R[11],
		tx,
		ty,
		tz,
		1
	];
}
/** 变换点：out = M × (x,y,z,1)，返回 [x,y,z]（w 齐次除） */
function mat4TransformPoint(m, x, y, z) {
	const w = m[3] * x + m[7] * y + m[11] * z + m[15];
	const iw = w !== 0 ? 1 / w : 0;
	return [
		(m[0] * x + m[4] * y + m[8] * z + m[12]) * iw,
		(m[1] * x + m[5] * y + m[9] * z + m[13]) * iw,
		(m[2] * x + m[6] * y + m[10] * z + m[14]) * iw
	];
}
/**
* 计算各骨骼蒙皮矩阵 M_skin_i = M_global_i × M_inv_bind_i。
*
* @param binds 各骨骼全局 bind 矩阵（MDLS bind，16 f32 列主序；null = 单位绑定）
* @param animMats 各骨骼动画全局矩阵（同长度；null = 该骨骼静止 → M_skin = I）
* @returns 每骨骼 M_skin（16 f32）或 null（静止/不可逆 → 调用方按原始 pos）
*/
function computeSkinMatrices(binds, animMats) {
	const n = Math.max(binds.length, animMats.length);
	const out = [];
	for (let i = 0; i < n; i++) {
		const anim = animMats[i] ?? null;
		if (anim === null) {
			out.push(null);
			continue;
		}
		const bind = binds[i] ?? null;
		if (bind === null) {
			out.push(anim);
			continue;
		}
		const inv = mat4Invert(bind);
		if (inv === null) {
			out.push(null);
			continue;
		}
		out.push(mat4Mul(anim, inv));
	}
	return out;
}
/**
* 蒙皮一个顶点：skinPos = Σ w_k × M_skin_{boneIdx[k]} × pos。
* 骨骼索引越界/权重为 0 的项跳过；M_skin 为 null（静止骨骼）时该项 = 原始 pos。
* 权重和 < 1 时余量归原始 pos（WE 顶点权重和通常 = 1）。
*/
function skinVertex(pos, weights, boneIndices, skin) {
	let x = 0;
	let y = 0;
	let z = 0;
	let wSum = 0;
	const n = Math.min(weights.length, boneIndices.length, 4);
	for (let k = 0; k < n; k++) {
		const w = weights[k];
		if (!(w > 0)) continue;
		const idx = boneIndices[k];
		const m = idx >= 0 && idx < skin.length ? skin[idx] : null;
		if (m === null) {
			x += w * pos[0];
			y += w * pos[1];
			z += w * pos[2];
		} else {
			const p = mat4TransformPoint(m, pos[0], pos[1], pos[2]);
			x += w * p[0];
			y += w * p[1];
			z += w * p[2];
		}
		wSum += w;
	}
	if (wSum < 1 && wSum > 0) {
		const rem = 1 - wSum;
		x += rem * pos[0];
		y += rem * pos[1];
		z += rem * pos[2];
	}
	return [
		x,
		y,
		z
	];
}
//#endregion
//#region src/client/ParticleRuntime.ts
var ParticleRuntime = class ParticleRuntime {
	desc;
	rateScale;
	sizeScale;
	particles = [];
	acc = 0;
	time = 0;
	/** 纹理染色缓存（颜色 → 染色 canvas） */
	tintCache = /* @__PURE__ */ new Map();
	/** 渲染器类型（sprite | spritetrail | rope）：决定是否沿速度拉伸 */
	rendererType;
	/** spritetrail 的 length 参数（拖尾时长系数） */
	trailLength;
	/** spritetrail 的 maxlength 参数（拖尾最大长度，场景 px；speed×length 上限） */
	trailMaxLength;
	/** spritetrail 的 minlength 参数（拖尾最小长度，场景 px；速度过低时的下限） */
	trailMinLength;
	/** 控制点线段序列索引（mapsequencebetweencontrolpoints 分布用） */
	seqIndex = 0;
	/** 粒子纹理（由 SceneModelRenderer 加载后注入） */
	texture = null;
	/** spritesheet 帧元数据 */
	frames = 0;
	fw = 0;
	fh = 0;
	/** 子粒子系统（children：如 rain_screen 的 static/fast 子雨滴）；
	*  type="eventfollow" 的子系在父粒子位置生成并跟随父粒子事件 */
	children = [];
	/** 本 runtime 是否为 eventfollow 子系（自身不独立发射，只响应父粒子事件） */
	eventFollow = false;
	/** instantaneous 一次性爆发是否已生成（rate=0 + instantaneous 的系统只爆发一次） */
	instantSpawned = false;
	/** 折射法线纹理（材质第二个纹理，REFRACT 粒子用；RG88/RGBA8888n 布局通用解压 (a,g)） */
	normalTexture = null;
	normalFrames = 0;
	normalFw = 0;
	normalFh = 0;
	constructor(desc, rateScale = 1, sizeScale = 1, eventFollow = false) {
		this.desc = desc;
		this.rateScale = rateScale;
		this.sizeScale = sizeScale;
		this.rendererType = desc.renderer?.type ?? "sprite";
		this.trailLength = desc.renderer?.length ?? 0;
		this.trailMaxLength = desc.renderer?.maxlength ?? 0;
		this.trailMinLength = desc.renderer?.minlength ?? 0;
		this.eventFollow = eventFollow;
		for (const c of desc.children) this.children.push({
			rt: new ParticleRuntime(c.desc, rateScale, sizeScale, c.type === "eventfollow"),
			type: c.type
		});
	}
	/** WE Start Time 语义：创建时预模拟（非延迟启动），避免开场空屏。
	*  由 SceneModelRenderer 在根 runtime 上调用一次；子 runtime 随父 update 自然推进。 */
	preSimulate() {
		const target = this.desc.startTime;
		if (target <= 0) return;
		const step = 1 / 30;
		let t = 0;
		while (t < target) {
			const dt = Math.min(step, target - t);
			this.update(dt);
			t += dt;
		}
	}
	/** SceneModelRenderer 加载纹理后注入（含 spritesheet 帧元数据） */
	setTexture(tex, frames = 0, fw = 0, fh = 0) {
		this.texture = tex;
		this.frames = frames;
		this.fw = fw;
		this.fh = fh;
	}
	/** 注入折射法线纹理（REFRACT 材质第二个纹理） */
	setNormalTexture(tex, frames = 0, fw = 0, fh = 0) {
		this.normalTexture = tex;
		this.normalFrames = frames;
		this.normalFw = fw;
		this.normalFh = fh;
	}
	/** 递归收集自身及所有子 runtime（供 SceneModelRenderer 逐层加载纹理） */
	collect() {
		const out = [];
		const walk = (rt) => {
			if (rt.desc.textureNames.length > 0) out.push({
				rt,
				texName: rt.desc.textureNames[0],
				normalName: rt.desc.refract && rt.desc.textureNames.length > 1 ? rt.desc.textureNames[1] : null
			});
			for (const c of rt.children) walk(c.rt);
		};
		walk(this);
		return out;
	}
	/** 纹理是否已就绪（自身或任一子 runtime）——用于区分"无粒子"与"纹理未加载" */
	get textureReady() {
		if (this.texture !== null) return true;
		for (const c of this.children) if (c.rt.textureReady) return true;
		return false;
	}
	/** 释放纹理（ImageBitmap.close）并递归子 runtime */
	dispose() {
		if (this.texture !== null && "close" in this.texture) try {
			this.texture.close();
		} catch {}
		this.texture = null;
		if (this.normalTexture !== null && "close" in this.normalTexture) try {
			this.normalTexture.close();
		} catch {}
		this.normalTexture = null;
		for (const c of this.children) c.rt.dispose();
	}
	/** 是否存在 rope/ropetrail 线渲染器（需 Canvas 绘制，不能走 WebGL 实例化） */
	hasLineRenderer() {
		if (this.rendererType === "rope" || this.rendererType === "ropetrail") return true;
		return this.children.some((c) => c.rt.hasLineRenderer());
	}
	/**
	* 收集 sprite/spritetrail 粒子为 WebGL 实例化批次（每个 runtime 一个批次，
	* 含纹理/帧/混合/折射信息；rope/ropetrail 由调用方走 Canvas）。
	* 变换与 Canvas draw 一致：屏幕 x = px0 + p.x·lx·s，y = py0 − p.y·ly·s，
	* 尺寸不乘对象 scale；spritetrail 沿速度方向拉伸。
	* 官方 quad 语义（genericparticle.vert ComputeParticlePosition）：
	*   quad 宽度 = size，高度 = size × textureRatio（h/w），quad 居中于粒子。
	*/
	collectGl(lx, ly, px0, py0, s, angle = 0) {
		const out = [];
		const walk = (rt) => {
			if (rt.texture !== null && rt.rendererType !== "rope" && rt.rendererType !== "ropetrail") {
				const tex = rt.texture;
				const frames = rt.frames;
				const fw = rt.fw;
				const fh = rt.fh;
				const texRatio = frames > 1 && fw > 0 && fh > 0 ? fh > 0 ? fh / fw : 1 : tex.height > 0 ? tex.height / tex.width : 1;
				const list = [];
				const ca = Math.cos(angle);
				const sa = Math.sin(angle);
				for (const p of rt.particles) {
					const df = rt.desc.perspective ? rt.depthFactor(p) : 1;
					const rx = p.x * ca - p.y * sa;
					const ry = p.x * sa + p.y * ca;
					const x = px0 + rx * lx * s * df;
					const y = py0 - ry * ly * s * df;
					const pwBase = Math.max(2, p.size * s * df);
					const pw = pwBase * lx;
					let size = pw;
					let aspect = texRatio * (ly / lx);
					let rot = p.rot + angle;
					let alpha = p.alpha;
					let gx = x;
					let gy = y;
					if (rt.rendererType === "spritetrail") {
						const localSpd = Math.hypot(p.vx, p.vy);
						const rvx = p.vx * ca - p.vy * sa;
						const rvy = p.vx * sa + p.vy * ca;
						const svx = rvx * lx * df;
						const svy = rvy * ly * df;
						const spd = Math.hypot(svx, svy);
						const maxL = rt.trailMaxLength > 0 ? rt.trailMaxLength : Infinity;
						const minL = rt.trailMinLength > 0 ? rt.trailMinLength : 0;
						const stretch = Math.max(minL, Math.min(localSpd * rt.trailLength, maxL));
						const spdScale = localSpd > .001 ? spd / localSpd : 1;
						const streakLen = pwBase * texRatio * stretch * spdScale;
						if (spd > 2 && streakLen > 2) {
							size = pw;
							aspect = streakLen / pw;
							rot = Math.atan2(-svx, svy);
							gx = x;
							gy = y;
						}
					}
					if (rt.desc.refract && rt.rendererType === "spritetrail") alpha *= .5;
					const frac = 1 - p.life / p.maxLife;
					const frame = rt.pickFrame(p, frac, frames);
					list.push({
						x: gx,
						y: gy,
						size,
						rot,
						r: p.color[0],
						g: p.color[1],
						b: p.color[2],
						a: Math.max(0, Math.min(1, alpha)),
						frame,
						aspect
					});
				}
				if (list.length > 0) out.push({
					particles: list,
					tex,
					normalTex: rt.desc.refract ? rt.normalTexture : null,
					frames,
					fw,
					fh,
					additive: rt.desc.blending === "additive",
					refract: rt.desc.refract && rt.rendererType === "sprite",
					refractAmount: rt.desc.refractAmount,
					trail: rt.rendererType === "spritetrail"
				});
			}
			for (const c of rt.children) walk(c.rt);
		};
		walk(this);
		return out;
	}
	get count() {
		return this.particles.length;
	}
	update(dt) {
		this.time += dt;
		const em = this.desc.emitter;
		const ini = this.desc.initializers;
		this.desc.operators;
		if (!this.instantSpawned && !this.eventFollow && em.instantaneous > 0) {
			this.instantSpawned = true;
			for (let i = 0; i < em.instantaneous && this.particles.length < this.desc.maxCount; i++) this.spawn(em, ini);
		}
		const newEvents = [];
		if (this.time >= this.desc.startTime && !this.eventFollow) {
			this.acc += em.rate * this.rateScale * dt;
			while (this.acc >= 1 && this.particles.length < this.desc.maxCount) {
				this.acc -= 1;
				const p = this.spawn(em, ini);
				if (p !== null) newEvents.push(p);
			}
		}
		this.updateParticles(dt);
		for (const c of this.children) if (c.type === "eventfollow" || c.type === "eventspawn") c.rt.eventFollowUpdate(this.particles, newEvents, dt);
		else c.rt.update(dt);
	}
	/**
	* eventfollow 子粒子更新：在父粒子位置生成。
	*  - 瞬时爆发：每个父粒子出生事件在其位置生成 instantaneous 个（如 shootingstarglow=1）
	*  - 连续发射：rate × dt 分布在存活父粒子上（如 rain_screen_fast_child）
	* 子粒子自身仍按各自算子更新（alphafade/sizechange 等），位置继承父粒子出生点。
	*/
	eventFollowUpdate(parents, newEvents, dt) {
		this.time += dt;
		const em = this.desc.emitter;
		const ini = this.desc.initializers;
		if (!this.instantSpawned) this.instantSpawned = true;
		for (const ev of newEvents) for (let i = 0; i < em.instantaneous && this.particles.length < this.desc.maxCount; i++) {
			const o = this.emitterOffset(em);
			this.spawnAt(ini, ev.x + o.x, ev.y + o.y, ev.z + o.z);
		}
		this.acc += em.rate * this.rateScale * dt;
		while (this.acc >= 1 && this.particles.length < this.desc.maxCount) {
			this.acc -= 1;
			const par = parents.length > 0 ? parents[Math.floor(Math.random() * parents.length)] : null;
			const o = this.emitterOffset(em);
			this.spawnAt(ini, (par !== null ? par.x : 0) + o.x, (par !== null ? par.y : 0) + o.y, (par !== null ? par.z : 0) + o.z);
		}
		this.updateParticles(dt);
		for (const c of this.children) if (c.type === "eventfollow" || c.type === "eventspawn") c.rt.eventFollowUpdate(this.particles, [], dt);
		else c.rt.update(dt);
	}
	/** 更新自身粒子：移动 / 算子（重力/阻尼/振荡/尺寸变化/透明度）/ 寿命过滤 */
	updateParticles(dt) {
		const ops = this.desc.operators;
		const g = ops.gravity ?? [
			0,
			0,
			0
		];
		const drag = ops.drag ?? 0;
		const angDrag = ops.angularDrag ?? 0;
		const angForce = ops.angularForce ?? [
			0,
			0,
			0
		];
		const fade = ops.alphaFade;
		const osc = ops.oscillateAlpha;
		const oscPos = ops.oscillatePosition;
		const sizeChanges = ops.sizeChanges ?? [];
		const turb = ops.turbulence;
		for (const p of this.particles) {
			p.life -= dt;
			const frac = 1 - p.life / p.maxLife;
			p.x += p.vx * dt;
			p.y += p.vy * dt;
			p.history.push({
				x: p.x,
				y: p.y
			});
			if (p.history.length > 24) p.history.shift();
			p.vx += g[0] * dt;
			p.vy += g[1] * dt;
			if (drag > 0) {
				p.vx *= Math.max(0, 1 - drag * dt);
				p.vy *= Math.max(0, 1 - drag * dt);
			}
			if (angDrag > 0) p.angVel *= Math.max(0, 1 - angDrag * dt);
			p.angVel += angForce[2] * dt;
			p.rot += p.angVel * dt;
			if (oscPos !== void 0) {
				const sw = Math.sin(this.time * p.oscFreq + p.oscPhase);
				p.x += sw * oscPos.mask[0] * dt;
				p.y += sw * oscPos.mask[1] * dt;
			}
			if (turb !== void 0) {
				const phase = this.time * (turb.speedMin + (turb.speedMax - turb.speedMin) * .5) + p.phase;
				p.x += Math.sin(phase) * turb.scale * 100 * dt;
				p.y += Math.cos(phase * .7) * turb.scale * 100 * dt;
			}
			let a = p.spawnAlpha;
			let fadeFactor = 1;
			if (fade !== void 0) {
				const fadeIn = (fade.fadeIn ?? 0) / p.maxLife;
				const fadeOut = (fade.fadeOut ?? 0) / p.maxLife;
				if (fadeIn > 0 && frac < fadeIn) fadeFactor = Math.min(fadeFactor, frac / fadeIn);
				if (fadeOut > 0) {
					const tail = 1 - frac;
					if (tail < fadeOut) fadeFactor = Math.min(fadeFactor, tail / fadeOut);
				}
			}
			a *= fadeFactor;
			if (osc !== void 0) {
				const s = Math.sin(this.time * osc.frequencyMax * Math.PI * 2 + p.phase);
				a *= osc.scaleMin + (1 - osc.scaleMin) * Math.max(0, s);
			}
			for (const sc of sizeChanges) if (frac >= sc.startTime) {
				const span = Math.max(1e-4, (sc.endTime ?? 1) - sc.startTime);
				const t = Math.min(1, Math.max(0, (frac - sc.startTime) / span));
				p.size = p.baseSize * (sc.startValue + (sc.endValue - sc.startValue) * t);
			}
			p.alpha = Math.max(0, Math.min(1, a));
		}
		this.particles = this.particles.filter((p) => p.life > 0);
	}
	/**
	* 绘制（局部坐标 → 世界变换 → 画布）。
	* 混合模式按材质 blending：translucent → alpha 混合（source-over，雾/雪等半透明）；
	* additive → 'lighter'（光效/火花）。t 为图层世界变换（含 parent 合并）。
	* 粒子局部 y 向上 → 绘制时翻转。粒子颜色按 colorrandom 染色（缓存染色纹理）。
	* spritesheet 序列帧（frames>1）：按粒子年龄取帧（出生随机相位），从位图中裁剪
	* 对应帧区域绘制——避免整张 8×8 帧矩阵被画出来（雾/烟 64 帧序列纹理）。
	*/
	draw(ctx, ox, oy, s, t, bg = null, angle = 0) {
		const tex = this.texture;
		const frames = this.frames;
		const fw = this.fw;
		const fh = this.fh;
		const lx = t.sx;
		const ly = t.sy;
		const px0 = ox + t.ox * s;
		const py0 = oy + t.oy * s;
		if (tex !== null) this.drawSelf(ctx, ox, oy, s, t, tex, frames, fw, fh, lx, ly, px0, py0, bg, angle);
		for (const c of this.children) c.rt.draw(ctx, ox, oy, s, t, bg, angle);
	}
	/** 该粒子系统（含子粒子）是否使用折射材质 */
	hasRefract() {
		return this.desc.refract || this.children.some((c) => c.rt.hasRefract());
	}
	/** 绘制自身粒子（tex 非空时） */
	drawSelf(ctx, ox, oy, s, t, tex, frames, fw, fh, lx, ly, px0, py0, bg, angle = 0) {
		const additive = this.desc.blending === "additive";
		const sprite = frames > 1 && fw > 0 && fh > 0;
		const cols = sprite ? Math.max(1, Math.floor(tex.width / fw)) : 1;
		const ca = Math.cos(angle);
		const sa = Math.sin(angle);
		ctx.save();
		if (additive) ctx.globalCompositeOperation = "lighter";
		if (this.rendererType === "rope") {
			const pts = this.particles;
			if (pts.length >= 2) for (let i = 1; i < pts.length; i++) {
				const a = pts[i - 1];
				const b = pts[i];
				const arx = a.x * ca - a.y * sa;
				const ary = a.x * sa + a.y * ca;
				const brx = b.x * ca - b.y * sa;
				const bry = b.x * sa + b.y * ca;
				const ax = px0 + arx * lx * s;
				const ay = py0 - ary * ly * s;
				const bx = px0 + brx * lx * s;
				const by = py0 - bry * ly * s;
				const dx = bx - ax;
				const dy = by - ay;
				const segLen = Math.hypot(dx, dy);
				if (segLen < .5) continue;
				const img = this.tinted(tex, b.color);
				ctx.save();
				ctx.translate(ax, ay);
				ctx.rotate(Math.atan2(dy, dx));
				ctx.globalAlpha = Math.max(0, Math.min(1, b.alpha));
				const w = Math.max(1, b.size * s);
				ctx.drawImage(img, 0, 0, tex.width, tex.height, -segLen / 2, -w / 2, segLen, w);
				ctx.restore();
			}
			ctx.restore();
			return;
		}
		if (this.rendererType === "ropetrail") {
			for (const p of this.particles) {
				const hist = p.history;
				if (hist.length < 2) continue;
				const img = this.tinted(tex, p.color);
				const w = Math.max(1, p.size * s);
				for (let hi = 1; hi < hist.length; hi++) {
					const a = hist[hi - 1];
					const b = hist[hi];
					const arx = a.x * ca - a.y * sa;
					const ary = a.x * sa + a.y * ca;
					const brx = b.x * ca - b.y * sa;
					const bry = b.x * sa + b.y * ca;
					const ax = px0 + arx * lx * s;
					const ay = py0 - ary * ly * s;
					const bx = px0 + brx * lx * s;
					const by = py0 - bry * ly * s;
					const dx = bx - ax;
					const dy = by - ay;
					const segLen = Math.hypot(dx, dy);
					if (segLen < .5) continue;
					ctx.save();
					ctx.translate(ax, ay);
					ctx.rotate(Math.atan2(dy, dx));
					ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha));
					ctx.drawImage(img, 0, 0, tex.width, tex.height, 0, -w / 2, segLen, w);
					ctx.restore();
				}
			}
			ctx.restore();
			return;
		}
		let drawn = 0;
		const DRAW_LIMIT = 400;
		for (const p of this.particles) {
			if (drawn >= DRAW_LIMIT) break;
			drawn++;
			const df = this.desc.perspective ? this.depthFactor(p) : 1;
			const x = px0 + (p.x * ca - p.y * sa) * lx * s * df;
			const y = py0 - (p.x * sa + p.y * ca) * ly * s * df;
			const pwBase = Math.max(2, p.size * s * df);
			const fwPx = sprite ? fw : tex.width;
			const texRatio = (sprite ? fh : tex.height) / fwPx;
			const pw = pwBase * lx;
			const ph = pwBase * texRatio * ly;
			const img = this.tinted(tex, p.color);
			ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha));
			if (this.desc.refract && bg !== null && this.rendererType === "sprite") {
				ctx.save();
				const off = pw * .06;
				ctx.drawImage(bg, x - pw / 2 + off, y - ph / 2 + off, pw, ph, x - pw / 2, y - ph / 2, pw, ph);
				ctx.globalCompositeOperation = "destination-in";
				ctx.drawImage(img, x - pw / 2, y - ph / 2, pw, ph);
				ctx.restore();
				continue;
			}
			if (this.desc.refract && this.rendererType === "spritetrail") ctx.globalAlpha *= .5;
			const localSpd = Math.hypot(p.vx, p.vy);
			const svx = p.vx * lx * df;
			const svy = p.vy * ly * df;
			const spd = Math.hypot(svx, svy);
			const maxL = this.trailMaxLength > 0 ? this.trailMaxLength : Infinity;
			const minL = this.trailMinLength > 0 ? this.trailMinLength : 0;
			const stretch = Math.max(minL, Math.min(localSpd * this.trailLength, maxL));
			const spdScale = localSpd > .001 ? spd / localSpd : 1;
			const streakLen = pwBase * texRatio * stretch * spdScale;
			if (this.rendererType === "spritetrail" && spd > 2 && streakLen > 2) {
				const len = streakLen;
				const wid = pw;
				const ang = Math.atan2(svx, svy);
				ctx.save();
				ctx.translate(x, y);
				ctx.rotate(ang);
				if (sprite) {
					const frac = 1 - p.life / p.maxLife;
					const frame = this.pickFrame(p, frac, frames);
					const col = frame % cols;
					const row = Math.floor(frame / cols);
					ctx.drawImage(img, col * fw, row * fh, fw, fh, -wid / 2, -len / 2, wid, len);
				} else ctx.drawImage(img, -wid / 2, -len / 2, wid, len);
				ctx.restore();
			} else if (p.rot !== 0) {
				ctx.save();
				ctx.translate(x, y);
				ctx.rotate(p.rot + angle);
				if (sprite) {
					const frac = 1 - p.life / p.maxLife;
					const frame = this.pickFrame(p, frac, frames);
					const col = frame % cols;
					const row = Math.floor(frame / cols);
					ctx.drawImage(img, col * fw, row * fh, fw, fh, -pw / 2, -ph / 2, pw, ph);
				} else ctx.drawImage(img, -pw / 2, -ph / 2, pw, ph);
				ctx.restore();
			} else if (sprite) {
				const frac = 1 - p.life / p.maxLife;
				const frame = this.pickFrame(p, frac, frames);
				const col = frame % cols;
				const row = Math.floor(frame / cols);
				ctx.drawImage(img, col * fw, row * fh, fw, fh, x - pw / 2, y - ph / 2, pw, ph);
			} else ctx.drawImage(img, x - pw / 2, y - ph / 2, pw, ph);
		}
		ctx.restore();
	}
	/** 纹理染色（source-in 保留 alpha），按颜色缓存 */
	/**
	* 帧选择（官方 genericparticle.vert ComputeSpriteFrame）：
	*  - randomframe：粒子出生随机帧后固定（静态水珠/雨滴）
	*  - 序列（默认，animationmode null/""/sequence）：从第 0 帧开始按寿命推进，
	*    速度 × sequenceMultiplier（particles-general "Sequence multiplier"）。
	*    旧实现给序列模式加随机起始帧 → 雾/烟每团动画相位错乱，此处修正。
	*/
	/**
	* 透视深度因子（perspective rendering — particles-general "Perspective rendering"）。
	* 2D 场景中粒子按 z 深度近大远小：depthFactor = 1 / (1 + max(0, -z) / focal)，
	* 其中 focal = (场景高/2) / tan(fov/2)，z 负 = 场景方向（远）。
	* 粒子位置（向层中心收缩）、尺寸、速度统一 × depthFactor。
	*/
	depthFactor(p) {
		const depth = Math.max(0, -p.z);
		return this.desc.perspectiveFocal / (this.desc.perspectiveFocal + depth);
	}
	pickFrame(p, frac, frames) {
		if (this.desc.animationMode === "randomframe") return p.frame % frames;
		const mult = this.desc.sequenceMultiplier > 0 ? this.desc.sequenceMultiplier : 1;
		const idx = Math.floor(frac * frames * mult);
		return Math.max(0, Math.min(frames - 1, idx));
	}
	tinted(tex, color) {
		const key = color[0] + "," + color[1] + "," + color[2];
		const hit = this.tintCache.get(key);
		if (hit !== void 0) return hit;
		const c = document.createElement("canvas");
		c.width = tex.width;
		c.height = tex.height;
		const g = c.getContext("2d");
		if (g !== null) {
			g.drawImage(tex, 0, 0);
			g.globalCompositeOperation = "multiply";
			g.fillStyle = "rgb(" + color[0] + "," + color[1] + "," + color[2] + ")";
			g.fillRect(0, 0, c.width, c.height);
			g.globalCompositeOperation = "destination-in";
			g.drawImage(tex, 0, 0);
		}
		this.tintCache.set(key, c);
		return c;
	}
	/** 发射器随机位置（发射区 + origin，含 sign 符号限制）→ spawnAt（返回生成的粒子） */
	spawn(em, ini) {
		let x = 0;
		let y = 0;
		if (this.desc.controlPointLine !== null && this.desc.sequenceCount > 0) {
			const [cpx, cpy] = this.desc.controlPointLine;
			const n = Math.max(1, Math.round(this.desc.sequenceCount));
			const period = this.desc.sequenceMirror ? Math.max(1, 2 * (n - 1)) : n;
			const idx = this.seqIndex % period;
			const pos = this.desc.sequenceMirror ? idx <= n - 1 ? idx : period - idx : idx;
			const t = n > 1 ? pos / (n - 1) : 0;
			x = cpx * t;
			y = cpy * t;
			this.seqIndex++;
		} else {
			const o = this.emitterOffset(em);
			x = o.x;
			y = o.y;
			const z = o.z;
			return this.spawnAt(ini, x, y, z);
		}
		return this.spawnAt(ini, x, y, 0);
	}
	/**
	* 发射区随机偏移（boxrandom/sphererandom + origin + sign 符号限制）。
	* eventfollow/eventspawn 子系在父粒子位置叠加此偏移（子系发射区相对父粒子）。
	* z 为发射区深度（sphererandom dirs.z × 半径，perspective rendering 用）。
	*/
	emitterOffset(em) {
		let x = 0;
		let y = 0;
		let z = 0;
		const [dx, dy, dz] = em.directions;
		if (em.type === "boxrandom") {
			const d = Array.isArray(em.distanceMax) ? em.distanceMax : [
				em.distanceMax,
				em.distanceMax,
				0
			];
			x = (Math.random() * 2 - 1) * d[0];
			y = (Math.random() * 2 - 1) * d[1];
			z = (Math.random() * 2 - 1) * (d[2] ?? 0);
		} else {
			const maxD = typeof em.distanceMax === "number" ? em.distanceMax : Math.hypot(em.distanceMax[0], em.distanceMax[1]);
			const ang = Math.random() * Math.PI * 2;
			const rr = em.distanceMin + Math.sqrt(Math.random()) * Math.max(0, maxD - em.distanceMin);
			x = Math.cos(ang) * rr * dx;
			y = Math.sin(ang) * rr * dy;
			z = (Math.random() * 2 - 1) * rr * (dz ?? 0);
		}
		if (em.sign !== void 0) {
			if (em.sign[0] === 1) x = Math.abs(x);
			else if (em.sign[0] === -1) x = -Math.abs(x);
			if (em.sign[1] === 1) y = Math.abs(y);
			else if (em.sign[1] === -1) y = -Math.abs(y);
			if (em.sign[2] === 1) z = Math.abs(z);
			else if (em.sign[2] === -1) z = -Math.abs(z);
		}
		return {
			x: x + em.origin[0],
			y: y + em.origin[1],
			z: z + em.origin[2]
		};
	}
	/** 在指定位置生成粒子（eventfollow 子系在父粒子位置调用）；z 为发射区深度（perspective） */
	spawnAt(ini, x, y, z) {
		const life = rand(ini.lifetime ?? [1, 1]);
		let size;
		if (ini.size !== void 0) {
			const [smn, smx] = ini.size;
			const exp = ini.sizeExponent ?? 1;
			size = (smn + Math.pow(Math.random(), exp) * Math.max(0, smx - smn)) * this.sizeScale;
		} else size = 32 * this.sizeScale;
		let vx = 0;
		let vy = 0;
		if (this.desc.operators.velocityRemap !== void 0) {
			const rm = this.desc.operators.velocityRemap;
			vx = rand(rm.min[0], rm.max[0]);
			vy = rand(rm.min[1], rm.max[1]);
		} else if (ini.velocityMin !== void 0 && ini.velocityMax !== void 0) {
			vx = rand(ini.velocityMin[0], ini.velocityMax[0]);
			vy = rand(ini.velocityMin[1], ini.velocityMax[1]);
		} else if (this.desc.emitter.speedMin !== void 0 && this.desc.emitter.speedMax !== void 0) {
			const speed = rand(this.desc.emitter.speedMin, this.desc.emitter.speedMax);
			const ang = Math.random() * Math.PI * 2;
			vx = Math.cos(ang) * speed;
			vy = Math.sin(ang) * speed;
		}
		if (ini.turbulentVelocity !== void 0) {
			const tv = ini.turbulentVelocity;
			const spd = tv.speedMin !== void 0 && tv.speedMax !== void 0 ? rand(tv.speedMin, tv.speedMax) : tv.speedMin ?? tv.speedMax ?? 100;
			const phase = tv.phaseMin !== void 0 && tv.phaseMax !== void 0 ? rand(tv.phaseMin, tv.phaseMax) : Math.random() * 2 - 1;
			const ts = tv.timescale ?? .1;
			const t = this.time * ts;
			const nx = Math.sin(phase * 1.7 + t * .7) * .7 + Math.sin(phase * 3.1 + t * 1.3) * .3;
			const ny = Math.sin(phase * 2.3 + t * 1.1) * .7 + Math.sin(phase * 4.9 + t * .8) * .3;
			const nz = Math.sin(phase * 1.3 + t * .5) * .7 + Math.sin(phase * 3.7 + t * 1.7) * .3;
			let dx = tv.scale * nx;
			let dy = tv.offset + tv.scale * ny;
			const dz = tv.scale * nz;
			const len = Math.hypot(dx, dy, dz);
			if (len > 1e-4) {
				dx /= len;
				dy /= len;
			}
			vx += dx * spd;
			vy += dy * spd;
		}
		const alpha = rand(ini.alphaMin ?? 1, ini.alphaMax ?? 1);
		let cr = 255;
		let cg = 255;
		let cb = 255;
		if (ini.colorMin !== void 0 && ini.colorMax !== void 0) {
			cr = Math.round(rand(ini.colorMin[0], ini.colorMax[0]));
			cg = Math.round(rand(ini.colorMin[1], ini.colorMax[1]));
			cb = Math.round(rand(ini.colorMin[2], ini.colorMax[2]));
		}
		const rot = ini.rotation !== void 0 ? rand(ini.rotation[0], ini.rotation[1]) : 0;
		const angVel = ini.angularVelocity !== void 0 ? rand(ini.angularVelocity[0], ini.angularVelocity[1]) : 0;
		const ob = this.desc.overbright > 0 ? this.desc.overbright : 1;
		cr = Math.min(255, Math.round(cr * ob));
		cg = Math.min(255, Math.round(cg * ob));
		cb = Math.min(255, Math.round(cb * ob));
		const osc = this.desc.operators.oscillatePosition;
		const oscFreq = osc !== void 0 ? rand(osc.frequencyMin, osc.frequencyMax) : 0;
		const oscPhase = Math.random() * Math.PI * 2;
		const p = {
			x,
			y,
			z,
			vx,
			vy,
			life,
			maxLife: Math.max(.001, life),
			baseSize: size,
			size,
			alpha,
			spawnAlpha: alpha,
			color: [
				cr,
				cg,
				cb
			],
			rot,
			angVel,
			frame: Math.floor(Math.random() * 64),
			history: [{
				x,
				y
			}],
			phase: Math.random() * Math.PI * 2,
			oscPhase,
			oscFreq
		};
		this.particles.push(p);
		return p;
	}
};
function rand(a, b) {
	if (Array.isArray(a)) {
		const [mn, mx] = a;
		return mn + Math.random() * Math.max(0, mx - mn);
	}
	if (b === void 0) return a;
	return a + Math.random() * Math.max(0, b - a);
}
//#endregion
//#region src/client/ParticleGL.ts
const VERT = `#version 300 es
layout(location=0) in vec2 a_Pos;
layout(location=1) in vec2 a_Origin;
layout(location=2) in float a_Size;
layout(location=3) in float a_Rot;
layout(location=4) in vec4 a_Color;
layout(location=5) in float a_Frame;
layout(location=6) in float a_Aspect;
uniform vec2 u_Viewport;
uniform float u_Trail;      // 1 = spritetrail（纹理 v 轴沿线，采样 (y,x)）
out vec4 v_Color;
out vec2 v_QuadUv;
out float v_Frame;
void main() {
  // 官方 ComputeParticlePosition：宽度 = size（right 轴），高度 = size × textureRatio（up 轴）
  vec2 corner = (a_Pos - 0.5) * vec2(a_Size, a_Size * a_Aspect);
  float c = cos(a_Rot);
  float s = sin(a_Rot);
  vec2 rc = vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c);
  vec2 p = a_Origin + rc;
  gl_Position = vec4(p.x / u_Viewport.x * 2.0 - 1.0, 1.0 - p.y / u_Viewport.y * 2.0, 0.0, 1.0);
  v_Color = a_Color;
  // 官方 spritetrail（common_particles.h）：quad 宽轴沿 right（屏幕水平）、长轴沿 up
  // （速度方向），uvs.x → 纹理 u（宽），uvs.y → 纹理 v（长）——不交换。
  // drop 纹理 32×128：128px 的 v 轴沿线拉成雨丝，32px 的 u 轴为雨滴宽度。
  v_QuadUv = a_Pos;
  v_Frame = a_Frame;
}`;
const FRAG = `#version 300 es
precision mediump float;
uniform sampler2D u_Tex;
uniform sampler2D u_Bg;
uniform sampler2D u_NormalTex;  // REFRACT 法线贴图（RG88/RGBA8888n 布局）
uniform vec4 u_FrameInfo;   // (frames, cols, fw/texW, fh/texH)
uniform float u_Refract;    // 0 | 1
uniform float u_RefractAmount;
uniform vec2 u_Viewport;    // CSS 像素尺寸（粒子 NDC）
uniform vec2 u_ViewportPx;  // 物理像素尺寸（gl_FragCoord 折射用）
in vec4 v_Color;
in vec2 v_QuadUv;
in float v_Frame;
out vec4 fragColor;
void main() {
  float frame = v_Frame;
  float col = mod(frame, u_FrameInfo.y);
  float row = floor(frame / u_FrameInfo.y);
  vec2 uv = (vec2(col, row) + v_QuadUv) * u_FrameInfo.zw;
  // 官方：color = v_Color * ConvertTexture0Format(sample)
  vec4 tex = texture(u_Tex, uv);
  vec4 color = vec4(v_Color.rgb, 1.0) * tex;
  color.a = v_Color.a * tex.a;
  if (u_Refract > 0.5) {
    // 官方折射（genericparticle.frag + common_fragment.h DecompressNormalWithMask）：
    //   offset = tangents·normal（屏幕朝向 tangent=(1,0,0,1)×amount）
    //          = (normal.x × amount, −normal.y × amount) × normal.a × v_Color.a
    //   法线解压：RG88 与 RGBA8888n 布局通用 —— x 在 alpha、y 在 green、mask 在 red
    //   （decodeTex 对 RG88 输出 rgb=R、a=G；RGBA8888n 原样保留 RGBA）
    vec4 nrm = texture(u_NormalTex, uv);
    vec2 n = nrm.ag * 2.0 - 1.0;
    float mask = nrm.r;
    vec2 scrUv = gl_FragCoord.xy / u_ViewportPx;
    vec2 refr = vec2(n.x * u_RefractAmount, -n.y * u_RefractAmount) * mask * v_Color.a;
    color.rgb *= texture(u_Bg, vec2(scrUv.x, 1.0 - scrUv.y) + refr).rgb;
  }
  // 预乘 alpha 输出（画布 premultipliedAlpha:true）：
  //   normal 用 blendFunc(ONE, ONE_MINUS_SRC_ALPHA) —— 画布内正确累积，
  //   additive 用 blendFuncSeparate(ONE, ONE, ZERO, ONE) —— rgb 加法累积、
  //   alpha 恒 0，drawImage 到主画布时 src.rgb + dst.rgb 纯加法（背景不被衰减）。
  fragColor = vec4(color.rgb * color.a, color.a);
}`;
var ParticleGL = class ParticleGL {
	canvas;
	gl = null;
	prog = null;
	vao = null;
	instBuf = null;
	quadBuf = null;
	idxBuf = null;
	/** 上下文是否已被浏览器逐出（Too many WebGL contexts / webglcontextlost） */
	lost = false;
	/** WEBGL_lose_context 扩展：丢失后原地恢复（restoreContext），避免新建上下文死循环 */
	loseExt = null;
	/** 恢复节流：两次 restore 之间至少间隔（避免立即再被逐出时疯狂重试） */
	lastRestoreAt = 0;
	restoreTimer = null;
	/** 纹理缓存（以纹理对象为 key，避免同尺寸不同内容冲突） */
	texCache = /* @__PURE__ */ new Map();
	bgTex = null;
	data = /* @__PURE__ */ new Float32Array(81920);
	maxParticles = 8192;
	uViewport = null;
	uViewportPx = null;
	uFrameInfo = null;
	uRefract = null;
	uRefractAmount = null;
	uTrail = null;
	uNormalTex = null;
	/** 法线纹理缓存（独立于主纹理缓存，同图复用） */
	normalTexCache = /* @__PURE__ */ new Map();
	/** 空白法线纹理缓存 key（REFRACT 批次未带法线时绑定，mask=0 折射关闭） */
	static BLANK_KEY = {};
	/** draw 日志节流（全局 1 次/秒，避免每帧刷屏） */
	lastDrawLog = 0;
	/** 丢失日志节流：只记第一次与恢复成功 */
	lostLogged = false;
	/** 已显式释放（dispose）：不再自动恢复 */
	disposed = false;
	constructor(canvas) {
		this.canvas = canvas;
		const gl = canvas.getContext("webgl2", {
			alpha: true,
			premultipliedAlpha: true,
			antialias: false
		});
		if (gl === null) return;
		this.gl = gl;
		this.loseExt = gl.getExtension("WEBGL_lose_context");
		this.data = new Float32Array(this.maxParticles * 10);
		if (!this.buildProgramAndBuffers()) return;
		canvas.addEventListener("webglcontextlost", (e) => {
			if (this.disposed) return;
			e.preventDefault();
			this.lost = true;
			if (!this.lostLogged) {
				this.lostLogged = true;
				console.warn("[ParticleGL] WebGL 上下文丢失，原地恢复中…");
			}
			this.scheduleRestore();
		});
		canvas.addEventListener("webglcontextrestored", () => {
			if (this.disposed) return;
			this.lost = false;
			this.lostLogged = false;
			this.texCache.clear();
			this.normalTexCache.clear();
			this.bgTex = null;
			this.buildProgramAndBuffers();
			console.warn("[ParticleGL] WebGL 上下文已恢复");
		});
	}
	/** 编译 program + 建缓冲；失败返回 false */
	buildProgramAndBuffers() {
		const gl = this.gl;
		if (gl === null) return false;
		if (this.prog !== null) {
			gl.deleteProgram(this.prog);
			this.prog = null;
		}
		if (this.vao !== null) {
			gl.deleteVertexArray(this.vao);
			this.vao = null;
		}
		if (this.instBuf !== null) {
			gl.deleteBuffer(this.instBuf);
			this.instBuf = null;
		}
		if (this.quadBuf !== null) {
			gl.deleteBuffer(this.quadBuf);
			this.quadBuf = null;
		}
		if (this.idxBuf !== null) {
			gl.deleteBuffer(this.idxBuf);
			this.idxBuf = null;
		}
		const prog = this.buildProgram(VERT, FRAG);
		if (prog === null) return false;
		this.prog = prog;
		this.uViewport = gl.getUniformLocation(prog, "u_Viewport");
		this.uViewportPx = gl.getUniformLocation(prog, "u_ViewportPx");
		this.uFrameInfo = gl.getUniformLocation(prog, "u_FrameInfo");
		this.uRefract = gl.getUniformLocation(prog, "u_Refract");
		this.uRefractAmount = gl.getUniformLocation(prog, "u_RefractAmount");
		this.uTrail = gl.getUniformLocation(prog, "u_Trail");
		this.uNormalTex = gl.getUniformLocation(prog, "u_NormalTex");
		this.setupBuffers();
		return true;
	}
	/** 上下文丢失后原地恢复（带 500ms 节流，避免立即再被逐出时疯狂重试） */
	scheduleRestore() {
		if (this.restoreTimer !== null) return;
		const wait = Math.max(500, 1500 - (performance.now() - this.lastRestoreAt));
		this.restoreTimer = setTimeout(() => {
			this.restoreTimer = null;
			this.lastRestoreAt = performance.now();
			try {
				if (this.lost && this.loseExt !== null) this.loseExt.restoreContext();
			} catch {}
		}, wait);
	}
	get available() {
		return !this.lost && this.gl !== null && this.prog !== null;
	}
	/** 每帧清空（透明），避免粒子残影 */
	clear() {
		const gl = this.gl;
		if (gl === null || this.lost) return;
		gl.viewport(0, 0, this.canvas.width, this.canvas.height);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
	}
	/** 场景切换时清空纹理缓存（保留上下文，避免每次 start() 新建 WebGL 上下文） */
	reset() {
		const gl = this.gl;
		if (gl === null) return;
		for (const t of this.texCache.values()) gl.deleteTexture(t);
		this.texCache.clear();
		for (const t of this.normalTexCache.values()) gl.deleteTexture(t);
		this.normalTexCache.clear();
		if (this.bgTex !== null) {
			gl.deleteTexture(this.bgTex);
			this.bgTex = null;
		}
	}
	/** 完全释放（renderer 生命周期结束）：删除 GPU 资源 + 显式丢失上下文 */
	dispose() {
		this.disposed = true;
		if (this.restoreTimer !== null) {
			clearTimeout(this.restoreTimer);
			this.restoreTimer = null;
		}
		const gl = this.gl;
		if (gl === null) return;
		try {
			const ext = gl.getExtension("WEBGL_lose_context");
			if (ext !== null) ext.loseContext();
		} catch {}
		for (const t of this.texCache.values()) gl.deleteTexture(t);
		this.texCache.clear();
		for (const t of this.normalTexCache.values()) gl.deleteTexture(t);
		this.normalTexCache.clear();
		if (this.bgTex !== null) {
			gl.deleteTexture(this.bgTex);
			this.bgTex = null;
		}
		if (this.prog !== null) gl.deleteProgram(this.prog);
		if (this.vao !== null) gl.deleteVertexArray(this.vao);
		if (this.instBuf !== null) gl.deleteBuffer(this.instBuf);
		if (this.quadBuf !== null) gl.deleteBuffer(this.quadBuf);
		if (this.idxBuf !== null) gl.deleteBuffer(this.idxBuf);
		this.prog = null;
		this.vao = null;
		this.instBuf = null;
		this.quadBuf = null;
		this.idxBuf = null;
		this.gl = null;
		this.lost = true;
	}
	buildProgram(vertSrc, fragSrc) {
		const gl = this.gl;
		if (gl === null) return null;
		const compile = (type, src) => {
			const sh = gl.createShader(type);
			if (sh === null) return null;
			gl.shaderSource(sh, src);
			gl.compileShader(sh);
			if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
				console.error("ParticleGL shader error:", gl.getShaderInfoLog(sh));
				gl.deleteShader(sh);
				return null;
			}
			return sh;
		};
		const vs = compile(gl.VERTEX_SHADER, vertSrc);
		const fs = compile(gl.FRAGMENT_SHADER, fragSrc);
		if (vs === null || fs === null) return null;
		const prog = gl.createProgram();
		if (prog === null) return null;
		gl.attachShader(prog, vs);
		gl.attachShader(prog, fs);
		gl.linkProgram(prog);
		gl.deleteShader(vs);
		gl.deleteShader(fs);
		if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
			console.error("ParticleGL link error:", gl.getProgramInfoLog(prog));
			gl.deleteProgram(prog);
			return null;
		}
		return prog;
	}
	setupBuffers() {
		const gl = this.gl;
		if (gl === null || this.prog === null) return;
		this.vao = gl.createVertexArray();
		gl.bindVertexArray(this.vao);
		const quadVerts = new Float32Array([
			0,
			0,
			1,
			0,
			1,
			1,
			0,
			1
		]);
		this.quadBuf = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
		gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
		const idx = new Uint16Array([
			0,
			1,
			2,
			0,
			2,
			3
		]);
		this.idxBuf = gl.createBuffer();
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
		this.instBuf = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
		gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
		const stride = 40;
		const loc = (i) => i;
		gl.enableVertexAttribArray(loc(1));
		gl.vertexAttribPointer(loc(1), 2, gl.FLOAT, false, stride, 0);
		gl.vertexAttribDivisor(loc(1), 1);
		gl.enableVertexAttribArray(loc(2));
		gl.vertexAttribPointer(loc(2), 1, gl.FLOAT, false, stride, 8);
		gl.vertexAttribDivisor(loc(2), 1);
		gl.enableVertexAttribArray(loc(3));
		gl.vertexAttribPointer(loc(3), 1, gl.FLOAT, false, stride, 12);
		gl.vertexAttribDivisor(loc(3), 1);
		gl.enableVertexAttribArray(loc(4));
		gl.vertexAttribPointer(loc(4), 4, gl.FLOAT, false, stride, 16);
		gl.vertexAttribDivisor(loc(4), 1);
		gl.enableVertexAttribArray(loc(5));
		gl.vertexAttribPointer(loc(5), 1, gl.FLOAT, false, stride, 32);
		gl.vertexAttribDivisor(loc(5), 1);
		gl.enableVertexAttribArray(loc(6));
		gl.vertexAttribPointer(loc(6), 1, gl.FLOAT, false, stride, 36);
		gl.vertexAttribDivisor(loc(6), 1);
		gl.bindVertexArray(null);
	}
	/** 粒子纹理（ImageBitmap/Canvas → GL 纹理），以纹理对象为 key 缓存 */
	textureFor(source) {
		const gl = this.gl;
		if (gl === null) return null;
		const hit = this.texCache.get(source);
		if (hit !== void 0) return hit;
		const tex = gl.createTexture();
		if (tex === null) return null;
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		this.texCache.set(source, tex);
		return tex;
	}
	/** 上传背景（主画布内容）为纹理，供折射采样 */
	uploadBackground(canvas) {
		const gl = this.gl;
		if (gl === null) return;
		if (this.bgTex === null) {
			this.bgTex = gl.createTexture();
			gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		} else gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
	}
	/**
	* 实例化绘制一组粒子（同一纹理/混合模式）。
	* @param particles 粒子数据（最多 maxParticles 个）
	* @param normalTex 折射法线纹理（REFRACT 批次；null = 无法线，用 mask=0 关闭折射）
	*/
	render(particles, opts, tex, normalTex, viewPxW, viewPxH) {
		const gl = this.gl;
		if (gl === null || this.lost || this.prog === null || this.vao === null || this.instBuf === null) return;
		const n = Math.min(particles.length, this.maxParticles);
		if (n === 0) return;
		const glTex = this.textureFor(tex);
		if (glTex === null) return;
		let o = 0;
		for (let i = 0; i < n; i++) {
			const p = particles[i];
			this.data[o++] = p.x;
			this.data[o++] = p.y;
			this.data[o++] = p.size;
			this.data[o++] = p.rot;
			this.data[o++] = p.r / 255;
			this.data[o++] = p.g / 255;
			this.data[o++] = p.b / 255;
			this.data[o++] = p.a;
			this.data[o++] = p.frame;
			this.data[o++] = p.aspect;
		}
		gl.useProgram(this.prog);
		gl.bindVertexArray(this.vao);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
		gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data.subarray(0, n * 10));
		gl.uniform2f(this.uViewport, opts.viewW, opts.viewH);
		gl.uniform2f(this.uViewportPx, viewPxW, viewPxH);
		const cols = opts.frames > 1 && opts.fw > 0 ? Math.max(1, Math.floor(tex.width / opts.fw)) : 1;
		gl.uniform4f(this.uFrameInfo, opts.frames, cols, opts.fw > 0 ? opts.fw / tex.width : 1, opts.fh > 0 ? opts.fh / tex.height : 1);
		gl.uniform1f(this.uRefract, opts.refract ? 1 : 0);
		gl.uniform1f(this.uRefractAmount, Number.isFinite(opts.refractAmount) && opts.refractAmount !== 0 ? opts.refractAmount : .06);
		gl.uniform1f(this.uTrail, opts.trail ? 1 : 0);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, glTex);
		gl.uniform1i(gl.getUniformLocation(this.prog, "u_Tex"), 0);
		if (opts.refract && this.bgTex !== null) {
			gl.activeTexture(gl.TEXTURE1);
			gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
			gl.uniform1i(gl.getUniformLocation(this.prog, "u_Bg"), 1);
		}
		let glNormal = null;
		if (opts.refract) {
			if (normalTex !== null) {
				glNormal = this.normalTexCache.get(normalTex) ?? null;
				if (glNormal === null) {
					glNormal = gl.createTexture();
					if (glNormal !== null) {
						gl.bindTexture(gl.TEXTURE_2D, glNormal);
						gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, normalTex);
						gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
						gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
						gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
						gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
						this.normalTexCache.set(normalTex, glNormal);
					}
				}
			} else {
				glNormal = this.normalTexCache.get(ParticleGL.BLANK_KEY) ?? null;
				if (glNormal === null) {
					glNormal = gl.createTexture();
					if (glNormal !== null) {
						gl.bindTexture(gl.TEXTURE_2D, glNormal);
						gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([
							0,
							0,
							0,
							0
						]));
						gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
						gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
						gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
						gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
						this.normalTexCache.set(ParticleGL.BLANK_KEY, glNormal);
					}
				}
			}
			if (glNormal !== null) {
				gl.activeTexture(gl.TEXTURE2);
				gl.bindTexture(gl.TEXTURE_2D, glNormal);
				gl.uniform1i(gl.getUniformLocation(this.prog, "u_NormalTex"), 2);
			}
		}
		gl.enable(gl.BLEND);
		if (opts.additive) gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
		else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
		gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, n);
		gl.bindVertexArray(null);
		const now = performance.now();
		if (n > 0 && now - this.lastDrawLog > 1e3) {
			this.lastDrawLog = now;
			console.log("[ParticleGL] draw n=" + n, "refract=" + opts.refract, "additive=" + opts.additive, "tex=" + tex.width + "x" + tex.height, "frames=" + opts.frames, "glError=" + gl.getError());
		}
	}
};
//#endregion
//#region src/client/WaterwavesGL.ts
const VERT_SRC$2 = `
attribute vec2 a_Pos;
varying vec2 v_UV;
void main() {
  gl_Position = vec4(a_Pos, 0.0, 1.0);
  v_UV = a_Pos * 0.5 + 0.5;
}
`;
const FRAG_SRC$2 = `
precision mediump float;
// 独立实现的水波扰动（数学事实：沿某方向传播的正弦波 + 垂直方向扰动）。
// 行为参考 Wallpaper Engine 官方 waterwaves 效果（黑盒观察），代码为独立编写。
uniform sampler2D u_Src;
uniform sampler2D u_MaskTex;
uniform float u_UseMask;
uniform float u_MaskAlpha;
uniform float u_Clock;
uniform vec4 u_Params[4]; // x=方向角, y=速度, z=尺度, w=强度
uniform float u_Power[4]; // 波形指数
uniform int u_Count;
varying vec2 v_Uv;
void main() {
  vec2 uv = v_Uv;
  float gate = 1.0;
  if (u_UseMask > 0.5) {
    vec4 m = texture2D(u_MaskTex, uv);
    gate = u_MaskAlpha > 0.5 ? m.a : m.r;
  }
  vec2 total = vec2(0.0);
  for (int i = 0; i < 4; i++) {
    if (i >= u_Count) break;
    vec4 p = u_Params[i];
    float sinA = sin(p.x);
    float cosA = cos(p.x);
    // 波相位沿 (-sinA, cosA) 方向随空间与时间变化
    float phase = u_Clock * p.y + (uv.x * -sinA + uv.y * cosA) * p.z;
    float wave = sin(phase);
    // 扰动沿 (cosA, sinA)，幅度为强度平方的指数波形
    float amp = pow(abs(wave), u_Power[i]) * sign(wave) * p.w * p.w;
    total += amp * vec2(cosA, sinA);
  }
  uv += total * gate;
  gl_FragColor = texture2D(u_Src, uv);
}
`;
var WaterwavesGL = class WaterwavesGL {
	canvas = null;
	gl = null;
	prog = null;
	locs = {};
	vbo = null;
	texCache = /* @__PURE__ */ new Map();
	curW = 0;
	curH = 0;
	/** 上下文被逐出后的原地恢复扩展 */
	loseExt = null;
	lost = false;
	lostLogged = false;
	lastRestoreAt = 0;
	/** WebGL 是否可用（惰性缓存，避免每次访问都新建探针上下文） */
	static cachedAvailable = null;
	static get available() {
		if (WaterwavesGL.cachedAvailable === null) try {
			const c = document.createElement("canvas");
			WaterwavesGL.cachedAvailable = !!(c.getContext("webgl") || c.getContext("experimental-webgl"));
		} catch {
			WaterwavesGL.cachedAvailable = false;
		}
		return WaterwavesGL.cachedAvailable;
	}
	ensure() {
		if (this.gl !== null && this.prog !== null && !this.lost) return true;
		if (this.lost) {
			const now = performance.now();
			if (this.canvas !== null && this.loseExt !== null && now - this.lastRestoreAt > 1e3) {
				this.lastRestoreAt = now;
				try {
					this.loseExt.restoreContext();
				} catch {}
			}
			return false;
		}
		try {
			const c = this.canvas ?? document.createElement("canvas");
			const gl = c.getContext("webgl") || c.getContext("experimental-webgl");
			if (gl === null) return false;
			this.canvas = c;
			this.gl = gl;
			this.loseExt = gl.getExtension("WEBGL_lose_context");
			c.addEventListener("webglcontextlost", (e) => {
				e.preventDefault();
				this.lost = true;
				if (!this.lostLogged) {
					this.lostLogged = true;
					console.warn("[waterwaves:GL] 上下文丢失，原地恢复中…");
				}
			});
			c.addEventListener("webglcontextrestored", () => {
				this.lost = false;
				this.lostLogged = false;
				this.texCache.clear();
				this.prog = null;
				this.vbo = null;
				console.warn("[waterwaves:GL] 上下文已恢复");
			});
			const compile = (type, src) => {
				const sh = gl.createShader(type);
				if (sh === null) return null;
				gl.shaderSource(sh, src);
				gl.compileShader(sh);
				if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
					console.warn("waterwaves shader: " + gl.getShaderInfoLog(sh));
					return null;
				}
				return sh;
			};
			const vs = compile(gl.VERTEX_SHADER, VERT_SRC$2);
			const fs = compile(gl.FRAGMENT_SHADER, FRAG_SRC$2);
			if (vs === null || fs === null) return false;
			const prog = gl.createProgram();
			if (prog === null) return false;
			gl.attachShader(prog, vs);
			gl.attachShader(prog, fs);
			gl.linkProgram(prog);
			if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
			this.prog = prog;
			gl.useProgram(prog);
			for (const name of [
				"u_Src",
				"u_MaskTex",
				"u_UseMask",
				"u_MaskAlpha",
				"u_Clock",
				"u_Params",
				"u_Power",
				"u_Count"
			]) this.locs[name] = gl.getUniformLocation(prog, name);
			const aPos = gl.getAttribLocation(prog, "a_Pos");
			this.vbo = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
			gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
				-1,
				-1,
				1,
				-1,
				-1,
				1,
				1,
				1
			]), gl.STATIC_DRAW);
			gl.enableVertexAttribArray(aPos);
			gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
			return true;
		} catch {
			return false;
		}
	}
	uploadTexture(key, src, w, h) {
		const gl = this.gl;
		if (gl === null) return null;
		const hit = this.texCache.get(key);
		if (hit !== void 0) return hit;
		const tex = gl.createTexture();
		if (tex === null) return null;
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		this.texCache.set(key, tex);
		return tex;
	}
	/**
	* 渲染 waterwaves 效果到离屏 WebGL canvas（逐像素 UV 场扰动）。
	* src：图层纹理；mask：mask 纹理（null = 无）；maskUseA：mask 用 A 通道（R8 alpha 语义）。
	*/
	render(src, w, h, mask, maskUseA, waves, time, key) {
		if (!this.ensure()) return null;
		const gl = this.gl;
		const prog = this.prog;
		if (gl === null || prog === null || this.canvas === null) return null;
		if (this.curW !== w || this.curH !== h) {
			this.canvas.width = w;
			this.canvas.height = h;
			this.curW = w;
			this.curH = h;
		}
		gl.viewport(0, 0, w, h);
		gl.useProgram(prog);
		const tex = this.uploadTexture("tex:" + key, src, w, h);
		if (tex === null) return null;
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.uniform1i(this.locs["u_Src"], 0);
		if (mask !== null) {
			const mtex = this.uploadTexture("mask:" + key, mask, 0, 0);
			gl.activeTexture(gl.TEXTURE1);
			gl.bindTexture(gl.TEXTURE_2D, mtex);
			gl.uniform1i(this.locs["u_MaskTex"], 1);
			gl.uniform1f(this.locs["u_UseMask"], 1);
			gl.uniform1f(this.locs["u_MaskAlpha"], maskUseA ? 1 : 0);
		} else gl.uniform1f(this.locs["u_UseMask"], 0);
		gl.uniform1f(this.locs["u_Clock"], time);
		const wv = [];
		const ex = [];
		const n = Math.min(4, waves.length);
		for (let i = 0; i < 4; i++) if (i < n) {
			wv.push(waves[i].direction, waves[i].speed, waves[i].scale, waves[i].strength);
			ex.push(Math.max(.5, Math.min(4, waves[i].exponent)));
		} else {
			wv.push(0, 0, 0, 0);
			ex.push(1);
		}
		gl.uniform4fv(this.locs["u_Params"], new Float32Array(wv));
		gl.uniform1fv(this.locs["u_Power"], new Float32Array(ex));
		gl.uniform1i(this.locs["u_Count"], n);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
		return this.canvas;
	}
	/** 场景切换时清空纹理缓存（保留上下文，避免每次 start() 新建 WebGL 上下文） */
	reset() {
		if (this.gl === null) return;
		for (const t of this.texCache.values()) this.gl.deleteTexture(t);
		this.texCache.clear();
		this.curW = 0;
		this.curH = 0;
	}
	/** 完全释放（renderer 生命周期结束） */
	dispose() {
		const gl = this.gl;
		if (gl === null) return;
		try {
			const ext = gl.getExtension("WEBGL_lose_context");
			if (ext !== null) ext.loseContext();
		} catch {}
		for (const t of this.texCache.values()) gl.deleteTexture(t);
		this.texCache.clear();
		if (this.prog !== null) gl.deleteProgram(this.prog);
		if (this.vbo !== null) gl.deleteBuffer(this.vbo);
		this.gl = null;
		this.prog = null;
		this.vbo = null;
		this.canvas = null;
		this.curW = 0;
		this.curH = 0;
	}
};
//#endregion
//#region src/client/NitroGL.ts
const VERT_SRC$1 = `
attribute vec2 a_Pos;
varying vec2 v_UV;
void main() {
  gl_Position = vec4(a_Pos, 0.0, 1.0);
  v_UV = a_Pos * 0.5 + 0.5;
}
`;
const FRAG_SRC$1 = `
precision mediump float;
varying vec2 v_Uv;
uniform sampler2D u_Src;    // 底图
uniform sampler2D u_Noise;  // 噪声（clouds_256，R 通道）
uniform sampler2D u_Mask0;
uniform sampler2D u_Mask1;
uniform sampler2D u_Mask2;
uniform sampler2D u_Mask3;
uniform float u_UseMask[4];
uniform float u_Aspect;     // 底图 高/宽（噪声纵横比补偿）
uniform float u_Clock;
uniform vec3 u_Color0[4];
uniform vec3 u_Color1[4];
uniform float u_Multiply[4];
uniform vec2 u_Ranges[4];
uniform vec2 u_Scales[4];
uniform vec4 u_Speeds[4];
uniform int u_Count;

vec4 sampleMask(int i, vec2 uv) {
  if (i == 0) return texture2D(u_Mask0, uv);
  if (i == 1) return texture2D(u_Mask1, uv);
  if (i == 2) return texture2D(u_Mask2, uv);
  return texture2D(u_Mask3, uv);
}

void main() {
  vec4 albedo = texture2D(u_Src, v_Uv);
  vec3 color = albedo.rgb;
  for (int i = 0; i < 4; i++) {
    if (i >= u_Count) break;
    // 两层动画噪声采样：尺度 + 时间流速，x 乘纵横比补偿
    vec2 nuvA = (v_Uv * u_Scales[i].x + u_Clock * u_Speeds[i].xy);
    nuvA.x *= u_Aspect;
    vec2 nuvB = (v_Uv * u_Scales[i].y + u_Clock * u_Speeds[i].zw);
    nuvB.x *= u_Aspect;
    nuvB = vec2(-nuvB.y, nuvB.x); // 第二层 90° 旋转（方向多样性）
    float nitro0 = texture2D(u_Noise, nuvA).r;
    float nitro1 = texture2D(u_Noise, nuvB).r;
    float remap = texture2D(u_Noise, v_Uv).r;
    // 核心噪声 + 两层乘积的带通（ranges 决定 band 宽度/中心）
    float coreNoise = smoothstep(nitro0, nitro1, 0.1 + remap * 0.8);
    float p = nitro0 * nitro1;
    float band = smoothstep(u_Ranges[i].y, u_Ranges[i].x, p) * smoothstep(u_Ranges[i].x, u_Ranges[i].y, p);
    float nitro = coreNoise * band * 4.0;
    vec3 nColor = mix(u_Color0[i], u_Color1[i], nitro);
    float blend = nitro * u_Multiply[i];
    if (u_UseMask[i] > 0.5) {
      // mask R8 解码后灰度在 alpha 通道
      blend *= sampleMask(i, v_Uv).a;
    }
    // 混合模式 22 Glow：BlendGlow(A,B)=BlendReflect(B,A)=min(B*B/(1-A),1)，
    // result = mix(A, glow, blend)。A==1 时避免除零返回 A。
    vec3 A = color;
    vec3 glow = (1.0 - A) > 0.001 ? min(nColor * nColor / max(1.0 - A, 0.001), 1.0) : A;
    color = mix(A, glow, clamp(blend, 0.0, 1.0));
  }
  gl_FragColor = vec4(max(0.0, color), albedo.a);
}
`;
var NitroGL = class NitroGL {
	canvas = null;
	gl = null;
	prog = null;
	locs = {};
	vbo = null;
	texCache = /* @__PURE__ */ new Map();
	curW = 0;
	curH = 0;
	loseExt = null;
	lost = false;
	lostLogged = false;
	lastRestoreAt = 0;
	static cachedAvailable = null;
	static get available() {
		if (NitroGL.cachedAvailable === null) try {
			const c = document.createElement("canvas");
			NitroGL.cachedAvailable = !!(c.getContext("webgl") || c.getContext("experimental-webgl"));
		} catch {
			NitroGL.cachedAvailable = false;
		}
		return NitroGL.cachedAvailable;
	}
	ensure() {
		if (this.gl !== null && this.prog !== null && !this.lost) return true;
		if (this.lost) {
			const now = performance.now();
			if (this.canvas !== null && this.loseExt !== null && now - this.lastRestoreAt > 1e3) {
				this.lastRestoreAt = now;
				try {
					this.loseExt.restoreContext();
				} catch {}
			}
			return false;
		}
		try {
			const c = this.canvas ?? document.createElement("canvas");
			const gl = c.getContext("webgl") || c.getContext("experimental-webgl");
			if (gl === null) return false;
			this.canvas = c;
			this.gl = gl;
			this.loseExt = gl.getExtension("WEBGL_lose_context");
			c.addEventListener("webglcontextlost", (e) => {
				e.preventDefault();
				this.lost = true;
				if (!this.lostLogged) {
					this.lostLogged = true;
					console.warn("[nitro:GL] 上下文丢失，原地恢复中…");
				}
			});
			c.addEventListener("webglcontextrestored", () => {
				this.lost = false;
				this.lostLogged = false;
				this.texCache.clear();
				this.prog = null;
				this.vbo = null;
				console.warn("[nitro:GL] 上下文已恢复");
			});
			const compile = (type, src) => {
				const sh = gl.createShader(type);
				if (sh === null) return null;
				gl.shaderSource(sh, src);
				gl.compileShader(sh);
				if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
					console.warn("nitro shader: " + gl.getShaderInfoLog(sh));
					return null;
				}
				return sh;
			};
			const vs = compile(gl.VERTEX_SHADER, VERT_SRC$1);
			const fs = compile(gl.FRAGMENT_SHADER, FRAG_SRC$1);
			if (vs === null || fs === null) return false;
			const prog = gl.createProgram();
			if (prog === null) return false;
			gl.attachShader(prog, vs);
			gl.attachShader(prog, fs);
			gl.linkProgram(prog);
			if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
			this.prog = prog;
			gl.useProgram(prog);
			for (const name of [
				"u_Src",
				"u_Noise",
				"u_Mask0",
				"u_Mask1",
				"u_Mask2",
				"u_Mask3",
				"u_UseMask",
				"u_Aspect",
				"u_Clock",
				"u_Color0",
				"u_Color1",
				"u_Multiply",
				"u_Ranges",
				"u_Scales",
				"u_Speeds",
				"u_Count"
			]) this.locs[name] = gl.getUniformLocation(prog, name);
			const aPos = gl.getAttribLocation(prog, "a_Pos");
			this.vbo = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
			gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
				-1,
				-1,
				1,
				-1,
				-1,
				1,
				1,
				1
			]), gl.STATIC_DRAW);
			gl.enableVertexAttribArray(aPos);
			gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
			return true;
		} catch {
			return false;
		}
	}
	uploadTexture(key, src, w, h) {
		const gl = this.gl;
		if (gl === null) return null;
		const hit = this.texCache.get(key);
		if (hit !== void 0) return hit;
		const tex = gl.createTexture();
		if (tex === null) return null;
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		this.texCache.set(key, tex);
		return tex;
	}
	/**
	* 渲染多个 nitro 效果到离屏 WebGL canvas（逐像素叠加）。
	* src：图层纹理；noise：噪声纹理（clouds_256）；masks：各 nitro 的 mask（null = 无）。
	*/
	render(src, w, h, noise, masks, nitros, time, key) {
		if (!this.ensure()) return null;
		const gl = this.gl;
		const prog = this.prog;
		if (gl === null || prog === null || this.canvas === null) return null;
		if (this.curW !== w || this.curH !== h) {
			this.canvas.width = w;
			this.canvas.height = h;
			this.curW = w;
			this.curH = h;
		}
		gl.viewport(0, 0, w, h);
		gl.useProgram(prog);
		const tex = this.uploadTexture("tex:" + key, src, w, h);
		if (tex === null) return null;
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.uniform1i(this.locs["u_Src"], 0);
		let noiseTex = null;
		if (noise !== null) noiseTex = this.uploadTexture("noise:" + key, noise, noise.width, noise.height);
		else noiseTex = this.uploadTexture("noise:" + key, src, w, h);
		if (noiseTex === null) return null;
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, noiseTex);
		gl.uniform1i(this.locs["u_Noise"], 1);
		const n = Math.min(4, nitros.length);
		const maskNames = [
			"u_Mask0",
			"u_Mask1",
			"u_Mask2",
			"u_Mask3"
		];
		const maskUnits = [
			2,
			3,
			4,
			5
		];
		const useMask = [];
		for (let i = 0; i < 4; i++) if (i < n && masks[i] !== null && masks[i] !== void 0) {
			const mtex = this.uploadTexture("mask" + i + ":" + key, masks[i], masks[i].width, masks[i].height);
			gl.activeTexture(gl.TEXTURE0 + maskUnits[i]);
			gl.bindTexture(gl.TEXTURE_2D, mtex);
			gl.uniform1i(this.locs[maskNames[i]], maskUnits[i]);
			useMask.push(1);
		} else {
			gl.uniform1i(this.locs[maskNames[i]], 0);
			useMask.push(0);
		}
		gl.uniform1fv(this.locs["u_UseMask"], new Float32Array(useMask));
		gl.uniform1f(this.locs["u_Aspect"], h > 0 ? h / w : 1);
		gl.uniform1f(this.locs["u_Clock"], time);
		gl.uniform1i(this.locs["u_Count"], n);
		const c0 = [];
		const c1 = [];
		const mul = [];
		const rg = [];
		const sc = [];
		const sp = [];
		for (let i = 0; i < 4; i++) if (i < n) {
			const p = nitros[i];
			c0.push(p.colorStart[0], p.colorStart[1], p.colorStart[2]);
			c1.push(p.colorEnd[0], p.colorEnd[1], p.colorEnd[2]);
			mul.push(p.multiply);
			rg.push(p.ranges[0], p.ranges[1]);
			sc.push(p.scales[0], p.scales[1]);
			sp.push(p.speeds[0], p.speeds[1], p.speeds[2], p.speeds[3]);
		} else {
			c0.push(0, 0, 0);
			c1.push(1, 1, 1);
			mul.push(0);
			rg.push(.3, .25);
			sc.push(1, 2);
			sp.push(0, 0, 0, 0);
		}
		gl.uniform3fv(this.locs["u_Color0"], new Float32Array(c0));
		gl.uniform3fv(this.locs["u_Color1"], new Float32Array(c1));
		gl.uniform1fv(this.locs["u_Multiply"], new Float32Array(mul));
		gl.uniform2fv(this.locs["u_Ranges"], new Float32Array(rg));
		gl.uniform2fv(this.locs["u_Scales"], new Float32Array(sc));
		gl.uniform4fv(this.locs["u_Speeds"], new Float32Array(sp));
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
		return this.canvas;
	}
	/** 场景切换时清空纹理缓存（保留上下文，避免每次 start() 新建 WebGL 上下文） */
	reset() {
		if (this.gl === null) return;
		for (const t of this.texCache.values()) this.gl.deleteTexture(t);
		this.texCache.clear();
		this.curW = 0;
		this.curH = 0;
	}
	/** 完全释放（renderer 生命周期结束） */
	dispose() {
		const gl = this.gl;
		if (gl === null) return;
		try {
			const ext = gl.getExtension("WEBGL_lose_context");
			if (ext !== null) ext.loseContext();
		} catch {}
		for (const t of this.texCache.values()) gl.deleteTexture(t);
		this.texCache.clear();
		if (this.prog !== null) gl.deleteProgram(this.prog);
		if (this.vbo !== null) gl.deleteBuffer(this.vbo);
		this.gl = null;
		this.prog = null;
		this.vbo = null;
		this.canvas = null;
		this.curW = 0;
		this.curH = 0;
	}
};
//#endregion
//#region src/client/ShakeGL.ts
const VERT_SRC = `
attribute vec2 a_Pos;
varying vec2 v_UV;
void main() {
  gl_Position = vec4(a_Pos, 0.0, 1.0);
  v_UV = a_Pos * 0.5 + 0.5;
}
`;
const FRAG_SRC = `
precision highp float;
// 独立实现的 shake（UV 位移 + 不透明度 mask 混合），行为参考官方效果（黑盒观察）。
uniform sampler2D u_Src;
uniform sampler2D u_Flow;
uniform sampler2D u_Mask;
uniform float u_UseMask;
uniform float u_FlowYFromAlpha;   // 方向场 y 分量取自 A 通道（RG88 解码语义）
uniform float u_MaskFromAlpha;    // mask 值取自 A 通道（R8 解码语义）
uniform float u_Offset;
uniform float u_Amp;
// 各纹理内容区域比例（image 尺寸 / 画布尺寸）：图层 UV → 纹理 UV
uniform vec2 u_SrcRect;
uniform vec2 u_FlowRect;
uniform vec2 u_MaskRect;
varying vec2 v_UV;

// 图层 UV（内容区 0..1）→ 纹理 UV（纹理不做翻转上传：v=0 = 图像第一行）
vec2 rectUv(vec2 imgUv, vec2 rect) {
  return imgUv * rect;
}

void main() {
  // 纹理按「不做翻转」上传（UNPACK_FLIP_Y_WEBGL = 0）：
  // 纹理 v=0 对应图像第一行（上）→ 这里显式把画布 UV（y 向上）转成图像 UV（y 向下）。
  // 不能依赖 UNPACK_FLIP_Y_WEBGL：ImageBitmap 源（本渲染器的图层纹理）在 Chrome 里
  // 会被忽略、canvas 源会被应用，两者不一致（实测）。
  vec2 imgUv = vec2(v_UV.x, 1.0 - v_UV.y);
  vec4 f = texture2D(u_Flow, rectUv(imgUv, u_FlowRect));
  float fy = u_FlowYFromAlpha > 0.5 ? f.a : f.g;
  vec2 flowMask = (vec2(f.r, fy) - vec2(0.498)) * 2.0;
  vec2 texOffset = u_Offset * u_Amp * u_Amp * flowMask;
  // 官方语义：位移量在图像空间（y 向下）叠加
  vec2 sImg = imgUv + texOffset;
  vec4 base = texture2D(u_Src, rectUv(imgUv, u_SrcRect));
  vec4 shaken = texture2D(u_Src, rectUv(sImg, u_SrcRect));
  if (u_UseMask > 0.5) {
    vec4 m = texture2D(u_Mask, rectUv(sImg, u_MaskRect));
    float mv = u_MaskFromAlpha > 0.5 ? m.a : m.r;
    gl_FragColor = mix(base, shaken, mv);
  } else {
    gl_FragColor = shaken;
  }
}
`;
/** 内容区域比例 = image 尺寸 / 纹理画布尺寸（未给出时视为整张纹理 = 1） */
function rectRatio(rect, tex) {
	const tw = tex.width ?? 0;
	const th = tex.height ?? 0;
	if (rect === void 0 || tw <= 0 || th <= 0) return [1, 1];
	return [Math.min(1, rect.w / tw), Math.min(1, rect.h / th)];
}
var ShakeGL = class ShakeGL {
	canvas = null;
	gl = null;
	prog = null;
	locs = {};
	vbo = null;
	texCache = /* @__PURE__ */ new Map();
	curW = 0;
	curH = 0;
	lost = false;
	lostLogged = false;
	loseExt = null;
	lastRestoreAt = 0;
	/** WebGL 是否可用（惰性缓存，避免每次访问都新建探针上下文） */
	static cachedAvailable = null;
	static get available() {
		if (ShakeGL.cachedAvailable === null) try {
			const c = document.createElement("canvas");
			ShakeGL.cachedAvailable = !!(c.getContext("webgl") || c.getContext("experimental-webgl"));
		} catch {
			ShakeGL.cachedAvailable = false;
		}
		return ShakeGL.cachedAvailable;
	}
	ensure() {
		if (this.gl !== null && this.prog !== null && !this.lost) return true;
		if (this.lost) {
			const now = performance.now();
			if (this.canvas !== null && this.loseExt !== null && now - this.lastRestoreAt > 1e3) {
				this.lastRestoreAt = now;
				try {
					this.loseExt.restoreContext();
				} catch {}
			}
			return false;
		}
		try {
			const c = this.canvas ?? document.createElement("canvas");
			const gl = c.getContext("webgl") || c.getContext("experimental-webgl");
			if (gl === null) return false;
			this.canvas = c;
			this.gl = gl;
			this.loseExt = gl.getExtension("WEBGL_lose_context");
			c.addEventListener("webglcontextlost", (e) => {
				e.preventDefault();
				this.lost = true;
				if (!this.lostLogged) {
					this.lostLogged = true;
					console.warn("[shake:GL] 上下文丢失，原地恢复中…");
				}
			});
			c.addEventListener("webglcontextrestored", () => {
				this.lost = false;
				this.lostLogged = false;
				this.texCache.clear();
				this.prog = null;
				this.vbo = null;
				console.warn("[shake:GL] 上下文已恢复");
			});
			const compile = (type, src) => {
				const sh = gl.createShader(type);
				if (sh === null) return null;
				gl.shaderSource(sh, src);
				gl.compileShader(sh);
				if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
					console.warn("shake shader: " + gl.getShaderInfoLog(sh));
					return null;
				}
				return sh;
			};
			const vs = compile(gl.VERTEX_SHADER, VERT_SRC);
			const fs = compile(gl.FRAGMENT_SHADER, FRAG_SRC);
			if (vs === null || fs === null) return false;
			const prog = gl.createProgram();
			if (prog === null) return false;
			gl.attachShader(prog, vs);
			gl.attachShader(prog, fs);
			gl.linkProgram(prog);
			if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
			this.prog = prog;
			gl.useProgram(prog);
			for (const name of [
				"u_Src",
				"u_Flow",
				"u_Mask",
				"u_UseMask",
				"u_FlowYFromAlpha",
				"u_MaskFromAlpha",
				"u_Offset",
				"u_Amp",
				"u_SrcRect",
				"u_FlowRect",
				"u_MaskRect"
			]) this.locs[name] = gl.getUniformLocation(prog, name);
			const aPos = gl.getAttribLocation(prog, "a_Pos");
			this.vbo = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
			gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
				-1,
				-1,
				1,
				-1,
				-1,
				1,
				1,
				1
			]), gl.STATIC_DRAW);
			gl.enableVertexAttribArray(aPos);
			gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
			return true;
		} catch {
			return false;
		}
	}
	uploadTexture(key, src) {
		const gl = this.gl;
		if (gl === null) return null;
		const hit = this.texCache.get(key);
		const dynamic = typeof HTMLCanvasElement !== "undefined" && src instanceof HTMLCanvasElement || typeof OffscreenCanvas !== "undefined" && src instanceof OffscreenCanvas;
		if (hit !== void 0 && !dynamic) return hit;
		const tex = hit ?? gl.createTexture();
		if (tex === null) return null;
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		this.texCache.set(key, tex);
		return tex;
	}
	/**
	* 渲染 shake 到离屏 WebGL canvas。
	* @param src           图层纹理（或 spritesheet 当前帧）
	* @param flow          方向场纹理（g_Texture1；null = 无 → 视为无位移场，直接返回原图）
	* @param flowYFromAlpha 方向场 y 分量是否在 A 通道（RG88 解码后 .r/.a）
	* @param mask          不透明度 mask（g_Texture3；null = 无 MASK combo）
	* @param maskFromAlpha mask 值是否在 A 通道（R8 解码后）
	*/
	render(src, w, h, flow, flowYFromAlpha, mask, maskFromAlpha, params, key, rects) {
		if (flow === null) return null;
		if (!this.ensure()) return null;
		const gl = this.gl;
		const prog = this.prog;
		if (gl === null || prog === null || this.canvas === null) return null;
		if (this.curW !== w || this.curH !== h) {
			this.canvas.width = w;
			this.canvas.height = h;
			this.curW = w;
			this.curH = h;
		}
		gl.viewport(0, 0, w, h);
		gl.useProgram(prog);
		const tex = this.uploadTexture("tex:" + key, src);
		const ftex = this.uploadTexture("flow:" + key, flow);
		if (tex === null || ftex === null) return null;
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.uniform1i(this.locs["u_Src"], 0);
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, ftex);
		gl.uniform1i(this.locs["u_Flow"], 1);
		gl.uniform1f(this.locs["u_FlowYFromAlpha"], flowYFromAlpha ? 1 : 0);
		if (mask !== null) {
			const mtex = this.uploadTexture("mask:" + key, mask);
			if (mtex === null) return null;
			gl.activeTexture(gl.TEXTURE2);
			gl.bindTexture(gl.TEXTURE_2D, mtex);
			gl.uniform1i(this.locs["u_Mask"], 2);
			gl.uniform1f(this.locs["u_UseMask"], 1);
			gl.uniform1f(this.locs["u_MaskFromAlpha"], maskFromAlpha ? 1 : 0);
		} else gl.uniform1f(this.locs["u_UseMask"], 0);
		const srcRect = rectRatio(rects?.src, src);
		const flowRect = rectRatio(rects?.flow, flow);
		const maskRect = mask !== null ? rectRatio(rects?.mask, mask) : [1, 1];
		gl.uniform2f(this.locs["u_SrcRect"], srcRect[0], srcRect[1]);
		gl.uniform2f(this.locs["u_FlowRect"], flowRect[0], flowRect[1]);
		gl.uniform2f(this.locs["u_MaskRect"], maskRect[0], maskRect[1]);
		gl.uniform1f(this.locs["u_Offset"], params.offset);
		gl.uniform1f(this.locs["u_Amp"], params.strength);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
		return this.canvas;
	}
	/** 场景切换时清空纹理缓存（保留上下文） */
	reset() {
		if (this.gl === null) return;
		for (const t of this.texCache.values()) this.gl.deleteTexture(t);
		this.texCache.clear();
		this.curW = 0;
		this.curH = 0;
	}
	/** 完全释放（renderer 生命周期结束） */
	dispose() {
		const gl = this.gl;
		if (gl === null) return;
		try {
			const ext = gl.getExtension("WEBGL_lose_context");
			if (ext !== null) ext.loseContext();
		} catch {}
		for (const t of this.texCache.values()) gl.deleteTexture(t);
		this.texCache.clear();
		if (this.prog !== null) gl.deleteProgram(this.prog);
		if (this.vbo !== null) gl.deleteBuffer(this.vbo);
		this.gl = null;
		this.prog = null;
		this.vbo = null;
		this.canvas = null;
		this.curW = 0;
		this.curH = 0;
	}
};
//#endregion
//#region src/client/Shake2D.ts
/**
* Shake2D —— shake 效果的 Canvas2D 回退实现（WebGL 不可用时）。
*
* 语义与 `ShakeGL` 一致（逐像素 UV 位移 + 不透明度 mask 混合），
* 只是用 ImageData 在 CPU 上双线性采样。为控制每帧开销：
*   - 图层像素数 ≤ SHAKE_2D_PIXEL_BUDGET 时逐像素精确位移；
*   - 超过预算的大图层先缩小到预算内，仍按每个位置的方向场形变，再放回原尺寸。
*     不能用平均方向平移整层，否则头发的局部卷曲会变成人物整体滑动。
* 纯图像处理，无 WebGL 依赖，也不触碰模块级可变状态。
*/
/** 逐像素位移的像素预算（约 1.5MP：单帧 CPU 采样约几毫秒） */
const SHAKE_2D_PIXEL_BUDGET = 15e5;
function makeCanvas(w, h) {
	const c = document.createElement("canvas");
	c.width = Math.max(1, Math.round(w));
	c.height = Math.max(1, Math.round(h));
	return c;
}
function readPixels(src, sw, sh, w, h) {
	const c = makeCanvas(w, h);
	const g = c.getContext("2d");
	if (g === null) return null;
	try {
		g.drawImage(src, 0, 0, sw, sh, 0, 0, c.width, c.height);
		return {
			data: g.getImageData(0, 0, c.width, c.height).data,
			w: c.width,
			h: c.height
		};
	} catch {
		return null;
	}
}
/** 纹理的完整画布尺寸（用于内容区域裁剪） */
function texSize(src) {
	const o = src;
	return [o.naturalWidth ?? o.width ?? 0, o.naturalHeight ?? o.height ?? 0];
}
/** 双线性采样单通道（ch = 0..3） */
function sampleChannel(r, u, v, ch) {
	const x = Math.min(r.w - 1, Math.max(0, u * r.w - .5));
	const y = Math.min(r.h - 1, Math.max(0, v * r.h - .5));
	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const fx = x - x0;
	const fy = y - y0;
	const x1 = Math.min(r.w - 1, x0 + 1);
	const y1 = Math.min(r.h - 1, y0 + 1);
	const a = r.data[(y0 * r.w + x0) * 4 + ch] * (1 - fx) + r.data[(y0 * r.w + x1) * 4 + ch] * fx;
	const b = r.data[(y1 * r.w + x0) * 4 + ch] * (1 - fx) + r.data[(y1 * r.w + x1) * 4 + ch] * fx;
	return a * (1 - fy) + b * fy;
}
/** 双线性采样 RGBA → out[0..3]（0..255） */
function sampleRGBA(r, u, v, out) {
	const x = Math.min(r.w - 1, Math.max(0, u * r.w - .5));
	const y = Math.min(r.h - 1, Math.max(0, v * r.h - .5));
	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const fx = x - x0;
	const fy = y - y0;
	const x1 = Math.min(r.w - 1, x0 + 1);
	const y1 = Math.min(r.h - 1, y0 + 1);
	for (let c = 0; c < 4; c++) {
		const a = r.data[(y0 * r.w + x0) * 4 + c] * (1 - fx) + r.data[(y0 * r.w + x1) * 4 + c] * fx;
		const b = r.data[(y1 * r.w + x0) * 4 + c] * (1 - fx) + r.data[(y1 * r.w + x1) * 4 + c] * fx;
		out[c] = a * (1 - fy) + b * fy;
	}
}
/** 官方 `flowMask = (rg - 0.498) * 2`（u/v 为图层 UV） */
function flowMaskAt(flow, u, v, yFromAlpha, out) {
	const chY = yFromAlpha ? 3 : 1;
	out[0] = (sampleChannel(flow, u, v, 0) / 255 - .498) * 2;
	out[1] = (sampleChannel(flow, u, v, chY) / 255 - .498) * 2;
}
/** 应用 shake：返回新 canvas；无方向场 / 无法读像素时返回 null（调用方画原图）。 */
function applyShake2D(input) {
	const { src, sw, sh, flow, mask } = input;
	if (flow === null || sw < 1 || sh < 1) return null;
	const out = makeCanvas(sw, sh);
	const g = out.getContext("2d");
	if (g === null) return null;
	if (input.offset === 0 || input.strength === 0) {
		g.drawImage(src, 0, 0, sw, sh, 0, 0, out.width, out.height);
		return out;
	}
	const scale = Math.min(1, Math.sqrt(SHAKE_2D_PIXEL_BUDGET / (out.width * out.height)));
	const w = Math.max(1, Math.min(SHAKE_2D_PIXEL_BUDGET, Math.floor(out.width * scale)));
	const h = Math.max(1, Math.min(Math.floor(SHAKE_2D_PIXEL_BUDGET / w), Math.floor(out.height * scale)));
	const srcR = readPixels(src, sw, sh, w, h);
	const flowR = readPixels(flow, input.rects?.flow?.w ?? (texSize(flow)[0] || w), input.rects?.flow?.h ?? (texSize(flow)[1] || h), w, h);
	if (srcR === null || flowR === null) return null;
	const maskR = mask !== null ? readPixels(mask, input.rects?.mask?.w ?? (texSize(mask)[0] || w), input.rects?.mask?.h ?? (texSize(mask)[1] || h), w, h) : null;
	if (mask !== null && maskR === null) return null;
	const amp = input.strength * input.strength;
	const off = input.offset;
	const maskCh = input.maskFromAlpha ? 3 : 0;
	const img = g.createImageData(w, h);
	const dst = img.data;
	const sampled = /* @__PURE__ */ new Float32Array(4);
	const f = /* @__PURE__ */ new Float32Array(2);
	for (let y = 0; y < h; y++) {
		const v = (y + .5) / h;
		for (let x = 0; x < w; x++) {
			const u = (x + .5) / w;
			const i = (y * w + x) * 4;
			flowMaskAt(flowR, u, v, input.flowYFromAlpha, f);
			const tox = off * amp * f[0];
			const toy = off * amp * f[1];
			if (tox === 0 && toy === 0) {
				dst[i] = srcR.data[i];
				dst[i + 1] = srcR.data[i + 1];
				dst[i + 2] = srcR.data[i + 2];
				dst[i + 3] = srcR.data[i + 3];
				continue;
			}
			sampleRGBA(srcR, u + tox, v + toy, sampled);
			const m = maskR !== null ? sampleChannel(maskR, u + tox, v + toy, maskCh) / 255 : 1;
			dst[i] = srcR.data[i] * (1 - m) + sampled[0] * m;
			dst[i + 1] = srcR.data[i + 1] * (1 - m) + sampled[1] * m;
			dst[i + 2] = srcR.data[i + 2] * (1 - m) + sampled[2] * m;
			dst[i + 3] = srcR.data[i + 3] * (1 - m) + sampled[3] * m;
		}
	}
	if (w === out.width && h === out.height) g.putImageData(img, 0, 0);
	else {
		const scaled = makeCanvas(w, h);
		const sg = scaled.getContext("2d");
		if (sg === null) return null;
		sg.putImageData(img, 0, 0);
		g.drawImage(scaled, 0, 0, out.width, out.height);
	}
	return out;
}
//#endregion
//#region src/client/shake-math.ts
/** 官方 `saturate()` */
function saturate(v) {
	return v < 0 ? 0 : v > 1 ? 1 : v;
}
/**
* 计算官方 shake 的标量位移系数 `offset`（把 shader 里的 offset 逐字搬出来）。
* 返回值 0..1（NOISE=0、无 TIMEOFFSET 分支时；见上方文档）。
*/
function shakeOffset(timeSec, p) {
	const time = p.speed * timeSec;
	const fx = p.friction[0];
	const fy = p.friction[1];
	if (p.audioProcessing === true) {
		const audioPulse = 1;
		if (p.direction === 1) return saturate(0);
		return p.direction === 0 ? audioPulse : -1;
	}
	let offset = Math.sin(time);
	offset = offset * .498 + .5;
	offset = (Math.cos(time) >= 0 ? 1 : 0) === 1 ? Math.pow(offset, fy) : 1 - Math.pow(1 - offset, fx);
	const span = p.bounds[1] - p.bounds[0];
	offset = saturate(span !== 0 ? (offset - p.bounds[0]) / span : offset - p.bounds[0]);
	if (p.direction === 0) offset = offset * 2 - 1;
	else if (p.direction === 2) offset = offset - 1;
	return offset;
}
//#endregion
//#region src/client/SceneModelRenderer.ts
/**
* puppet 网格离屏渲染：把部件网格（三角形 + UV 纹理）渲染一次到离屏 canvas。
* 模型空间（y-up，原点=图片中心）→ canvas 像素（y 向下）：
*   x_c = x_m, y_c = -y_m（绘制时经场景变换把图片中心对齐图层锚点）。
* UV v 翻转（模型 v-up → 纹理 v-down）。
* 每三角形：clip 路径 + 仿射变换（UV 三角 → 位置三角）+ drawImage 纹理。
* 骨骼蒙皮（规范）：M_inv_bind_i = inverse(bind_i)；
*   M_skin_i = M_global_i × M_inv_bind_i，静止骨骼 M_global = bind → M_skin = I；
*   动画骨骼（骨骼 0）M_global_0 = T(bx,by) × Rz(rot) × T(-bx,-by) × bind_0；
*   skinPos = Σ w_k × M_skin_{boneIdx[k]} × pos（4 权重 + 4 骨骼索引）。
* anim 可选：{rot, bx, by} = 动画骨骼（骨骼 0）绕其 bind 位置的旋转。
*/
function buildMeshCanvas(mesh, tex, anim, binds, boneMats) {
	const posArr = [];
	if (boneMats !== void 0 && boneMats !== null && boneMats.length > 0) {
		const skin = computeSkinMatrices(binds ?? [], boneMats);
		for (const v of mesh.vertices) {
			const sp = skinVertex(v.pos, v.weights ?? [], v.boneIndices ?? [], skin);
			posArr.push([sp[0], sp[1]]);
		}
	} else if (anim !== void 0 && anim !== null) {
		const anim0 = mat4Mul(mat4TRS(anim.bx, anim.by, 0, 0, 1, 1, 1), mat4Mul(mat4TRS(0, 0, 0, anim.rot, 1, 1, 1), mat4TRS(-anim.bx, -anim.by, 0, 0, 1, 1, 1)));
		const n = binds !== null && binds !== void 0 ? binds.length : 1;
		const animMats = [];
		for (let i = 0; i < n; i++) {
			const bind = binds !== null && binds !== void 0 ? binds[i] : null;
			animMats.push(i === 0 ? mat4Mul(anim0, bind ?? mat4Identity()) : bind ?? null);
		}
		const skin = computeSkinMatrices(binds ?? [], animMats);
		for (const v of mesh.vertices) {
			const sp = skinVertex(v.pos, v.weights ?? [], v.boneIndices ?? [], skin);
			posArr.push([sp[0], sp[1]]);
		}
	} else for (const v of mesh.vertices) posArr.push([v.pos[0], v.pos[1]]);
	let mnx = Infinity;
	let mny = Infinity;
	let mxx = -Infinity;
	let mxy = -Infinity;
	for (const [x, y] of posArr) {
		const yy = -y;
		if (x < mnx) mnx = x;
		if (yy < mny) mny = yy;
		if (x > mxx) mxx = x;
		if (yy > mxy) mxy = yy;
	}
	const c0 = document.createElement("canvas");
	c0.width = 1;
	c0.height = 1;
	if (!Number.isFinite(mnx) || mxx - mnx > 2e4 || mxy - mny > 2e4) return {
		canvas: c0,
		originX: 0,
		originY: 0
	};
	const pad = 4;
	const cw = Math.max(1, Math.ceil(mxx - mnx) + 8);
	const ch = Math.max(1, Math.ceil(mxy - mny) + 8);
	const c = document.createElement("canvas");
	c.width = cw;
	c.height = ch;
	const g = c.getContext("2d");
	if (g === null) return {
		canvas: c,
		originX: pad - mnx,
		originY: pad - mny
	};
	g.translate(pad - mnx, pad - mny);
	const tw = tex.width;
	const th = tex.height;
	const verts = mesh.vertices;
	const idx = mesh.indices;
	for (let i = 0; i + 2 < idx.length; i += 3) {
		const a = verts[idx[i]];
		const b = verts[idx[i + 1]];
		const cc = verts[idx[i + 2]];
		if (a === void 0 || b === void 0 || cc === void 0) continue;
		const fv = (val) => (mesh.flipV ? 1 - val : val) * th;
		const u0 = a.uv[0] * tw;
		const v0 = fv(a.uv[1]);
		const u1 = b.uv[0] * tw;
		const v1 = fv(b.uv[1]);
		const u2 = cc.uv[0] * tw;
		const v2 = fv(cc.uv[1]);
		const x0 = posArr[idx[i]][0];
		const y0 = -posArr[idx[i]][1];
		const x1 = posArr[idx[i + 1]][0];
		const y1 = -posArr[idx[i + 1]][1];
		const x2 = posArr[idx[i + 2]][0];
		const y2 = -posArr[idx[i + 2]][1];
		const det = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
		if (Math.abs(det) < 1e-9) continue;
		g.save();
		g.beginPath();
		g.moveTo(x0, y0);
		g.lineTo(x1, y1);
		g.lineTo(x2, y2);
		g.closePath();
		g.clip();
		const m00 = ((x1 - x0) * (v2 - v0) - (x2 - x0) * (v1 - v0)) / det;
		const m01 = ((u1 - u0) * (x2 - x0) - (u2 - u0) * (x1 - x0)) / det;
		const m10 = ((y1 - y0) * (v2 - v0) - (y2 - y0) * (v1 - v0)) / det;
		const m11 = ((u1 - u0) * (y2 - y0) - (u2 - u0) * (y1 - y0)) / det;
		g.transform(m00, m10, m01, m11, x0 - m00 * u0 - m01 * v0, y0 - m10 * u0 - m11 * v0);
		g.drawImage(tex, 0, 0);
		g.restore();
	}
	return {
		canvas: c,
		originX: pad - mnx,
		originY: pad - mny
	};
}
/**
* 把 scene.json animationlayers 映射到 MDLA 新格式动画索引（官方语义）：
* 仅 visible=true 层参与；动画选择 = id 直配 → 名字匹配 → "动画 N" 数字后缀 → 层索引回退。
* 多动画 + 非空 layers 时按此合成；否则回退单动画（动画 0）。
*/
function resolveAnimLayers(puppet, layer) {
	if (puppet.animsV2.length > 1 && layer.animationLayers.length > 0) {
		const out = [];
		for (const l of layer.animationLayers) {
			if (!l.visible) continue;
			const blend = l.blend >= 0 && l.blend <= 1 ? l.blend : 1;
			const rate = l.rate > 0 ? l.rate : 1;
			let idx = -1;
			if (l.animation !== null) idx = puppet.animsV2.findIndex((a) => a.id === l.animation);
			if (idx < 0 && l.name !== null && l.name !== "") idx = puppet.animsV2.findIndex((a) => a.name !== "" && a.name === l.name);
			if (idx < 0 && l.name !== null) {
				const m = String(l.name).match(/(\d+)/);
				if (m !== null) {
					const n = parseInt(m[1], 10);
					if (n >= 1 && n <= puppet.animsV2.length) idx = n - 1;
				}
			}
			if (idx < 0) {
				const li = layer.animationLayers.indexOf(l);
				if (li >= 0 && li < puppet.animsV2.length) idx = li;
			}
			if (idx < 0) idx = 0;
			out.push({
				animIdx: idx,
				blend,
				rate,
				additive: l.additive
			});
		}
		if (out.length > 0) return out;
	}
	return [{
		animIdx: 0,
		blend: 1,
		rate: 1,
		additive: false
	}];
}
/** 新格式静态检测：所有合成层的帧 0 / 1 / 中 三采样位姿全同 → 静态（不播放） */
function isStaticPuppetV2(puppet, layers) {
	for (const L of layers) {
		const fc = Math.max(1, puppet.animsV2[L.animIdx]?.frameCount ?? 1);
		const f0 = samplePuppetRT(puppet, L.animIdx, 0);
		const f1 = fc > 1 ? samplePuppetRT(puppet, L.animIdx, 1) : f0;
		const fm = fc > 2 ? samplePuppetRT(puppet, L.animIdx, Math.floor(fc / 2)) : f0;
		const nb = Math.max(f0.length, f1.length, fm.length);
		for (let b = 0; b < nb; b++) {
			const a = f0[b];
			const c = f1[b];
			const d = fm[b];
			if (a === null || c === null || d === null) continue;
			if (Math.abs(a.angle - c.angle) > 1e-4 || Math.abs(a.tx - c.tx) > .001 || Math.abs(a.ty - c.ty) > .001) return false;
			if (Math.abs(a.angle - d.angle) > 1e-4 || Math.abs(a.tx - d.tx) > .001 || Math.abs(a.ty - d.ty) > .001) return false;
		}
	}
	return true;
}
/** 链乘 MDLS 局部矩阵 → 每骨骼 bind 世界位姿（列主序；parent 链 2D 分解） */
function computeBindWorldRT(puppet) {
	const bones = puppet.bones;
	const nb = bones.length;
	const bindWorld = new Array(nb);
	for (let b = 0; b < nb; b++) {
		const local = bones[b].bind ?? bones[b].pose ?? null;
		const parent = bones[b].parent;
		bindWorld[b] = local === null ? parent >= 0 && parent < nb ? bindWorld[parent] ?? null : null : parent >= 0 && parent < nb && bindWorld[parent] !== null && bindWorld[parent] !== void 0 ? mat4Mul(bindWorld[parent], local) : local;
	}
	return bindWorld.map((m) => m !== null ? {
		angle: Math.atan2(m[1], m[0]),
		tx: m[12],
		ty: m[13]
	} : {
		angle: 0,
		tx: 0,
		ty: 0
	});
}
/**
* 粒子纹理径向软边合成：中心不衰减，边缘 30% 区间线性淡出到透明。
* 用于雾/雪/光晕类粒子，避免硬边方块在大尺寸 + additive 下叠加成"白线"。
*/
function makeSoftTexture(src) {
	const w = src.width;
	const h = src.height;
	const c = document.createElement("canvas");
	c.width = w;
	c.height = h;
	const g = c.getContext("2d");
	if (g === null) return c;
	g.drawImage(src, 0, 0);
	const cx = w / 2;
	const cy = h / 2;
	const r = Math.max(1, Math.min(w, h) / 2);
	const grad = g.createRadialGradient(cx, cy, r * .65, cx, cy, r);
	grad.addColorStop(0, "rgba(255,255,255,1)");
	grad.addColorStop(1, "rgba(255,255,255,0)");
	g.globalCompositeOperation = "destination-in";
	g.fillStyle = grad;
	g.fillRect(0, 0, w, h);
	return c;
}
/**
* waterwaves 效果（Canvas2D 条带近似），对照官方 shader：
*   vert:  v_Direction = rotateVec2((0,1), θ) = (-sinθ, cosθ)   ← 传播方向
*   frag:  distance = t*speed + dot(uv, v_Direction)*scale
*          offset = (v_Direction.y, -v_Direction.x) = (cosθ, sinθ)  ← 扰动方向
*          texCoord += sign(sin)^exp * |sin|^exp * strength² * offset * mask
* 条带 = 等 phase 线（垂直 v_Direction，即沿 offset），带内沿 offset 整体平移；
* 多个 waterwaves（ww1-ww4）扰动叠加；mask 限制扰动区域。
*/
function applyWaterwaves(src, w, h, waves, time, mask) {
	const c = document.createElement("canvas");
	c.width = w;
	c.height = h;
	const g = c.getContext("2d");
	if (g === null) return c;
	const theta = waves[0].direction;
	const offx = Math.cos(theta);
	const offy = Math.sin(theta);
	const bands = w * h > 9e5 ? 32 : 48;
	const horizontal = Math.abs(offx) >= Math.abs(offy);
	let maskAvg = null;
	if (mask !== null && mask !== void 0) {
		const mc = document.createElement("canvas");
		mc.width = 64;
		mc.height = 64;
		const mg = mc.getContext("2d");
		if (mg !== null) {
			mg.drawImage(mask, 0, 0, 64, 64);
			const img = mg.getImageData(0, 0, 64, 64);
			maskAvg = [];
			for (let i = 0; i < bands; i++) {
				let sumR = 0;
				let sumA = 0;
				let cnt = 0;
				if (horizontal) {
					const x0 = Math.floor(i / bands * 64);
					const x1 = Math.max(x0 + 1, Math.floor((i + 1) / bands * 64));
					for (let x = x0; x < x1; x++) for (let y = 0; y < 64; y++) {
						sumR += img.data[(y * 64 + x) * 4];
						sumA += img.data[(y * 64 + x) * 4 + 3];
						cnt++;
					}
				} else {
					const y0 = Math.floor(i / bands * 64);
					const y1 = Math.max(y0 + 1, Math.floor((i + 1) / bands * 64));
					for (let y = y0; y < y1; y++) for (let x = 0; x < 64; x++) {
						sumR += img.data[(y * 64 + x) * 4];
						sumA += img.data[(y * 64 + x) * 4 + 3];
						cnt++;
					}
				}
				const useA = sumR >= cnt * 254;
				maskAvg.push(cnt > 0 ? (useA ? sumA : sumR) / cnt / 255 : 0);
			}
		}
	}
	if (horizontal) {
		const bw = w / bands;
		for (let i = 0; i < bands; i++) {
			const x0 = i * bw;
			const cx = (x0 + bw / 2) / w;
			let disp = 0;
			for (const p of waves) {
				const s = p.strength * p.strength;
				const e = Math.max(.5, Math.min(4, p.exponent));
				const phase = time * p.speed + (cx * -Math.sin(p.direction) + .5 * Math.cos(p.direction)) * p.scale;
				const val = Math.sin(phase);
				disp += Math.sign(val) * Math.pow(Math.abs(val), e) * s * Math.cos(p.direction) * w;
			}
			disp *= maskAvg !== null ? maskAvg[i] : 1;
			g.drawImage(src, x0, 0, bw + .5, h, x0 + disp, 0, bw + .5, h);
		}
	} else {
		const bh = h / bands;
		for (let i = 0; i < bands; i++) {
			const y0 = i * bh;
			const cy = (y0 + bh / 2) / h;
			let disp = 0;
			for (const p of waves) {
				const s = p.strength * p.strength;
				const e = Math.max(.5, Math.min(4, p.exponent));
				const phase = time * p.speed + (.5 * -Math.sin(p.direction) + cy * Math.cos(p.direction)) * p.scale;
				const val = Math.sin(phase);
				disp += Math.sign(val) * Math.pow(Math.abs(val), e) * s * Math.sin(p.direction) * h;
			}
			disp *= maskAvg !== null ? maskAvg[i] : 1;
			g.drawImage(src, 0, y0, w, bh + .5, 0, y0 + disp, w, bh + .5);
		}
	}
	return c;
}
var SceneModelRenderer = class SceneModelRenderer {
	el = null;
	ctx = null;
	model = null;
	base = null;
	layerTextures = /* @__PURE__ */ new Map();
	/** 效果 mask 纹理（waterwaves 的 opacitymask）+ 通道模式（true=R8 alpha 语义用 A） */
	effectMasks = /* @__PURE__ */ new Map();
	/** shake 效果纹理：**每个 shake pass** 一组方向场（g_Texture1）+ 不透明度 mask（g_Texture3）。
	*  WE 把 scene.json 里列出的每个 effect 当作一次独立 pass 依次作用于图层纹理，
	*  同一图层挂多个 shake（如 3258032485 单层 8 个方向场 = 各处毛发拉伸）必须逐个串联。 */
	shakeTex = /* @__PURE__ */ new Map();
	/** WebGL shake 渲染器（惰性创建；多 pass 串联时与 shakeGL2 乒乓复用，避免读同一张纹理） */
	shakeGL = null;
	shakeGL2 = null;
	/** WebGL waterwaves 渲染器（惰性创建） */
	wwGL = null;
	/** WebGL nitro 渲染器（惰性创建） */
	nitroGL = null;
	/** nitro 效果纹理：图层 id → { 噪声, 各 nitro mask } */
	nitroTex = /* @__PURE__ */ new Map();
	/** 图层纹理的 Image 内容区域尺寸（tex 画布内左上角）；无则用位图原生尺寸 */
	layerTexImage = /* @__PURE__ */ new Map();
	/** 图层 spritesheet 序列帧动画元数据：图层 id → { 帧数, 帧宽, 帧高, 单帧时长（秒）, 帧矩形 }。
	*  (GIF/切分图片动画：纹理含 TEXS 动画段，渲染按时间取帧裁剪) */
	layerSprite = /* @__PURE__ */ new Map();
	/** spritesheet 当前帧裁剪缓存：图层 id → { 帧号, 裁剪矩形, canvas }（帧切换时重建） */
	spriteFrameCache = /* @__PURE__ */ new Map();
	/** 图层世界变换（递归 parent 合并；局部 y-up 翻转） */
	worldTransform = /* @__PURE__ */ new Map();
	/** 图层 id → 图层（链式查找 puppet 祖先用） */
	byId = /* @__PURE__ */ new Map();
	runtimes = /* @__PURE__ */ new Map();
	/** 折射背景快照缓存（每帧只复制一次，多折射层共享） */
	bgCache = null;
	/** WebGL 粒子实例化渲染器（叠加层） */
	particleGL = null;
	glCanvas = null;
	/** 每帧折射背景是否已上传 WebGL（只传一次） */
	bgUploaded = false;
	/** 静态图像层离屏缓存（无动画层只渲染一次，每帧合成） */
	staticBg = null;
	staticBgReady = false;
	/** 前缀静态层 id 集合（只缓存 z-order 底部的连续静态层段，避免动态层被压序） */
	staticPrefixIds = /* @__PURE__ */ new Set();
	/** 已就「无可用纹理」告警过的图层 id（占位/composelayer 层只提示一次，不再画调试脚手架） */
	warnedNoTexture = /* @__PURE__ */ new Set();
	/** 单层绘制异常只警告一次的图层 id（一层出错不再吃掉整帧） */
	failedLayers = /* @__PURE__ */ new Set();
	/** WebGL 粒子渲染开关（坐标空间已修正，开启） */
	static USE_WEBGL_PARTICLES = true;
	/** puppet 动画状态：puppet 图层 id → { 动画, 播放时间 } */
	puppetAnims = /* @__PURE__ */ new Map();
	/** 每帧计算的动画变换：puppet 图层 id → 平移/旋转 */
	animXform = /* @__PURE__ */ new Map();
	/** 0013 老格式逐骨骼动画全局矩阵：puppet 图层 id → 每骨骼动画矩阵（TRS，绝对姿态） */
	boneAnimMats = /* @__PURE__ */ new Map();
	/** 新格式（MDLA0006）逐骨骼动画全局矩阵（列主序世界）：puppet 图层 id → 每骨骼 */
	puppetGlobalMats = /* @__PURE__ */ new Map();
	/** 新格式逐骨骼链乘 bind 世界矩阵（M_skin = M_global × inv(bindWorld)） */
	puppetBindWorld = /* @__PURE__ */ new Map();
	/** 新格式逐骨骼最终位姿 {angle,tx,ty}（attachment 锚点跟随用） */
	puppetPosesRT = /* @__PURE__ */ new Map();
	/** 新格式动画播放状态：图层 id → { 合成层, 播放时间 } */
	puppetAnimsV2 = /* @__PURE__ */ new Map();
	/** 新格式 bind 世界位姿缓存（静态，attachment 无动画帧时用）：图层 id → 每骨骼 */
	bindWorldCache = /* @__PURE__ */ new Map();
	/** puppet 网格离屏渲染缓存：图层 id → { canvas, 模型原点 } */
	meshCanvases = /* @__PURE__ */ new Map();
	dpr = 1;
	live = false;
	closed = false;
	rafId = 0;
	lastT = 0;
	/** 全局动画时间（秒，effects/粒子用） */
	animTime = 0;
	blurPx = 0;
	scale = 1;
	monitor = "";
	version = 0;
	handlers;
	/** 粒子层日志节流（layer.id → 上次时间） */
	lastParticleLog = /* @__PURE__ */ new Map();
	constructor(handlers = {}) {
		this.handlers = handlers;
	}
	get isLive() {
		return this.live;
	}
	start(monitor, version) {
		if (this.live && this.monitor === monitor && this.version === version && this.model !== null) {
			this.applyVisuals();
			return;
		}
		this.stop();
		this.closed = false;
		this.monitor = monitor;
		this.version = version;
		this.el = document.createElement("canvas");
		this.el.style.position = "fixed";
		this.el.style.top = "0";
		this.el.style.left = "0";
		this.el.style.width = "100%";
		this.el.style.height = "100%";
		this.el.style.zIndex = "-2";
		this.el.style.pointerEvents = "none";
		this.el.style.border = "0";
		document.body.appendChild(this.el);
		this.ctx = this.el.getContext("2d");
		if (SceneModelRenderer.USE_WEBGL_PARTICLES && this.particleGL === null) {
			this.glCanvas = document.createElement("canvas");
			this.particleGL = new ParticleGL(this.glCanvas);
			if (!this.particleGL.available) {
				this.particleGL.dispose();
				this.particleGL = null;
				this.glCanvas = null;
			}
		}
		this.resize();
		this.applyVisuals();
		window.addEventListener("resize", this.onResize);
		document.addEventListener("visibilitychange", this.onVisibility);
		this.load();
	}
	stop() {
		this.closed = true;
		if (this.rafId !== 0) {
			cancelAnimationFrame(this.rafId);
			this.rafId = 0;
		}
		window.removeEventListener("resize", this.onResize);
		document.removeEventListener("visibilitychange", this.onVisibility);
		if (this.el !== null) {
			this.el.remove();
			this.el = null;
			this.ctx = null;
		}
		if (this.particleGL !== null) this.particleGL.reset();
		this.model = null;
		this.base = null;
		for (const bmp of this.layerTextures.values()) try {
			bmp.close();
		} catch {}
		this.layerTextures.clear();
		this.layerTexImage.clear();
		this.layerSprite.clear();
		this.spriteFrameCache.clear();
		this.worldTransform.clear();
		this.byId.clear();
		this.puppetAnims.clear();
		this.puppetAnimsV2.clear();
		this.animXform.clear();
		this.boneAnimMats.clear();
		this.puppetGlobalMats.clear();
		this.puppetBindWorld.clear();
		this.puppetPosesRT.clear();
		this.bindWorldCache.clear();
		this.meshCanvases.clear();
		for (const v of this.effectMasks.values()) try {
			if ("close" in v.bmp) v.bmp.close();
		} catch {}
		this.effectMasks.clear();
		for (const v of this.shakeTex.values()) for (const one of v) {
			try {
				one.flow.close();
			} catch {}
			if (one.mask !== null) try {
				one.mask.close();
			} catch {}
		}
		this.shakeTex.clear();
		if (this.wwGL !== null) this.wwGL.reset();
		if (this.shakeGL !== null) this.shakeGL.reset();
		if (this.shakeGL2 !== null) this.shakeGL2.reset();
		for (const rt of this.runtimes.values()) rt.dispose();
		this.runtimes.clear();
		this.staticBg = null;
		this.staticBgReady = false;
		this.staticPrefixIds.clear();
		this.warnedNoTexture.clear();
		this.failedLayers.clear();
		this.setLive(false);
	}
	/** 完全销毁（renderer 生命周期结束）：释放 WebGL 上下文 + 移除叠加画布 */
	destroy() {
		this.stop();
		if (this.particleGL !== null) {
			this.particleGL.dispose();
			this.particleGL = null;
		}
		if (this.glCanvas !== null) this.glCanvas = null;
		if (this.wwGL !== null) {
			this.wwGL.dispose();
			this.wwGL = null;
		}
		if (this.shakeGL !== null) {
			this.shakeGL.dispose();
			this.shakeGL = null;
		}
		if (this.shakeGL2 !== null) {
			this.shakeGL2.dispose();
			this.shakeGL2 = null;
		}
	}
	applyVisuals(blurPx, scale) {
		if (blurPx !== void 0) this.blurPx = blurPx;
		if (scale !== void 0) this.scale = scale;
		if (this.el !== null) {
			this.el.style.filter = "blur(" + Math.round(this.blurPx) + "px)";
			this.el.style.transform = "scale(" + this.scale.toFixed(3) + ")";
		}
	}
	/** 昼夜 alpha 因子（0-1）：按本地时长的日出/日落小时计算当前是夜还是昼。
	*  - 默认夜间（<dayStart 或 >dayEnd）→ nightWhenStart/nightWhenEnd 端为 1（夜空层显示）；
	*  - 白天（dayStart..dayEnd）→ 另一侧为 1。
	*  这是 auto 模式（真实时钟驱动），不依赖任何用户控件。 */
	dayNightFactor(dn) {
		const now = /* @__PURE__ */ new Date();
		const hour = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
		const { dayStartH: s, dayEndH: e, nightWhenStart, nightWhenEnd } = dn;
		if (s > e) return hour >= s || hour < e ? nightWhenStart ? 1 : 0 : nightWhenStart ? 0 : 1;
		return hour < s || hour >= e ? nightWhenStart ? 1 : 0 : nightWhenStart ? 0 : 1;
	}
	async load() {
		if (this.closed) return;
		let model;
		try {
			const res = await fetch("/we-sync/scene/model?monitor=" + encodeURIComponent(this.monitor) + "&v=" + this.version, { cache: "no-store" });
			if (!res.ok) throw new Error("model " + res.status);
			model = await res.json();
		} catch {
			this.fail();
			return;
		}
		if (this.closed) return;
		this.model = model;
		this.byId.clear();
		for (const l of model.layers) this.byId.set(l.id, l);
		this.computeWorldTransforms();
		this.setLive(true);
		{
			const dnLayers = model.layers.filter((l) => l.dayNight !== void 0);
			console.log("[scene:dayNight] 壁纸 " + this.monitor + " 共 " + model.layers.length + " 层，" + dnLayers.length + " 层带昼夜脚本: " + (dnLayers.length === 0 ? "(无)" : dnLayers.map((l) => l.name + "#" + l.id + " DN=" + JSON.stringify(l.dayNight) + " factor=" + (l.alpha * this.dayNightFactor(l.dayNight)).toFixed(3)).join(" | ")));
		}
		this.loadBase(model);
		const jobs = [];
		for (const layer of model.layers) {
			jobs.push(this.loadLayerTexture(layer));
			jobs.push(this.loadEffectTextures(layer));
		}
		/** 粒子系统：创建运行时 + 加载粒子纹理（引擎资产 /we-sync/asset/texture） */
		for (const layer of model.layers) if (layer.particle !== null) {
			const rt = new ParticleRuntime(layer.particle, model.particleRateScale, model.particleSizeScale);
			this.runtimes.set(layer.id, rt);
			rt.preSimulate();
			for (const sub of rt.collect()) {
				jobs.push(this.loadParticleTexture(sub.rt, sub.texName));
				if (sub.normalName !== null) jobs.push(this.loadParticleNormalTexture(sub.rt, sub.normalName));
			}
		}
		for (const layer of model.layers) {
			if (layer.puppet === null) continue;
			if (layer.puppet.animsV2.length > 0) {
				this.bindWorldCache.set(layer.id, computeBindWorldRT(layer.puppet));
				const layers = resolveAnimLayers(layer.puppet, layer);
				if (isStaticPuppetV2(layer.puppet, layers)) continue;
				this.puppetAnimsV2.set(layer.id, {
					layers,
					time: 0
				});
				continue;
			}
			if (layer.puppet.animations.length === 0) continue;
			const anim = layer.animationIds.length > 0 ? layer.puppet.animations.find((a) => layer.animationIds.includes(a.id)) ?? layer.puppet.animations[0] : layer.puppet.animations[0];
			if (anim.keyframes.length < 2) continue;
			if (anim.old13 && anim.boneKeyframes !== void 0 && anim.boneKeyframes.length > 1) {
				let anyAnim = false;
				for (const bk of anim.boneKeyframes) {
					if (bk.length < 2) continue;
					for (let vi = 0; vi < 9; vi++) {
						let mn = Infinity, mx = -Infinity;
						for (const k of bk) {
							const v = k.values[vi];
							if (!Number.isFinite(v)) continue;
							if (v < mn) mn = v;
							if (v > mx) mx = v;
						}
						if (Number.isFinite(mn) && mx - mn > .01) {
							anyAnim = true;
							break;
						}
					}
					if (anyAnim) break;
				}
				if (!anyAnim) continue;
			} else {
				const kf = anim.keyframes;
				let maxSpan = 0;
				for (let vi = 0; vi < 8; vi++) {
					let mn = Infinity;
					let mx = -Infinity;
					for (const k of kf) {
						const v = k.values[vi];
						if (!Number.isFinite(v)) continue;
						if (v < mn) mn = v;
						if (v > mx) mx = v;
					}
					if (Number.isFinite(mn) && mx - mn > maxSpan) maxSpan = mx - mn;
				}
				if (maxSpan < .01) continue;
			}
			this.puppetAnims.set(layer.id, {
				anim,
				time: 0
			});
		}
		if (jobs.length > 0) await Promise.all(jobs);
		if (this.closed) return;
		this.staticBg = null;
		this.staticBgReady = false;
		this.buildStaticBg();
		if (!this.closed) this.startAnimation();
	}
	/**
	* 递归合并 parent 层级变换（含 attachment 骨骼挂载）。
	* 顶层（无 parent）：WE 场景坐标 **y 向上** → 屏幕 y = 场景高 - origin.y。
	* 子图层：局部坐标 y 向上，父 scale 施加于子的位移与尺寸。
	* attachment（如 "head"/"Attachment"）：子层挂到 parent puppet 的具名骨骼锚点，
	* 锚点 = 锚定骨骼最终世界位姿（动画合成后）+ R(骨骼角)·锚点局部矩阵平移 + 子层 origin。
	*/
	computeWorldTransforms() {
		const model = this.model;
		if (model === null) return;
		const H = model.height;
		const byId = /* @__PURE__ */ new Map();
		for (const l of model.layers) byId.set(l.id, l);
		const cache = /* @__PURE__ */ new Map();
		const walk = (l) => {
			const hit = cache.get(l.id);
			if (hit !== void 0) return hit;
			let t;
			const parent = l.parent !== null ? byId.get(l.parent) : void 0;
			if (parent !== void 0) {
				const p = walk(parent);
				let ao = null;
				if (l.attachment !== null && parent.puppet !== null) {
					const anchor = parent.puppet.boneAnchors.find((a) => a.name === l.attachment);
					if (anchor !== void 0 && anchor.boneIdx >= 0 && anchor.boneIdx < parent.puppet.bones.length) {
						if (parent.puppet.animsV2.length > 0) {
							const pose = this.puppetPosesRT.get(parent.id)?.[anchor.boneIdx] ?? this.bindWorldCache.get(parent.id)?.[anchor.boneIdx] ?? null;
							if (pose !== null && pose !== void 0) {
								const c = Math.cos(pose.angle);
								const s = Math.sin(pose.angle);
								ao = [pose.tx + anchor.m[12] * c - anchor.m[13] * s, pose.ty + anchor.m[12] * s + anchor.m[13] * c];
							}
						} else ao = [anchor.m[12], anchor.m[13]];
					}
				}
				t = {
					ox: p.ox + p.sx * (l.origin[0] + (ao !== null ? ao[0] : 0)),
					oy: p.oy - p.sy * (l.origin[1] + (ao !== null ? ao[1] : 0)),
					sx: p.sx * (l.scale[0] ?? 1),
					sy: p.sy * (l.scale[1] ?? 1)
				};
			} else t = {
				ox: l.origin[0],
				oy: H - l.origin[1],
				sx: l.scale[0] ?? 1,
				sy: l.scale[1] ?? 1
			};
			cache.set(l.id, t);
			return t;
		};
		for (const l of model.layers) walk(l);
		this.worldTransform = cache;
	}
	async loadParticleTexture(rt, name) {
		try {
			const res = await fetch("/we-sync/asset/texture?name=" + encodeURIComponent(name), { cache: "no-store" });
			if (!res.ok) {
				console.warn("[particle tex] 加载失败", name, res.status);
				return;
			}
			const frames = Number(res.headers.get("X-Sprite-Frames") ?? "0");
			const fw = Number(res.headers.get("X-Sprite-Width") ?? "0");
			const fh = Number(res.headers.get("X-Sprite-Height") ?? "0");
			const blob = await res.blob();
			const bmp = await createImageBitmap(blob);
			if (this.closed) {
				bmp.close();
				return;
			}
			let tex = bmp;
			if (bmp.width < 128 && bmp.height < 128) {
				tex = makeSoftTexture(bmp);
				bmp.close();
			}
			if (this.closed) return;
			rt.setTexture(tex, frames > 1 && fw > 0 && fh > 0 ? frames : 0, fw, fh);
		} catch (err) {
			console.warn("[particle tex] 加载/解码失败", name, err);
		}
	}
	/** 加载粒子折射法线纹理（REFRACT 材质第二个纹理，如 rain_drops_sheet_normal）。
	*  法线纹理不做软边处理（需要原始 R/G/A 通道做 shader 解压）。 */
	async loadParticleNormalTexture(rt, name) {
		try {
			const res = await fetch("/we-sync/asset/texture?name=" + encodeURIComponent(name), { cache: "no-store" });
			if (!res.ok) {
				console.warn("[particle normal tex] 加载失败", name, res.status);
				return;
			}
			const frames = Number(res.headers.get("X-Sprite-Frames") ?? "0");
			const fw = Number(res.headers.get("X-Sprite-Width") ?? "0");
			const fh = Number(res.headers.get("X-Sprite-Height") ?? "0");
			const blob = await res.blob();
			const bmp = await createImageBitmap(blob);
			if (this.closed) {
				bmp.close();
				return;
			}
			rt.setNormalTexture(bmp, frames > 1 && fw > 0 && fh > 0 ? frames : 0, fw, fh);
		} catch (err) {
			console.warn("[particle normal tex] 加载/解码失败", name, err);
		}
	}
	async loadLayerTexture(layer) {
		if (this.layerTextures.has(layer.id)) return;
		const candidates = layer.decodableTexture !== null ? [layer.decodableTexture, ...layer.textureRefs.filter((t) => t !== layer.decodableTexture)] : layer.textureRefs;
		for (const name of candidates) {
			if (this.closed) return;
			const got = await this.fetchTexture(name);
			if (got === null) continue;
			if (this.closed) {
				got.bmp.close();
				return;
			}
			this.layerTextures.set(layer.id, got.bmp);
			if (got.imgW > 0 && got.imgH > 0) this.layerTexImage.set(layer.id, [got.imgW, got.imgH]);
			if (got.sprite !== null) this.layerSprite.set(layer.id, got.sprite);
			this.startAnimation();
			return;
		}
	}
	/**
	* 图层效果纹理（与图层自身纹理互相独立，必须单独加载）：
	*   - waterwaves：g_Texture1 不透明度 mask（门控扰动区域）
	*   - shake：g_Texture1 方向场（flowmask）+ g_Texture3 不透明度 mask（MASK combo）
	* 此前这些加载被写在「图层纹理全部候选都失败」之后（`return` 之前不可达），
	* 导致有纹理的图层永远拿不到效果 mask —— shake 退化成整层滑动、
	* waterwaves 退化成全图扰动。现按效果类型独立加载。
	*/
	async loadEffectTextures(layer) {
		if (this.closed) return;
		if (layer.effects.some((e) => e.type === "waterwaves" && e.mask !== null) && !this.effectMasks.has(layer.id)) for (const e of layer.effects) {
			const m = e.type === "waterwaves" ? e.mask : null;
			if (m === null || this.effectMasks.has(layer.id)) continue;
			try {
				const got = await this.fetchEffectTexture(m);
				if (got === null) continue;
				if (this.closed) {
					got.bmp.close();
					return;
				}
				this.effectMasks.set(layer.id, {
					bmp: got.bmp,
					useA: this.texValueInAlpha(got.bmp)
				});
				this.startAnimation();
			} catch {}
		}
		const shakes = layer.effects.filter((e) => e.type === "shake");
		if (shakes.length > 0 && !this.shakeTex.has(layer.id)) {
			if (shakes.filter((e) => typeof e.flow !== "string" || e.flow === null || e.flow === "").length === shakes.length) console.warn("[scene:effect] 图层 #" + layer.id + " " + layer.name + " 的 " + shakes.length + " 个 shake 都没有方向场字段（flow）——node 半是旧产物，请**重启 DSH 进程**后刷新页面");
			const loaded = [];
			try {
				for (const [passIndex, shk] of shakes.entries()) {
					if (typeof shk.flow !== "string" || shk.flow === "") continue;
					const flow = await this.fetchEffectTexture(shk.flow);
					if (flow === null) continue;
					if (this.closed) {
						flow.bmp.close();
						break;
					}
					let mask = null;
					if (shk.mask !== null) {
						mask = await this.fetchEffectTexture(shk.mask);
						if (this.closed) {
							flow.bmp.close();
							if (mask !== null) mask.bmp.close();
							break;
						}
					}
					loaded.push({
						passIndex,
						flow: flow.bmp,
						flowW: flow.imgW,
						flowH: flow.imgH,
						flowYFromAlpha: this.texChannelsDuplicated(flow.bmp),
						mask: mask !== null ? mask.bmp : null,
						maskW: mask !== null ? mask.imgW : 0,
						maskH: mask !== null ? mask.imgH : 0,
						maskFromAlpha: mask !== null ? this.texValueInAlpha(mask.bmp) : false
					});
				}
				if (loaded.length > 0) {
					this.shakeTex.set(layer.id, loaded);
					console.log("[scene:effect] 图层 #" + layer.id + " " + layer.name + "：shake 生效 " + loaded.length + "/" + shakes.length + " pass（方向场 " + loaded.map((x) => x.mask !== null ? "flow+mask" : "flow").join(", ") + "）");
					this.startAnimation();
				} else if (shakes.length > 0) console.warn("[scene:effect] 图层 #" + layer.id + " " + layer.name + "：shake 方向场加载失败（" + shakes.length + " 个 pass 全部不可用）");
			} catch {}
		}
		const nitros = layer.effects.filter((e) => e.type === "nitro");
		if (nitros.length > 0 && !this.nitroTex.has(layer.id)) {
			const jobs = [];
			let noiseBmp = null;
			const masks = new Array(nitros.length).fill(null);
			const noiseName = nitros[0].noise;
			if (noiseName !== null && noiseName !== "") jobs.push((async () => {
				try {
					const res = await fetch("/we-sync/asset/texture?name=" + encodeURIComponent(noiseName), { cache: "no-store" });
					if (res.ok) noiseBmp = await createImageBitmap(await res.blob());
				} catch {}
			})());
			for (let i = 0; i < nitros.length; i++) {
				const m = nitros[i].mask;
				if (m === null || m === "") continue;
				const maskName = m.startsWith("materials/") ? m : "materials/" + m + ".tex";
				const idx = i;
				jobs.push((async () => {
					try {
						const res = await fetch("/we-sync/scene/texture?monitor=" + encodeURIComponent(this.monitor) + "&name=" + encodeURIComponent(maskName), { cache: "no-store" });
						if (res.ok) masks[idx] = await createImageBitmap(await res.blob());
					} catch {}
				})());
			}
			await Promise.all(jobs);
			if (this.closed) {
				const allBmps = [noiseBmp, ...masks];
				for (const bb of allBmps) if (bb !== null) bb.close();
				return;
			}
			this.nitroTex.set(layer.id, {
				noise: noiseBmp,
				masks
			});
			this.startAnimation();
		}
	}
	/** 效果 mask 引用（如 "masks/shake_mask_xxx"）→ pkg 条目名 materials/<name>.tex */
	async fetchEffectTexture(name) {
		try {
			const entry = name.startsWith("materials/") ? name : "materials/" + name + ".tex";
			const res = await fetch("/we-sync/scene/texture?monitor=" + encodeURIComponent(this.monitor) + "&name=" + encodeURIComponent(entry), { cache: "no-store" });
			if (!res.ok) return null;
			const blob = await res.blob();
			const bmp = await createImageBitmap(blob, {
				premultiplyAlpha: "none",
				colorSpaceConversion: "none"
			});
			const imgW = Number(res.headers.get("X-WE-Image-W"));
			const imgH = Number(res.headers.get("X-WE-Image-H"));
			return {
				bmp,
				imgW: Number.isFinite(imgW) && imgW > 0 ? imgW : bmp.width,
				imgH: Number.isFinite(imgH) && imgH > 0 ? imgH : bmp.height
			};
		} catch {
			return null;
		}
	}
	/** 16×16 采样做出通道语义判断（失败时退回保守默认） */
	sampleChannels(bmp) {
		try {
			const tc = document.createElement("canvas");
			tc.width = 16;
			tc.height = 16;
			const tg = tc.getContext("2d");
			if (tg === null) return null;
			tg.drawImage(bmp, 0, 0, 16, 16);
			const px = tg.getImageData(0, 0, 16, 16);
			let sr = 0;
			let sg = 0;
			let sb = 0;
			let sa = 0;
			let n = 0;
			let allWhiteRGB = true;
			let grayDup = true;
			for (let i = 0; i < px.data.length; i += 4) {
				const r = px.data[i];
				const g = px.data[i + 1];
				const b = px.data[i + 2];
				if (r < 254 || g < 254 || b < 254) allWhiteRGB = false;
				if (r !== g || g !== b) grayDup = false;
				sr += r;
				sg += g;
				sb += b;
				sa += px.data[i + 3];
				n++;
			}
			if (n === 0) return null;
			return {
				r: sr / n,
				g: sg / n,
				b: sb / n,
				a: sa / n,
				allWhiteRGB,
				grayDup
			};
		} catch {
			return null;
		}
	}
	/** mask 值是否在 A 通道（R8 解码：rgb 全 255、值在 A） */
	texValueInAlpha(bmp) {
		const s = this.sampleChannels(bmp);
		return s !== null && s.allWhiteRGB;
	}
	/** 是否 RG88 解码语义（第一通道被复制到 rgb，第二通道在 A）——shake 方向场的 y 分量 */
	texChannelsDuplicated(bmp) {
		const s = this.sampleChannels(bmp);
		return s !== null && s.grayDup && !s.allWhiteRGB;
	}
	async fetchTexture(name) {
		try {
			const res = await fetch("/we-sync/scene/texture?monitor=" + encodeURIComponent(this.monitor) + "&name=" + encodeURIComponent(name), { cache: "no-store" });
			if (!res.ok) return null;
			const blob = await res.blob();
			const bmp = await createImageBitmap(blob);
			const imgW = Number(res.headers.get("X-WE-Image-W"));
			const imgH = Number(res.headers.get("X-WE-Image-H"));
			const frames = Number(res.headers.get("X-Sprite-Frames"));
			const fw = Number(res.headers.get("X-Sprite-Width"));
			const fh = Number(res.headers.get("X-Sprite-Height"));
			const dur = Number(res.headers.get("X-Sprite-Duration"));
			let sprite = null;
			if (Number.isFinite(frames) && frames > 1 && Number.isFinite(fw) && fw > 0 && Number.isFinite(fh) && fh > 0) {
				const total = Number.isFinite(dur) && dur > 0 ? dur : frames / 10;
				let rects = null;
				const rectsRaw = res.headers.get("X-Sprite-Rects");
				if (rectsRaw !== null) {
					const parts = rectsRaw.split(";");
					const arr = [];
					for (const p of parts) {
						const n = p.split(",").map((x) => Number(x));
						if (n.length === 4 && n.every((x) => Number.isFinite(x))) arr.push([
							n[0],
							n[1],
							n[2],
							n[3]
						]);
					}
					if (arr.length === frames) rects = arr;
				}
				sprite = {
					frames,
					fw,
					fh,
					per: total / frames,
					rects
				};
			}
			return {
				bmp,
				imgW: Number.isFinite(imgW) && imgW > 0 ? imgW : bmp.width,
				imgH: Number.isFinite(imgH) && imgH > 0 ? imgH : bmp.height,
				sprite
			};
		} catch {
			return null;
		}
	}
	async loadBase(model) {
		try {
			const res = await fetch("/we-sync/preview?v=" + this.version, { cache: "no-store" });
			if (!res.ok) return;
			const blob = await res.blob();
			const img = new Image();
			img.src = URL.createObjectURL(blob);
			await new Promise((resolve, reject) => {
				img.onload = () => resolve();
				img.onerror = () => reject(/* @__PURE__ */ new Error("preview decode"));
			});
			if (this.closed) {
				URL.revokeObjectURL(img.src);
				return;
			}
			this.base = img;
			this.startAnimation();
		} catch {}
	}
	fail() {
		this.setLive(false);
		this.closed = true;
	}
	startAnimation() {
		if (this.rafId === 0 && !document.hidden) {
			this.lastT = performance.now();
			this.rafId = requestAnimationFrame(this.draw);
		}
	}
	draw = () => {
		this.rafId = 0;
		if (this.closed || this.ctx === null || this.el === null) return;
		const now = performance.now();
		const dt = Math.min(.1, (now - this.lastT) / 1e3);
		this.lastT = now;
		this.animTime += dt;
		this.bgCache = null;
		this.bgUploaded = false;
		for (const rt of this.runtimes.values()) rt.update(dt);
		this.updatePuppetAnims(dt);
		try {
			this.renderScene();
		} catch (e) {
			console.error("[scene:render] renderScene 异常:", e);
		}
		this.rafId = requestAnimationFrame(this.draw);
	};
	/**
	* 更新 puppet 动画 → 部件变换（装配根整体呼吸 + 部件自身摆动）。
	* 帧值布局（实测）：[pos3][rotZ(v4)][scale3]；v4 摆动 = 绕 z 旋转（呼吸/头发/草）；
	* v0/v1（或 v6/v7，petal 类）变化 = 位置位移（相对首帧）。
	*/
	updatePuppetAnims(dt) {
		this.animXform.clear();
		this.boneAnimMats.clear();
		this.puppetGlobalMats.clear();
		this.puppetBindWorld.clear();
		this.puppetPosesRT.clear();
		for (const [layerId, st] of this.puppetAnimsV2) {
			st.time += dt;
			const puppet = this.byId.get(layerId)?.puppet ?? null;
			if (puppet === null) continue;
			const nb = puppet.bones.length;
			if (nb === 0) continue;
			const bindWorld = new Array(nb);
			for (let b = 0; b < nb; b++) {
				const local = puppet.bones[b].bind ?? puppet.bones[b].pose ?? null;
				const parent = puppet.bones[b].parent;
				bindWorld[b] = local === null ? parent >= 0 && parent < nb ? bindWorld[parent] ?? null : null : parent >= 0 && parent < nb && bindWorld[parent] !== null && bindWorld[parent] !== void 0 ? mat4Mul(bindWorld[parent], local) : local;
			}
			const final = bindWorld.map((m) => m !== null ? {
				angle: Math.atan2(m[1], m[0]),
				tx: m[12],
				ty: m[13]
			} : {
				angle: 0,
				tx: 0,
				ty: 0
			}).map((r) => ({
				angle: r.angle,
				tx: r.tx,
				ty: r.ty
			}));
			const refCache = /* @__PURE__ */ new Map();
			for (const L of st.layers) {
				const fc = Math.max(1, puppet.animsV2[L.animIdx]?.frameCount ?? 1);
				const frame = Math.floor(st.time * 30 * L.rate) % fc;
				const lw = samplePuppetRT(puppet, L.animIdx, frame);
				let refRT = null;
				if (L.additive) {
					if (!refCache.has(L.animIdx)) refCache.set(L.animIdx, samplePuppetRT(puppet, L.animIdx, 0));
					refRT = refCache.get(L.animIdx) ?? null;
				}
				for (let b = 0; b < nb; b++) {
					const w = lw[b];
					if (w === null || w === void 0) continue;
					if (L.additive) {
						const ref = refRT !== null ? refRT[b] : null;
						if (ref === null || ref === void 0) continue;
						let da = w.angle - ref.angle;
						while (da > Math.PI) da -= 2 * Math.PI;
						while (da < -Math.PI) da += 2 * Math.PI;
						final[b].angle += da * L.blend;
						final[b].tx += (w.tx - ref.tx) * L.blend;
						final[b].ty += (w.ty - ref.ty) * L.blend;
					} else {
						let da = w.angle - final[b].angle;
						while (da > Math.PI) da -= 2 * Math.PI;
						while (da < -Math.PI) da += 2 * Math.PI;
						final[b].angle += da * L.blend;
						final[b].tx += (w.tx - final[b].tx) * L.blend;
						final[b].ty += (w.ty - final[b].ty) * L.blend;
					}
				}
			}
			const globals = new Array(nb);
			for (let b = 0; b < nb; b++) globals[b] = mat4TRS(final[b].tx, final[b].ty, 0, final[b].angle, 1, 1, 1);
			this.puppetGlobalMats.set(layerId, globals);
			this.puppetBindWorld.set(layerId, bindWorld);
			this.puppetPosesRT.set(layerId, final);
		}
		for (const [layerId, st] of this.puppetAnims) {
			st.time += dt;
			const kf = st.anim.keyframes;
			if (kf.length === 0) continue;
			let peak = 0;
			for (let i = 1; i < kf.length; i++) if (kf[i].t > kf[peak].t) peak = i;
			const period = kf[peak].t - kf[0].t;
			if (period > 5e6) continue;
			const dur = st.anim.old13 && st.anim.duration > 0 ? kf.length / st.anim.duration : st.anim.duration > 0 ? st.anim.duration : 3;
			const t = period > 0 ? st.time * period / dur : st.time * (kf.length - 1) / dur;
			if (st.anim.old13 && st.anim.boneKeyframes !== void 0 && st.anim.boneKeyframes.length > 1) {
				const mats = [];
				for (let b = 0; b < st.anim.boneKeyframes.length; b++) {
					const bk = st.anim.boneKeyframes[b];
					if (bk.length === 0) {
						mats.push(null);
						continue;
					}
					const s = sampleAnimation({
						...st.anim,
						keyframes: bk
					}, t);
					if (s === null) {
						mats.push(null);
						continue;
					}
					const v = s.values;
					mats.push(mat4TRSEuler(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8]));
				}
				this.boneAnimMats.set(layerId, mats);
				continue;
			}
			const s = sampleAnimation(st.anim, t);
			if (s === null) continue;
			const v = s.values;
			const base = st.anim.keyframes[0].values;
			const spans = [
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				0
			];
			for (let vi = 0; vi < 8; vi++) {
				let mn = Infinity;
				let mx = -Infinity;
				for (const k of kf) {
					const val = k.values[vi];
					if (!Number.isFinite(val)) continue;
					if (val < mn) mn = val;
					if (val > mx) mx = val;
				}
				if (Number.isFinite(mn)) spans[vi] = mx - mn;
			}
			const qx = v[3];
			const qy = v[4];
			const qz = v[5];
			const qw = v[6];
			const qlen2 = qx * qx + qy * qy + qz * qz + qw * qw;
			let rot;
			if (Math.abs(qlen2 - 1) < .05) rot = 2 * Math.atan2(qz, qw);
			else rot = v[4];
			let dx = 0;
			let dy = 0;
			if (st.anim.old13) {
				if (spans[0] > .5) dx += v[0] - base[0];
				if (spans[1] > .5) dy += v[1] - base[1];
			} else {
				if (spans[0] > .5) dy += v[0] - base[0];
				if (spans[6] > .5) dx += v[6] - base[6];
				if (spans[7] > .5) dy += v[7] - base[7];
			}
			this.animXform.set(layerId, {
				dx,
				dy,
				rot
			});
		}
		if (this.puppetPosesRT.size > 0) this.computeWorldTransforms();
	}
	/** 静态图像层：无粒子、无效果、无动画（自身及祖先）、非序列帧动画，可离屏缓存只渲染一次 */
	isStaticImageLayer(layer) {
		if (layer.image === void 0 || layer.particle !== null) return false;
		if (layer.effects.length > 0 || layer.copybackground === true) return false;
		if (layer.dayNight !== void 0) return false;
		if (this.layerSprite.has(layer.id)) return false;
		let p = layer.id;
		while (p !== null && this.byId.has(p)) {
			if (this.animXform.has(p) || this.boneAnimMats.has(p) || this.puppetGlobalMats.has(p)) return false;
			p = this.byId.get(p)?.parent ?? null;
		}
		return true;
	}
	/** 构建静态层离屏缓存（场景坐标 canvas，模型加载后调用一次） */
	buildStaticBg() {
		const model = this.model;
		if (model === null) return;
		const c = document.createElement("canvas");
		c.width = Math.max(1, Math.round(model.width));
		c.height = Math.max(1, Math.round(model.height));
		const g = c.getContext("2d");
		if (g === null) return;
		this.staticPrefixIds.clear();
		let prefixEnded = false;
		for (const layer of model.layers) {
			if (prefixEnded) break;
			if (!layer.visible || layer.alpha <= 0 || !this.isStaticImageLayer(layer)) {
				prefixEnded = true;
				continue;
			}
			const t = this.worldTransform.get(layer.id);
			const bmp = this.layerTextures.get(layer.id) ?? null;
			if (bmp === null || t === void 0) {
				prefixEnded = true;
				continue;
			}
			this.staticPrefixIds.add(layer.id);
			g.save();
			g.translate(t.ox, t.oy);
			const rot = (layer.angles[2] ?? 0) * Math.PI / 180;
			if (rot !== 0) g.rotate(rot);
			g.scale(t.sx, t.sy);
			if (layer.alpha < 1) g.globalAlpha = Math.max(0, Math.min(1, layer.alpha));
			const ti = this.layerTexImage.get(layer.id);
			const sw = ti !== void 0 ? ti[0] : bmp.width;
			const sh = ti !== void 0 ? ti[1] : bmp.height;
			const dw = layer.size !== null ? layer.size[0] : sw;
			const dh = layer.size !== null ? layer.size[1] : sh;
			g.drawImage(bmp, 0, 0, sw, sh, -dw / 2, -dh / 2, dw, dh);
			g.restore();
		}
		this.staticBg = c;
		this.staticBgReady = true;
	}
	renderScene() {
		const ctx = this.ctx;
		if (ctx === null || this.el === null) return;
		const cw = this.el.clientWidth;
		const ch = this.el.clientHeight;
		if (cw === 0 || ch === 0) return;
		ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
		ctx.clearRect(0, 0, cw, ch);
		const model = this.model;
		if (model === null) return;
		if (this.base !== null) this.drawCoverBase(ctx, this.base, cw, ch);
		else if (model.clearColor !== null) {
			ctx.fillStyle = "rgb(" + Math.round(model.clearColor[0] * 255) + "," + Math.round(model.clearColor[1] * 255) + "," + Math.round(model.clearColor[2] * 255) + ")";
			ctx.fillRect(0, 0, cw, ch);
		}
		const s = Math.max(cw / model.width, ch / model.height);
		const ox = (cw - model.width * s) / 2;
		const oy = (ch - model.height * s) / 2;
		if (this.staticBgReady && this.staticBg !== null) ctx.drawImage(this.staticBg, 0, 0, this.staticBg.width, this.staticBg.height, ox, oy, this.staticBg.width * s, this.staticBg.height * s);
		let glSegment = false;
		let glAdditive = false;
		const flushGl = () => {
			if (glSegment && this.particleGL !== null && this.glCanvas !== null) {
				const prevOp = ctx.globalCompositeOperation;
				if (glAdditive) ctx.globalCompositeOperation = "lighter";
				ctx.drawImage(this.glCanvas, 0, 0, this.glCanvas.width, this.glCanvas.height, 0, 0, cw, ch);
				ctx.globalCompositeOperation = prevOp;
				glSegment = false;
				this.bgUploaded = false;
			}
		};
		for (const layer of model.layers) {
			if (!layer.visible || layer.alpha <= 0) continue;
			if (this.staticBgReady && this.staticPrefixIds.has(layer.id)) continue;
			const t = this.worldTransform.get(layer.id);
			let ax = 0;
			let ay = 0;
			let arot = 0;
			const selfXf = this.animXform.get(layer.id);
			if (selfXf !== void 0 && t !== void 0) {
				ax = selfXf.dx;
				ay = -selfXf.dy;
				arot = selfXf.rot;
			} else if (layer.parent !== null) {
				let anchorId = null;
				let p = layer.parent;
				while (p !== null && this.byId.has(p)) {
					if (this.animXform.has(p)) {
						anchorId = p;
						break;
					}
					p = this.byId.get(p)?.parent ?? null;
				}
				if (anchorId !== null && t !== void 0) {
					const xf = this.animXform.get(anchorId);
					const pt = this.worldTransform.get(anchorId);
					if (xf !== void 0 && pt !== void 0) {
						const relx = t.ox - pt.ox;
						const rely = t.oy - pt.oy;
						const c = Math.cos(xf.rot);
						const sn = Math.sin(xf.rot);
						ax = pt.ox + c * relx - sn * rely - t.ox;
						ay = pt.oy + sn * relx + c * rely - t.oy;
						arot = xf.rot;
					}
				}
			}
			const px = ox + ((t !== void 0 ? t.ox : layer.origin[0]) + ax) * s;
			const py = oy + ((t !== void 0 ? t.oy : layer.origin[1]) + ay) * s;
			const rt = this.runtimes.get(layer.id);
			if (rt !== void 0) {
				const wt = t ?? {
					ox: layer.origin[0],
					oy: layer.origin[1],
					sx: layer.scale[0] ?? 1,
					sy: layer.scale[1] ?? 1
				};
				if (this.particleGL !== null && this.el !== null && SceneModelRenderer.USE_WEBGL_PARTICLES && !rt.hasLineRenderer()) {
					if (!this.particleGL.available) continue;
					const layerAngle = layer.angles[2] ?? 0;
					const batches = rt.collectGl(wt.sx, wt.sy, ox + wt.ox * s, oy + wt.oy * s, s, layerAngle);
					const now = performance.now();
					if (batches.length === 0) continue;
					const additive = batches[0].additive;
					if (glSegment && glAdditive !== additive) flushGl();
					if (!glSegment) {
						glSegment = true;
						glAdditive = additive;
						this.bgUploaded = false;
						this.particleGL.clear();
					}
					if (now - (this.lastParticleLog.get(layer.id) ?? 0) > 1e3) {
						this.lastParticleLog.set(layer.id, now);
						console.log("[scene:GL] layer=" + layer.name, batches.map((b) => "n=" + b.particles.length + (b.refract ? "/R" : "") + (b.additive ? "/A" : "")).join(" "));
					}
					for (const b of batches) {
						if (b.refract && !this.bgUploaded) {
							this.particleGL.uploadBackground(this.el);
							this.bgUploaded = true;
							console.log("[scene:GL] bg uploaded", this.el.width + "x" + this.el.height);
						}
						this.particleGL.render(b.particles, {
							viewW: this.el.clientWidth,
							viewH: this.el.clientHeight,
							additive: b.additive,
							refract: b.refract,
							frames: b.frames,
							fw: b.fw,
							fh: b.fh,
							refractAmount: b.refractAmount,
							trail: b.trail
						}, b.tex, b.normalTex, this.el.width, this.el.height);
					}
					continue;
				}
				flushGl();
				let bg = null;
				if (rt.hasRefract() && this.el !== null) {
					if (this.bgCache === null) {
						this.bgCache = document.createElement("canvas");
						this.bgCache.width = this.el.width;
						this.bgCache.height = this.el.height;
						const bgctx = this.bgCache.getContext("2d");
						if (bgctx !== null) bgctx.drawImage(this.el, 0, 0);
					}
					bg = this.bgCache;
				}
				rt.draw(ctx, ox, oy, s, wt, bg, layer.angles[2] ?? 0);
				continue;
			}
			flushGl();
			ctx.save();
			ctx.translate(px, py);
			const animB0 = selfXf !== void 0 && layer.puppet !== null ? layer.puppet.bones[0]?.bind ?? null : null;
			const rotAngle = (layer.angles[2] ?? 0) * Math.PI / 180 + arot;
			if (animB0 !== null && animB0.length >= 15 && rotAngle !== 0) {
				const sxv = (t !== void 0 ? t.sx : layer.scale[0] ?? 1) * s;
				const syv = (t !== void 0 ? t.sy : layer.scale[1] ?? 1) * s;
				const bx = animB0[12] * sxv;
				const by = -animB0[13] * syv;
				ctx.translate(bx, by);
				ctx.rotate(rotAngle);
				ctx.translate(-bx, -by);
			} else ctx.rotate(rotAngle);
			ctx.scale((t !== void 0 ? t.sx : layer.scale[0] ?? 1) * s, (t !== void 0 ? t.sy : layer.scale[1] ?? 1) * s);
			let layerAlpha = layer.alpha;
			if (layer.dayNight !== void 0) layerAlpha = layer.alpha * this.dayNightFactor(layer.dayNight);
			if (layerAlpha < 1) ctx.globalAlpha = Math.max(0, Math.min(1, layerAlpha));
			let bmp = this.layerTextures.get(layer.id) ?? null;
			if (model.puppetMeshRender && layer.puppet !== null && layer.puppet.mesh !== null && bmp !== null) {
				const newGlobals = this.puppetGlobalMats.get(layer.id);
				const newBindWorld = this.puppetBindWorld.get(layer.id);
				const old13Mats = this.boneAnimMats.get(layer.id);
				const selfXf2 = this.animXform.get(layer.id);
				const b0 = layer.puppet.bones[0]?.bind ?? null;
				const animSkin = selfXf2 !== void 0 && b0 !== null && b0.length >= 15 ? {
					rot: selfXf2.rot,
					bx: b0[12],
					by: b0[13]
				} : null;
				let key;
				let binds;
				let mats;
				let anim;
				if (newGlobals !== void 0 && newBindWorld !== void 0) {
					key = "v2:" + Math.floor(this.animTime * 30).toString(36);
					binds = newBindWorld;
					mats = newGlobals;
					anim = null;
				} else {
					key = old13Mats !== void 0 ? "old13:" + Math.floor(this.animTime * 60).toString(36) : animSkin !== null ? animSkin.rot.toFixed(4) : "static";
					binds = layer.puppet.bones.map((b) => b.bind ?? b.pose ?? null);
					mats = old13Mats;
					anim = animSkin;
				}
				let mc = this.meshCanvases.get(layer.id);
				if (mc === void 0 || mc.animKey !== key) {
					const built = buildMeshCanvas(layer.puppet.mesh, bmp, anim, binds, mats);
					mc = {
						canvas: built.canvas,
						originX: built.originX,
						originY: built.originY,
						animKey: key
					};
					this.meshCanvases.set(layer.id, mc);
				}
				ctx.drawImage(mc.canvas, -mc.originX, -mc.originY);
			} else if (bmp !== null) {
				let src = bmp;
				const ti = this.layerTexImage.get(layer.id);
				let sw = ti !== void 0 ? ti[0] : bmp.width;
				let sh = ti !== void 0 ? ti[1] : bmp.height;
				const dw = layer.size !== null ? layer.size[0] : sw;
				const dh = layer.size !== null ? layer.size[1] : sh;
				const spr = this.layerSprite.get(layer.id);
				if (spr != null && bmp.width >= 1 && bmp.height >= 1) {
					const total = spr.frames * spr.per;
					let frameIdx = Math.floor(this.animTime % total / spr.per);
					if (frameIdx < 0) frameIdx = 0;
					if (frameIdx >= spr.frames) frameIdx = spr.frames - 1;
					const rect = spr.rects !== null && spr.rects[frameIdx] !== void 0 ? spr.rects[frameIdx] : (() => {
						const cols = Math.max(1, Math.floor(bmp.width / spr.fw));
						const col = frameIdx % cols;
						const row = Math.floor(frameIdx / cols);
						return [
							col * spr.fw,
							row * spr.fh,
							spr.fw,
							spr.fh
						];
					})();
					const rx = Math.max(0, Math.min(bmp.width - 1, Math.round(rect[0])));
					const ry = Math.max(0, Math.min(bmp.height - 1, Math.round(rect[1])));
					const rw = Math.max(1, Math.min(bmp.width - rx, Math.round(rect[2])));
					const rh = Math.max(1, Math.min(bmp.height - ry, Math.round(rect[3])));
					const cached = this.spriteFrameCache.get(layer.id);
					let frameBmp;
					if (cached !== void 0 && cached.frame === frameIdx && cached.sx === rx && cached.sy === ry && cached.sw === rw && cached.sh === rh) frameBmp = cached.canvas;
					else {
						frameBmp = document.createElement("canvas");
						frameBmp.width = rw;
						frameBmp.height = rh;
						const fctx = frameBmp.getContext("2d");
						if (fctx !== null) {
							fctx.imageSmoothingEnabled = false;
							fctx.drawImage(bmp, rx, ry, rw, rh, 0, 0, rw, rh);
						}
						this.spriteFrameCache.set(layer.id, {
							frame: frameIdx,
							sx: rx,
							sy: ry,
							sw: rw,
							sh: rh,
							canvas: frameBmp
						});
					}
					src = frameBmp;
					sw = rw;
					sh = rh;
				}
				const effScale = model.effectStrengthScale ?? 1;
				const wws = layer.effects.filter((e) => e.type === "waterwaves").map((e) => ({
					...e,
					strength: e.strength * effScale
				}));
				const shakes = layer.effects.filter((e) => e.type === "shake");
				const nitros = layer.effects.filter((e) => e.type === "nitro");
				if (wws.length > 0) {
					const maskInfo = this.effectMasks.get(layer.id);
					let eff = null;
					if (this.wwGL !== null || WaterwavesGL.available) {
						if (this.wwGL === null) this.wwGL = new WaterwavesGL();
						eff = this.wwGL.render(src, sw, sh, maskInfo !== void 0 ? maskInfo.bmp : null, maskInfo !== void 0 ? maskInfo.useA : false, wws, this.animTime, String(layer.id));
					}
					if (eff === null) eff = applyWaterwaves(src, sw, sh, wws, this.animTime, maskInfo !== void 0 ? maskInfo.bmp : null);
					ctx.drawImage(eff, 0, 0, sw, sh, -dw / 2, -dh / 2, dw, dh);
				} else if (nitros.length > 0) {
					const nt = this.nitroTex.get(layer.id);
					let eff = null;
					if (nt !== void 0 && (this.nitroGL !== null || NitroGL.available)) {
						if (this.nitroGL === null) this.nitroGL = new NitroGL();
						const params = nitros.map((e) => ({
							colorStart: e.colorStart,
							colorEnd: e.colorEnd,
							multiply: e.multiply,
							ranges: e.ranges,
							scales: e.scales,
							speeds: e.speeds,
							smoothness: e.smoothness,
							useMask: e.mask !== null && e.mask !== ""
						}));
						eff = this.nitroGL.render(src, sw, sh, nt.noise, nt.masks, params, this.animTime, String(layer.id));
					}
					if (eff === null) ctx.drawImage(src, 0, 0, sw, sh, -dw / 2, -dh / 2, dw, dh);
					else ctx.drawImage(eff, 0, 0, sw, sh, -dw / 2, -dh / 2, dw, dh);
				} else if (shakes.length > 0) {
					const stArr = this.shakeTex.get(layer.id);
					let curSrc = src;
					let curOut = null;
					const passes = stArr?.length ?? 0;
					for (let pi = 0; pi < passes; pi++) {
						const st = stArr[pi];
						const shk = shakes[st.passIndex];
						const offset = shakeOffset(this.animTime, {
							speed: shk.speed,
							bounds: shk.bounds,
							friction: shk.friction,
							direction: shk.direction,
							audioProcessing: shk.audioProcessing
						});
						const glKey = String(layer.id) + ":" + st.passIndex;
						const rects = {
							src: {
								w: sw,
								h: sh
							},
							flow: {
								w: st.flowW,
								h: st.flowH
							},
							mask: st.mask !== null ? {
								w: st.maskW,
								h: st.maskH
							} : void 0
						};
						let out = null;
						if (this.shakeGL !== null || ShakeGL.available) {
							const useA = pi % 2 === 0;
							if (useA ? this.shakeGL === null : this.shakeGL2 === null) {
								if (useA) this.shakeGL = new ShakeGL();
								else this.shakeGL2 = new ShakeGL();
							}
							out = (useA ? this.shakeGL : this.shakeGL2).render(curSrc, sw, sh, st.flow, st.flowYFromAlpha, st.mask, st.maskFromAlpha, {
								offset,
								strength: shk.strength
							}, glKey, rects);
						}
						if (out === null) out = applyShake2D({
							src: curSrc,
							sw,
							sh,
							flow: st.flow,
							flowYFromAlpha: st.flowYFromAlpha,
							mask: st.mask,
							maskFromAlpha: st.maskFromAlpha,
							offset,
							strength: shk.strength,
							rects
						});
						if (out === null) break;
						curOut = out;
						curSrc = out;
					}
					if (curOut !== null) ctx.drawImage(curOut, 0, 0, sw, sh, -dw / 2, -dh / 2, dw, dh);
					else ctx.drawImage(src, 0, 0, sw, sh, -dw / 2, -dh / 2, dw, dh);
				} else ctx.drawImage(src, 0, 0, sw, sh, -dw / 2, -dh / 2, dw, dh);
			} else if (!this.warnedNoTexture.has(layer.id)) {
				this.warnedNoTexture.add(layer.id);
				console.warn("[scene:render] 图层无可用纹理，已跳过绘制：#" + layer.id + " " + layer.name + " [" + layer.kind + "]");
			}
			ctx.restore();
		}
		flushGl();
		ctx.strokeStyle = "rgba(255,255,255,0.28)";
		ctx.lineWidth = 1;
		ctx.strokeRect(ox, oy, model.width * s, model.height * s);
	}
	drawCoverBase(ctx, img, cw, ch) {
		const iw = img.naturalWidth;
		const ih = img.naturalHeight;
		if (iw === 0 || ih === 0) return;
		const s = Math.max(cw / iw, ch / ih);
		const sw = cw / s;
		const sh = ch / s;
		ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, cw, ch);
	}
	resize() {
		if (this.el === null) return;
		this.dpr = window.devicePixelRatio || 1;
		const w = Math.max(1, Math.round(this.el.clientWidth * this.dpr));
		const h = Math.max(1, Math.round(this.el.clientHeight * this.dpr));
		if (this.el.width !== w) this.el.width = w;
		if (this.el.height !== h) this.el.height = h;
		if (this.glCanvas !== null) {
			if (this.glCanvas.width !== w) this.glCanvas.width = w;
			if (this.glCanvas.height !== h) this.glCanvas.height = h;
		}
	}
	onResize = () => {
		this.resize();
		this.staticBg = null;
		this.staticBgReady = false;
		if (this.model !== null) this.buildStaticBg();
		this.startAnimation();
	};
	onVisibility = () => {
		if (document.hidden) {
			if (this.rafId !== 0) {
				cancelAnimationFrame(this.rafId);
				this.rafId = 0;
			}
		} else this.startAnimation();
	};
	setLive(live) {
		if (this.live === live) return;
		this.live = live;
		if (this.handlers.onLiveChange !== void 0) this.handlers.onLiveChange(live);
	}
};
//#endregion
export { SceneModelRenderer };

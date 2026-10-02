//! 构建期把 native 源码指纹注入二进制（`--build-info` 打印，发布检查扫描比对）。
//!
//! 为什么需要：`bin/` 里的预编译 exe 是提交进仓库、由 npm 直接发布的（发布 CI 不重编原生程序），
//! 所以「改了 src 但忘了 cargo build + 把产物拷回 bin/」会把旧二进制悄悄发出去——
//! 26.9.12 ~ 26.9.29 的捕获器正是如此：源码已是 0.4.0（FreeThreaded 事件驱动出帧），
//! 包内却一直是 0.3.0（每次唤醒只捡一帧 + 100ms 轮询），实测任何壁纸都被压到 ~8fps。
//!
//! 算法必须与 tools/check-package.mjs 的 nativeSourceFingerprint() 完全一致：
//! FNV-1a 64，按相对路径（统一正斜杠）升序，逐文件哈希 [路径字节, 0x00, 内容字节, 0xFF]。
//! 两侧都用字节序比较 ASCII 路径，因此排序结果一致。

use std::fs;
use std::path::{Path, PathBuf};

const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

fn fnv(h: u64, bytes: &[u8]) -> u64 {
    let mut h = h;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(FNV_PRIME);
    }
    h
}

/// 递归收集 `dir` 下的 `.rs` 文件，路径相对 `root` 并统一成正斜杠
fn collect(dir: &Path, root: &Path, out: &mut Vec<(String, PathBuf)>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            collect(&p, root, out);
        } else if p.extension().and_then(|s| s.to_str()) == Some("rs") {
            if let Ok(rel) = p.strip_prefix(root) {
                out.push((rel.to_string_lossy().replace('\\', "/"), p.clone()));
            }
        }
    }
}

fn main() {
    let root = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string()));
    let mut files: Vec<(String, PathBuf)> = Vec::new();
    collect(&root.join("src"), &root, &mut files);
    files.sort();

    let mut h = FNV_OFFSET;
    for (rel, path) in &files {
        h = fnv(h, rel.as_bytes());
        h = fnv(h, &[0x00]);
        if let Ok(bytes) = fs::read(path) {
            h = fnv(h, &bytes);
        }
        h = fnv(h, &[0xff]);
    }

    println!("cargo:rustc-env=WE_CAPTURE_SRC_HASH={h:016x}");
    // src 树任一文件变化都要重跑本脚本（并因此重编二进制）
    println!("cargo:rerun-if-changed=src");
}

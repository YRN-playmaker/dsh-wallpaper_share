# Wallpaper Engine .tex 纹理格式（完整破解记录）

> 本文档记录 `.tex` 纹理容器的**完整二进制格式**，已用 8 个真实 workshop
> scene.pkg 交叉验证 + repkg（notscuffed/repkg，MIT）源码语义确认。
> 参考源码存档于 `_dev/reference/`（26 个 .cs 文件 + LICENSE）。

## 1. 总体结构

```
Magic1 "0005\0" + Magic2 "TEXI0001\0"（null 终止字符串，共 14 字节）
Header（7 × int32，raw LE）：
  Format         TexFormat：0=RGBA8888, 4=DXT5, 6=DXT3, 7=DXT1, 8=RG88, 9=R8
  Flags          TexFlags：0=None, 1=NoInterpolation, 2=ClampUVs, 4=IsGif, 32=IsVideoTexture
  TextureWidth   画布宽（含未用区域，如 2048/4096/8192）
  TextureHeight  画布高
  ImageWidth     像素宽（= mip0 实际尺寸，如 1920）
  ImageHeight    像素高
  UnkInt0        未知（不影响解析）
ImageContainer：
  "TEXB0001\0" / "TEXB0002\0" / "TEXB0003\0" / "TEXB0004\0"（null 终止）
  imageCount（int32，通常 1）
  TEXB0001/0002：无更多容器字段（老版本）
  TEXB0003：    ImageFormat（int32）
  TEXB0004：    ImageFormat + isVideoMp4（int32 == 1）
  每个 image：
    mipmapCount（int32，上限 32）
    每级 mip：
      Width / Height（int32）
      IsLZ4Compressed（int32：1 = LZ4 压缩）
      DecompressedBytesCount（int32：LZ4 解压后字节数）
      byteCount（int32：本 mip 数据字节数）
      bytes（byteCount 字节）
```

**ImageFormat（FreeImageFormat 子集）**：13 = PNG、2 = JPEG、-1 = raw（无内嵌图片）。

- ImageFormat 为 PNG/JPEG：mip bytes = **完整图片文件**（含签名），全分辨率
  （如 Rebecca 3840×2160 PNG、背景 5349×3009 PNG、eva 1920×1080 JPEG）。
- ImageFormat 为 raw：mip bytes = **LZ4 压缩流**，解压到 DecompressedBytesCount
  字节，内容为 Header.Format 指定的像素数据（DXT1/DXT3/DXT5/RGBA8888/RG88/R8）。

## 2. raw 纹理样例（实测）

| 文件 | 容器 | Header.Format | mip0 | LZ4 | 解压后 |
|---|---|---|---|---|---|
| sky.tex | TEXB0004 | 4 (DXT5) | 1920×1088 | 230,858B | 2,088,960B（= w×h，DXT5） |
| RAIL2.tex | TEXB0003 | 4 (DXT5) | 3840×1280 | 363,464B | 4,915,200B（= w×h） |
| NTaXeb.tex (Persona) | TEXB0002 | 0 (RGBA8888) | 2048×2048 | 4,241,029B | 16,777,216B（= w×h×4） |

> 之前"数据量远小于 DXT 链"的困惑由此解开：**LZ4 压缩**（0.11-0.27 bpp 是压缩率，
> 不是格式密度）。"数据量奇数"（305,121）也是 LZ4 流长度的自然结果。

## 3. 之前的错误记录（供后人避坑）

- 早期误判 `@50..@81` 为 8 个 `<<8` 编码字段、mip0 图片在 `@83`——根因是
  把 Magic2 的 null 终止符（`@13`）计入字段起始，整体错位 1 字节。
  正确：`Magic2` 消费到 `@13` 的 \0 后，Header 从 `@14` 起，全为 raw int32。
- DXT1/DXT5 端点相关性、BC7 模式分布、L8 链方程等负结果均因**未解析 mip
  容器结构**（LZ4 + 每级头）直接对字节流试解。
- 关键提示来自 repkg `TexImageReader.cs`：`IsLZ4Compressed = ReadInt32() == 1`。

## 4. 实现

- 完整解码器：`src/scene/SceneTex.ts`（解析 + LZ4 + DXT1/3/5/RGBA8888 → PNG 编码）
- 块解码器：`src/scene/TexDecode.ts`（DXT1/3/5/RGBA8888/RGBA16F/R16F/L8）
- 路由：`/we-sync/scene/texture`（.tex → mip0：内嵌图片原样 / raw 解码为 PNG）
- 许可证：格式为事实信息；解析语义参考 repkg（MIT, notscuffed 2019，
  参考文件见 `_dev/reference/`），实现为自研，主项目保持 MIT。

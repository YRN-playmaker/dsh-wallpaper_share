/** 保留未预乘通道，裁掉 .tex 画布在内容区右侧/底部的空白边缘。 */
export async function decodeParticleBitmap(res: Response, normal = false): Promise<ImageBitmap> {
  const options: ImageBitmapOptions = { premultiplyAlpha: 'none', ...(normal ? { colorSpaceConversion: 'none' as const } : {}) }
  const bmp = await createImageBitmap(await res.blob(), options)
  const imageW = Number(res.headers.get('X-WE-Image-W'))
  const imageH = Number(res.headers.get('X-WE-Image-H'))
  const w = Number.isInteger(imageW) && imageW > 0 && imageW <= bmp.width ? imageW : bmp.width
  const h = Number.isInteger(imageH) && imageH > 0 && imageH <= bmp.height ? imageH : bmp.height
  if (w === bmp.width && h === bmp.height) return bmp
  try {
    return await createImageBitmap(bmp, 0, 0, w, h, options)
  } finally {
    bmp.close()
  }
}

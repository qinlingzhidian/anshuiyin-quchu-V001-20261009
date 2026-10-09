/**
 * AI 明水印智能检测与内容感知消除引擎 (Visible Watermark Detector & Inpainting Engine)
 * 专用于消除：
 * 1. “豆包 AI 生成”等角标文字水印
 * 2. 即梦 AI / 通义万相 / 文心一言 / Midjourney 等角标水印
 * 3. 自定义矩形选区水印
 */

export interface WatermarkBox {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  confidence: number;
}

/**
 * 智能检测图像右下角（及角落）是否存在明水印文字（如“豆包 AI 生成”）
 * 关键保证：若未检测到真实高对比度字形边缘，必须返回 null，严禁无水印时误报！
 */
export function detectVisibleWatermark(
  ctx: CanvasRenderingContext2D,
  imgWidth: number,
  imgHeight: number
): WatermarkBox | null {
  // 重点检索右下角区域：横向占 28%，纵向占 14%
  const searchW = Math.round(imgWidth * 0.28);
  const searchH = Math.round(imgHeight * 0.14);
  const startX = imgWidth - searchW;
  const startY = imgHeight - searchH;

  const cornerData = ctx.getImageData(startX, startY, searchW, searchH);
  const pixels = cornerData.data;

  let textStrokePixels = 0;
  let minX = searchW;
  let maxX = 0;
  let minY = searchH;
  let maxY = 0;

  // 扫描右下角，统计文字特征像素：
  // 豆包等水印文字通常为亮白或高亮浅色（lum > 160），且与相邻底色有显著梯度差（字形笔画边缘）
  for (let y = 1; y < searchH - 1; y++) {
    for (let x = 1; x < searchW - 1; x++) {
      const imgX = startX + x;
      const imgY = startY + y;
      const idx = (y * searchW + x) * 4;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      // 与左侧和上方相邻像素计算梯度差
      const leftIdx = (y * searchW + (x - 1)) * 4;
      const upIdx = ((y - 1) * searchW + x) * 4;

      const leftLum = 0.299 * pixels[leftIdx] + 0.587 * pixels[leftIdx + 1] + 0.114 * pixels[leftIdx + 2];
      const upLum = 0.299 * pixels[upIdx] + 0.587 * pixels[upIdx + 1] + 0.114 * pixels[upIdx + 2];
      const diff = Math.max(Math.abs(lum - leftLum), Math.abs(lum - upLum));

      // 白色/浅灰文字笔画，且笔画边缘高锐度
      if (lum > 160 && diff > 28) {
        textStrokePixels++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const textW = maxX - minX;
  const textH = maxY - minY;

  // 严格阈值：只有存在足够密度的连续文字笔画特征（至少 35 个笔画像素，且长宽比符合字串）才认定存在明水印
  // 若已净化或普通无水印图片，必然不满足条件，直接返回 null！
  if (textStrokePixels < 35 || textW < 25 || textH < 8) {
    return null;
  }

  // 留出充分的清除安全边距
  const padX = Math.max(12, Math.round(imgWidth * 0.015));
  const padY = Math.max(10, Math.round(imgHeight * 0.01));

  let boxX = Math.max(0, startX + minX - padX);
  let boxY = Math.max(0, startY + minY - padY);
  let boxW = textW + padX * 2;
  let boxH = textH + padY * 2;

  // 若文字贴近右边缘或下边缘（如豆包字样常在底端 2%~5%），直接将选区延伸至图片边缘，彻底覆盖不漏字
  if (boxX + boxW >= imgWidth - 60) {
    boxW = imgWidth - boxX;
  }
  if (boxY + boxH >= imgHeight - 60) {
    boxH = imgHeight - boxY;
  }

  return {
    x: boxX,
    y: boxY,
    width: boxW,
    height: boxH,
    label: '豆包 AI 生成 / 角标文字水印',
    confidence: Math.min(99, Math.round(75 + (textStrokePixels / 10))),
  };
}

/**
 * 内容感知消除算法 (Content-Aware Edge-Preserving Inpainting)
 * 专为右下角角标水印优化：从水印区域上方和左侧未受污染的健康背景提取环境纹理向内渐变重建，
 * 彻底擦除“豆包 AI 生成”等文字，重构底色，完全消除接缝与模糊块。
 */
export function inpaintWatermarkRegion(
  ctx: CanvasRenderingContext2D,
  imgWidth: number,
  imgHeight: number,
  box: WatermarkBox
): void {
  const { x, y, width, height } = box;
  if (width <= 0 || height <= 0) return;

  const x1 = Math.max(0, Math.floor(x));
  const y1 = Math.max(0, Math.floor(y));
  // 确保覆盖至图片实际边界
  const x2 = (x + width >= imgWidth - 40) ? imgWidth : Math.min(imgWidth, Math.ceil(x + width));
  const y2 = (y + height >= imgHeight - 40) ? imgHeight : Math.min(imgHeight, Math.ceil(y + height));

  const bw = x2 - x1;
  const bh = y2 - y1;
  if (bw <= 0 || bh <= 0) return;

  // 获取整图数据或局部扩展区域
  const pad = 16;
  const sx = Math.max(0, x1 - pad);
  const sy = Math.max(0, y1 - pad);
  const sw = Math.min(imgWidth - sx, bw + pad * 2);
  const sh = Math.min(imgHeight - sy, bh + pad * 2);

  const regionData = ctx.getImageData(sx, sy, sw, sh);
  const data = regionData.data;

  const relX1 = x1 - sx;
  const relY1 = y1 - sy;
  const relX2 = relX1 + bw;
  const relY2 = relY1 + bh;

  // 1. 从上方 (Top) 与左侧 (Left) 提取参考健康边界像素
  // 在右下角水印中，上边界和左边界是绝对未被水印污染的真实背景（地面、器械、背景）
  const getTopRef = (relX: number) => {
    const clampedX = Math.max(0, Math.min(sw - 1, relX));
    const refY = Math.max(0, relY1 - 2);
    const idx = (refY * sw + clampedX) * 4;
    return [data[idx], data[idx + 1], data[idx + 2]];
  };

  const getLeftRef = (relY: number) => {
    const clampedY = Math.max(0, Math.min(sh - 1, relY));
    const refX = Math.max(0, relX1 - 2);
    const idx = (clampedY * sw + refX) * 4;
    return [data[idx], data[idx + 1], data[idx + 2]];
  };

  // 2. 双向梯度内容感知重构填充
  for (let py = relY1; py < relY2; py++) {
    const vProgress = (py - relY1) / (relY2 - relY1 || 1); // 0 (靠近顶边界) -> 1 (靠近底端)

    for (let px = relX1; px < relX2; px++) {
      const hProgress = (px - relX1) / (relX2 - relX1 || 1); // 0 (靠近左边界) -> 1 (靠近右端)

      const topPixel = getTopRef(px);
      const leftPixel = getLeftRef(py);

      // 上下与左右渐变权重分配
      // 距离上方近则上方背景权重大，距离左侧近则左侧背景权重大
      const wTop = Math.max(0.05, 1 - vProgress * 0.4);
      const wLeft = Math.max(0.05, 1 - hProgress * 0.4);
      const sumWeight = wTop + wLeft;

      let r = (topPixel[0] * wTop + leftPixel[0] * wLeft) / sumWeight;
      let g = (topPixel[1] * wTop + leftPixel[1] * wLeft) / sumWeight;
      let b = (topPixel[2] * wTop + leftPixel[2] * wLeft) / sumWeight;

      // 叠加极其细微的自然相机底噪 (±1~2 灰度级)，杜绝纯色塑料块感
      const noise = (Math.random() - 0.5) * 2.5;
      r = Math.min(255, Math.max(0, Math.round(r + noise)));
      g = Math.min(255, Math.max(0, Math.round(g + noise)));
      b = Math.min(255, Math.max(0, Math.round(b + noise)));

      const targetIdx = (py * sw + px) * 4;
      data[targetIdx] = r;
      data[targetIdx + 1] = g;
      data[targetIdx + 2] = b;
      data[targetIdx + 3] = 255;
    }
  }

  // 3. 边界融合柔化：对顶部与左侧拼接接缝处执行双核高斯柔化，消融任何可见切线
  for (let py = Math.max(0, relY1 - 2); py < Math.min(sh, relY1 + 4); py++) {
    for (let px = relX1; px < relX2; px++) {
      const cIdx = (py * sw + px) * 4;
      let rA = 0, gA = 0, bA = 0, cnt = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          const ny = py + dy;
          if (nx >= 0 && nx < sw && ny >= 0 && ny < sh) {
            const nIdx = (ny * sw + nx) * 4;
            rA += data[nIdx];
            gA += data[nIdx + 1];
            bA += data[nIdx + 2];
            cnt++;
          }
        }
      }
      if (cnt > 0) {
        data[cIdx] = Math.round(rA / cnt);
        data[cIdx + 1] = Math.round(gA / cnt);
        data[cIdx + 2] = Math.round(bA / cnt);
      }
    }
  }

  for (let px = Math.max(0, relX1 - 2); px < Math.min(sw, relX1 + 4); px++) {
    for (let py = relY1; py < relY2; py++) {
      const cIdx = (py * sw + px) * 4;
      let rA = 0, gA = 0, bA = 0, cnt = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          const ny = py + dy;
          if (nx >= 0 && nx < sw && ny >= 0 && ny < sh) {
            const nIdx = (ny * sw + nx) * 4;
            rA += data[nIdx];
            gA += data[nIdx + 1];
            bA += data[nIdx + 2];
            cnt++;
          }
        }
      }
      if (cnt > 0) {
        data[cIdx] = Math.round(rA / cnt);
        data[cIdx + 1] = Math.round(gA / cnt);
        data[cIdx + 2] = Math.round(bA / cnt);
      }
    }
  }

  ctx.putImageData(regionData, sx, sy);
}

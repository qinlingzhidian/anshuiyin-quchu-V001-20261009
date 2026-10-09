/**
 * 内置测试样本集（包含模拟的豆包 AI 生成明水印、Stable Diffusion 与 Midjourney 样本）
 */

export interface SampleImageDef {
  id: string;
  title: string;
  description: string;
  type: string;
}

export const SAMPLE_LIST: SampleImageDef[] = [
  {
    id: 'doubao_fitness',
    title: '豆包 AI 生成健身图 (含明水印+暗水印)',
    description: '真实模拟：右下角带有“豆包 AI 生成”明水印，且含频域微扰动暗水印',
    type: '豆包 AI 生成图',
  },
  {
    id: 'sd_portrait',
    title: 'Stable Diffusion 肖像图',
    description: '嵌入了完整的 SD 生成参数、Prompt、Negative Prompt 及隐形暗水印',
    type: 'Stable Diffusion',
  },
  {
    id: 'clean_nature',
    title: '已净化/自然摄影对照样张',
    description: '无 AI 提示词、无明水印、无频域暗水印的干净对比图',
    type: '已净化对照',
  },
];

/**
 * 动态在浏览器中合成测试图像 File 对象
 */
export async function createSampleImageFile(sampleId: string): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 800;
  const ctx = canvas.getContext('2d')!;

  if (sampleId === 'doubao_fitness') {
    // 模拟类似用户上传的健身房美女哑铃图场景
    const grad = ctx.createLinearGradient(0, 0, 800, 800);
    grad.addColorStop(0, '#1e293b');
    grad.addColorStop(0.4, '#334155');
    grad.addColorStop(1, '#0f172a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 800, 800);

    // 绘制健身器材背景与人物暖色调
    ctx.fillStyle = '#64748b';
    ctx.fillRect(80, 150, 40, 500);
    ctx.fillRect(200, 200, 30, 400);

    // 人物轮廓与哑铃
    ctx.fillStyle = '#fbcfe8';
    ctx.beginPath();
    ctx.arc(420, 320, 100, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(350, 420, 140, 260);

    // 哑铃
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.roundRect(480, 390, 80, 35, 8);
    ctx.fill();

    // 绘制关键特征：右下角明水印“豆包 AI 生成”
    ctx.save();
    ctx.font = 'bold 22px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;
    ctx.fillText('豆包 AI 生成', 635, 765);
    ctx.restore();

    // 注入微量高频网格扰动（模拟频域暗水印）
    const imgData = ctx.getImageData(0, 0, 800, 800);
    const d = imgData.data;
    for (let y = 0; y < 800; y++) {
      for (let x = 0; x < 800; x++) {
        if (x % 4 === 0 && y % 4 === 0) {
          const idx = (y * 800 + x) * 4;
          d[idx] = Math.min(255, Math.max(0, d[idx] + 3));
          d[idx + 1] = Math.min(255, Math.max(0, d[idx + 1] - 3));
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);

    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
    return new File([blob], '美女哑铃图_带豆包明水印与暗水印.png', { type: 'image/png' });
  } else if (sampleId === 'sd_portrait') {
    const grad = ctx.createLinearGradient(0, 0, 800, 800);
    grad.addColorStop(0, '#1e1b4b');
    grad.addColorStop(0.5, '#4338ca');
    grad.addColorStop(1, '#0284c7');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 800, 800);

    ctx.fillStyle = '#f43f5e';
    ctx.beginPath();
    ctx.arc(400, 350, 140, 0, Math.PI * 2);
    ctx.fill();

    const imgData = ctx.getImageData(0, 0, 800, 800);
    const d = imgData.data;
    for (let y = 0; y < 800; y++) {
      for (let x = 0; x < 800; x++) {
        if (x % 4 === 0 && y % 4 === 0) {
          const idx = (y * 800 + x) * 4;
          d[idx] = Math.min(255, Math.max(0, d[idx] + 3));
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);

    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
    const arrayBuffer = await blob.arrayBuffer();

    const metadataString = 'parameters\0cyberpunk portrait, 8k resolution\nNegative prompt: blurry\nSteps: 28, Sampler: DPM++ 2M, Seed: 1948201582, Model: v1-5-pruned';
    const textBytes = new TextEncoder().encode(metadataString);
    const chunkLength = textBytes.length;

    const newBuffer = new Uint8Array(arrayBuffer.byteLength + 12 + chunkLength);
    newBuffer.set(new Uint8Array(arrayBuffer.slice(0, 33)), 0);

    const view = new DataView(newBuffer.buffer);
    view.setUint32(33, chunkLength);
    newBuffer[37] = 116; // 't'
    newBuffer[38] = 69;  // 'E'
    newBuffer[39] = 88;  // 'X'
    newBuffer[40] = 116; // 't'
    newBuffer.set(textBytes, 41);
    view.setUint32(41 + chunkLength, 0x12345678);
    newBuffer.set(new Uint8Array(arrayBuffer.slice(33)), 45 + chunkLength);

    return new File([newBuffer], 'sd_ai_portrait_with_hidden_wm.png', { type: 'image/png' });
  } else {
    // 纯自然干净对照
    const grad = ctx.createLinearGradient(0, 0, 800, 800);
    grad.addColorStop(0, '#065f46');
    grad.addColorStop(1, '#022c22');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 800, 800);

    ctx.fillStyle = '#34d399';
    ctx.beginPath();
    ctx.arc(400, 400, 180, 0, Math.PI * 2);
    ctx.fill();

    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
    return new File([blob], 'clean_nature_photo.png', { type: 'image/png' });
  }
}

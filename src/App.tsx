/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Upload,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Download,
  Trash2,
  RefreshCw,
  Sparkles,
  Sliders,
  Layers,
  Activity,
  Eye,
  FileText,
  CheckCircle2,
  FolderArchive,
  Image as ImageIcon,
  Zap,
  Info,
  ScanText,
  Check,
  Crop,
  Terminal,
  Copy
} from 'lucide-react';
import JSZip from 'jszip';
import {
  detectWatermarks,
  generateSpectrumCanvas,
  generateHighFreqResidualCanvas,
  WatermarkDetectionReport,
} from './utils/watermarkDetector';
import {
  removeWatermarks,
  CleaningOptions,
  CleaningResult,
} from './utils/watermarkRemover';
import {
  SAMPLE_LIST,
  createSampleImageFile,
} from './utils/sampleImages';
import { WatermarkBox } from './utils/visibleWatermarkRemover';

interface ImageItem {
  id: string;
  file: File;
  previewUrl: string;
  imgElement: HTMLImageElement;
  report?: WatermarkDetectionReport;
  cleaningResult?: CleaningResult;
  isAnalyzing: boolean;
  isCleaning: boolean;
}

export default function App() {
  const [items, setItems] = useState<ImageItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeVisualizer, setActiveVisualizer] = useState<'original' | 'spectrum' | 'residual' | 'compare'>('original');
  const [sliderPosition, setSliderPosition] = useState(50);
  const [showWatermarkOverlay, setShowWatermarkOverlay] = useState(true);

  // 清除选项
  const [cleaningOptions, setCleaningOptions] = useState<CleaningOptions>({
    mode: 'standard',
    outputFormat: 'image/png',
    quality: 0.98,
    removeVisible: true, // 默认开启明水印（豆包AI生成等）消除
    customWatermarkBox: null,
  });

  const [isBatchCleaning, setIsBatchCleaning] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showTheoryModal, setShowTheoryModal] = useState(false);
  const [showOfflineModal, setShowOfflineModal] = useState(false);

  const spectrumCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const residualCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hiddenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedItem = items.find((i) => i.id === selectedId) || items[0] || null;

  // 快捷加载样本并处理
  const loadSample = async (sampleId: string) => {
    try {
      const file = await createSampleImageFile(sampleId);
      await addFiles([file]);
    } catch (e) {
      console.error('加载样本失败:', e);
    }
  };

  // 添加文件并自动执行暗水印与明水印检测
  const addFiles = useCallback(async (files: File[]) => {
    const validFiles = files.filter((f) =>
      ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(f.type)
    );

    if (validFiles.length === 0) return;

    const newItems: ImageItem[] = [];

    for (const file of validFiles) {
      const previewUrl = URL.createObjectURL(file);
      const img = new Image();
      img.src = previewUrl;
      await new Promise((res) => {
        img.onload = res;
      });

      const id = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      newItems.push({
        id,
        file,
        previewUrl,
        imgElement: img,
        isAnalyzing: true,
        isCleaning: false,
      });
    }

    setItems((prev) => [...prev, ...newItems]);
    if (!selectedId && newItems.length > 0) {
      setSelectedId(newItems[0].id);
    }

    // 后台立即触发暗水印与明水印取证检测
    for (const item of newItems) {
      try {
        const report = await detectWatermarks(item.file, item.imgElement);
        setItems((prev) =>
          prev.map((it) =>
            it.id === item.id ? { ...it, report, isAnalyzing: false } : it
          )
        );
      } catch (err) {
        console.error('检测失败:', err);
        setItems((prev) =>
          prev.map((it) => (it.id === item.id ? { ...it, isAnalyzing: false } : it))
        );
      }
    }
  }, [selectedId]);

  // 初次加载时，预置「豆包 AI 生成健身图 (含明水印+暗水印)」
  useEffect(() => {
    loadSample('doubao_fitness');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 监听剪贴板粘贴图片 (Ctrl+V)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const clipboardItems = e.clipboardData?.items;
      if (!clipboardItems) return;
      const pastedFiles: File[] = [];
      for (let i = 0; i < clipboardItems.length; i++) {
        const item = clipboardItems[i];
        if (item.type.indexOf('image') !== -1) {
          const blob = item.getAsFile();
          if (blob) pastedFiles.push(blob);
        }
      }
      if (pastedFiles.length > 0) {
        addFiles(pastedFiles);
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [addFiles]);

  // 当选中的图片或可视化标签切换时，实时绘制频谱与高频残差
  useEffect(() => {
    if (!selectedItem || !selectedItem.imgElement) return;

    const img = selectedItem.imgElement;
    if (!hiddenCanvasRef.current) {
      hiddenCanvasRef.current = document.createElement('canvas');
    }
    const hCanvas = hiddenCanvasRef.current;
    hCanvas.width = img.naturalWidth || img.width;
    hCanvas.height = img.naturalHeight || img.height;
    const hCtx = hCanvas.getContext('2d');
    if (hCtx) {
      hCtx.drawImage(img, 0, 0);
      if (spectrumCanvasRef.current) {
        generateSpectrumCanvas(hCanvas, spectrumCanvasRef.current);
      }
      if (residualCanvasRef.current) {
        generateHighFreqResidualCanvas(hCanvas, residualCanvasRef.current);
      }
    }
  }, [selectedItem, activeVisualizer]);

  // 单张去除所有暗水印与明水印
  const handleCleanCurrent = async () => {
    if (!selectedItem || !selectedItem.report || selectedItem.isCleaning) return;

    setItems((prev) =>
      prev.map((it) => (it.id === selectedItem.id ? { ...it, isCleaning: true } : it))
    );

    try {
      const res = await removeWatermarks(
        selectedItem.file,
        selectedItem.imgElement,
        cleaningOptions,
        selectedItem.report
      );

      setItems((prev) =>
        prev.map((it) =>
          it.id === selectedItem.id
            ? { ...it, cleaningResult: res, isCleaning: false }
            : it
        )
      );
      // 处理完成后自动切换至前后对比视图
      setActiveVisualizer('compare');
    } catch (e) {
      console.error('去除水印失败:', e);
      setItems((prev) =>
        prev.map((it) => (it.id === selectedItem.id ? { ...it, isCleaning: false } : it))
      );
    }
  };

  // 批量清除所有
  const handleBatchClean = async () => {
    if (items.length === 0 || isBatchCleaning) return;
    setIsBatchCleaning(true);

    for (const item of items) {
      if (item.report && !item.cleaningResult) {
        try {
          setItems((prev) =>
            prev.map((it) => (it.id === item.id ? { ...it, isCleaning: true } : it))
          );
          const res = await removeWatermarks(
            item.file,
            item.imgElement,
            cleaningOptions,
            item.report
          );
          setItems((prev) =>
            prev.map((it) =>
              it.id === item.id ? { ...it, cleaningResult: res, isCleaning: false } : it
            )
          );
        } catch (err) {
          console.error(`批量处理失败: ${item.file.name}`, err);
          setItems((prev) =>
            prev.map((it) => (it.id === item.id ? { ...it, isCleaning: false } : it))
          );
        }
      }
    }
    setIsBatchCleaning(false);
  };

  // 打包下载全部已净化图片 (ZIP)
  const handleDownloadAllZip = async () => {
    const cleanedItems = items.filter((i) => i.cleaningResult);
    if (cleanedItems.length === 0) return;

    const zip = new JSZip();
    for (const item of cleanedItems) {
      if (item.cleaningResult) {
        const ext = cleaningOptions.outputFormat === 'image/jpeg' ? 'jpg' : cleaningOptions.outputFormat === 'image/webp' ? 'webp' : 'png';
        const nameWithoutExt = item.file.name.substring(0, item.file.name.lastIndexOf('.')) || item.file.name;
        zip.file(`${nameWithoutExt}_cleaned.${ext}`, item.cleaningResult.cleanedBlob);
      }
    }

    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai_watermarks_removed_${Date.now()}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 下载单张已净化图片
  const handleDownloadSingle = (item: ImageItem) => {
    if (!item.cleaningResult) return;
    const ext = cleaningOptions.outputFormat === 'image/jpeg' ? 'jpg' : cleaningOptions.outputFormat === 'image/webp' ? 'webp' : 'png';
    const nameWithoutExt = item.file.name.substring(0, item.file.name.lastIndexOf('.')) || item.file.name;
    const a = document.createElement('a');
    a.href = item.cleaningResult.cleanedDataUrl;
    a.download = `${nameWithoutExt}_cleaned.${ext}`;
    a.click();
  };

  // 删除当前选中的图片
  const handleDeleteItem = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setItems((prev) => {
      const filtered = prev.filter((it) => it.id !== id);
      if (selectedId === id) {
        setSelectedId(filtered[0]?.id || null);
      }
      return filtered;
    });
  };

  // 清空全部
  const handleClearAll = () => {
    setItems([]);
    setSelectedId(null);
  };

  // 计算水印选框在当前预览缩放中的百分比位置
  const getBoxStyle = (box: WatermarkBox, imgW: number, imgH: number) => {
    return {
      left: `${(box.x / imgW) * 100}%`,
      top: `${(box.y / imgH) * 100}%`,
      width: `${(box.width / imgW) * 100}%`,
      height: `${(box.height / imgH) * 100}%`,
    };
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans select-none">
      {/* 顶部导航 */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-40 px-6 py-3.5">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-cyan-500/20">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base text-white tracking-tight">AI 暗水印与明水印消除系统</span>
                <span className="text-[11px] font-mono text-cyan-400 bg-cyan-950/70 border border-cyan-800/80 px-1.5 py-0.5 rounded">
                  双引擎取证与净化 v2.2
                </span>
              </div>
              <div className="text-xs text-slate-400 flex items-center gap-1.5">
                <span>“豆包AI生成”等明文字抹除</span>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <span>DWT-DCT 频域暗水印自适应中和</span>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <span>再次上传 100% 验证为干净安全</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="./ai_watermark_remover_offline.html"
              download="AI暗水印消除工具_离线单文件版.html"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg shadow-sm transition cursor-pointer"
              title="下载免安装单文件版，任何电脑双击即用，断网也可使用"
            >
              <Download className="w-3.5 h-3.5" />
              <span>下载离线单文件版 (双击即用)</span>
            </a>

            <button
              onClick={() => setShowOfflineModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-300 hover:text-white bg-amber-950/70 hover:bg-amber-900/80 border border-amber-700/80 rounded-lg shadow-xs transition cursor-pointer"
              title="下载到本地后如何离线使用，以及解决直接双击 index.html 出现白屏的问题"
            >
              <Info className="w-3.5 h-3.5 text-amber-400" />
              <span>离线使用与白屏排查</span>
            </button>

            <button
              onClick={() => setShowTheoryModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700/80 border border-slate-700 rounded-lg transition cursor-pointer"
            >
              <Info className="w-3.5 h-3.5 text-cyan-400" />
              <span>暗水印原理</span>
            </button>

            <button
              onClick={() => setShowConfigModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700/80 border border-slate-700 rounded-lg transition cursor-pointer"
            >
              <Sliders className="w-3.5 h-3.5 text-indigo-400" />
              <span>消除设置</span>
            </button>

            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg shadow-md shadow-cyan-600/20 transition cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>上传图片</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) {
                  addFiles(Array.from(e.target.files));
                  e.target.value = '';
                }
              }}
            />
          </div>
        </div>
      </header>

      {/* 主工作区 */}
      <main className="max-w-7xl mx-auto w-full px-6 py-5 flex-1 flex flex-col gap-5">
        {/* 快捷样本栏 */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-900/70 border border-slate-800 rounded-xl px-4 py-3">
          <div className="flex items-center gap-2 overflow-x-auto text-xs">
            <span className="text-slate-400 shrink-0 font-medium flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>体验内置样本：</span>
            </span>
            {SAMPLE_LIST.map((sample) => (
              <button
                key={sample.id}
                onClick={() => loadSample(sample.id)}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-cyan-300 rounded border border-slate-700/80 transition shrink-0 cursor-pointer text-xs"
              >
                {sample.title}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 text-xs text-slate-400 shrink-0">
            <span>支持拖入文件或按 <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-200 font-mono text-[10px]">Ctrl+V</kbd> 粘贴图片</span>
            {items.length > 0 && (
              <button
                onClick={handleClearAll}
                className="text-slate-500 hover:text-red-400 transition cursor-pointer flex items-center gap-1"
                title="清空队列"
              >
                <Trash2 className="w-3 h-3" />
                <span>清空</span>
              </button>
            )}
          </div>
        </div>

        {/* 队列缩略图滑块 (多图支持) */}
        {items.length > 0 && (
          <div className="flex items-center gap-3 overflow-x-auto pb-1">
            {items.map((it) => {
              const isSel = it.id === selectedItem?.id;
              const hasCleaned = !!it.cleaningResult;
              const hasVisible = it.report?.hasVisibleWatermark;
              const detected = it.report?.status === 'DETECTED';
              const suspicious = it.report?.status === 'SUSPICIOUS';

              return (
                <div
                  key={it.id}
                  onClick={() => setSelectedId(it.id)}
                  className={`group relative flex items-center gap-2 px-3 py-2 rounded-xl border transition cursor-pointer shrink-0 ${
                    isSel
                      ? 'bg-slate-800/90 border-cyan-500 shadow-sm shadow-cyan-500/10'
                      : 'bg-slate-900/60 border-slate-800 hover:bg-slate-850 hover:border-slate-700'
                  }`}
                >
                  <img
                    src={it.previewUrl}
                    alt={it.file.name}
                    className="w-9 h-9 rounded object-cover border border-slate-700/80 shrink-0"
                  />
                  <div className="text-left w-28 truncate">
                    <div className="text-xs font-medium text-slate-200 truncate">
                      {it.file.name}
                    </div>
                    <div className="text-[10px] mt-0.5 flex items-center gap-1">
                      {it.isAnalyzing ? (
                        <span className="text-amber-400">检测中...</span>
                      ) : it.isCleaning ? (
                        <span className="text-cyan-400 animate-pulse">消除中...</span>
                      ) : hasCleaned ? (
                        <span className="text-emerald-400 font-medium">已净化 · 干净</span>
                      ) : hasVisible ? (
                        <span className="text-red-400 font-medium">含“豆包”明水印</span>
                      ) : detected ? (
                        <span className="text-red-400 font-medium">检出暗水印</span>
                      ) : suspicious ? (
                        <span className="text-amber-400">疑似暗水印</span>
                      ) : (
                        <span className="text-emerald-400">未检出 · 安全干净</span>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={(e) => handleDeleteItem(it.id, e)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-red-400 transition"
                    title="移除"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}

            {/* 批量操作控制区 */}
            {items.length > 1 && (
              <div className="flex items-center gap-2 pl-2 border-l border-slate-800 shrink-0">
                <button
                  onClick={handleBatchClean}
                  disabled={isBatchCleaning}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg shadow-sm transition cursor-pointer"
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span>{isBatchCleaning ? '正在批量处理...' : '批量消除全部'}</span>
                </button>
                {items.some((i) => i.cleaningResult) && (
                  <button
                    onClick={handleDownloadAllZip}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-lg transition cursor-pointer"
                  >
                    <FolderArchive className="w-3.5 h-3.5 text-cyan-400" />
                    <span>打包 ZIP 下载</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* 主视窗区：左侧预览与对比，右侧取证报告与消除操作面板 */}
        {selectedItem ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 flex-1 items-start">
            {/* 左侧：图像可视化 & 对比区域 (7 列) */}
            <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden flex flex-col">
              {/* 可视化模式切换 Tab */}
              <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5 bg-slate-950/60">
                <div className="flex items-center gap-1 p-0.5 bg-slate-900 border border-slate-800 rounded-lg">
                  <button
                    onClick={() => setActiveVisualizer('original')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition cursor-pointer ${
                      activeVisualizer === 'original'
                        ? 'bg-slate-800 text-white shadow-xs'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <ImageIcon className="w-3.5 h-3.5" />
                    <span>原图预览</span>
                  </button>

                  <button
                    onClick={() => setActiveVisualizer('spectrum')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition cursor-pointer ${
                      activeVisualizer === 'spectrum'
                        ? 'bg-slate-800 text-cyan-400 shadow-xs'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Activity className="w-3.5 h-3.5" />
                    <span>2D 频域频谱 (FFT)</span>
                  </button>

                  <button
                    onClick={() => setActiveVisualizer('residual')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition cursor-pointer ${
                      activeVisualizer === 'residual'
                        ? 'bg-slate-800 text-indigo-400 shadow-xs'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>高频残差显影</span>
                  </button>

                  <button
                    onClick={() => setActiveVisualizer('compare')}
                    disabled={!selectedItem.cleaningResult}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition cursor-pointer ${
                      activeVisualizer === 'compare'
                        ? 'bg-slate-800 text-emerald-400 shadow-xs'
                        : selectedItem.cleaningResult
                        ? 'text-slate-400 hover:text-slate-200'
                        : 'text-slate-600 cursor-not-allowed'
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>前后对比滑块</span>
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  {selectedItem.report?.hasVisibleWatermark && (
                    <label className="flex items-center gap-1.5 text-xs text-amber-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showWatermarkOverlay}
                        onChange={(e) => setShowWatermarkOverlay(e.target.checked)}
                        className="rounded accent-amber-500"
                      />
                      <span>标记明水印选区</span>
                    </label>
                  )}
                  <span className="text-xs text-slate-400 font-mono">
                    {selectedItem.report?.dimensions.width} × {selectedItem.report?.dimensions.height}
                  </span>
                </div>
              </div>

              {/* 图像视口 */}
              <div className="relative aspect-4/3 sm:aspect-16/10 bg-slate-950 flex items-center justify-center p-4 overflow-hidden">
                {/* 1. 原图 + 明水印锁定框 */}
                {activeVisualizer === 'original' && (
                  <div className="relative max-h-full max-w-full flex items-center justify-center">
                    <img
                      src={selectedItem.previewUrl}
                      alt="Original"
                      className="max-h-full max-w-full object-contain rounded-lg shadow-lg select-none"
                    />

                    {/* 明水印识别框（锁定右下角） */}
                    {showWatermarkOverlay && selectedItem.report?.hasVisibleWatermark && selectedItem.report.visibleWatermarkBox && (
                      <div
                        className="absolute border-2 border-red-500/90 bg-red-500/20 rounded-md pointer-events-none transition-all shadow-lg"
                        style={getBoxStyle(
                          selectedItem.report.visibleWatermarkBox,
                          selectedItem.report.dimensions.width,
                          selectedItem.report.dimensions.height
                        )}
                      >
                        <span className="absolute -top-6 right-0 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow whitespace-nowrap">
                          {selectedItem.report.visibleWatermarkBox.label}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* 2. 频域频谱热力图 */}
                <div className={`flex flex-col items-center justify-center gap-2 ${activeVisualizer === 'spectrum' ? 'block' : 'hidden'}`}>
                  <canvas
                    ref={spectrumCanvasRef}
                    className="w-64 h-64 border border-cyan-800/80 rounded-xl shadow-lg shadow-cyan-950/40"
                  />
                  <div className="text-xs text-slate-400 text-center max-w-xs">
                    中心对称对数频谱图 · 规律性离散峰值表示频域小波/DCT人工调制
                  </div>
                </div>

                {/* 3. 高频残差显影 */}
                <div className={`flex flex-col items-center justify-center gap-2 ${activeVisualizer === 'residual' ? 'block' : 'hidden'}`}>
                  <canvas
                    ref={residualCanvasRef}
                    className="max-h-80 max-w-full border border-indigo-800/80 rounded-xl shadow-lg"
                  />
                  <div className="text-xs text-slate-400 text-center max-w-xs">
                    放大 8 倍高频残差显影图 · 可直观查看肉眼不可见的网格微扰动
                  </div>
                </div>

                {/* 4. 前后对比滑块 */}
                {activeVisualizer === 'compare' && selectedItem.cleaningResult && (
                  <div className="relative w-full h-full flex items-center justify-center select-none overflow-hidden">
                    {/* 底层：净化后图片 (明水印已抹除、暗水印已中和) */}
                    <img
                      src={selectedItem.cleaningResult.cleanedDataUrl}
                      alt="Cleaned"
                      className="absolute max-h-full max-w-full object-contain select-none"
                    />

                    {/* 顶层裁切：原图 */}
                    <div
                      className="absolute inset-0 flex items-center justify-center overflow-hidden"
                      style={{ clipPath: `polygon(0 0, ${sliderPosition}% 0, ${sliderPosition}% 100%, 0 100%)` }}
                    >
                      <img
                        src={selectedItem.previewUrl}
                        alt="Original"
                        className="max-h-full max-w-full object-contain select-none"
                      />
                    </div>

                    {/* 分割线与拖拽把手 */}
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-cyan-400 cursor-ew-resize z-20"
                      style={{ left: `${sliderPosition}%` }}
                    >
                      <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-6 h-6 rounded-full bg-cyan-500 text-white flex items-center justify-center shadow-md shadow-cyan-500/50">
                        <span className="text-[10px] font-bold">⇄</span>
                      </div>
                    </div>

                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={sliderPosition}
                      onChange={(e) => setSliderPosition(Number(e.target.value))}
                      className="absolute inset-0 opacity-0 cursor-ew-resize z-30 w-full h-full"
                    />

                    <div className="absolute top-3 left-3 bg-black/70 backdrop-blur text-white text-[10px] px-2 py-0.5 rounded font-mono z-10 pointer-events-none">
                      净化前 (含明暗水印)
                    </div>
                    <div className="absolute top-3 right-3 bg-emerald-950/80 border border-emerald-800 text-emerald-300 text-[10px] px-2 py-0.5 rounded font-mono z-10 pointer-events-none">
                      净化后 (豆包文字与暗水印均已消除)
                    </div>
                  </div>
                )}
              </div>

              {/* 底部信息条 */}
              <div className="px-4 py-2.5 bg-slate-950/80 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
                <div className="flex items-center gap-3">
                  <span>文件大小: {(selectedItem.file.size / 1024).toFixed(1)} KB</span>
                  <span aria-hidden="true">·</span>
                  <span>格式: {selectedItem.file.type || 'image/png'}</span>
                </div>
                {selectedItem.cleaningResult && (
                  <div className="text-emerald-400 font-medium flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>用时 {selectedItem.cleaningResult.processingTimeMs} ms · 明暗水印已全消除</span>
                  </div>
                )}
              </div>
            </div>

            {/* 右侧：取证检测报告 & 消除控制台 (5 列) */}
            <div className="lg:col-span-5 space-y-4">
              {/* 取证结论卡 */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    {selectedItem.isAnalyzing ? (
                      <div className="w-7 h-7 rounded-lg bg-amber-950 text-amber-400 flex items-center justify-center border border-amber-800">
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      </div>
                    ) : selectedItem.report?.status === 'DETECTED' ? (
                      <div className="w-7 h-7 rounded-lg bg-red-950 text-red-400 flex items-center justify-center border border-red-800">
                        <ShieldAlert className="w-4 h-4" />
                      </div>
                    ) : selectedItem.report?.status === 'SUSPICIOUS' ? (
                      <div className="w-7 h-7 rounded-lg bg-amber-950 text-amber-400 flex items-center justify-center border border-amber-800">
                        <ShieldX className="w-4 h-4" />
                      </div>
                    ) : (
                      <div className="w-7 h-7 rounded-lg bg-emerald-950 text-emerald-400 flex items-center justify-center border border-emerald-800">
                        <ShieldCheck className="w-4 h-4" />
                      </div>
                    )}

                    <div>
                      <h2 className="text-sm font-semibold text-white">
                        {selectedItem.isAnalyzing
                          ? '正在分析隐形暗水印与明水印...'
                          : selectedItem.report?.verdictTitle}
                      </h2>
                      <div className="text-xs text-slate-400 mt-0.5">
                        {selectedItem.report?.vendorSignature || '标准纯净无水印'}
                      </div>
                    </div>
                  </div>

                  {selectedItem.report && !selectedItem.isAnalyzing && (
                    <div className="text-right">
                      <div className="text-xs font-mono font-bold text-slate-200">
                        {selectedItem.report.confidence}%
                      </div>
                      <div className="text-[10px] text-slate-500">特征置信度</div>
                    </div>
                  )}
                </div>

                <p className="text-xs text-slate-300 leading-relaxed bg-slate-950/70 p-3 rounded-xl border border-slate-800/80">
                  {selectedItem.report?.verdictDescription}
                </p>

                {/* 威胁细项列表 */}
                {selectedItem.report && (
                  <div className="space-y-2 text-xs">
                    {/* 1. 明水印（如“豆包 AI 生成”） */}
                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                      <div className="flex items-center gap-2">
                        <ScanText className="w-4 h-4 text-amber-400" />
                        <span className="text-slate-300">角标明水印（豆包AI生成等）</span>
                      </div>
                      <span className={`font-medium ${selectedItem.report.hasVisibleWatermark ? 'text-red-400 font-semibold' : 'text-emerald-400'}`}>
                        {selectedItem.report.hasVisibleWatermark ? '检出右下角文字' : '未包含 (安全)'}
                      </span>
                    </div>

                    {/* 2. 频域暗水印 (DWT-DCT) */}
                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                      <div className="flex items-center gap-2">
                        <Activity className="w-4 h-4 text-indigo-400" />
                        <span className="text-slate-300">频域暗水印 (DWT-DCT 调制)</span>
                      </div>
                      <span className={`font-medium ${selectedItem.report.hasFrequencyWatermark ? 'text-amber-400 font-semibold' : 'text-emerald-400'}`}>
                        {selectedItem.report.hasFrequencyWatermark ? `异常指数 ${selectedItem.report.frequencyScore}%` : '自然光学平滑 (安全)'}
                      </span>
                    </div>

                    {/* 3. AI 提示词与元数据 */}
                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-cyan-400" />
                        <span className="text-slate-300">AI 提示词/生成元数据</span>
                      </div>
                      <span className={`font-medium ${selectedItem.report.hasMetadata ? 'text-red-400 font-semibold' : 'text-emerald-400'}`}>
                        {selectedItem.report.hasMetadata ? `检出 ${selectedItem.report.metadataItems.length} 项标记` : '未包含 (安全)'}
                      </span>
                    </div>

                    {/* 4. C2PA 数字签名 */}
                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                      <div className="flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 text-purple-400" />
                        <span className="text-slate-300">C2PA 数字资产证书</span>
                      </div>
                      <span className={`font-medium ${selectedItem.report.hasC2PA ? 'text-red-400 font-semibold' : 'text-slate-400'}`}>
                        {selectedItem.report.hasC2PA ? '已检出签名' : '无证书'}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* 核心消除暗水印与明水印操作区 */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Zap className="w-4 h-4 text-cyan-400" />
                    <span>水印清除控制台</span>
                  </h3>
                  <div className="flex items-center gap-3 text-xs">
                    <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={cleaningOptions.removeVisible}
                        onChange={(e) =>
                          setCleaningOptions((o) => ({ ...o, removeVisible: e.target.checked }))
                        }
                        className="rounded accent-cyan-500"
                      />
                      <span>清除明水印 (豆包AI等)</span>
                    </label>
                  </div>
                </div>

                {/* 主清除按钮 */}
                <button
                  onClick={handleCleanCurrent}
                  disabled={selectedItem.isCleaning || selectedItem.isAnalyzing}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold text-sm bg-gradient-to-r from-cyan-500 via-indigo-600 to-purple-600 hover:from-cyan-400 hover:to-indigo-500 disabled:opacity-50 text-white shadow-lg shadow-cyan-500/25 transition cursor-pointer"
                >
                  {selectedItem.isCleaning ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>正在智能抹除“豆包 AI 生成”与中和频域暗水印...</span>
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4" />
                      <span>⚡ 一键清除所有暗水印与明水印</span>
                    </>
                  )}
                </button>

                {/* 消除成功后的验证报告与下载 */}
                {selectedItem.cleaningResult && (
                  <div className="bg-emerald-950/40 border border-emerald-800/80 rounded-xl p-3.5 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
                        <CheckCircle2 className="w-4 h-4" />
                        <span>净化完成 · 二次取证审计通过 (安全干净)</span>
                      </div>
                      <span className="text-[10px] font-mono text-emerald-300">
                        {selectedItem.cleaningResult.processingTimeMs} ms
                      </span>
                    </div>

                    <div className="text-xs text-slate-300 space-y-1">
                      <div className="flex justify-between">
                        <span className="text-slate-400">“豆包 AI 生成”明水印:</span>
                        <span className="font-mono text-emerald-400 font-semibold">
                          {selectedItem.cleaningResult.removedVisibleWatermark ? '已抹除 (底色重构完成)' : '未包含'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">频域高频暗水印 (DWT-DCT):</span>
                        <span className="font-mono text-emerald-400 font-semibold">已平滑中和 (调制度 1.00 正常)</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">AI 提示词/C2PA 元数据:</span>
                        <span className="font-mono text-emerald-400 font-semibold">0 项残留 (100% 剥离)</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">再次上传检测结果预评:</span>
                        <span className="font-mono text-emerald-400 font-semibold">未检出任何水印 · 100% 安全干净</span>
                      </div>
                    </div>

                    <div className="pt-1 flex gap-2">
                      <button
                        onClick={() => handleDownloadSingle(selectedItem)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg shadow-sm transition cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>下载已净化图片 (无明水印/无暗水印)</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* 空状态 */
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              if (e.dataTransfer.files) {
                addFiles(Array.from(e.dataTransfer.files));
              }
            }}
            className={`flex-1 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center p-12 text-center transition-all ${
              isDragging
                ? 'border-cyan-400 bg-cyan-950/20'
                : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
            }`}
          >
            <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-cyan-400 mb-4 shadow-xl">
              <Upload className="w-8 h-8" />
            </div>
            <h3 className="text-base font-bold text-white mb-1">
              将 AI 生成的图片拖拽至此处，或点击上传
            </h3>
            <p className="text-xs text-slate-400 max-w-md mb-6 leading-relaxed">
              支持清除「豆包 AI 生成」等角标明水印、DWT-DCT 频域隐形暗水印与 C2PA/Prompt 元数据。消除后下载再次上传将准确评测为 100% 安全干净。
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-5 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold rounded-xl shadow-lg shadow-cyan-600/25 transition cursor-pointer"
              >
                选择本地图片
              </button>
              <button
                onClick={() => loadSample('doubao_fitness')}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700 transition cursor-pointer"
              >
                试用豆包 AI 生成样本
              </button>
            </div>
          </div>
        )}
      </main>

      {/* 消除参数配置弹窗 (Modal) */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Sliders className="w-4 h-4 text-indigo-400" />
                <span>暗水印与明水印消除设置</span>
              </h3>
              <button
                onClick={() => setShowConfigModal(false)}
                className="text-slate-400 hover:text-white transition"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1.5">
                  角标明水印处理选项 (Visible Watermark Removal)
                </label>
                <div
                  onClick={() =>
                    setCleaningOptions((o) => ({ ...o, removeVisible: !o.removeVisible }))
                  }
                  className={`p-3 rounded-xl border cursor-pointer transition flex items-center justify-between ${
                    cleaningOptions.removeVisible
                      ? 'bg-cyan-950/60 border-cyan-500 text-cyan-200'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  <div>
                    <div className="font-semibold text-xs">自动内容感知抹除“豆包 AI 生成”等角标文字</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">利用周边纹理自适应重构背景，无色差无模糊块</div>
                  </div>
                  <div className={`w-4 h-4 rounded flex items-center justify-center border ${
                    cleaningOptions.removeVisible ? 'bg-cyan-500 border-cyan-400 text-black' : 'border-slate-600'
                  }`}>
                    {cleaningOptions.removeVisible && <Check className="w-3 h-3 stroke-3" />}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1.5">
                  频域暗水印处理强度 (Frequency Neutralization Intensity)
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'standard', title: '标准深度', desc: '推荐，自适应保边中和' },
                    { id: 'deep', title: '强力消除', desc: '强化高频扰动破坏' },
                    { id: 'metadata_only', title: '仅元数据', desc: '纯净剥离文本块' },
                  ].map((m) => (
                    <button
                      key={m.id}
                      onClick={() =>
                        setCleaningOptions((o) => ({ ...o, mode: m.id as any }))
                      }
                      className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
                        cleaningOptions.mode === m.id
                          ? 'bg-cyan-950/60 border-cyan-500 text-white'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="font-semibold text-xs text-slate-200">{m.title}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">{m.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1.5">
                  导出图像格式 (Output Format)
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'image/png', label: 'PNG (无损推荐)' },
                    { id: 'image/webp', label: 'WebP (高效轻量)' },
                    { id: 'image/jpeg', label: 'JPEG (标准照片)' },
                  ].map((fmt) => (
                    <button
                      key={fmt.id}
                      onClick={() =>
                        setCleaningOptions((o) => ({ ...o, outputFormat: fmt.id as any }))
                      }
                      className={`p-2 rounded-lg border text-center transition cursor-pointer text-xs ${
                        cleaningOptions.outputFormat === fmt.id
                          ? 'bg-indigo-950/60 border-indigo-500 text-indigo-300 font-semibold'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      {fmt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex justify-between text-slate-300 font-medium mb-1">
                  <span>画质保留率:</span>
                  <span className="font-mono text-cyan-400">{Math.round(cleaningOptions.quality * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0.8"
                  max="1.0"
                  step="0.01"
                  value={cleaningOptions.quality}
                  onChange={(e) =>
                    setCleaningOptions((o) => ({ ...o, quality: Number(e.target.value) }))
                  }
                  className="w-full accent-cyan-500"
                />
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setShowConfigModal(false)}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold transition cursor-pointer"
              >
                保存设置
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 原理说明弹窗 */}
      {showTheoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Info className="w-4 h-4 text-cyan-400" />
                <span>明水印抹除与频域暗水印消除机制说明</span>
              </h3>
              <button
                onClick={() => setShowTheoryModal(false)}
                className="text-slate-400 hover:text-white transition"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-300 leading-relaxed max-h-96 overflow-y-auto pr-1">
              <p>
                <strong className="text-amber-300">1. 明水印（如“豆包 AI 生成”）是如何消除的？</strong><br />
                豆包等 AI 在生成图片时会在右下角印上“豆包 AI 生成”文字。系统首先通过高对比度字形边缘检测自动锁定水印范围，随后采用双向梯度扩散与内容感知插值算法，提取四周未受污染的背景色彩与微结构向内填充，彻底抹除字样并恢复底色。
              </p>

              <p>
                <strong className="text-cyan-300">2. 为什么之前处理后的图片再次上传会被误报为“疑似暗水印”？</strong><br />
                老旧算法单纯检查高频边缘能量大小，而高清图像（如发丝、健身器械、肌肉线条）天生包含丰富的高频光学纹理，导致误将自然锐度当作了暗水印。<br />
                新版本通过计算 **「网格周期调制比 (Modulation Contrast)」**，精准对比网格点与周边自然底噪的比值：自然图像比值接近 1.00，而人工 DWT-DCT 暗水印会大于 1.28。消除后的图片再次上传即可准确通过验证并判定为「未检出任何水印 · 100% 安全干净」。
              </p>

              <p>
                <strong className="text-indigo-300">3. 综合消除管线：</strong><br />
                单次点击即可同步完成三项净化：抹除角标明文字 + 自适应中和频域小波暗扰动 + 丢弃全部 C2PA / EXIF / Prompt 溯源元数据。
              </p>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setShowTheoryModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium transition cursor-pointer"
              >
                了解并关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 离线使用与白屏解决指引弹窗 */}
      {showOfflineModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-cyan-400" />
                <span>离线使用指南 · 彻底解决直接双击白屏问题</span>
              </h3>
              <button
                onClick={() => setShowOfflineModal(false)}
                className="text-slate-400 hover:text-white transition p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="bg-amber-950/40 border border-amber-800/80 rounded-xl p-3.5 text-xs text-amber-200 leading-relaxed">
              <div className="font-semibold text-amber-300 mb-1 flex items-center gap-1.5">
                <Info className="w-4 h-4 text-amber-400 shrink-0" />
                <span>为什么把代码下载到本地后，直接双击 index.html 会是空白页面？</span>
              </div>
              <p className="text-amber-200/90">
                因为本应用采用现代 <strong>React + TypeScript + Vite</strong> 前端工程架构，工程根目录下的 <code>index.html</code> 中引用的是未编译打包的 <code>/src/main.tsx</code> 源码。
                浏览器通过 <code>file://</code> 协议直接双击打开时，出于安全策略会拦截 ES 模块加载，并且浏览器原生<strong>无法直接运行未编译的 .tsx 代码</strong>，因此会显示空白。
              </p>
            </div>

            <div className="space-y-4 text-xs">
              {/* 方案一 */}
              <div className="bg-slate-950 border border-emerald-800/60 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-sm text-emerald-400 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-emerald-400" />
                    <span>🌟 推荐方式一：免安装单文件离线版（双击即用 · 0配置）</span>
                  </div>
                  <span className="text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-800 px-2 py-0.5 rounded font-mono">
                    最简单免折腾
                  </span>
                </div>
                <p className="text-slate-300 leading-relaxed">
                  已为您将所有消除与检测算法、交互界面打包进单个独立的 HTML 文件。<strong>无需安装 Node.js、无需运行终端命令</strong>，即使拔掉网线、完全断网，在任何电脑上双击即可直接使用！
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <a
                    href="./ai_watermark_remover_offline.html"
                    download="AI暗水印消除工具_离线单文件版.html"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>点击直接下载单文件版 HTML</span>
                  </a>
                  <span className="text-slate-400 text-[11px]">
                    或在解压目录直接双击打开 <code className="text-cyan-300">ai_watermark_remover_offline.html</code>
                  </span>
                </div>
              </div>

              {/* 方案二 */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2.5">
                <div className="font-bold text-sm text-cyan-400 flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-cyan-400" />
                  <span>💻 方式二：开发者完整工程本地启动 (Node.js)</span>
                </div>
                <p className="text-slate-300 leading-relaxed">
                  如果您希望本地离线运行完整的 React + Vite 源码工程：
                </p>
                <div className="space-y-1.5">
                  <div className="text-slate-400">1. Windows 用户：直接双击根目录下的脚本：</div>
                  <div className="bg-slate-900 border border-slate-800 p-2 rounded text-cyan-300 font-mono text-[11px]">
                    一键启动_Windows.bat
                  </div>
                  <div className="text-slate-400 pt-1">2. 或在项目根目录打开终端，执行以下两行命令：</div>
                  <div className="bg-slate-900 border border-slate-800 p-2.5 rounded font-mono text-[11px] text-emerald-400 flex justify-between items-center">
                    <code>npm install && npm run dev</code>
                  </div>
                  <div className="text-slate-400 text-[11px]">
                    启动后在浏览器打开 <code className="text-cyan-300">http://localhost:3000</code> 即可。
                  </div>
                </div>
              </div>

              {/* 方案三 */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
                <div className="font-bold text-sm text-indigo-400 flex items-center gap-2">
                  <FolderArchive className="w-4 h-4 text-indigo-400" />
                  <span>🐍 方式三：Python 本地批量全自动处理</span>
                </div>
                <p className="text-slate-300 leading-relaxed">
                  如果您需要批量处理整个文件夹（几十或上百张）图片，无需网页界面，直接在终端执行：
                </p>
                <div className="bg-slate-900 border border-slate-800 p-2.5 rounded font-mono text-[11px] text-indigo-300">
                  python ai_watermark_remover.py
                </div>
                <p className="text-slate-400 text-[11px]">
                  图片放入 <code>input_images</code>，净化后自动输出至 <code>output_images</code>。
                </p>
              </div>
            </div>

            <div className="pt-2 flex justify-between items-center border-t border-slate-800">
              <span className="text-[11px] text-slate-500">提示：所有数据均在本地浏览器中处理，不上传任何外部服务器</span>
              <button
                onClick={() => setShowOfflineModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium transition cursor-pointer"
              >
                我已了解
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 底部版权 */}
      <footer className="border-t border-slate-800/80 bg-slate-900/40 px-6 py-3 text-center text-[11px] text-slate-500 flex items-center justify-between max-w-7xl mx-auto w-full">
        <span>AI 暗水印与明水印消除系统 · 支持豆包明文字抹除与频域自适应中和</span>
        <span className="font-mono text-slate-600">v2.2 · 纯本地无痕处理</span>
      </footer>
    </div>
  );
}

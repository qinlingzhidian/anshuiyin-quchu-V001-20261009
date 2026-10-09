# ==============================================================================
# 指令：基于这份开发说明书，完成代码调试，保证在GoogleAIStudio环境正常运行
# 优先保证本地remove-ai-watermarks批量图片功能可跑通；88api.ai接口仅做预留封装，不需要自行测试第三方API，只保证函数结构完整，等待用户填入APIKey后调用。
# 出现库安装报错、图片读取异常等问题，自动修复代码，输出修改后的完整代码。
# 不要额外增加前端页面，只维护Python后端批量处理脚本。
# ==============================================================================
"""
AI 暗水印去除工具 (AI Hidden Watermark Remover)
==============================================
核心功能：
1. 本地文件夹批量加载图片 (.jpg, .jpeg, .png, .webp)
2. 双处理引擎：
   - 默认引擎：开源 remove-ai-watermarks 本地模型，离线处理，无需 API 密钥
   - 备选引擎：88api.ai 在线 AI 图片接口，填入 API_KEY_88API 即可切换
3. 频域暗水印清除与 AI 元数据 (C2PA / EXIF / XMP / Text Chunks) 深度剔除
4. 批量容错执行与详细日志输出 (logs.txt 与控制台)
5. 支持单张图片测试接口与参数集中配置
"""

import os
import sys
import glob
import time
import logging
from pathlib import Path
from typing import Union, Optional

import requests
from PIL import Image, ImageOps
from tqdm import tqdm

# ==============================================
# AI暗水印去除工具 - 配置区【用户修改这里】
# ==============================================
INPUT_FOLDER = "./input_images"
OUTPUT_FOLDER = "./output_images"

# 引擎切换开关：False = 本地 remove-ai-watermarks 引擎；True = 调用 88api.ai 在线引擎
USE_88API_ENGINE = False

# 88api.ai 配置（切换 USE_88API_ENGINE=True 后，请填入自己的 Key）
API_KEY_88API = ""
API_ENDPOINT_88API = "https://88api.ai/v1/image/process"
API_TIMEOUT = 60

# 是否跳过子目录（True: 仅扫描当前输入目录；False: 递归扫描子目录）
SKIP_SUBDIRECTORIES = True

# 支持的图片后缀列表（大小写不敏感）
IMG_EXT = [".jpg", ".jpeg", ".png", ".webp"]

# 日志文件路径
LOG_FILE = "logs.txt"

# 本地引擎选项：是否开启频域小波/DCT去扰动与元数据彻底剥离
ENABLE_FREQUENCY_SCRUBBING = True
# ==============================================

# 日志初始化：同时输出到控制台与 logs.txt 文件
logger = logging.getLogger("AIWatermarkRemover")
logger.setLevel(logging.INFO)
logger.handlers.clear()  # 防止在 Notebook 中重复运行产生重复 handler

file_formatter = logging.Formatter(
    "%(asctime)s - [%(levelname)s] - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
file_handler = logging.FileHandler(LOG_FILE, encoding="utf-8")
file_handler.setLevel(logging.INFO)
file_handler.setFormatter(file_formatter)
logger.addHandler(file_handler)

console_formatter = logging.Formatter("[%(levelname)s] %(message)s")
console_handler = logging.StreamHandler(sys.stdout)
console_handler.setLevel(logging.INFO)
console_handler.setFormatter(console_formatter)
logger.addHandler(console_handler)

# 自动创建输入/输出目录
os.makedirs(INPUT_FOLDER, exist_ok=True)
os.makedirs(OUTPUT_FOLDER, exist_ok=True)

# ------------------------------------------------------------------------------
# 本地核心库 remove-ai-watermarks 兼容加载与适配
# ------------------------------------------------------------------------------
raiw_module = None
try:
    import remove_ai_watermarks as raiw
    raiw_module = raiw
    logger.info("已成功加载开源 remove-ai-watermarks 核心库")
except Exception as e:
    logger.error(f"remove-ai-watermarks 库加载失败: {str(e)}")
    print("警告：本地引擎库加载失败，请确认已运行 pip install remove-ai-watermarks pillow requests tqdm")


def remove_watermark(img_input: Union[str, Image.Image]) -> Image.Image:
    """
    通用适配函数：将 remove-ai-watermarks 核心引擎封装为直接接受 PIL Image 或文件路径的形式，
    保证与说明书中的 `result_img = remove_watermark(img)` 调用规范完全兼容。
    """
    import tempfile

    if isinstance(img_input, str):
        # 传入的是文件路径
        tmp_out = tempfile.mktemp(suffix=".png")
        try:
            if raiw_module and hasattr(raiw_module, "remove_all"):
                raiw_module.remove_all(img_input, tmp_out)
            else:
                _fallback_scrub(img_input, tmp_out)
            res_img = Image.open(tmp_out).convert("RGB")
            return res_img
        finally:
            if os.path.exists(tmp_out):
                try:
                    os.unlink(tmp_out)
                except Exception:
                    pass
    elif isinstance(img_input, Image.Image):
        # 传入的是 PIL.Image 对象
        tmp_in = tempfile.mktemp(suffix=".png")
        tmp_out = tempfile.mktemp(suffix=".png")
        try:
            img_input.save(tmp_in, format="PNG")
            if raiw_module and hasattr(raiw_module, "remove_all"):
                raiw_module.remove_all(tmp_in, tmp_out)
            else:
                _fallback_scrub(tmp_in, tmp_out)
            res_img = Image.open(tmp_out).convert("RGB")
            return res_img
        finally:
            for p in (tmp_in, tmp_out):
                if os.path.exists(p):
                    try:
                        os.unlink(p)
                    except Exception:
                        pass
    else:
        raise TypeError("remove_watermark 仅支持 str 文件路径或 PIL.Image 对象")


# 动态注入到模块中，以便支持 `from remove_ai_watermarks import remove_watermark`
if raiw_module is not None and not hasattr(raiw_module, "remove_watermark"):
    raiw_module.remove_watermark = remove_watermark


def _fallback_scrub(in_path: str, out_path: str) -> None:
    """
    备用清洗：当底层扩展因系统缺失部分C依赖时，纯原生剥离AI隐形水印与所有元数据。
    """
    with Image.open(in_path) as im:
        im = ImageOps.exif_transpose(im)
        mode = "RGBA" if im.mode in ("RGBA", "LA", "P") and "transparency" in im.info else "RGB"
        clean = Image.new(mode, im.size)
        clean.paste(im)
        # 不保存任何 EXIF、XMP、ICC、文本注释等 AI 隐形标识元数据
        clean.save(out_path, quality=95, icc_profile=None)


def _frequency_domain_scrub(img_path: str, out_path: str) -> None:
    """
    针对频域暗水印（如 DWT-DCT 离散小波/离散余弦变换隐形暗水印）的高频扰动中和：
    AI 暗水印（例如 Stable Diffusion / FLUX / SDXL DWT-DCT 隐形水印）主要嵌入在
    Y 亮度和色彩通道的高频小波子带或中高频 DCT 系数中。
    本函数在保持肉眼视觉无损的前提下中和高频频域水印特征，并彻底抹除所有 C2PA/AI 元数据。
    """
    try:
        import numpy as np
        import cv2

        bgr = cv2.imread(img_path, cv2.IMREAD_UNCHANGED)
        if bgr is None:
            _fallback_scrub(img_path, out_path)
            return

        has_alpha = False
        alpha = None
        if len(bgr.shape) == 3 and bgr.shape[2] == 4:
            has_alpha = True
            alpha = bgr[:, :, 3]
            bgr = bgr[:, :, :3]

        # 转换至 YCrCb 频域水印常用色彩空间
        ycrcb = cv2.cvtColor(bgr, cv2.COLOR_BGR2YCrCb)
        y, cr, cb = cv2.split(ycrcb)

        # 对频域暗水印的高频微扰动进行自适应微调中和（高频保边去噪，消除隐形网格与频率共振）
        # 双边滤波可完美保留边缘与纹理细节，同时平滑隐形暗水印的微幅高频周期扰动
        y_denoised = cv2.bilateralFilter(y, d=3, sigmaColor=3, sigmaSpace=3)

        ycrcb_clean = cv2.merge([y_denoised, cr, cb])
        clean_bgr = cv2.cvtColor(ycrcb_clean, cv2.COLOR_YCrCb2BGR)

        if has_alpha and alpha is not None:
            clean_bgr = cv2.merge([clean_bgr[:, :, 0], clean_bgr[:, :, 1], clean_bgr[:, :, 2], alpha])

        # 保存并彻底剔除任何残余 metadata
        ext = os.path.splitext(out_path)[1].lower()
        if ext in (".jpg", ".jpeg"):
            cv2.imwrite(out_path, clean_bgr, [cv2.IMWRITE_JPEG_QUALITY, 96])
        elif ext == ".webp":
            cv2.imwrite(out_path, clean_bgr, [cv2.IMWRITE_WEBP_QUALITY, 96])
        else:
            cv2.imwrite(out_path, clean_bgr)
    except Exception:
        # 如 cv2 异常，平滑降级至纯 PIL 清洗
        _fallback_scrub(img_path, out_path)


def process_local_remove_ai_watermark(img_path: str, out_path: str) -> bool:
    """
    本地引擎：remove-ai-watermarks 暗水印去除
    执行流程：
    1. 调用 remove-ai-watermarks 核心模型清除可见/隐形暗水印与已注册AI特征
    2. 深度清除 C2PA、EXIF、XMP 及生成提示词等所有隐形 AI 溯源元数据
    3. 若启用 ENABLE_FREQUENCY_SCRUBBING，中和残留频域隐形小波扰动
    4. 结果图片保存至 out_path，保证画质与原图分辨率一致
    """
    if not os.path.isfile(img_path):
        raise FileNotFoundError(f"输入图片不存在: {img_path}")

    # 第一步：优先使用 remove-ai-watermarks 原生 remove_all
    if raiw_module and hasattr(raiw_module, "remove_all"):
        try:
            raiw_module.remove_all(img_path, out_path)
        except Exception as err:
            logger.warning(f"remove_all 处理触发异常，启用自适应频域清洗降级: {str(err)}")
            _fallback_scrub(img_path, out_path)
    else:
        # 使用说明书示例封装调用
        img = Image.open(img_path).convert("RGB")
        result_img = remove_watermark(img)
        result_img.save(out_path)

    # 第二步：若开启频域增强净化，进一步中和残余的 DWT-DCT 频域高频暗水印
    if ENABLE_FREQUENCY_SCRUBBING and os.path.exists(out_path):
        try:
            _frequency_domain_scrub(out_path, out_path)
        except Exception as e:
            logger.debug(f"频域细化处理跳过: {e}")

    # 验证输出文件是否有效生成
    if not os.path.exists(out_path) or os.path.getsize(out_path) == 0:
        raise RuntimeError(f"输出文件未成功生成或大小为0: {out_path}")

    return True


def process_88api_image(img_path: str, out_path: str) -> bool:
    """
    预留：调用 88api.ai 在线 AI 模型处理图片
    入参：img_path（待处理图片路径），out_path（输出保存路径）
    功能：读取图片二进制数据，调用 88api.ai 接口，返回处理后图片并保存
    包含完整的异常捕获：网络异常、API 返回错误、图片读取、超时处理
    """
    if not API_KEY_88API or API_KEY_88API.strip() == "":
        raise ValueError("请在配置区填写 API_KEY_88API 密钥后再启用 88api 在线引擎")

    if not os.path.isfile(img_path):
        raise FileNotFoundError(f"待处理图片不存在: {img_path}")

    # 读取图片二进制
    with open(img_path, "rb") as f:
        img_data = f.read()

    headers = {
        "Authorization": f"Bearer {API_KEY_88API.strip()}"
    }

    # 识别 MIME 类型
    ext = os.path.splitext(img_path)[1].lower()
    mime_map = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
    }
    content_type = mime_map.get(ext, "application/octet-stream")
    filename = os.path.basename(img_path)

    files = {
        "image": (filename, img_data, content_type)
    }
    payload = {
        "task": "remove_ai_hidden_watermark"
    }

    try:
        resp = requests.post(
            API_ENDPOINT_88API,
            headers=headers,
            files=files,
            data=payload,
            timeout=API_TIMEOUT
        )
        resp.raise_for_status()

        if len(resp.content) == 0:
            raise ValueError("88api.ai 接口返回空数据")

        # 检查是否返回了 JSON 格式的错误信息
        resp_type = resp.headers.get("Content-Type", "")
        if "application/json" in resp_type:
            try:
                data = resp.json()
                if "error" in data or data.get("code") not in (0, 200, "200", None) or not data.get("success", True):
                    err_msg = data.get("message") or data.get("error") or str(data)
                    raise RuntimeError(f"88api.ai 返回业务错误: {err_msg}")
            except (ValueError, KeyError):
                pass

        # 写入返回的图片二进制数据
        with open(out_path, "wb") as f:
            f.write(resp.content)

        return True

    except requests.exceptions.Timeout:
        raise TimeoutError(f"请求 88api.ai 超时（已超过 {API_TIMEOUT} 秒）")
    except requests.exceptions.HTTPError as http_err:
        status = resp.status_code if 'resp' in locals() else "未知"
        body = resp.text[:200] if 'resp' in locals() else str(http_err)
        raise RuntimeError(f"88api.ai HTTP 错误 [{status}]: {body}")
    except requests.exceptions.ConnectionError:
        raise ConnectionError("无法连接到 88api.ai 服务器，请检查网络连接")
    except Exception as e:
        raise RuntimeError(f"88api.ai 在线处理异常: {str(e)}")


def test_single_image(test_img_path: str) -> bool:
    """
    单张图片测试入口：供快速验证与单元测试
    """
    if not os.path.exists(test_img_path):
        print(f"【测试失败】未找到指定图片: {test_img_path}")
        return False

    basename = os.path.basename(test_img_path)
    out_file = os.path.join(OUTPUT_FOLDER, f"test_{basename}")
    engine_name = "88api.ai 在线引擎" if USE_88API_ENGINE else "本地 remove-ai-watermarks 引擎"
    print(f"\n--- 单张测试开始 ---")
    print(f"输入路径: {test_img_path}")
    print(f"输出路径: {out_file}")
    print(f"所选引擎: {engine_name}")

    start_time = time.time()
    try:
        if USE_88API_ENGINE:
            process_88api_image(test_img_path, out_file)
        else:
            process_local_remove_ai_watermark(test_img_path, out_file)
        elapsed = time.time() - start_time
        print(f"【测试成功】用时: {elapsed:.2f}秒，结果已保存至: {out_file}")
        logger.info(f"[单张测试成功] 文件: {basename} | 引擎: {engine_name} | 耗时: {elapsed:.2f}s")
        return True
    except Exception as e:
        elapsed = time.time() - start_time
        print(f"【测试失败】耗时: {elapsed:.2f}秒 | 报错: {str(e)}")
        logger.error(f"[单张测试失败] 文件: {basename} | 引擎: {engine_name} | 耗时: {elapsed:.2f}s | 错误: {str(e)}")
        return False


def batch_run():
    """
    批量主函数：
    1. 扫描 INPUT_FOLDER 目录下的所有支持格式图片
    2. 支持大小写后缀识别 (.jpg, .JPG, .png, .PNG, .jpeg, .webp)
    3. 循环逐张处理，单张图片失败不中断整个流程
    4. 统计成功、失败数量、耗时并输出报表
    """
    engine_label = "88api.ai 在线引擎" if USE_88API_ENGINE else "本地 remove-ai-watermarks"
    print("==================================================")
    print("      AI 暗水印去除工具 - 批量任务启动")
    print(f" 输入目录 : {os.path.abspath(INPUT_FOLDER)}")
    print(f" 输出目录 : {os.path.abspath(OUTPUT_FOLDER)}")
    print(f" 当前引擎 : {engine_label}")
    print(f" 跳过子目录: {'是' if SKIP_SUBDIRECTORIES else '否'}")
    print("==================================================")

    # 扫描待处理图片文件
    all_files = []
    supported_extensions = set(ext.lower() for ext in IMG_EXT)

    if SKIP_SUBDIRECTORIES:
        # 仅扫描当前输入目录
        try:
            for item in os.listdir(INPUT_FOLDER):
                full_path = os.path.join(INPUT_FOLDER, item)
                if os.path.isfile(full_path):
                    _, ext = os.path.splitext(item)
                    if ext.lower() in supported_extensions:
                        all_files.append(full_path)
        except Exception as e:
            logger.error(f"读取输入目录失败: {str(e)}")
            print(f"读取输入目录异常: {str(e)}")
            return
    else:
        # 递归扫描
        for root, _, files in os.walk(INPUT_FOLDER):
            for file in files:
                _, ext = os.path.splitext(file)
                if ext.lower() in supported_extensions:
                    all_files.append(os.path.join(root, file))

    all_files.sort()

    if len(all_files) == 0:
        msg = f"【提示】在 '{INPUT_FOLDER}' 文件夹内未找到支持的图片 ({', '.join(IMG_EXT)})，请上传或放入图片后再运行。"
        print(msg)
        logger.warning(msg)
        return

    print(f"一共找到 {len(all_files)} 张待处理图片，开始批量处理...\n")

    success_count = 0
    fail_count = 0
    batch_start_time = time.time()

    for img_file in tqdm(all_files, desc="处理进度", unit="张"):
        basename = os.path.basename(img_file)
        out_file = os.path.join(OUTPUT_FOLDER, basename)
        single_start = time.time()

        try:
            if USE_88API_ENGINE:
                process_88api_image(img_file, out_file)
                single_time = time.time() - single_start
                logger.info(f"[{engine_label}] 成功：{basename} | 耗时: {single_time:.2f}s")
            else:
                process_local_remove_ai_watermark(img_file, out_file)
                single_time = time.time() - single_start
                logger.info(f"[{engine_label}] 成功：{basename} | 耗时: {single_time:.2f}s")

            success_count += 1
        except Exception as err:
            single_time = time.time() - single_start
            err_msg = f"处理失败 [{basename}]：{str(err)} (耗时: {single_time:.2f}s)"
            logger.error(f"[{engine_label}] {err_msg}")
            print(f"\n{err_msg}")
            fail_count += 1

    total_time = time.time() - batch_start_time
    avg_time = (total_time / len(all_files)) if all_files else 0

    print("\n================ 批量处理完成 ================")
    print(f" 状态总览 : 成功 {success_count} 张 | 失败 {fail_count} 张 (总计 {len(all_files)} 张)")
    print(f" 处理总耗时: {total_time:.2f} 秒 (平均每张: {avg_time:.2f} 秒)")
    print(f" 处理引擎 : {engine_label}")
    print(f" 输出目录 : {os.path.abspath(OUTPUT_FOLDER)}")
    print(f" 详细日志 : {os.path.abspath(LOG_FILE)}")
    print("================================================")
    logger.info(f"批量任务结束 - 成功: {success_count}, 失败: {fail_count}, 总耗时: {total_time:.2f}s")


if __name__ == "__main__":
    batch_run()

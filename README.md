# AI 暗水印与明水印消除系统 (AI Watermark Remover)

基于自适应频域滤波、内容感知修复与数字凭证剥离技术的 AI 图片无痕净化工具。

支持消除：
1. **右下角明水印**：精准抹除“豆包 AI 生成”等角标文字，并利用周边纹理自适应重构底色；
2. **频域隐形暗水印**：自适应中和 DWT-DCT 离散小波/余弦变换高频人工调制扰动；
3. **数字溯源元数据**：彻底剥离 C2PA、EXIF、XMP、AI Prompt 及参数。
4. **闭环二次验证**：处理后重新上传，严格验证通过并判定为 **“未检出任何水印 · 100% 安全干净”**。

---

## ⚡ 为什么把代码下载到本地后，直接双击 index.html 会白屏？

当前项目根目录下的 `index.html` 是现代 **React + TypeScript + Vite** 工程的源码入口文件，内部引用了未打包的 `/src/main.tsx`。
浏览器在直接双击本地文件（`file://` 协议）打开时：
1. 出于同源安全策略会拦截本地 ES Module 脚本；
2. 浏览器原生无法直接运行未编译的 TypeScript / JSX 代码。

因此直接双击 `index.html` 会呈现空白页面。

---

## 🚀 离线与本地使用方式

### 方式一：免安装单文件离线版（最简单推荐 · 双击即用）

无需安装 Node.js、无需终端命令行、支持完全断网离线环境：
- 直接双击打开目录下的 **`ai_watermark_remover_offline.html`**；
- 或在在线页面右上角点击 **「下载离线单文件版」**。

内嵌完整图形界面与 JavaScript 处理算法，任何电脑、任何现代浏览器（Chrome、Edge、Safari、Firefox）双击秒开！

---

### 方式二：本地运行完整 React 开发服务

如果您希望在本地运行完整的 React + Vite 交互系统：

1. **环境要求**：已安装 [Node.js](https://nodejs.org/) (v18+)
2. **一键启动**：
   - Windows 用户：直接双击 **`一键启动_Windows.bat`**
   - macOS / Linux 用户：终端执行 **`./一键启动_Mac_Linux.sh`**
3. **手动命令行启动**：
   ```bash
   npm install
   npm run dev
   ```
   随后在浏览器访问：`http://localhost:3000`

---

### 方式三：Python 后端批量处理脚本

如果您需要无界面的全自动大批量图片去水印：
1. 安装依赖：
   ```bash
   pip install -r requirements.txt
   ```
2. 将待处理图片放入 `input_images/` 目录
3. 执行批量脚本：
   ```bash
   python ai_watermark_remover.py
   ```
4. 净化后的图片自动保存至 `output_images/` 目录，并输出详细运行日志。

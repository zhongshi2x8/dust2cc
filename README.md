# dust2.cc 🧙

一个面向 CS2 饰品行情分析的 Chrome Manifest V3 扩展。

## ✨ 功能特性

- 📈 自动抓取站点 K 线与价格数据
- 🤖 提供页内 AI 分析面板和 Chrome side panel
- 🎯 生成买入区、止损位、目标价、支撑阻力等关键价位
- 🧩 支持图表重点位标注与指标摘要
- 🔄 避免旧分析残留，数据变化后自动刷新结果

## 🌐 当前支持站点

- `steamdt.com`
- `csqaq.com`

## 🚧 当前状态

项目仍在持续迭代中。

已知仍在重点优化的部分：

- `steamdt.com` 的主图识别与 K 线抓取链路还在继续打磨

## 🛠 技术栈

- TypeScript
- Vite
- React
- Chrome Extension Manifest V3
- Vitest

## 🚀 本地开发

安装依赖：

```bash
npm install
```

启动开发环境：

```bash
npm run dev
```

运行测试：

```bash
npm test
```

类型检查：

```bash
npm run typecheck
```

构建扩展：

```bash
npm run build
```

## 🧪 在 Chrome 中加载

1. 执行 `npm run build`
2. 打开 `chrome://extensions`
3. 开启右上角“开发者模式”
4. 点击“加载已解压的扩展程序”
5. 选择项目下的 `dist` 目录

## 📦 怎么分享给别人使用

### 方式一：直接发构建产物

最简单，适合朋友测试：

1. 你本地执行 `npm run build`
2. 把整个 `dist` 目录压缩成 zip
3. 发给对方
4. 对方按上面的 Chrome 加载步骤导入 `dist`

### 方式二：让别人从 GitHub 自己构建

适合开发者或愿意折腾一点的用户：

```bash
git clone https://github.com/zhongshi2x8/dust2cc.git
cd dust2cc
npm install
npm run build
```

然后再到 Chrome 里加载 `dist`。

### 方式三：发布到 Chrome Web Store

适合真正公开分发：

- 用户可以一键安装
- 更新也更方便
- 但需要补齐商店图、介绍文案、隐私说明和发布材料

## 🗂 项目结构

- `src/content`：内容脚本、站点提取器、页面注入逻辑
- `src/background`：后台 Service Worker 与 LLM 路由
- `src/sidepanel`：扩展侧边栏界面
- `src/shared`：共享类型、指标、提示词与数据处理逻辑
- `scripts`：构建辅助脚本

## 🧹 开源整理说明

这份仓库已经做过一轮清理，移除了几类不适合继续公开保留的内容：

- 🗑 未实际生效的旧 hook 文件
- 🗑 内部临时计划文档
- 🗑 重复维护的 `page-script` 产物源码副本

现在 `page-script` 只保留一份 TypeScript 源码，并在构建前自动生成浏览器实际注入的脚本，减少“改了一份、另一份没跟上”的混乱。

## 📄 License

MIT

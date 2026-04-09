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

## 📄 License

MIT

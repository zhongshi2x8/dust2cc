# dust2.cc 🧙

对 csqaq 和 steamdt 的饰品k线以及大盘k线进行AI分析的插件工具。

## ✨ 功能特性

- 📈 自动抓取站点 K 线与价格数据
- 🤖 提供页内 AI 分析面板和 Chrome side panel
- 🎯 生成买入区、止损位、目标价、支撑阻力等关键价位
- 🧩 支持图表重点位标注与指标摘要
- 🔄 避免旧分析残留，数据变化后自动刷新结果

## 🌐 当前支持站点

- `steamdt.com`
- `csqaq.com`

## 📦 使用教程

直接下载：

- [点击下载 dist.zip](https://github.com/zhongshi2x8/dust2cc/releases/latest/download/dist.zip)

安装步骤：

1. 点击上面的 `dist.zip` 下载链接
2. 解压 `dist.zip`
3. 打开 Chrome，进入 `chrome://extensions`
4. 打开右上角“开发者模式”
5. 点击“加载已解压的扩展程序”
6. 选择刚刚解压出来的 `dist` 文件夹


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

构建并生成可发布的 `dist.zip`：

```bash
npm run package
```

打包完成后，发布包会出现在：

```bash
release/dist.zip
```
## 📄 License

MIT

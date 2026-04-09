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

## 📦 小白安装

推荐直接下载发布好的 `dist.zip`，不用自己装 Node.js，也不用自己构建。

直接下载：

- [点击下载 dist.zip](https://github.com/zhongshi2x8/dust2cc/releases/latest/download/dist.zip)
- [查看全部版本](https://github.com/zhongshi2x8/dust2cc/releases)

安装步骤：

1. 点击上面的 `dist.zip` 下载链接
2. 解压 `dist.zip`
3. 打开 Chrome，进入 `chrome://extensions`
4. 打开右上角“开发者模式”
5. 点击“加载已解压的扩展程序”
6. 选择刚刚解压出来的 `dist` 文件夹

注意：

- GitHub 自动生成的 “Source code (zip)” 不能直接拿来安装扩展
- 一定要下载 Release 里的 `dist.zip`
- 每次更新新版本后，删除旧扩展并重新加载新的 `dist` 文件夹即可

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

## 🧪 在 Chrome 中加载

1. 执行 `npm run build`
2. 打开 `chrome://extensions`
3. 开启右上角“开发者模式”
4. 点击“加载已解压的扩展程序”
5. 选择项目下的 `dist` 目录

## 🚀 维护者发布

如果你是仓库维护者，执行下面这条命令即可生成发布包：

```bash
npm run package
```

生成好的文件在：

```bash
release/dist.zip
```

## 📄 License

MIT

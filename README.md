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

1. 打开仓库的 [Releases](https://github.com/zhongshi2x8/dust2cc/releases)
2. 下载最新版本里的 `dist.zip`
3. 解压 `dist.zip`
4. 打开 Chrome，进入 `chrome://extensions`
5. 打开右上角“开发者模式”
6. 点击“加载已解压的扩展程序”
7. 选择刚刚解压出来的 `dist` 文件夹

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

## 🚀 发布 `dist.zip`

如果你是仓库维护者，推荐按下面的方式发版本：

1. 本地执行 `npm run package`
2. 确认生成了 `release/dist.zip`
3. 去 GitHub 仓库创建一个新的 Release
4. 把 `release/dist.zip` 作为附件上传
5. 在 Release 说明里告诉用户“下载 `dist.zip` 后解压加载”

这样小白用户只需要进 Releases 下载 `dist.zip`，不用自己构建项目。

## 📄 License

MIT

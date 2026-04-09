import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const rootDir = resolve(import.meta.dirname, '..');
const distDir = resolve(rootDir, 'dist');
const releaseDir = resolve(rootDir, 'release');
const zipPath = resolve(releaseDir, 'dist.zip');

if (!existsSync(distDir)) {
  console.error('dist 目录不存在，请先运行 npm run build');
  process.exit(1);
}

mkdirSync(releaseDir, { recursive: true });
rmSync(zipPath, { force: true });

const zipResult = spawnSync('zip', ['-rq', zipPath, '.'], {
  cwd: distDir,
  stdio: 'inherit',
});

if (zipResult.error) {
  console.error(`打包 dist.zip 失败：${zipResult.error.message}`);
  process.exit(1);
}

if (zipResult.status !== 0) {
  process.exit(zipResult.status ?? 1);
}

console.log(`已生成发布包：${zipPath}`);

#!/usr/bin/env node
/**
 * 把腾讯云后端域名写进 client/vercel.json 的 rewrites。
 *
 *   node deploy/gen-vercel-config.mjs https://api.example.com
 *
 * 作用：浏览器只访问 https://<你的前端>.vercel.app/api/*，
 * 由 Vercel 在服务端反代到腾讯云后端 —— 不产生跨域、不受混合内容限制，
 * 即使后端只有 HTTP 也能被 HTTPS 前端正常调用。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(here, '../client/vercel.json');

const input = process.argv[2];
if (!input) {
  console.error('用法: node deploy/gen-vercel-config.mjs https://api.example.com');
  process.exit(1);
}

let host;
try {
  host = new URL(input).origin;
} catch {
  console.error(`无法解析地址: ${input}`);
  process.exit(1);
}

const config = JSON.parse(readFileSync(configPath, 'utf8'));
const apiRewrite = config.rewrites.find((rule) => rule.source.startsWith('/api'));
if (!apiRewrite) {
  console.error('client/vercel.json 中找不到 /api 反代规则');
  process.exit(1);
}

apiRewrite.destination = `${host}/api/:path*`;
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`已写入反代目标: ${apiRewrite.destination}`);

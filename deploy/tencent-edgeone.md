# 腾讯云上线（本地版 / 不含 AI）

> 目标：把这份纯前端工具放到公网，让同事打开一个 `https://` 网址就能用。
> 本文只写**怎么放上去**与**放上去之后必须自检什么**；不做任何后端、不加任何统计脚本。
> 事实核查日期：2026-09-27（腾讯云文档与 EdgeOne 官方页面）。

## 0. 先明确这次上线的是什么

| 项 | 值 |
|---|---|
| 构建命令 | `npm run build`（**本地版**） |
| 产物 | `dist/`（19 个文件，约 2.4 MB） |
| 待上传目录 | `_deploy/上传这个文件夹/`（已经拷好，直接拖拽即可） |
| CSP `connect-src` | **`'none'`**——页面在浏览器层面没有任何出站能力 |
| AI 功能 | **不含**：界面会显示「AI 深度分析（本部署不可用）」并说明原因（而不是给一个点了必然失败的按钮） |
| 数据去向 | 只在访问者自己的浏览器里；没有后端、没有云端副本、没有访问统计 |

**为什么公开部署必须用本地版**：含 AI 版会让每位访客在一个由你控制的页面上粘贴自己的
DeepSeek API Key；而且「DeepSeek 是否允许你的新域名跨域」我们**从未验证过**。
本地版把这条路彻底关掉（CSP + Service Worker 双保险），是给同事用最稳的形态。

## 1. 推荐路线：EdgeOne Pages（免费、拖拽上传、自带 HTTPS）

腾讯云的 EdgeOne Makers / Pages 提供免费静态托管，官方说明：拖拽上传、自动配置 SSL 与 HTTPS、
可用平台子域名（`xxx.edgeone.app`），也可之后绑自己的域名
（见 [Pages Drop 公告](https://pages.edgeone.ai/zh/resources/announcing-pages-drop-free-static-website-hosting)）。

步骤：

1. 打开 **<https://pages.edgeone.ai/zh/drop>**，用腾讯云账号（或微信）登录。
2. 把 **`_deploy/上传这个文件夹`** 整个拖进上传区（里面的 `index.html`、`assets/`、
   `icons/`、`sw.js`、`manifest.webmanifest` 等都必须在**根**，不要再套一层目录）。
3. 起一个子域名，例如 `intern-recruitment` → 得到 `https://intern-recruitment.edgeone.app`。
4. 等构建完成（几秒到一分钟），打开网址按 §4 自检。
5. （可选）之后想用自己的域名：在该项目里「自定义域名」绑定即可；
   **大陆地区用自定义域名需要 ICP 备案**，用平台给的 `*.edgeone.app` 子域名则不需要。

## 2. 备选路线 B：COS 对象存储 + 自定义域名

**注意（2026 年现状）**：2024-01-01 之后创建的存储桶**不再支持通过 COS 默认域名
（包括静态网站域名）直接访问对象**，必须绑定**自定义域名**才能在浏览器里正常打开页面
（见 [设置静态网站](https://cloud.tencent.com/document/product/436/32670)）。
而大陆节点上的自定义域名需要 ICP 备案。因此这条路适合「已经有一个备案域名」的情况。

1. 创建一个存储桶（地域就近，权限选 **公有读私有写**）。
2. 开启「静态网站」，索引文档填 `index.html`，并开启**强制 HTTPS**。
3. 上传 `_deploy/上传这个文件夹` 里的全部文件到桶根目录。
4. 绑定自定义域名并配置 CNAME；证书可在腾讯云申请免费证书。
5. **建议同时开启防盗刷/CDN 鉴权**：静态站公开可读，网址一旦外传会产生流量费用
   （腾讯云文档里的「防盗刷指引」）。
6. 老老实实接受的限制：COS 静态网站**不会**消费我们产物里的 `_headers` 文件，
   因此 `X-Frame-Options` / `frame-ancestors` 这类**只能靠响应头**的防护在这条路上拿不到；
   `index.html` 里的 **meta CSP 仍然生效**（它是构建时注入的，和响应头版逐字相同、只少
   `frame-ancestors` 一条）。

## 3. 备选路线 C：轻量应用服务器 + Nginx

只在你需要「真正的响应头 + 访问控制」时选它（例如 Nginx 的 `auth_basic` 做口令）。
代价是要自己维护服务器、装证书、打补丁。要点：

```nginx
server {
  listen 443 ssl;
  server_name your.example.com;
  root /srv/intern-recruitment;   # 放 _deploy/上传这个文件夹 里的内容

  # 与产物里的 _headers 一致的完整策略（响应头形式，比 meta 版多 frame-ancestors）
  add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'none'; worker-src 'self' blob:; manifest-src 'self'; media-src 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'" always;
  add_header X-Content-Type-Options nosniff always;
  add_header Referrer-Policy no-referrer always;
  add_header X-Frame-Options DENY always;

  # Service Worker 与首页必须可重新校验，否则用户永远拿到旧版本
  location = /sw.js { add_header Cache-Control "no-cache"; }
  location = /index.html { add_header Cache-Control "no-cache"; }
  location / { try_files $uri $uri/ /index.html; }
}
```

## 4. 上线后必须自检的 5 项

1. **地址是 `https://`**：加密本地仓依赖浏览器安全上下文，`http://` 或 IP 访问会让它失效。
2. **AI 相关**：首页右上角**没有**「AI 深度分析」按钮，而是写着「AI 深度分析（本部署不可用）」；
   设置页同样不显示 AI 面板。这是**正确**行为（这一份产物不含 AI）。
3. **主链路**：导入页粘贴 `_demo/demo-intern-recruitment.tsv` 的内容 → 映射 → 清洗 → 看板出数字与图。
4. **导出**：Excel / Markdown 能下载；「打印 / 另存为 PDF」能弹出**带内容**的新窗口。
5. **PWA（可选）**：浏览器地址栏出现安装图标；断网后刷新仍能打开应用壳。

## 5. 上线前后的红线（与 AGENTS §2 / §6 一致）

- **不加**任何第三方统计、广告、客服挂件、错误上报；**不开**平台的 Analytics。
- **不建** Functions / API 路由 / 云数据库 / 公共 CORS 代理；静态站就是静态站。
- **不上传** `docs/`、`src/`、`tests/`、`_demo/`、`_release/`、`node_modules/`；
  上传包里只该有 `_deploy/上传这个文件夹` 的内容。
- **不放真实招聘数据**到任何地方（仓库、上传包、截图）；演示只用 `_demo/` 的合成数据。
- 托管平台自身的**访问日志**（IP / 时间 / URL）属于平台侧记录，不含招聘数据；
  如果连这个也不想要，就只能用本机 `启动本地版.bat` 那种纯本地方式。

## 6. 更新版本（以后改完代码怎么再上线）

```bash
npm run build                        # 重新生成本地版产物
```

然后把新的 `dist/` 内容覆盖上传（EdgeOne Pages 重新拖一次 / COS 覆盖同名对象）。
**Service Worker 会让老用户先看到旧版本**，页面会给出更新提示，用户点一下即切换到新版
（这是设计行为，不是 bug；见 `docs/DECISIONS.md` D-086）。

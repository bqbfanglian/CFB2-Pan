# CFB2 网盘

Cloudflare Worker 提供网盘和分享页面，D1 保存目录与权限，多个 Backblaze B2 私有桶保存文件。上传时后台按写入后的配额占用率选桶。同等占用率下，`priority` 较小的桶优先。页面显示整个网盘的容量，普通文件操作无需选桶。

## 通过网页控制台部署

准备一个可连接 Cloudflare Workers Builds 的 Git 仓库，以及已在 Cloudflare 托管的域名。下文用 `drive.example.com` 管理文件，用 `share.example.com` 接收访客。

### 1. 在 Backblaze 创建私有桶和密钥

1. 在 [Backblaze 控制台](https://secure.backblaze.com/) 打开 **B2 Cloud Storage → Buckets → Create a Bucket**，创建至少两个 **Private** 桶。记下每个桶的名称和 **S3 Endpoint**，例如 `s3.us-west-004.backblazeb2.com`。 [Backblaze 创建存储桶](https://www.backblaze.com/docs/cloud-storage-create-and-manage-buckets)
2. 打开 **Application Keys → Add a New Application Key**。每个桶各建一把密钥，在 **Allow Access to Bucket(s)** 选择对应桶，**Type of Access** 选 **Read and Write**，**File Name Prefix** 填 `cfb2-pan/`。保存生成的 `keyID` 与只显示一次的 `applicationKey`。 [Backblaze Application Keys](https://www.backblaze.com/docs/en/cloud-storage-get-started-with-a-backblaze-integration)
3. 参照 [桶配置示例](config/b2-buckets.example.json) 在本机填好 JSON。`id` 是应用内永久标识，`name` 是实际桶名，`region` 是 S3 Endpoint 中的区域，例如 `us-west-004`，`keyId` 和 `applicationKey` 是上一步的值。`quota` 用字节表示，`10737418240` 等于 10 GiB。`priority` 在占用率相同时决定顺序，`writable` 控制这个桶能否承接新上传。将这份 JSON 保存到密码管理器或已被 Git 忽略的 `b2-buckets.local.json`，稍后粘贴到 Cloudflare Secret。

所有文件传输通过 Worker。B2 桶保持默认 CORS 设置即可。

### 2. 在 Cloudflare 创建 D1 和 Access 应用

1. 在 [Cloudflare 控制台](https://dash.cloudflare.com/) 打开 **D1 SQL Database → Create database**，创建 `cfb2-pan`。复制数据库 ID。在代码仓库的网页编辑器打开 [wrangler.jsonc](wrangler.jsonc)，替换 `database_id` 占位值并保存到部署分支。如果数据库名称不同，同时改 `database_name`。保留绑定名 `DB`。 [Cloudflare D1](https://developers.cloudflare.com/d1/get-started/)
2. 在 **Zero Trust → Access controls → Applications → Add an application → Self-hosted** 添加管理域名 `drive.example.com`。创建 **Allow** 策略，**Include** 条件使用 **Emails**，填写管理员邮箱。登录方式可用账户中已启用的身份提供商。复制应用详情中的 **Application Audience (AUD)**，并记下团队域名，例如 `my-team.cloudflareaccess.com`。分享域名独立于此 Access 应用。 [Cloudflare Access 自托管应用](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/) · [Access JWT 和 AUD](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)

### 3. 在 Cloudflare 连接仓库

1. 在 Cloudflare 头像菜单打开 **My Profile → API Tokens → Create Token**。以 **Edit Cloudflare Workers** 模板创建构建令牌，给目标账户额外添加 **Account → D1 → Edit**。部署时需要这个权限执行数据库迁移。把资源范围限制到目标账户及域名所在的区域。 [Workers Builds API Token](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/#api-token)
2. 打开 **Workers & Pages → Create application**，选择 **GitHub** 或 **GitLab** 导入仓库。已有 Worker 可从 **Settings → Builds → Connect** 连接仓库。Worker 名称使用 `cfb2-pan`，与 `wrangler.jsonc` 中的 `name` 一致。选择部署分支和项目根目录，使用上一步创建的 API Token，关闭预览构建。 [导入仓库或连接已有 Worker](https://developers.cloudflare.com/workers/ci-cd/builds/) · [构建配置](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
3. 按下表填写网页输入框并保存部署。两条命令由 Cloudflare 执行。如果导入时只显示默认令牌，在 Worker 的 **Settings → Builds** 选择自定义令牌，然后在 **Builds** 重试。连接已有 Worker 后可在仓库网页编辑器提交一次变更来触发构建。

| 网页输入框 | 填写内容 |
| --- | --- |
| Build command | `npm run check` |
| Deploy command | `npx wrangler d1 migrations apply DB --remote && npm run deploy` |

4. 打开 **Builds** 确认 D1 迁移和 Worker 部署成功。后续提交到部署分支时，Cloudflare 会先应用尚未执行的迁移。 [D1 迁移](https://developers.cloudflare.com/d1/reference/migrations/)

### 4. 设置 Worker 的运行时配置和域名

1. 在 Worker 的 **Settings → Variables and Secrets → Add** 添加下表字段，然后部署这次配置变更。项目配置已开启 `keep_vars`，代码更新会保留在面板设置的变量和自定义域名。 [Cloudflare Secrets](https://developers.cloudflare.com/workers/configuration/secrets/) · [Wrangler 配置保留规则](https://developers.cloudflare.com/workers/wrangler/configuration/#source-of-truth)

| 名称 | 类型 | 填写内容 |
| --- | --- | --- |
| `ADMIN_HOST` | Text | `drive.example.com` |
| `SHARE_HOST` | Text | `share.example.com` |
| `ACCESS_TEAM_DOMAIN` | Text | `my-team.cloudflareaccess.com`，只填主机名 |
| `ACCESS_AUD` | Text | 管理应用的 AUD |
| `ADMIN_EMAIL` | Text | **Allow** 策略中的管理员邮箱 |
| `B2_BUCKETS` | Secret | 第一步填好的完整 JSON 数组 |
| `SHARE_SECRET` | Secret | 用密码管理器生成的至少 32 字节的随机字符串，例如 43 个随机字母和数字 |

2. 进入 **Settings → Domains & Routes → Add → Custom Domain**，分别绑定管理域名和分享域名。 [Cloudflare Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

### 5. 在浏览器验收

1. 打开管理域名，用管理员邮箱登录。确认显示网盘总容量，并可创建文件夹。
2. 上传一个小文件和一个大于 16 MiB 的文件，验证普通上传和分片上传。用两个等额的空桶测试均衡时，连续上传两个同样大小的文件，可在 Backblaze 的 **Browse Files → cfb2-pan/** 中确认每桶各新增一个对象。单文件上限 1 GiB，上传中断后，在同一浏览器和目录重选原文件可续传。
3. 为文件创建带密码的分享。在无痕窗口打开分享域名，输密码并下载。回到管理页撤销分享，确认访客新发起的下载被拒绝。

## 日常管理

- 更新 Worker 的 `B2_BUCKETS` Secret 即可新增桶、调整配额，或把 `writable` 改为 `false` 以暂停向该桶分配新文件。桶 ID 和所指向的实际桶保持稳定。存在历史文件或清理任务时，保留桶配置及有效密钥。
- 当选中的桶在写入前探测失败，Worker 暂停向该桶分配新上传两分钟，并尝试其他有配额的桶。文件开始写入后固定使用已选桶，续传和下载沿用同一个桶。桶恢复后可再次接收新文件。
- 目录项删除后立即停止新下载。定时清理成功删除对应 B2 版本后释放配额。现有 B2 对象通过新上传进入网盘，网盘对象使用独立的 `cfb2-pan/` 前缀。定期备份 D1 元数据及需要保留的 B2 内容。 [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
- 轮换 `SHARE_SECRET` 后，已有的有效链接可继续访问，带密码的访客需重新输入密码。可创建新链接供管理页复制。

## 本地开发

```bash
npm ci
npm run dev
```

打开 [本地网盘](http://127.0.0.1:8787/)。Wrangler 使用本地 D1 和两个模拟桶，数据保存在 `.wrangler/state`。`npm run check` 检查代码，`npm run build` 生成 Cloudflare dry-run 构建。Windows PowerShell 可使用 `npm.cmd`。

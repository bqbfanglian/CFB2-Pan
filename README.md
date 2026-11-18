# CFB2 网盘

用 Cloudflare Workers 分发文件。访客打开分享链接即可下载，分享可设密码和有效期，也可手动撤销。管理员用网盘密码登录后上传和管理文件。Worker 会在多个 Backblaze B2 私有桶之间自动调度。

## 网页部署教程

全程用浏览器操作。准备 Cloudflare、GitHub 和 Backblaze B2 账号。首次部署可以直接使用 Cloudflare 提供的 `workers.dev` 地址。打开根路径进入管理登录，把 `/s/…` 分享链接发给访客即可。 [Cloudflare 的 `workers.dev` 地址](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)

下面从**新建数据库**开始。升级已有网盘请看文末的[升级说明](#升级已有网盘)。

### 1. 在 Cloudflare 建库，在 GitHub 填数据库 ID

1. 打开 Cloudflare 控制台，进入 **D1 SQL Database → Create database**。名称填 `cfb2-pan`，创建后在数据库页面复制 **Database ID**。 [Cloudflare D1 控制台](https://dash.cloudflare.com/?to=/:account/workers/d1)
2. 在同一个数据库页面打开 **Console**。按下表顺序执行 SQL。每一行都先在 GitHub 打开文件，用 **Raw** 查看并复制整个文件，再回到 D1 的输入框粘贴并点 **Execute**。确认本次执行成功后再粘贴下一份。 [D1 控制台执行 SQL](https://developers.cloudflare.com/d1/get-started/#populate-your-d1-database)

   | 顺序 | 复制这个文件 |
   | --- | --- |
   | 1 | [0001_drive.sql](migrations/0001_drive.sql) |
   | 2 | [0002_cleanup_retry.sql](migrations/0002_cleanup_retry.sql) |
   | 3 | [0003_bucket_scheduling.sql](migrations/0003_bucket_scheduling.sql) |
   | 4 | [0004_admin_sessions.sql](migrations/0004_admin_sessions.sql) |

3. 执行下方查询，看到 `root` 和 `我的文件` 就说明网盘根目录已创建。在 **Tables** 页确认有 `bucket_health` 和 `admin_sessions` 表。

   ```sql
   SELECT id, name FROM entries WHERE id = 'root';
   ```

4. 在 GitHub 打开你要部署的仓库。自己已有写权限就直接用，否则先点页面右上角的 **Fork**。在你的仓库 `main` 分支打开根目录的 `wrangler.jsonc`，点铅笔图标。把 `database_id` 的全零值替换为第一步复制的 ID，保留 `binding` 为 `DB` 和 `database_name` 为 `cfb2-pan`，然后点 **Commit changes** 保存到 `main`。

### 2. 在 Backblaze 建两个私有桶

1. 打开 Backblaze 控制台，进入 **B2 Cloud Storage → Buckets → Create a Bucket**。选 **Private**，创建两个桶。记下每个桶的名称和页面显示的 **S3 Endpoint**。例如端点 `s3.us-west-004.backblazeb2.com` 对应的 `region` 是 `us-west-004`。沿用桶的默认跨域配置即可。 [Backblaze 建桶](https://www.backblaze.com/docs/cloud-storage-create-and-manage-buckets)
2. 打开 **Application Keys → Add a New Application Key**，每个桶分别建一把密钥。

   | 表单字段 | 填写内容 |
   | --- | --- |
   | Name of Key | 自取，例如 `cfb2-pan-primary` |
   | Allow Access to Bucket(s) | 选择这把密钥对应的桶 |
   | Type of Access | **Read and Write** |
   | File Name Prefix | `cfb2-pan/` |

   点 **Create New Key** 后，保存显示的 `keyID` 和 `applicationKey`。密钥值只在创建时显示。 [Backblaze 应用密钥](https://www.backblaze.com/docs/en/cloud-storage-get-started-with-a-backblaze-integration#scoped-application-key-recommended)

3. 打开 [B2 配置示例](config/b2-buckets.example.json)，复制整个 JSON 到本机文本编辑器。两段分别填各自的桶，保留外层 `[` 和 `]`。这段填好的 JSON 稍后完整粘贴到 Cloudflare 的 `B2_BUCKETS` Secret。

   | JSON 字段 | 从哪里取值 |
   | --- | --- |
   | `name` | Backblaze 的桶名 |
   | `region` | 该桶 S3 Endpoint 中的区域 |
   | `keyId` | 对应桶的 `keyID` |
   | `applicationKey` | 对应桶的 `applicationKey` |

   示例给每个桶设了 10 GiB 应用配额。首装可直接保留示例中的 `id`、`quota`、`priority` 和 `writable`。真实密钥只填进本机临时副本和 Cloudflare Secret，GitHub 上保留原占位值。

### 3. 在 Workers & Pages 导入 GitHub 仓库

1. 进入 **Workers & Pages → Create application**，选择 **GitHub** 并授权 Cloudflare 访问你要部署的仓库。选择第 1 步改过 `wrangler.jsonc` 的那个仓库。 [Workers Builds 导入仓库](https://developers.cloudflare.com/workers/ci-cd/builds/#connect-a-new-worker)
2. 按下表填写部署表单，点 **Save and Deploy**。表中的命令填在网页表单里，由 Cloudflare 运行。

   | 表单字段 | 填写内容 |
   | --- | --- |
   | Worker name | `cfb2-pan`，与 `wrangler.jsonc` 的 `name` 一致 |
   | Production branch | `main` |
   | Root directory | 留空，用仓库根目录 |
   | Build command | `npm run check` |
   | Deploy command | `npm run deploy` |
   | API token | 使用 Cloudflare 提供的构建令牌。若界面显示 **Create new token**，用它创建默认令牌 |

3. 打开这个 Worker 的 **Deployments**，确认已有成功部署。打开 **Bindings**，确认 `DB` 指向 `cfb2-pan`。在 **Settings → Domains & Routes** 复制 `workers.dev` 地址。如果账户尚未设置 `workers.dev` 子域名，按控制台提示先注册。 [Workers Builds 表单说明](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/) · [`workers.dev` 设置](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)

### 4. 在 Worker 添加三个 Secret

进入 **Workers & Pages → cfb2-pan → Settings → Variables and Secrets → Add**。按表逐项填 **Type**、**Variable name** 和 **Value**，保存并部署设置。

| Variable name | Type | Value |
| --- | --- | --- |
| `ADMIN_PASSWORD` | Secret | 自设的管理员密码，16 至 128 个字符，建议用密码管理器生成 |
| `B2_BUCKETS` | Secret | 第 2 步填好的整个 JSON 数组 |
| `SHARE_SECRET` | Secret | 用密码管理器独立生成的随机字符串，至少 32 字节，例如 40 位随机字母和数字 |

登录时输入 `ADMIN_PASSWORD`。后续部署继续使用原 `SHARE_SECRET`，这样管理页可以再次复制已有分享链接。 [Worker Secret 设置](https://developers.cloudflare.com/workers/configuration/secrets/#via-the-dashboard)

### 5. 验收上传和分享

1. 打开第 3 步复制的站点地址，输入 `ADMIN_PASSWORD` 登录。进入网盘后，应能看到文件列表和总容量。
2. 上传一个小文件，再上传一个大于 16 MiB 的文件，分别下载验证。要检查自动选桶，可在两个等额空桶上先连续上传两个同样大小的文件，再到 Backblaze 的 **Browse Files → cfb2-pan/** 确认每桶各新增一个对象。
3. 为文件创建分享，密码留空。在无痕窗口打开链接，应能直接看到文件并下载。再从管理页撤销链接，用同一链接重新下载应被拒绝。需要给资源加一道密码时，可在创建分享时填写访问密码。

### 可选：使用自定义域名

在 **Settings → Domains & Routes → Add → Custom Domain** 添加自己的主机名。若只用一个域名，直接用该地址登录和创建分享。若分开管理和分享域名，添加两个 Custom Domain，再在 **Variables and Secrets** 添加两项 **Text** 变量。`ADMIN_HOST` 填管理主机名，`SHARE_HOST` 填分享主机名，例如 `drive.example.com` 和 `share.example.com`。只填主机名，地址可继续沿用来保留旧分享。 [绑定 Worker 自定义域名](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/#set-up-a-custom-domain-in-the-dashboard)

### 卡在哪一步就查哪一项

| 现象 | 检查位置 |
| --- | --- |
| Cloudflare 的导入列表没有仓库 | 查看 GitHub 的 Cloudflare 应用授权，确认允许访问该仓库。 |
| 构建日志提示 D1 绑定错误，或网盘打不开文件列表 | 检查部署分支的 `wrangler.jsonc` 是否使用了实际 `database_id`，再到该 D1 的 **Tables** 确认迁移已执行。 |
| 登录时提示管理员密码未配置 | 在 **Variables and Secrets** 添加或更新 `ADMIN_PASSWORD`，保存并部署设置。 |
| 绑定的自定义域名打不开 | 在 **Domains & Routes** 确认域名已绑到正确的 Worker。如果设置过 `ADMIN_HOST` 或 `SHARE_HOST`，核对拼写。 |
| 网盘显示 B2 配置错误，或写入失败 | 检查 `B2_BUCKETS` 是否为完整 JSON，桶名、区域和密钥是否一一对应，密钥是否有 **Read and Write** 权限。 |

## 升级已有网盘

1. 在旧 Worker 上先设置 `ADMIN_PASSWORD`。继续使用原 D1、桶 `id`、`SHARE_SECRET` 和分享域名。
2. 如果之前通过 D1 控制台初始化，在 **D1 → Console** 执行新增的 [0004_admin_sessions.sql](migrations/0004_admin_sessions.sql)。使用 Wrangler 自动迁移的实例沿用原部署命令即可。 [D1 迁移记录](https://developers.cloudflare.com/d1/reference/migrations/)
3. 新版部署成功后，在 Zero Trust 中取消该网盘域名的旧 Access 应用，再用管理员密码登录确认。保留原分享域名即可继续使用先前发出的分享链接。

## 日常使用

- 调整桶配额或增加桶时，在 Worker 控制台编辑 `B2_BUCKETS` Secret。设置 `writable: false` 可暂停向该桶分配新文件。有历史文件或清理任务时，保留该桶的配置和有效密钥。
- Worker 按上传后的占用率选桶，占用率相同再看 `priority`。写入前探测失败会换桶，已开始写入的会话固定在原桶。单文件上限 1 GiB，上传中断后，在同一浏览器和目录重新选原文件即可续传。
- 删除后会立即停止新下载，定时任务删除 B2 对象版本后释放配额。请分别备份 D1 元数据与要保留的 B2 文件。 [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)

## 本地开发

```bash
npm ci
npm run dev
```

打开 [本地网盘](http://127.0.0.1:8787/)，使用演示密码 `cfb2-demo-password` 登录。本地演示使用 Wrangler 模拟的 D1 和两个对象桶，数据位于 `.wrangler/state`。运行 `npm run check` 检查代码，运行 `npm run build` 验证部署构建。Windows PowerShell 可使用 `npm.cmd`。

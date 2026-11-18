# CFB2 网盘

CFB2 是基于 Cloudflare Workers 的个人资源分发工具。收到链接的访客直接访问分享页。管理员在 `/admin` 上传资源、管理分享和接入 Backblaze B2 私有桶，Worker 自动分配新上传。

## 网页部署教程

全程用浏览器操作。准备 Cloudflare、GitHub 和 Backblaze B2 账号。一个 `workers.dev` 地址即可使用。在该地址后加 `/admin` 管理资源，发布后的 `/s/…` 链接供访客下载。 [Cloudflare 的 `workers.dev` 地址](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)

### 1. 在 Cloudflare 建库，在 GitHub 填数据库 ID

1. 打开 Cloudflare 控制台，进入 **D1 SQL Database → Create database**。名称填 `cfb2-pan`，创建后在数据库页面复制 **Database ID**。 [Cloudflare D1 控制台](https://dash.cloudflare.com/?to=/:account/workers/d1)
2. 打开 [初始化 SQL](migrations/0001_initial.sql)，点 **Raw** 并复制全文。回到 D1 数据库的 **Console**，一次粘贴并点 **Execute**。执行成功后，在 **Tables** 中能看到 `entries`、`admin_sessions` 和 `bucket_settings`。 [D1 控制台执行 SQL](https://developers.cloudflare.com/d1/get-started/#populate-your-d1-database)
3. 在 GitHub 打开你要部署的仓库。自己已有写权限就直接用，否则先点页面右上角的 **Fork**。在你的仓库 `main` 分支打开根目录的 `wrangler.jsonc`，点铅笔图标。把 `database_id` 的全零值替换为刚复制的数据库 ID，保留 `binding` 为 `DB` 和 `database_name` 为 `cfb2-pan`，然后点 **Commit changes** 保存到 `main`。

### 2. 在 Backblaze 准备私有桶和密钥

1. 打开 Backblaze 控制台，进入 **B2 Cloud Storage → Buckets → Create a Bucket**。选 **Private** 创建桶。记下桶名和 **S3 Endpoint**，例如 `s3.us-west-004.backblazeb2.com` 对应区域 `us-west-004`。可以先接入一个桶，之后再扩充。保留默认跨域配置。 [Backblaze 建桶](https://www.backblaze.com/docs/cloud-storage-create-and-manage-buckets)
2. 打开 **Application Keys → Add a New Application Key**，每个桶分别建一把密钥。

   | 表单字段 | 填写内容 |
   | --- | --- |
   | Name of Key | 自取，例如 `cfb2-pan-primary` |
   | Allow Access to Bucket(s) | 选择这把密钥对应的桶 |
   | Type of Access | **Read and Write** |
   | File Name Prefix | `cfb2-pan/` |

   点 **Create New Key** 后，保存显示的 `keyID` 和 `applicationKey`。密钥值只在创建时显示。 [Backblaze 应用密钥](https://www.backblaze.com/docs/en/cloud-storage-get-started-with-a-backblaze-integration#scoped-application-key-recommended)

   桶名、区域和这两个密钥值在第 5 步填进管理台。

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

### 4. 在 Worker 添加两个 Secret

进入 **Workers & Pages → cfb2-pan → Settings → Variables and Secrets → Add**。按表逐项填 **Type**、**Variable name** 和 **Value**，保存并部署设置。

| Variable name | Type | Value |
| --- | --- | --- |
| `ADMIN_PASSWORD` | Secret | 自设的管理员密码，16 至 128 个字符，建议用密码管理器生成 |
| `SHARE_SECRET` | Secret | 用密码管理器独立生成的随机字符串，至少 32 字节，例如 40 位随机字母和数字 |

登录时输入 `ADMIN_PASSWORD`。请备份并保留 `SHARE_SECRET`，它也用于解密后台保存的桶密钥和复制已有分享链接。 [Worker Secret 设置](https://developers.cloudflare.com/workers/configuration/secrets/#via-the-dashboard)

### 5. 在管理台接入桶并发布资源

1. 打开站点的 `/admin`，用 `ADMIN_PASSWORD` 登录。进入 **存储 → 添加存储桶**。
2. 填第 2 步拿到的桶名、S3 区域、Key ID 和 Application Key。应用配额以 GiB 填写，例如 `10`。优先级只在占用率相同时生效，数值较小者优先。点 **验证并添加**，成功后应出现桶卡片和容量。Worker 会检查读写连通性，并加密保存桶密钥。
3. 进入 **资源 → 上传文件**。上传后点文件右侧的**创建分享**按钮。密码留空的分享可在无痕窗口直接下载。回到 **分享** 撤销链接后，访客的新下载请求会被拒绝。

### 可选：使用自定义域名

在 **Settings → Domains & Routes → Add → Custom Domain** 添加自己的主机名。若只用一个域名，直接用该地址登录和创建分享。若分开管理和分享域名，添加两个 Custom Domain，再在 **Variables and Secrets** 添加两项 **Text** 变量。`ADMIN_HOST` 填管理主机名，`SHARE_HOST` 填分享主机名，例如 `drive.example.com` 和 `share.example.com`。只填主机名，地址可继续沿用来保留旧分享。 [绑定 Worker 自定义域名](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/#set-up-a-custom-domain-in-the-dashboard)

### 卡在哪一步就查哪一项

| 现象 | 检查位置 |
| --- | --- |
| Cloudflare 的导入列表没有仓库 | 查看 GitHub 的 Cloudflare 应用授权，确认允许访问该仓库。 |
| 构建日志提示 D1 绑定错误，或网盘打不开文件列表 | 检查部署分支的 `wrangler.jsonc` 是否使用了实际 `database_id`，再到该 D1 的 **Tables** 确认迁移已执行。 |
| 登录时提示管理员密码未配置 | 在 **Variables and Secrets** 添加或更新 `ADMIN_PASSWORD`，保存并部署设置。 |
| 绑定的自定义域名打不开 | 在 **Domains & Routes** 确认域名已绑到正确的 Worker。如果设置过 `ADMIN_HOST` 或 `SHARE_HOST`，核对拼写。 |
| 添加桶提示验证失败 | 确认桶名、区域和密钥对应，密钥有 **Read and Write** 权限，且允许 `cfb2-pan/` 前缀。 |
| 「移除桶」不可用 | 桶仍有文件、未完成上传或待清理记录。处理后等待定时清理，再刷新后台。 |

## 日常使用

- **存储**页可暂停或恢复新上传分配。正在上传的文件可续传，旧文件和分享照常下载。没有文件或上传引用的桶可从网盘移除，Backblaze 上的桶会保留。
- Worker 按上传后的占用率选桶，占用率相同再看 `priority`。写入前探测失败会换桶，已开始写入的会话固定在原桶。单文件上限 1 GiB，上传中断后，在同一浏览器和目录重新选原文件即可续传。
- 删除后会立即停止新下载，定时任务删除 B2 对象版本后释放配额。请分别备份 D1 元数据与要保留的 B2 文件。 [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)

## 本地开发

```bash
npm ci
npm run dev
```

打开 [本地管理台](http://127.0.0.1:8787/admin)，使用演示密码 `cfb2-demo-password` 登录。本地演示使用 Wrangler 模拟的 D1 和对象桶，数据位于 `.wrangler/state`。运行 `npm run check` 检查代码，运行 `npm run build` 验证部署构建。Windows PowerShell 可使用 `npm.cmd`。

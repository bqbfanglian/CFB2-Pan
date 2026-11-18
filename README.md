# CFB2 网盘

用 Cloudflare Workers 搭建个人网盘。文件存放在多个 Backblaze B2 私有桶中，由 Worker 自动选桶。支持文件管理、分片续传，以及可设密码、有效期和手动撤销的分享链接。

## 网页部署教程

全程用浏览器操作。需要 GitHub 账号、Backblaze B2 账号，以及一个已接入 Cloudflare 的域名。下面以 `example.com` 为例，部署时换成你自己的域名。

| 示例地址 | 用途 |
| --- | --- |
| `drive.example.com` | 管理网盘，管理员用邮箱验证码登录 |
| `share.example.com` | 打开分享链接，访客可直接访问 |

下面从**新建数据库**开始。升级已有网盘请看文末的[升级说明](#升级已有网盘)。

### 1. 在 Cloudflare 建库，在 GitHub 填数据库 ID

1. 打开 Cloudflare 控制台，进入 **D1 SQL Database → Create database**。名称填 `cfb2-pan`，创建后在数据库页面复制 **Database ID**。 [Cloudflare D1 控制台](https://dash.cloudflare.com/?to=/:account/workers/d1)
2. 在同一个数据库页面打开 **Console**。按下表顺序执行 SQL。每一行都先在 GitHub 打开文件，用 **Raw** 查看并复制整个文件，再回到 D1 的输入框粘贴并点 **Execute**。确认本次执行成功后再粘贴下一份。 [D1 控制台执行 SQL](https://developers.cloudflare.com/d1/get-started/#populate-your-d1-database)

   | 顺序 | 复制这个文件 |
   | --- | --- |
   | 1 | [0001_drive.sql](migrations/0001_drive.sql) |
   | 2 | [0002_cleanup_retry.sql](migrations/0002_cleanup_retry.sql) |
   | 3 | [0003_bucket_scheduling.sql](migrations/0003_bucket_scheduling.sql) |

3. 执行下方查询，看到 `root` 和 `我的文件` 就说明网盘根目录已创建。在 **Tables** 页还能看到 `bucket_health` 表。

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

### 3. 给管理域名加邮箱登录

1. 在 Cloudflare 控制台打开 **Zero Trust**。首次进入时按页面提示创建团队。进入 **Integrations → Identity providers → Add new identity provider**，选 **One-time PIN**。已有这个登录方式就直接使用。 [启用邮箱验证码](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/#set-up-otp)
2. 进入 **Access controls → Applications → Create new application → Self-hosted and private → Add public hostname**。应用名填 `CFB2 Pan`，子域名填 `drive`，域名选自己的域名，路径留空。登录方式选 **One-time PIN**。 [创建 Access 应用](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/#1-add-your-application-to-access)
3. 在 **Access policies** 添加策略。**Action** 选 **Allow**，**Include** 选 **Emails**，填你用来登录网盘的邮箱。保存应用。这个 Access 应用只配置 `drive` 管理域名。
4. 回到 **Applications**，编辑刚创建的应用。在 **Additional settings** 复制 **Application Audience (AUD) Tag**。再到 **Zero Trust → Settings** 记下团队域名，例如 `my-team.cloudflareaccess.com`。这两个值和管理员邮箱在第 5 步使用。 [查找 AUD](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/#get-your-aud-tag) · [查找团队域名](https://developers.cloudflare.com/cloudflare-one/faq/getting-started-faq/)

### 4. 在 Workers & Pages 导入 GitHub 仓库

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

3. 打开这个 Worker 的 **Deployments**，确认已有成功部署。打开 **Bindings**，确认 `DB` 指向 `cfb2-pan`。本项目使用自定义域名，实际访问地址在第 5 步绑定。 [Workers Builds 表单说明](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)

### 5. 在 Worker 填配置并绑定域名

进入 **Workers & Pages → cfb2-pan → Settings → Variables and Secrets → Add**。按表逐项填 **Type**、**Variable name** 和 **Value**，保存并部署设置。

| Variable name | Type | Value |
| --- | --- | --- |
| `ADMIN_HOST` | Text | 管理域名，如 `drive.example.com` |
| `SHARE_HOST` | Text | 分享域名，如 `share.example.com` |
| `ADMIN_EMAIL` | Text | 第 3 步 Allow 策略里的邮箱 |
| `ACCESS_TEAM_DOMAIN` | Text | 第 3 步记录的团队域名，只填主机名 |
| `ACCESS_AUD` | Text | 第 3 步复制的 AUD Tag |
| `B2_BUCKETS` | Secret | 第 2 步填好的整个 JSON 数组 |
| `SHARE_SECRET` | Secret | 用密码管理器生成并保存的随机字符串，例如 40 位随机字母和数字 |

前两个域名只填 `drive.example.com` 这样的主机名。`SHARE_SECRET` 至少 32 字节，后续部署继续使用同一个值。 [Worker Secret 设置](https://developers.cloudflare.com/workers/configuration/secrets/#via-the-dashboard)

1. 进入同一个 Worker 的 **Settings → Domains & Routes → Add → Custom Domain**。填实际管理域名，点 **Add Custom Domain**。
2. 重复一次，添加实际分享域名。两个域名都应出现在同一个 Worker 的 **Domains & Routes** 中。 [绑定 Worker 自定义域名](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/#set-up-a-custom-domain-in-the-dashboard)

### 6. 验收上传和分享

1. 在无痕窗口打开管理域名。看到 Access 登录页后填管理员邮箱，输入邮件验证码。进入网盘后，应能看到文件列表和总容量。
2. 上传一个小文件，再上传一个大于 16 MiB 的文件，分别下载验证。要检查自动选桶，可在两个等额空桶上先连续上传两个同样大小的文件，再到 Backblaze 的 **Browse Files → cfb2-pan/** 确认每桶各新增一个对象。
3. 为文件创建带密码的分享。在另一浏览器或独立的无痕会话打开分享链接，应看到分享密码页面。解锁后下载文件，再从管理页撤销链接。用同一链接再次发起下载，应被拒绝。

### 卡在哪一步就查哪一项

| 现象 | 检查位置 |
| --- | --- |
| Cloudflare 的导入列表没有仓库 | 查看 GitHub 的 Cloudflare 应用授权，确认允许访问该仓库。 |
| 构建日志提示 D1 绑定错误，或网盘打不开文件列表 | 检查部署分支的 `wrangler.jsonc` 是否使用了实际 `database_id`，再到该 D1 的 **Tables** 确认迁移已执行。 |
| 自定义域名打不开 | 在 **Domains & Routes** 确认两个域名已绑到正确的 Worker，再核对 `ADMIN_HOST` 和 `SHARE_HOST` 是否与绑定值一致。 |
| 管理域名没有登录页，或登录后返回 403 | 检查 Access 应用的主机名和 Allow 邮箱，再核对 Worker 的 `ACCESS_TEAM_DOMAIN`、`ACCESS_AUD` 和 `ADMIN_EMAIL`。 |
| 网盘显示 B2 配置错误，或写入失败 | 检查 `B2_BUCKETS` 是否为完整 JSON，桶名、区域和密钥是否一一对应，密钥是否有 **Read and Write** 权限。 |
| 分享链接要求 Access 登录 | 检查 Access 应用的主机名范围。管理应用只覆盖 `drive`，分享使用单独的 `share` 主机名。 |

## 升级已有网盘

通过旧教程启用了 Wrangler 自动迁移的实例，可继续使用原来的部署命令。采用本页 D1 控制台方式安装的实例，在部署新版代码前到 **D1 → Console** 按顺序执行新版新增的迁移文件。数据库已有文件时，保留原数据库、桶 `id` 和 `SHARE_SECRET`。 [D1 迁移记录](https://developers.cloudflare.com/d1/reference/migrations/)

## 日常使用

- 调整桶配额或增加桶时，在 Worker 控制台编辑 `B2_BUCKETS` Secret。设置 `writable: false` 可暂停向该桶分配新文件。有历史文件或清理任务时，保留该桶的配置和有效密钥。
- Worker 按上传后的占用率选桶，占用率相同再看 `priority`。写入前探测失败会换桶，已开始写入的会话固定在原桶。单文件上限 1 GiB，上传中断后，在同一浏览器和目录重新选原文件即可续传。
- 删除后会立即停止新下载，定时任务删除 B2 对象版本后释放配额。请分别备份 D1 元数据与要保留的 B2 文件。 [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)

## 本地开发

```bash
npm ci
npm run dev
```

打开 [本地网盘](http://127.0.0.1:8787/)。本地演示使用 Wrangler 模拟的 D1 和两个对象桶，数据位于 `.wrangler/state`。运行 `npm run check` 检查代码，运行 `npm run build` 验证部署构建。Windows PowerShell 可使用 `npm.cmd`。

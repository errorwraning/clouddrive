#部署完后启动命令
source venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4



# CloudDrive 后端

FastAPI + MySQL + 本地磁盘文件存储。

## 目录结构

```
clouddrive-backend/
├── main.py               # 应用入口
├── requirements.txt      # Python 依赖
├── .env.example          # 环境变量模板
├── core/
│   ├── config.py         # 读取 .env 配置
│   ├── database.py       # SQLAlchemy 连接 & Session
│   └── security.py       # 密码哈希、JWT
├── models/
│   ├── user.py           # 用户数据表
│   └── file.py           # 文件数据表
├── schemas/
│   ├── user.py           # 请求/响应 Pydantic 模型
│   └── file.py
├── routers/
│   ├── auth.py           # 注册、登录、用户信息
│   └── files.py          # 上传、下载、文件管理
├── uploads/              # 文件存储目录（自动创建）
└── frontend/             # 前端静态文件（可选）
    ├── index.html
    ├── css/style.css
    └── js/app.js
```

---

## 快速启动

### 1. 准备 MySQL 数据库

```sql
CREATE DATABASE clouddrive CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 然后编辑 .env，填写数据库密码和 SECRET_KEY
```

`.env` 最少需要改这两项：

```
DB_PASSWORD=你的MySQL密码
SECRET_KEY=随机长字符串（用下方命令生成）
```

生成 SECRET_KEY：

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

### 3. 安装依赖

```bash
# 建议使用虚拟环境
python3 -m venv venv
source venv/bin/activate       # Windows: venv\Scripts\activate

pip install -r requirements.txt
# 如果 pydantic-settings 未安装：
pip install pydantic-settings
```

### 4. 启动服务

```bash
python3 main.py
```

服务启动后：
- API 文档：http://localhost:8000/docs
- 前端页面：http://localhost:8000（如果 frontend/ 目录存在）

---

## API 接口一览

### 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/register` | 注册 |
| POST | `/api/auth/login`    | 登录，返回 JWT Token |
| GET  | `/api/auth/me`       | 获取当前用户信息 |
| GET  | `/api/auth/storage`  | 获取存储用量 |

### 文件管理（需要登录）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET    | `/api/files`                    | 列出文件（支持 nav/path/q 参数）|
| POST   | `/api/files/upload`             | 上传文件（multipart/form-data）|
| GET    | `/api/files/{id}/download`      | 下载文件 |
| POST   | `/api/files/folder`             | 新建文件夹 |
| PATCH  | `/api/files/{id}/rename`        | 重命名 |
| POST   | `/api/files/{id}/share`         | 开启/关闭分享 |
| DELETE | `/api/files/{id}`               | 移入回收站 |
| POST   | `/api/files/{id}/restore`       | 从回收站恢复 |
| DELETE | `/api/files/{id}/permanent`     | 永久删除 |

### 公开接口（无需登录）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/files/shared/{token}` | 通过分享链接下载文件 |
| GET | `/api/health` | 健康检查 |

---

## 生产部署建议

1. **关闭 reload 模式**：`main.py` 里的 `reload=True` 改为 `False`
2. **CORS**：把 `allow_origins=["*"]` 改为你的实际前端域名
3. **HTTPS**：通过 Nginx 反向代理 + Let's Encrypt 证书
4. **进程管理**：用 `supervisor` 或 `systemd` 保持进程存活
5. **uploads 目录**：定期备份，或改用对象存储（OSS/S3）

### Nginx 反向代理示例

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    client_max_body_size 2g;  # 与 MAX_FILE_SIZE 保持一致

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

# AgentFlow Docker 部署指南

## 快速开始

### 1. 构建 Docker 镜像

```bash
cd /path/to/agent-flow
docker build -t xiaopeng1112/agentflow:latest .
```

### 2. 运行后端服务

```bash
docker run -d \
  --name agentflow-backend \
  -p 3001:3001 \
  xiaopeng1112/agentflow:latest
```

### 3. 访问前端

打开浏览器访问：
```
https://xiaopeng1112.github.io/agent-flow/
```

前端会自动连接到本地 `localhost:3001` 的后端服务。

---

## 详细说明

### 构建选项

#### 不使用缓存重新构建
```bash
docker build --no-cache -t xiaopeng1112/agentflow:latest .
```

#### 构建特定版本的镜像
```bash
docker build -t xiaopeng1112/agentflow:v2.9.1 .
```

### 运行选项

#### 前台运行（可查看日志）
```bash
docker run -p 3001:3001 xiaopeng1112/agentflow:latest
```

#### 后台运行（推荐演讲使用）
```bash
docker run -d \
  --name agentflow-backend \
  -p 3001:3001 \
  xiaopeng1112/agentflow:latest
```

#### 查看运行日志
```bash
docker logs agentflow-backend
# 实时查看日志
docker logs -f agentflow-backend
```

#### 停止容器
```bash
docker stop agentflow-backend
```

#### 移除容器
```bash
docker rm agentflow-backend
```

---

## 发布到 DockerHub

### 1. 登录 DockerHub
```bash
docker login
# 输入用户名和密码
```

### 2. 标记镜像
```bash
docker tag xiaopeng1112/agentflow:latest xiaopeng1112/agentflow:latest
```

### 3. 推送到 DockerHub
```bash
docker push xiaopeng1112/agentflow:latest
```

### 4. 别人使用你的镜像
```bash
docker pull xiaopeng1112/agentflow:latest
docker run -d -p 3001:3001 xiaopeng1112/agentflow:latest
```

---

## 使用 Docker Compose（可选）

如果想使用 docker-compose 简化操作，创建 `docker-compose.yml`：

```yaml
version: '3.8'
services:
  agentflow-backend:
    image: xiaopeng1112/agentflow:latest
    ports:
      - "3001:3001"
    volumes:
      - agentflow-data:/app/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
      interval: 10s
      timeout: 5s
      retries: 3

volumes:
  agentflow-data:
```

然后运行：
```bash
docker-compose up -d
```

---

## 故障排查

### 端口已被占用
如果 3001 端口被占用，可以映射到其他端口：
```bash
docker run -d -p 3002:3001 xiaopeng1112/agentflow:latest
# 然后在前端改 localhost:3001 为 localhost:3002
```

### 查看容器状态
```bash
docker ps  # 查看运行中的容器
docker logs agentflow-backend  # 查看错误日志
```

### 清理（谨慎）
```bash
docker stop agentflow-backend
docker rm agentflow-backend
docker rmi xiaopeng1112/agentflow:latest
```

---

## 演讲使用建议

1. **演讲前**：在你的电脑上构建并测试镜像
   ```bash
   docker build -t xiaopeng1112/agentflow:latest .
   docker run -d -p 3001:3001 xiaopeng1112/agentflow:latest
   ```

2. **演讲时**：打开浏览器访问 Pages 地址即可演示

3. **演讲后**：推送到 DockerHub
   ```bash
   docker push xiaopeng1112/agentflow:latest
   ```

4. **分享给听众**：
   - 分享 Pages 地址：`https://xiaopeng1112.github.io/agent-flow/`
   - 分享 Docker 启动命令：`docker pull xiaopeng1112/agentflow && docker run -d -p 3001:3001 xiaopeng1112/agentflow`

---

## 镜像大小和内容

这个 Docker 镜像只包含：
- ✅ Node.js 运行时
- ✅ 后端编译产物（dist/）
- ✅ 依赖包（node_modules/）
- ❌ 源代码（TypeScript 源文件不包含）
- ❌ 前端代码（用 GitHub Pages）

这样能确保源码不泄露，同时镜像体积合理（约 200-300MB）。

---

## 技术细节

- **多阶段构建**：分离编译阶段和运行阶段，只在最终镜像中保留必要文件
- **生产依赖**：使用 `--production` 标志，不安装 devDependencies
- **健康检查**：内置 healthcheck 便于监控容器状态
- **Alpine Linux**：使用轻量级基础镜像，减小镜像大小

---

## CI 构建（GitHub Actions）

仓库已添加一个 GitHub Actions workflow，位于 `.github/workflows/docker-publish.yml`，在推送到 `main` 分支或手动触发时会自动构建并推送镜像到 Docker Hub。

使用说明：

- 在仓库设置中添加 Secrets：
  - `DOCKER_HUB_USERNAME`：你的 Docker Hub 用户名
  - `DOCKER_HUB_TOKEN`：Docker Hub 的访问令牌（推荐使用 Access Token）

- 手动触发或推送到 `main` 后，Actions 会执行构建并将镜像推送到 `xiaopeng1112/agentflow:latest`。

触发后可在 GitHub 仪表盘的 Actions 标签页查看运行日志。CI 方式适合在本地网络受限或无法直接构建时使用。


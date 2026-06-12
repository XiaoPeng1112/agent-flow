# ═══ 构建阶段 ═══
FROM node:20-alpine AS builder

WORKDIR /app

# 复制 package 文件
COPY package.json yarn.lock ./
COPY packages/server/package.json packages/server/tsconfig.json ./packages/server/

# 安装依赖
RUN yarn install --frozen-lockfile

# 复制源代码（仅构建阶段）
COPY packages/server/src ./packages/server/src

# 编译 TypeScript
WORKDIR /app/packages/server
RUN yarn build

# ═══ 运行阶段 ═══
FROM node:20-alpine

WORKDIR /app

# 从构建阶段复制 package.json
COPY package.json yarn.lock ./
COPY packages/server/package.json ./packages/server/

# 安装生产依赖（--production 不安装 devDependencies）
RUN yarn install --frozen-lockfile --production

# 从构建阶段复制编译产物（不含源代码）
COPY --from=builder /app/packages/server/dist ./packages/server/dist

# 创建数据目录
RUN mkdir -p /app/data

# 暴露端口
EXPOSE 3001

# 健康检查
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# 启动后端服务
CMD ["node", "packages/server/dist/index.js"]

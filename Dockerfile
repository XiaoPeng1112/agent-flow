# ═══ 构建阶段 ═══
FROM node:20-alpine AS builder

WORKDIR /app

# 复制后端 package 文件和锁文件
COPY packages/server/package.json packages/server/tsconfig.json ./
COPY yarn.lock ./

# 安装依赖并编译后端
RUN yarn install --frozen-lockfile
COPY packages/server/src ./src
RUN yarn build

# 安装生产依赖到单独目录
RUN yarn install --production --frozen-lockfile --modules-folder /app/prod_node_modules

# ═══ 运行阶段 ═══
FROM node:20-alpine

WORKDIR /app

# 复制运行时依赖和编译产物
COPY --from=builder /app/prod_node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# 创建数据目录
RUN mkdir -p /app/data

# 暴露端口
EXPOSE 3001

# 健康检查
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# 启动后端服务
CMD ["node", "dist/index.js"]

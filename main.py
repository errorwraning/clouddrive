from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

from core.config import settings
from core.database import engine, Base
import models  # 确保所有 model 被导入，触发建表

from routers import auth, files

# ===== 建表 =====
Base.metadata.create_all(bind=engine)

# ===== 应用实例 =====
app = FastAPI(
    title="CloudDrive API",
    version="1.0.0",
    description="云盘后端 API，基于 FastAPI + MySQL",
)

# ===== CORS =====
# 开发阶段允许所有来源；生产环境请改为你的实际域名
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ===== 路由 =====
app.include_router(auth.router)
app.include_router(files.router)

# ===== 托管前端静态文件 =====
# 将前端 clouddrive/ 目录放到与本文件同级，自动托管
#FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "frontend")
FRONTEND_DIR = r"C:\Users\ZMJ\Desktop\project\网盘\clouddrive\frontend"

if os.path.isdir(FRONTEND_DIR):
    #app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="static")

    @app.get("/", include_in_schema=False)
    def serve_frontend():
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))


# ===== 健康检查 =====
@app.get("/api/health", tags=["系统"])
def health():
    return {"status": "ok", "version": "1.0.0"}


# ===== 启动入口 =====
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=True,   # 开发模式热重载，生产环境去掉
    )

import os
import uuid
import secrets
import mimetypes
from pathlib import Path
from typing import Optional

import aiofiles
from fastapi import (
    APIRouter, Depends, HTTPException, UploadFile,
    File as FastAPIFile, Query, status
)
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import func

from core.config import settings
from core.database import get_db
from core.security import get_current_user
from models.user import User
from models.file import File
from schemas.file import (
    FileOut, FileListResponse,
    CreateFolderRequest, RenameRequest, MoveRequest
)

router = APIRouter(prefix="/api/files", tags=["文件"])

# ===== 工具函数 =====

def guess_file_type(filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    mapping = {
        "image": {"png","jpg","jpeg","gif","webp","svg","bmp","ico","avif"},
        "video": {"mp4","mov","avi","mkv","webm","flv","m4v"},
        "audio": {"mp3","wav","flac","aac","ogg","m4a","wma"},
        "pdf":   {"pdf"},
        "doc":   {"doc","docx","txt","md","odt","rtf","xls","xlsx","csv","ppt","pptx"},
        "zip":   {"zip","rar","7z","tar","gz","bz2","xz"},
    }
    for t, exts in mapping.items():
        if ext in exts:
            return t
    return "other"


def get_used_storage(user_id: int, db: Session) -> int:
    return db.query(func.coalesce(func.sum(File.size), 0)).filter(
        File.user_id == user_id,
        File.is_deleted == False,
        File.file_type != "folder",
    ).scalar()


def normalize_path(path: str) -> str:
    """统一路径格式：去掉首尾斜杠，空字符串代表根目录"""
    return path.strip("/").strip()


# ===== 文件列表 =====

@router.get("", response_model=FileListResponse, summary="列出文件")
def list_files(
    path: str = Query("", description="目录路径，根目录传空字符串"),
    nav: str = Query("all", description="all/recent/shared/trash/image/video/doc"),
    q: str = Query("", description="搜索关键字"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(File).filter(File.user_id == current_user.id)

    if nav == "trash":
        query = query.filter(File.is_deleted == True)
    elif nav == "recent":
        query = query.filter(File.is_deleted == False).order_by(File.updated_at.desc()).limit(20)
    elif nav == "shared":
        query = query.filter(File.is_deleted == False, File.is_shared == True)
    elif nav == "image":
        query = query.filter(File.is_deleted == False, File.file_type == "image")
    elif nav == "video":
        query = query.filter(File.is_deleted == False, File.file_type == "video")
    elif nav == "doc":
        query = query.filter(File.is_deleted == False, File.file_type.in_(["doc","pdf"]))
    else:
        # 普通目录浏览
        query = query.filter(
            File.is_deleted == False,
            File.path == normalize_path(path),
        )

    if q:
        query = query.filter(File.name.ilike(f"%{q}%"))

    # 文件夹排前面，再按时间倒序
    if nav not in ("recent",):
        query = query.order_by(
            (File.file_type != "folder").asc(),
            File.updated_at.desc(),
        )

    items = query.all()
    return FileListResponse(items=items, total=len(items))


# ===== 上传 =====

@router.post("/upload", response_model=FileOut, summary="上传文件")
async def upload_file(
    file: UploadFile = FastAPIFile(...),
    path: str = Query("", description="上传到哪个目录"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # 检查文件大小（先读 header）
    if file.size and file.size > settings.MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="文件超过单次上传限制")

    # 检查配额
    used = get_used_storage(current_user.id, db)
    if used + (file.size or 0) > current_user.quota:
        raise HTTPException(status_code=400, detail="存储空间不足")

    # 生成唯一存储文件名，防止冲突
    suffix = Path(file.filename).suffix
    storage_name = f"{uuid.uuid4().hex}{suffix}"
    dest = Path(settings.UPLOAD_DIR) / str(current_user.id) / storage_name
    dest.parent.mkdir(parents=True, exist_ok=True)

    # 流式写入磁盘
    actual_size = 0
    async with aiofiles.open(dest, "wb") as f:
        while chunk := await file.read(1024 * 1024):  # 1 MB chunks
            actual_size += len(chunk)
            if actual_size > settings.MAX_FILE_SIZE:
                await f.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail="文件超过单次上传限制")
            await f.write(chunk)

    mime = mimetypes.guess_type(file.filename)[0] or "application/octet-stream"

    record = File(
        user_id=current_user.id,
        name=file.filename,
        storage_name=str(dest),
        file_type=guess_file_type(file.filename),
        path=normalize_path(path),
        size=actual_size,
        mime_type=mime,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


# ===== 下载 =====

@router.get("/{file_id}/download", summary="下载文件")
def download_file(
    file_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    record = db.query(File).filter(
        File.id == file_id,
        File.user_id == current_user.id,
        File.is_deleted == False,
    ).first()

    if not record:
        raise HTTPException(status_code=404, detail="文件不存在")
    if record.file_type == "folder":
        raise HTTPException(status_code=400, detail="不支持下载文件夹")

    if not os.path.exists(record.storage_name):
        raise HTTPException(status_code=404, detail="文件已丢失，请联系管理员")

    return FileResponse(
        path=record.storage_name,
        filename=record.name,
        media_type=record.mime_type or "application/octet-stream",
    )


# ===== 新建文件夹 =====

@router.post("/folder", response_model=FileOut, summary="新建文件夹")
def create_folder(
    body: CreateFolderRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="文件夹名称不能为空")

    parent = normalize_path(body.path)

    # 同目录下不允许重名
    exists = db.query(File).filter(
        File.user_id == current_user.id,
        File.name == name,
        File.path == parent,
        File.file_type == "folder",
        File.is_deleted == False,
    ).first()
    if exists:
        raise HTTPException(status_code=400, detail="同名文件夹已存在")

    folder = File(
        user_id=current_user.id,
        name=name,
        storage_name="",
        file_type="folder",
        path=parent,
        size=0,
        mime_type="",
    )
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return folder


# ===== 重命名 =====

@router.patch("/{file_id}/rename", response_model=FileOut, summary="重命名")
def rename_file(
    file_id: int,
    body: RenameRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    record = _get_file(file_id, current_user.id, db)
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="名称不能为空")

    record.name = name
    db.commit()
    db.refresh(record)
    return record


# ===== 分享 =====

@router.post("/{file_id}/share", response_model=FileOut, summary="开启/关闭分享")
def toggle_share(
    file_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    record = _get_file(file_id, current_user.id, db)
    if record.is_shared:
        record.is_shared = False
        record.share_token = None
    else:
        record.is_shared = True
        record.share_token = secrets.token_urlsafe(24)

    db.commit()
    db.refresh(record)
    return record


# ===== 分享链接下载（无需登录）=====

@router.get("/shared/{token}", summary="通过分享链接下载文件（无需登录）")
def download_shared(token: str, db: Session = Depends(get_db)):
    record = db.query(File).filter(
        File.share_token == token,
        File.is_shared == True,
        File.is_deleted == False,
    ).first()

    if not record:
        raise HTTPException(status_code=404, detail="分享链接无效或已失效")

    if not os.path.exists(record.storage_name):
        raise HTTPException(status_code=404, detail="文件已丢失")

    return FileResponse(
        path=record.storage_name,
        filename=record.name,
        media_type=record.mime_type or "application/octet-stream",
    )


# ===== 移入回收站 =====

@router.delete("/{file_id}", summary="移入回收站")
def soft_delete(
    file_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    record = _get_file(file_id, current_user.id, db)
    record.is_deleted = True
    record.is_shared = False
    record.share_token = None
    db.commit()
    return {"detail": "已移入回收站"}


# ===== 从回收站恢复 =====

@router.post("/{file_id}/restore", response_model=FileOut, summary="从回收站恢复")
def restore_file(
    file_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    record = db.query(File).filter(
        File.id == file_id,
        File.user_id == current_user.id,
        File.is_deleted == True,
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail="文件不存在")

    record.is_deleted = False
    db.commit()
    db.refresh(record)
    return record


# ===== 永久删除 =====

@router.delete("/{file_id}/permanent", summary="永久删除")
def permanent_delete(
    file_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    record = db.query(File).filter(
        File.id == file_id,
        File.user_id == current_user.id,
        File.is_deleted == True,
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail="文件不在回收站")

    # 删除磁盘文件
    if record.storage_name and os.path.exists(record.storage_name):
        os.remove(record.storage_name)

    db.delete(record)
    db.commit()
    return {"detail": "已永久删除"}


# ===== 内部工具 =====

def _get_file(file_id: int, user_id: int, db: Session) -> File:
    record = db.query(File).filter(
        File.id == file_id,
        File.user_id == user_id,
        File.is_deleted == False,
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail="文件不存在")
    return record

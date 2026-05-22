from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Boolean,
    DateTime, BigInteger, ForeignKey, Text
)
from core.database import Base


class File(Base):
    __tablename__ = "files"

    id           = Column(Integer, primary_key=True, index=True)
    user_id      = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name         = Column(String(512), nullable=False)          # 显示文件名
    storage_name = Column(String(512), nullable=False)          # 磁盘上的实际文件名
    file_type    = Column(String(32), nullable=False)           # folder/image/pdf/doc/...
    path         = Column(Text, nullable=False, default="")     # 父目录路径，用 / 分隔
    size         = Column(BigInteger, default=0)                # 字节数
    mime_type    = Column(String(128), default="")
    is_deleted   = Column(Boolean, default=False, index=True)
    is_shared    = Column(Boolean, default=False)
    share_token  = Column(String(64), nullable=True, index=True)
    created_at   = Column(DateTime, default=datetime.utcnow)
    updated_at   = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

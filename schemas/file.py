from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List


class FileOut(BaseModel):
    id: int
    name: str
    file_type: str
    path: str
    size: int
    mime_type: str
    is_deleted: bool
    is_shared: bool
    share_token: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class FileListResponse(BaseModel):
    items: List[FileOut]
    total: int


class CreateFolderRequest(BaseModel):
    name: str
    path: str = ""   # 父目录路径


class RenameRequest(BaseModel):
    name: str


class MoveRequest(BaseModel):
    new_path: str

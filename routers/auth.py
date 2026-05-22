from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from core.database import get_db
from core.security import hash_password, verify_password, create_access_token, get_current_user
from models.user import User
from schemas.user import RegisterRequest, LoginRequest, TokenResponse, UserOut, StorageInfo
from models.file import File
from sqlalchemy import func

router = APIRouter(prefix="/api/auth", tags=["认证"])


@router.post("/register", response_model=TokenResponse, summary="注册")
def register(body: RegisterRequest, db: Session = Depends(get_db)):
    # 邮箱唯一检查
    if db.query(User).filter(User.email == body.email).first():
        raise HTTPException(status_code=400, detail="该邮箱已被注册")

    user = User(
        name=body.name,
        email=body.email,
        password=hash_password(body.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token({"sub": str(user.id)})
    return TokenResponse(access_token=token, user=UserOut.model_validate(user))


@router.post("/login", response_model=TokenResponse, summary="登录")
def login(body: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email).first()
    if not user or not verify_password(body.password, user.password):
        raise HTTPException(status_code=401, detail="邮箱或密码错误")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="账号已被禁用")

    token = create_access_token({"sub": str(user.id)})
    return TokenResponse(access_token=token, user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut, summary="获取当前用户信息")
def me(current_user: User = Depends(get_current_user)):
    return current_user


@router.get("/storage", response_model=StorageInfo, summary="获取存储空间用量")
def storage(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    used = db.query(func.coalesce(func.sum(File.size), 0)).filter(
        File.user_id == current_user.id,
        File.is_deleted == False,
        File.file_type != "folder",
    ).scalar()

    quota = current_user.quota
    percent = round(used / quota * 100, 2) if quota > 0 else 0
    return StorageInfo(used=used, quota=quota, percent=percent)

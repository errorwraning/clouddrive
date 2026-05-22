from pydantic import BaseModel, EmailStr, field_validator
from datetime import datetime
from typing import Optional


class RegisterRequest(BaseModel):
    name: str
    email: EmailStr
    password: str

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v):
        if not v.strip():
            raise ValueError("用户名不能为空")
        return v.strip()

    @field_validator("password")
    @classmethod
    def password_length(cls, v):
        if len(v) < 6:
            raise ValueError("密码至少6位")
        return v


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserOut"


class UserOut(BaseModel):
    id: int
    name: str
    email: str
    quota: int
    created_at: datetime

    class Config:
        from_attributes = True


class StorageInfo(BaseModel):
    used: int
    quota: int
    percent: float

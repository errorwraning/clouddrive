from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, BigInteger
from core.database import Base


class User(Base):
    __tablename__ = "users"

    id         = Column(Integer, primary_key=True, index=True)
    name       = Column(String(64), nullable=False)
    email      = Column(String(128), unique=True, index=True, nullable=False)
    password   = Column(String(256), nullable=False)
    quota      = Column(BigInteger, default=5 * 1024 ** 3)   # 5 GB
    is_active  = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

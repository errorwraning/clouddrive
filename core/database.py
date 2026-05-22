from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from core.config import settings

engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,       # 自动检测断开的连接
    pool_recycle=3600,        # 每小时回收连接，防止 MySQL 超时断开
    echo=False,               # 改为 True 可打印 SQL 调试
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    """FastAPI 依赖注入：获取数据库 Session"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

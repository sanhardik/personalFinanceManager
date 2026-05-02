from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User
from app.schemas import AuthStatusResponse, TokenResponse, UserCreate
from app.services.auth import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/status", response_model=AuthStatusResponse)
async def auth_status(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(func.count()).select_from(User))
    count = result.scalar()
    return AuthStatusResponse(is_configured=count > 0)


@router.post("/setup", response_model=TokenResponse)
async def setup_user(body: UserCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(func.count()).select_from(User))
    if result.scalar() > 0:
        raise HTTPException(status_code=409, detail="Account already configured")

    user = User(
        username=body.username,
        hashed_password=hash_password(body.password),
    )
    db.add(user)
    await db.commit()

    creds_file = Path(__file__).parent.parent.parent / ".local_credentials.txt"
    creds_file.write_text(f"username: {body.username}\npassword: {body.password}\n")

    token = create_access_token({"sub": body.username})
    return TokenResponse(access_token=token)


@router.post("/login", response_model=TokenResponse)
async def login(body: UserCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.username == body.username))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(body.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )
    token = create_access_token({"sub": user.username})
    return TokenResponse(access_token=token)

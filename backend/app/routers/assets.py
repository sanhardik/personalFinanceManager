"""
Asset endpoints for Personal Finance Manager.

Routes:
  GET    /assets        — List all assets
  POST   /assets        — Create a new asset
  GET    /assets/{id}   — Get a single asset
  PUT    /assets/{id}   — Update an asset
  DELETE /assets/{id}   — Delete an asset (blocked if linked to accounts)
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Account, Asset
from app.schemas import AssetCreate, AssetResponse, AssetUpdate
from app.services.auth import get_current_user

router = APIRouter(prefix="/assets", tags=["assets"], dependencies=[Depends(get_current_user)])


@router.get("", response_model=list[AssetResponse])
async def list_assets(db: AsyncSession = Depends(get_db)):
    """Return all assets ordered by asset_type, then name."""
    result = await db.execute(
        select(Asset).order_by(Asset.asset_type, Asset.asset_name)
    )
    return result.scalars().all()


@router.post("", response_model=AssetResponse, status_code=201)
async def create_asset(payload: AssetCreate, db: AsyncSession = Depends(get_db)):
    """Create a new asset."""
    asset = Asset(**payload.model_dump())
    db.add(asset)
    await db.commit()
    await db.refresh(asset)
    return asset


@router.get("/{asset_id}", response_model=AssetResponse)
async def get_asset(asset_id: int, db: AsyncSession = Depends(get_db)):
    """Get a single asset by ID."""
    result = await db.execute(select(Asset).where(Asset.id == asset_id))
    asset = result.scalar_one_or_none()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    return asset


@router.put("/{asset_id}", response_model=AssetResponse)
async def update_asset(
    asset_id: int,
    payload: AssetUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update an asset."""
    result = await db.execute(select(Asset).where(Asset.id == asset_id))
    asset = result.scalar_one_or_none()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(asset, field, value)

    await db.commit()
    await db.refresh(asset)
    return asset


@router.delete("/{asset_id}", status_code=204)
async def delete_asset(asset_id: int, db: AsyncSession = Depends(get_db)):
    """
    Delete an asset.
    Blocked if any accounts are still linked to this asset.
    """
    result = await db.execute(select(Asset).where(Asset.id == asset_id))
    asset = result.scalar_one_or_none()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    # Check for linked accounts
    linked = await db.execute(
        select(Account).where(Account.asset_id == asset_id).limit(1)
    )
    if linked.scalar_one_or_none():
        raise HTTPException(
            status_code=409,
            detail="Cannot delete asset — it is linked to one or more loan accounts. Unlink them first.",
        )

    await db.delete(asset)
    await db.commit()

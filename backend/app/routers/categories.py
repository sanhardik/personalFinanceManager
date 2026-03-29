"""
Category endpoints for Personal Finance Manager.

Routes:
  GET  /categories      — List all categories (optional filter by type)
  POST /categories      — Create a new category
  GET  /categories/{id} — Get a single category
  PUT  /categories/{id} — Update a category
  DELETE /categories/{id} — Delete a category (only non-system)
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Category
from app.schemas import CategoryCreate, CategoryResponse, CategoryUpdate

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("", response_model=list[CategoryResponse])
async def list_categories(
    category_type: str | None = Query(
        default=None,
        description="Filter by type: Income or Expense",
        pattern="^(Income|Expense)$",
    ),
    db: AsyncSession = Depends(get_db),
):
    """Return all categories, optionally filtered by type."""
    stmt = select(Category).order_by(Category.category_type, Category.name)
    if category_type:
        stmt = stmt.where(Category.category_type == category_type)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("", response_model=CategoryResponse, status_code=201)
async def create_category(
    payload: CategoryCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new user-defined category."""
    # Check for duplicate name
    existing = await db.execute(
        select(Category).where(Category.name == payload.name)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Category '{payload.name}' already exists")

    category = Category(
        name=payload.name,
        category_type=payload.category_type,
        icon=payload.icon,
        colour=payload.colour,
        is_system=False,
    )
    db.add(category)
    await db.commit()
    await db.refresh(category)
    return category


@router.get("/{category_id}", response_model=CategoryResponse)
async def get_category(
    category_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Get a single category by ID."""
    result = await db.execute(
        select(Category).where(Category.id == category_id)
    )
    category = result.scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    return category


@router.put("/{category_id}", response_model=CategoryResponse)
async def update_category(
    category_id: int,
    payload: CategoryUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update an existing category."""
    result = await db.execute(
        select(Category).where(Category.id == category_id)
    )
    category = result.scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(category, field, value)

    await db.commit()
    await db.refresh(category)
    return category


@router.delete("/{category_id}", status_code=204)
async def delete_category(
    category_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Delete a category. System categories cannot be deleted."""
    result = await db.execute(
        select(Category).where(Category.id == category_id)
    )
    category = result.scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    if category.is_system:
        raise HTTPException(status_code=403, detail="Cannot delete system category")

    await db.delete(category)
    await db.commit()

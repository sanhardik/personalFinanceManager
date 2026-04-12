"""
Category endpoints for Personal Finance Manager.

Routes:
  GET    /categories      — List all categories (optional filter by type)
  POST   /categories      — Create a new category
  GET    /categories/{id} — Get a single category
  PUT    /categories/{id} — Update a category
  DELETE /categories/{id} — Delete a category (only non-system, no children)

Parent categories:
  - Any category can be a parent (parent_id=None, others reference it)
  - Max one level of nesting (children cannot have children)
  - Setting parent_id=None removes the parent relationship
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Category
from app.schemas import CategoryCreate, CategoryResponse, CategoryUpdate

router = APIRouter(prefix="/categories", tags=["categories"])


def _cat_to_response(cat: Category) -> CategoryResponse:
    """Build CategoryResponse including parent_name from loaded relationship."""
    data = CategoryResponse.model_validate(cat)
    # parent_name is not a DB column — populate from loaded relationship
    object.__setattr__(data, "parent_name", cat.parent.name if cat.parent else None)
    return data


@router.get("", response_model=list[CategoryResponse])
async def list_categories(
    category_type: str | None = Query(
        default=None,
        description="Filter by type: Income or Expense",
        pattern="^(Income|Expense)$",
    ),
    db: AsyncSession = Depends(get_db),
):
    """Return all categories with parent info, optionally filtered by type."""
    stmt = (
        select(Category)
        .options(selectinload(Category.parent))
        .order_by(Category.category_type, Category.name)
    )
    if category_type:
        stmt = stmt.where(Category.category_type == category_type)
    result = await db.execute(stmt)
    return [_cat_to_response(c) for c in result.scalars().all()]


@router.post("", response_model=CategoryResponse, status_code=201)
async def create_category(
    payload: CategoryCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new user-defined category."""
    existing = await db.execute(select(Category).where(Category.name == payload.name))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Category '{payload.name}' already exists")

    if payload.parent_id is not None:
        await _validate_parent(db, payload.parent_id, child_id=None)

    category = Category(
        name=payload.name,
        category_type=payload.category_type,
        icon=payload.icon,
        colour=payload.colour,
        parent_id=payload.parent_id,
        is_system=False,
    )
    db.add(category)
    await db.commit()
    await db.refresh(category)

    result = await db.execute(
        select(Category).options(selectinload(Category.parent)).where(Category.id == category.id)
    )
    return _cat_to_response(result.scalar_one())


@router.get("/{category_id}", response_model=CategoryResponse)
async def get_category(category_id: int, db: AsyncSession = Depends(get_db)):
    """Get a single category by ID."""
    result = await db.execute(
        select(Category).options(selectinload(Category.parent)).where(Category.id == category_id)
    )
    category = result.scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    return _cat_to_response(category)


@router.put("/{category_id}", response_model=CategoryResponse)
async def update_category(
    category_id: int,
    payload: CategoryUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update an existing category."""
    result = await db.execute(
        select(Category).options(selectinload(Category.parent)).where(Category.id == category_id)
    )
    category = result.scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    update_data = payload.model_dump(exclude_unset=True)

    if "parent_id" in update_data and update_data["parent_id"] is not None:
        await _validate_parent(db, update_data["parent_id"], child_id=category_id)

    for field, value in update_data.items():
        setattr(category, field, value)

    await db.commit()

    db.expire(category, ["parent"])
    result = await db.execute(
        select(Category).options(selectinload(Category.parent)).where(Category.id == category_id)
    )
    return _cat_to_response(result.scalar_one())


@router.delete("/{category_id}", status_code=204)
async def delete_category(category_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a category. System categories and categories with children cannot be deleted."""
    result = await db.execute(
        select(Category).options(selectinload(Category.children)).where(Category.id == category_id)
    )
    category = result.scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    if category.is_system:
        raise HTTPException(status_code=403, detail="Cannot delete system category")
    if category.children:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete '{category.name}' — it has {len(category.children)} sub-categories. Remove them first.",
        )

    await db.delete(category)
    await db.commit()


async def _validate_parent(db: AsyncSession, parent_id: int, child_id: int | None) -> Category:
    """
    Validate a parent_id assignment:
    - Parent must exist
    - Parent cannot be the category itself
    - Parent cannot already have a parent (max 1 level deep)
    """
    parent = await db.get(Category, parent_id)
    if not parent:
        raise HTTPException(status_code=404, detail="Parent category not found")
    if child_id is not None and parent_id == child_id:
        raise HTTPException(status_code=422, detail="A category cannot be its own parent")
    if parent.parent_id is not None:
        raise HTTPException(
            status_code=422,
            detail=f"'{parent.name}' already has a parent — nesting is limited to one level",
        )
    return parent

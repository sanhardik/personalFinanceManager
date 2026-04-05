"""
CSV upload endpoint.

Routes:
  POST /upload — Upload a bank CSV file, auto-detect bank, parse and store transactions
  GET  /upload/banks — List supported banks
"""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.parsers.registry import get_supported_banks
from app.schemas import UploadResponse
from app.services.upload import process_csv_upload

router = APIRouter(prefix="/upload", tags=["upload"])


@router.post("", response_model=UploadResponse)
async def upload_csv(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload a bank CSV file.

    - Auto-detects the bank from the CSV header
    - Parses all transactions
    - Creates accounts if they don't exist
    - Inserts transactions (skips duplicates via SHA256 hash)
    """
    # Validate file type
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are supported")

    # Read file content
    try:
        raw = await file.read()
        content = raw.decode("utf-8-sig")  # utf-8-sig handles BOM from Excel
    except UnicodeDecodeError:
        try:
            content = raw.decode("latin-1")
        except Exception:
            raise HTTPException(status_code=400, detail="Could not decode file. Expected UTF-8 or Latin-1 encoding.")

    if not content.strip():
        raise HTTPException(status_code=400, detail="File is empty")

    # Process the upload
    try:
        result = process_csv_upload(content, db)
        # Handle both sync and async returns
        if hasattr(result, "__await__"):
            result = await result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return UploadResponse(
        bank_name=result.bank_name,
        accounts_found=result.accounts_found,
        total_rows=result.total_rows,
        inserted=result.inserted,
        duplicates=result.duplicates,
        errors=result.errors,
    )


@router.get("/banks", response_model=list[str])
async def list_supported_banks():
    """Return list of banks with supported CSV parsers."""
    return get_supported_banks()

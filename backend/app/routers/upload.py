"""
CSV upload endpoint.

Routes:
  POST /upload       — Upload a bank CSV file; optionally specify expected bank to validate format
  GET  /upload/banks — List supported banks with format metadata
"""

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.parsers.registry import detect_parser, get_bank_info, get_supported_banks
from app.schemas import UploadResponse
from app.services.upload import process_csv_upload

router = APIRouter(prefix="/upload", tags=["upload"])


async def _read_csv(file: UploadFile) -> str:
    """Read and decode an uploaded CSV file."""
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are supported")
    try:
        raw = await file.read()
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            return raw.decode("latin-1")
        except Exception:
            raise HTTPException(
                status_code=400,
                detail="Could not decode file. Expected UTF-8 or Latin-1 encoding.",
            )


@router.post("/detect")
async def detect_csv(file: UploadFile = File(...)):
    """
    Parse a CSV without inserting — returns detected bank name and account names.
    Used by the frontend to show an account-assignment step before committing the upload.
    """
    content = await _read_csv(file)
    if not content.strip():
        raise HTTPException(status_code=400, detail="File is empty")

    first_line = content.split("\n", 1)[0].strip()
    parser = detect_parser(first_line)
    if not parser:
        raise HTTPException(
            status_code=400,
            detail=f"Unrecognised CSV format. Could not detect bank from header.",
        )

    result = parser.parse(content)
    # Collect unique accounts from parsed transactions
    seen = {}
    for tx in result.transactions:
        if tx.account_number not in seen:
            seen[tx.account_number] = {
                "account_number": tx.account_number,
                "account_name": tx.account_name or tx.account_number,
                "account_type": tx.account_type,
            }

    return {
        "bank_name": result.bank_name,
        "accounts": list(seen.values()),
        "row_count": result.row_count,
    }


@router.post("", response_model=UploadResponse)
async def upload_csv(
    file: UploadFile = File(...),
    bank: str | None = Form(None),
    account_id: int | None = Form(None),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload a bank CSV file.

    - If `bank` is provided, validates that the file matches that bank's format
    - Auto-detects the bank from the CSV header
    - Parses all transactions
    - Creates accounts if they don't exist
    - Inserts transactions (skips duplicates via SHA256 hash)
    """
    # Validate file type
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are supported")

    content = await _read_csv(file)
    if not content.strip():
        raise HTTPException(status_code=400, detail="File is empty")

    # If a bank was selected, validate the file matches that bank's format
    if bank:
        header_line = content.splitlines()[0] if content.strip() else ""
        detected = detect_parser(header_line)
        if detected is None:
            # Look up expected headers for the selected bank
            info = next((b for b in get_bank_info() if b["name"].lower() == bank.lower()), None)
            hint = (
                f" Expected columns: {', '.join(info['required_headers'])}"
                if info else ""
            )
            raise HTTPException(
                status_code=422,
                detail=f"This file does not match any known bank format.{hint}",
            )
        if detected.bank_name.lower() != bank.lower():
            info = next((b for b in get_bank_info() if b["name"].lower() == bank.lower()), None)
            hint = (
                f" Expected columns: {', '.join(info['required_headers'])}"
                if info else ""
            )
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Wrong bank format. You selected {bank} but this file looks like a "
                    f"{detected.bank_name} CSV.{hint}"
                ),
            )

    # Process the upload (with optional account_id override)
    try:
        result = process_csv_upload(content, db, account_id_override=account_id)
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


@router.get("/banks")
async def list_supported_banks():
    """Return banks with name, description, and required column headers."""
    return get_bank_info()

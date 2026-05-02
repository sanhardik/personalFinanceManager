"""
CSV upload endpoint.

Routes:
  POST /upload        — Upload a bank or brokerage CSV file
  POST /upload/detect — Parse without inserting, returns bank + accounts
  GET  /upload/banks  — List supported banks with format metadata
"""

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.parsers.registry import detect_cash_parser, detect_parser, detect_stock_parser, get_all_platform_info, get_bank_info, get_supported_banks
from app.schemas import UploadResponse
from app.services.auth import get_current_user
from app.services.upload import process_csv_upload, process_stock_csv_upload

router = APIRouter(prefix="/upload", tags=["upload"], dependencies=[Depends(get_current_user)])


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
    Parse a CSV without inserting — returns detected bank/platform name and account names.
    Tries bank parsers first, then stock/brokerage parsers.
    Used by the frontend to show an account-assignment step before committing the upload.
    """
    content = await _read_csv(file)
    if not content.strip():
        raise HTTPException(status_code=400, detail="File is empty")

    first_line = content.split("\n", 1)[0].strip()

    # Try standard bank parsers, then full-content bank parsers (Superhero Cash)
    parser = detect_parser(first_line) or detect_cash_parser(content)
    if parser:
        result = parser.parse(content)
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
            "csv_type": "bank",
        }

    # Try stock/brokerage parsers
    stock_parser = detect_stock_parser(content)
    if stock_parser:
        result = stock_parser.parse(content)
        accounts = []
        if result.account_number:
            accounts.append({
                "account_number": result.account_number,
                "account_name": result.account_name or result.entity_name or result.account_number,
                "account_type": "investment",
            })
        return {
            "bank_name": result.platform_name,
            "accounts": accounts,
            "row_count": result.row_count,
            "csv_type": "stock",
        }

    raise HTTPException(
        status_code=400,
        detail="Unrecognised CSV format. Could not detect bank or brokerage platform.",
    )


@router.post("", response_model=UploadResponse)
async def upload_csv(
    file: UploadFile = File(...),
    bank: str | None = Form(None),
    account_id: int | None = Form(None),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload a bank or brokerage CSV file.

    - Auto-detects the format (bank CSV or stock/brokerage CSV)
    - If `bank` is provided, validates that the file matches that bank's format
    - Creates accounts if they don't exist
    - Inserts transactions/trades (skips duplicates via SHA256 hash)
    """
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are supported")

    content = await _read_csv(file)
    if not content.strip():
        raise HTTPException(status_code=400, detail="File is empty")

    first_line = content.splitlines()[0] if content.strip() else ""

    # ── Try bank parsers (standard + full-content) ───────────────────────────
    bank_parser = detect_parser(first_line) or detect_cash_parser(content)
    if bank_parser:
        # If a bank was selected, validate format matches
        if bank and bank.lower() not in ("superhero", "superhero cash") and bank_parser.bank_name.lower() != bank.lower():
            info = next((b for b in get_bank_info() if b["name"].lower() == bank.lower()), None)
            hint = (
                f" Expected columns: {', '.join(info['required_headers'])}"
                if info else ""
            )
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Wrong bank format. You selected {bank} but this file looks like a "
                    f"{bank_parser.bank_name} CSV.{hint}"
                ),
            )

        try:
            result = await process_csv_upload(content, db, account_id_override=account_id)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        return UploadResponse(
            bank_name=result.bank_name,
            accounts_found=result.accounts_found,
            account_ids=result.account_ids,
            total_rows=result.total_rows,
            inserted=result.inserted,
            duplicates=result.duplicates,
            errors=result.errors,
        )

    # ── Try stock/brokerage parsers ───────────────────────────────────────────
    stock_parser = detect_stock_parser(content)
    if stock_parser:
        try:
            result = await process_stock_csv_upload(content, db, account_id_override=account_id)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        return UploadResponse(
            bank_name=result.platform_name,
            accounts_found=[result.account_number] if result.account_number else [],
            account_ids=[result.account_id] if result.account_id else [],
            total_rows=result.total_rows,
            inserted=result.inserted,
            duplicates=result.duplicates,
            errors=result.errors,
        )

    # ── No parser matched ─────────────────────────────────────────────────────
    if bank:
        info = next((b for b in get_bank_info() if b["name"].lower() == bank.lower()), None)
        hint = (
            f" Expected columns: {', '.join(info['required_headers'])}"
            if info else ""
        )
        raise HTTPException(
            status_code=422,
            detail=f"This file does not match any known bank format.{hint}",
        )

    raise HTTPException(
        status_code=400,
        detail="Unrecognised CSV format. Could not detect bank or brokerage platform from header.",
    )


@router.get("/banks")
async def list_supported_banks():
    """Return all supported platforms (banks + brokerages) with name, description, and required column headers."""
    return get_all_platform_info()

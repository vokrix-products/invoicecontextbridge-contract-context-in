"""InvoiceContextBridge extraction processor.

This module converts raw input bytes (PDF, Excel, CSV, or plain text)
into structured records for downstream matching and controller review.
"""

import csv
import io
import json
import os
import re
from datetime import datetime, date
from typing import Any, Dict, List

import openpyxl
import pdfplumber
from openai import OpenAI

# Allowed status values for the dashboard. These are the status names only;
# severity levels are stored in `details` where needed.
STATUS_SEVERITY = {
    "valid_match": "good",
    "valid_match_with_amendment_applied": "good",
    "missing_contract": "critical",
    "expired_contract": "critical",
    "missing_amendment": "warning",
    "stale_terms": "warning",
    "rate_mismatch": "critical",
    "nte_cap_exceeded": "critical",
    "cap_accumulation_unknown": "warning",
    "volume_tier_mismatch": "warning",
    "rebate_not_applied": "critical",
    "rebate_threshold_unverified": "warning",
    "sla_credit_missing": "critical",
    "sla_penalty_missing": "critical",
    "missing_po": "warning",
    "missing_receipt": "warning",
    "services_no_receipt_expected": "info",
    "duplicate_invoice": "critical",
    "duplicate_line": "warning",
    "anomaly_detected": "critical",
    "low_confidence": "warning",
    "medium_confidence": "info",
    "high_confidence": "good",
    "needs_human_review": "warning",
    "flagged_leakage": "critical",
    "already_paid_leakage_candidate": "critical",
    "draft_export_ready": "info",
    "rejected_by_controller": "info",
    "escalated": "warning",
    "approved_for_draft_export": "good",
}


def _to_iso_date(value: Any) -> str | None:
    """Convert a value to an ISO-8601 date string if possible."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()

    text = str(value).strip()
    if not text:
        return None

    # Try ISO format first
    try:
        return datetime.fromisoformat(text).date().isoformat()
    except Exception:
        pass

    # Common alternate formats
    for fmt in ("%Y/%m/%d", "%m/%d/%Y", "%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except Exception:
            continue
    return None


def _make_record(
    title: Any,
    details: Dict[str, Any],
    status: str = "needs_human_review",
    due_date: Any = None,
) -> Dict[str, Any]:
    """Create a record matching the required top-level key shape."""
    if status not in STATUS_SEVERITY:
        status = "needs_human_review"

    return {
        "title": str(title) if title else "Untitled",
        "status": status,
        "details": details,
        "due_date": _to_iso_date(due_date),
    }


def _extract_pdf(file_bytes: bytes) -> str:
    """Extract text from PDF bytes using pdfplumber."""
    try:
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            pages = []
            for page in pdf.pages:
                pages.append(page.extract_text() or "")
            return "\n".join(pages)
    except Exception:
        return ""


def _extract_excel(file_bytes: bytes) -> List[Dict[str, Any]]:
    """Extract records from Excel workbook bytes using openpyxl."""
    try:
        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
    except Exception:
        return []

    records: List[Dict[str, Any]] = []
    for ws in wb.worksheets:
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            continue

        headers = []
        for cell in rows[0]:
            if cell is None:
                headers.append("")
            else:
                headers.append(str(cell).strip())

        for row in rows[1:]:
            if not any(row):
                continue

            data: Dict[str, Any] = {}
            for idx, val in enumerate(row):
                if idx < len(headers) and headers[idx]:
                    data[headers[idx]] = val
                elif val is not None:
                    data[f"column_{idx}"] = val

            # Remove empty keys/values
            data = {k: v for k, v in data.items() if k and v is not None}
            if not data:
                continue

            title = _row_title(data)
            details = dict(data)
            details["source_file_type"] = "excel"
            status = _row_status(data)
            due_date = _row_due_date(data)

            records.append(_make_record(title, details, status, due_date))

    return records


def _row_title(row: Dict[str, Any]) -> str:
    """Extract the primary tracked entity from a row."""
    entity_keys = (
        "vendor_name",
        "supplier",
        "contract_title",
        "employee_name",
        "patient_name",
        "counterparty",
        "company_name",
        "customer_name",
        "contract_party",
    )
    for key in entity_keys:
        if key in row and row[key]:
            return str(row[key])

    document_keys = ("invoice_number", "contract_id", "invoice_id", "po_number")
    for key in document_keys:
        if key in row and row[key]:
            return str(row[key])

    for val in row.values():
        if val is not None and str(val).strip():
            return str(val)
    return "Untitled"


def _row_status(row: Dict[str, Any]) -> str:
    """Assign a simple dashboard status based on available fields."""
    row_keys = set(row.keys())

    has_invoice = "invoice_number" in row_keys or "invoice_id" in row_keys
    has_entity = any(
        key in row and row[key]
        for key in (
            "vendor_name",
            "supplier",
            "contract_title",
            "employee_name",
            "patient_name",
            "counterparty",
        )
    )

    if has_invoice:
        if has_entity:
            return "valid_match"
        return "missing_contract"

    has_contract = any(
        key in row and row[key]
        for key in ("contract_id", "contract_title", "vendor_name", "supplier")
    )
    if has_contract:
        return "valid_match"

    return "needs_human_review"


def _row_due_date(row: Dict[str, Any]) -> str | None:
    """Find first parseable due date in a row."""
    for key in (
        "due_date",
        "invoice_due_date",
        "contract_end_date",
        "renewal_date",
        "payment_due_date",
    ):
        if key in row:
            iso = _to_iso_date(row[key])
            if iso:
                return iso
    return None


def _is_table(text: str) -> bool:
    """Return True if text looks like a delimited table with multiple rows."""
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if len(lines) < 2:
        return False

    first, second = lines[0], lines[1]
    for delim in (",", "\t", ";", "|"):
        if delim in first and delim in second:
            return True
    return False


def _parse_csv_text(text: str) -> List[Dict[str, Any]]:
    """Parse delimited text/CSV into records."""
    sample = text[:2048]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",\t;|")
    except csv.Error:
        dialect = csv.excel

    f = io.StringIO(text)
    reader = csv.DictReader(f, dialect=dialect)
    if not reader.fieldnames:
        return []

    records: List[Dict[str, Any]] = []
    for row in reader:
        row = {k: v for k, v in row.items() if k is not None}
        if not any(v for v in row.values()):
            continue

        title = _row_title(row)
        details = dict(row)
        details["source_file_type"] = "csv"
        status = _row_status(row)
        due_date = _row_due_date(row)

        records.append(_make_record(title, details, status, due_date))

    return records


def _extract_entity_name(text: str) -> str | None:
    """Extract vendor/supplier/entity name from plain text."""
    patterns = [
        r"(?:vendor|supplier|contract party|employee|patient|customer|company)\s*[:：#]\s*([^\n\r,]+)",
        r"(?:from|to)\s+([A-Z][A-Za-z0-9&\. ]+?)\s*(?:\n|$)",
    ]
    for pattern in patterns:
        m = re.search(pattern, text, re.I)
        if m:
            return m.group(1).strip(" :;")

    for line in text.splitlines():
        line = line.strip()
        if line:
            return line[:120]
    return None


def _deepseek_extract(text: str) -> Dict[str, Any] | None:
    """Optional DeepSeek extraction helper.

    Not called by process_file in this phase, but retained for future use.
    The instantiation pattern follows the required exact format.
    """
    if "DEEPSEEK_API_KEY" not in os.environ:
        return None

    try:
        client = OpenAI(
            api_key=os.environ["DEEPSEEK_API_KEY"],
            base_url="https://api.deepseek.com",
        )
        messages = [
            {
                "role": "system",
                "content": (
                    "You extract structured AP invoice/contract fields as JSON. "
                    "The title field must be the primary entity the buyer tracks "
                    "(vendor name, employee name, contract party, patient name, etc.) "
                    "— never a document type or category."
                ),
            },
            {"role": "user", "content": text[:6000]},
        ]
        response = client.chat.completions.create(
            model="deepseek-v4-flash",
            messages=messages,
            temperature=0,
        )
        content = response.choices[0].message.content
        return json.loads(content) if content else None
    except Exception:
        return None


def _process_text(text: str) -> List[Dict[str, Any]]:
    """Process plain text / CSV text into records."""
    text = text.strip()
    if not text:
        return []

    if _is_table(text):
        try:
            records = _parse_csv_text(text)
            if records:
                return records
        except Exception:
            pass

    title = _extract_entity_name(text) or "Unnamed document"
    details: Dict[str, Any] = {
        "source_text": text[:5000],
        "source_file_type": "text",
    }
    return [_make_record(title, details, status="needs_human_review")]


def process_file(file_bytes: bytes) -> list[dict]:
    """Extract records from file bytes.

    Tries PDF first, then Excel, then UTF-8 text/CSV.
    Always returns a list of record dicts with keys:
        title, status, details, due_date
    """
    if not isinstance(file_bytes, bytes):
        raise TypeError("file_bytes must be bytes")

    # PDF
    pdf_text = _extract_pdf(file_bytes)
    if pdf_text.strip():
        return _process_text(pdf_text)

    # Excel
    excel_records = _extract_excel(file_bytes)
    if excel_records:
        return excel_records

    # UTF-8 text / CSV fallback
    try:
        text = file_bytes.decode("utf-8", errors="ignore")
    except Exception:
        text = ""
    return _process_text(text)

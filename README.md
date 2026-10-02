# InvoiceContextBridge

Contract-context invoice reconciliation for Accounts Payable (AP).

InvoiceContextBridge ingests supplier invoices and the contracts, amendments,
POs, receipts, and service records that surround them, and produces a
draft-only reconciliation layer for controller review. It never writes back
to an ERP. Every record is surfaced for a human controller to approve,
reject, or escalate.

## Archetype

This product is a **contract-context invoice reconciliation bridge** for AP
teams. The core value is matching each invoice line against the governing
contract terms (rates, NTE caps, volume tiers, rebates, SLA credits) and
flagging leakage, mismatches, and missing context before payment.

## What the poller expects as input

The poller reads new files as raw bytes and hands them to
`processor.process_file(file_bytes: bytes) -> list[dict]`. Supported inputs:

- **PDF** (parsed with `pdfplumber`)
- **Excel** (`.xlsx`, parsed with `openpyxl`)
- **CSV / delimited text**
- **Plain text** (UTF-8)

Each returned record has these top-level keys:

- `title` — the primary tracked entity (vendor name, supplier, employee
  name, patient name, contract party, etc.). Never a document type.
- `status` — one of the allowed dashboard statuses defined in
  `processor.STATUS_SEVERITY`.
- `details` — a dict of extracted fields plus `source_file_type`.
- `due_date` — an ISO-8601 date string or `null`.

## Files

- `processor.py` — core extraction: `process_file(file_bytes: bytes) -> list[dict]`
- `run_demo.py` — zero-arg demo with hardcoded CSV data, exits 0
- `run_tests.py` — unit tests for `process_file`
- `requirements.txt` — Python dependencies

## Usage

```bash
pip install -r requirements.txt
python3 run_demo.py
python3 run_tests.py
```

`process_file` tries PDF extraction first, then Excel, then UTF-8 text/CSV.
The allowed statuses (with severity) live in `processor.STATUS_SEVERITY`.
Dashboard: https://invoicecontextbridge-contract-context-in.vokrix.co
Vercel: invoicecontextbridge-contract-context-in
Railway: invoicecontextbridge-contract-context-in
Cloudflare: invoicecontextbridge-contract-context-in.vokrix.co

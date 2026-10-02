"""Run a quick demo of processor.process_file with hardcoded CSV data."""

from processor import process_file


def main() -> int:
    test_bytes = b"supplier,product,price\nAcme,Widget,9.99\n"
    results = process_file(test_bytes)

    print(f"Extracted {len(results)} record(s)")
    for record in results:
        print(f"Title: {record['title']}")
        print(f"Status: {record['status']}")
        print(f"Due: {record['due_date']}")
        print(f"Details: {record['details']}")

    assert isinstance(results, list)
    assert len(results) > 0
    assert results[0]["title"] == "Acme"
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

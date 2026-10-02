"""Basic unit tests for InvoiceContextBridge processor."""

import unittest

from processor import process_file, STATUS_SEVERITY


class ProcessorTests(unittest.TestCase):
    def test_csv_bytes_returns_list(self):
        data = b"supplier,product,price\nAcme,Widget,9.99\n"
        results = process_file(data)

        self.assertIsInstance(results, list)
        self.assertTrue(len(results) >= 1)
        self.assertIn("title", results[0])
        self.assertIn("status", results[0])
        self.assertIn("details", results[0])
        self.assertIn("due_date", results[0])

    def test_text_fallback(self):
        data = b"Vendor: Acme Corp\nInvoice: 123\nDue: 2025-01-31\n"
        results = process_file(data)

        self.assertIsInstance(results, list)
        self.assertTrue(len(results) >= 1)
        self.assertEqual(results[0]["title"], "Acme Corp")

    def test_empty_bytes(self):
        results = process_file(b"")
        self.assertIsInstance(results, list)
        self.assertEqual(results, [])

    def test_status_allowed(self):
        data = b"supplier,product,price\nAcme,Widget,9.99\n"
        results = process_file(data)

        self.assertTrue(len(results) >= 1)
        self.assertIn(results[0]["status"], STATUS_SEVERITY)


if __name__ == "__main__":
    unittest.main()

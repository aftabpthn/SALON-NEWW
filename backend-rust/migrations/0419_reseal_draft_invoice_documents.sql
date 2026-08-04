-- Drops invoice PDF snapshots that were sealed before the invoice existed.
--
-- pos_invoice_documents is the permanent record of what a guest was handed, and
-- ON CONFLICT DO NOTHING makes the first write win forever. That was correct.
-- What was wrong is when the first write happened: the snapshot was taken by
-- whoever first downloaded a PDF, and nothing checked whether the sale had been
-- finalized. Download a draft and the draft was sealed — so after finalize, the
-- invoice kept handing back a PDF of a bill that was still being edited, with
-- the wrong totals and the wrong payments on it.
--
-- The application now seals at finalize and refuses to seal a draft at all.
-- This clears the rows that were sealed under the old rule so they can be taken
-- again from the finalized invoice.
--
-- Two cases, and both are identified precisely rather than guessed at:

-- 1. The sale was never finalized. There is nothing legitimate to preserve;
--    a draft has no permanent form yet.
DELETE FROM pos_invoice_documents document
 USING pos_sales sale
 WHERE sale.id = document.sale_id
   AND sale.finalized_at IS NULL;

-- 2. The snapshot predates the finalize, so it captured the draft. Anything
--    sealed at or after finalize is a genuine record and is left alone —
--    including every snapshot taken from here on, since the seal now runs
--    immediately after the finalize commits.
DELETE FROM pos_invoice_documents document
 USING pos_sales sale
 WHERE sale.id = document.sale_id
   AND sale.finalized_at IS NOT NULL
   AND document.created_at < sale.finalized_at;

-- Deleted rather than re-rendered here because rendering needs the application:
-- the PDF layout, the business profile and the GST context all live in Rust,
-- not in SQL. The next download re-seals from the finalized invoice, which is
-- the correct source.

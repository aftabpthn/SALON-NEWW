ALTER TABLE purchase_bill_matches
    DROP CONSTRAINT purchase_bill_matches_status_check,
    ADD CONSTRAINT purchase_bill_matches_status_check
        CHECK (status IN (
            'suggested',
            'fuzzy',
            'exact',
            'learned',
            'accepted',
            'rejected',
            'confirmed'
        ));

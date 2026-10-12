ALTER TABLE journal_entries
    ADD COLUMN IF NOT EXISTS reversal_of_entry_id VARCHAR(36) NULL AFTER reference_id;

UPDATE journal_entries
SET reversal_of_entry_id = reference_id
WHERE reference_type = 'reversal'
  AND reference_id IS NOT NULL
  AND reversal_of_entry_id IS NULL;

ALTER TABLE journal_entries
    ADD UNIQUE KEY uq_journal_entry_single_reversal (reversal_of_entry_id);

ALTER TABLE journal_entries
    ADD CONSTRAINT fk_journal_entry_reversal_original
    FOREIGN KEY (reversal_of_entry_id) REFERENCES journal_entries(id)
    ON DELETE RESTRICT;

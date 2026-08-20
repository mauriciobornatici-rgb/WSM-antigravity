CREATE TRIGGER trg_journal_entries_no_update
BEFORE UPDATE ON journal_entries
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Journal entries are immutable; create a reversal instead';

CREATE TRIGGER trg_journal_entries_no_delete
BEFORE DELETE ON journal_entries
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Journal entries cannot be deleted';

CREATE TRIGGER trg_journal_entry_lines_no_update
BEFORE UPDATE ON journal_entry_lines
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Journal entry lines are immutable';

CREATE TRIGGER trg_journal_entry_lines_no_delete
BEFORE DELETE ON journal_entry_lines
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Journal entry lines cannot be deleted';

CREATE TRIGGER trg_audit_logs_no_update
BEFORE UPDATE ON audit_logs
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit logs are immutable';

CREATE TRIGGER trg_audit_logs_no_delete
BEFORE DELETE ON audit_logs
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit logs cannot be deleted';

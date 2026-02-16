CREATE VIRTUAL TABLE IF NOT EXISTS `messages_fts` USING fts5(
  `search_text`,
  content='messages',
  content_rowid='rowid',
  tokenize='unicode61'
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `messages_fts_ai` AFTER INSERT ON `messages` BEGIN
  INSERT INTO messages_fts(rowid, search_text)
  VALUES (new.rowid, new.search_text);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `messages_fts_ad` AFTER DELETE ON `messages` BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, search_text)
  VALUES ('delete', old.rowid, old.search_text);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `messages_fts_au` AFTER UPDATE OF `search_text` ON `messages` BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, search_text)
  VALUES ('delete', old.rowid, old.search_text);
  INSERT INTO messages_fts(rowid, search_text)
  VALUES (new.rowid, new.search_text);
END;
--> statement-breakpoint
INSERT INTO messages_fts(rowid, search_text)
SELECT rowid, search_text FROM messages;

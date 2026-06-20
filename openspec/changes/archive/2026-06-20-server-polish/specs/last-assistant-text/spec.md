## ADDED Requirements

### Requirement: Last assistant text retrieval
The system SHALL expose `GET /api/sessions/:id/last-assistant-text` returning the text content of the most recent assistant message in the session. The response SHALL be `{ text: string | null }`. Unknown sessions SHALL return HTTP 404.

#### Scenario: Last assistant message exists
- **WHEN** `GET /api/sessions/:id/last-assistant-text` is called for a session with at least one assistant message
- **THEN** the response status is 200 and `text` contains the text of the most recent assistant message

#### Scenario: No assistant messages
- **WHEN** `GET /api/sessions/:id/last-assistant-text` is called for a session with no assistant messages
- **THEN** the response status is 200 and `text` is `null`

#### Scenario: Unknown session
- **WHEN** `GET /api/sessions/nope/last-assistant-text` is called
- **THEN** the response status is 404

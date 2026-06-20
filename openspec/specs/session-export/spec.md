## Purpose

Session HTML export for viewing conversation history in a browser.

## Requirements

### Requirement: Session HTML export
The system SHALL expose `GET /api/sessions/:id/export-html` returning a self-contained HTML document representing the session's conversation history. The HTML SHALL include inline CSS and SHALL NOT reference external resources. Unknown sessions SHALL return HTTP 404.

#### Scenario: Export a session with messages
- **WHEN** `GET /api/sessions/:id/export-html` is called for a session with 5 messages
- **THEN** the response status is 200 and the Content-Type is `text/html`
- **AND** the body is an HTML document containing all 5 messages rendered as chat bubbles

#### Scenario: Export unknown session
- **WHEN** `GET /api/sessions/nope/export-html` is called
- **THEN** the response status is 404

#### Scenario: Export an empty session
- **WHEN** `GET /api/sessions/:id/export-html` is called for a session with no messages
- **THEN** the response status is 200 and the HTML shows an empty conversation with the session title

### Requirement: Export HTML template structure
The exported HTML SHALL include:
- Document title set to the session title (or "Session Export" if untitled)
- A header with the session title, project name, and creation date
- Messages rendered in chronological order with role-colored styling (user on right, assistant on left)
- Tool result messages collapsed by default with an expandable toggle
- Timestamps for each message in a human-readable format
- Responsive design that works on mobile and desktop
- A "Copy" button on each assistant message that copies the message text to clipboard

#### Scenario: All message types rendered correctly
- **WHEN** the session contains user, assistant, and tool messages
- **THEN** user messages are styled in one color, assistant messages in another, and tool messages are collapsed by default

#### Scenario: Copy button copies assistant text
- **WHEN** the "Copy" button on an assistant message is clicked
- **THEN** the message text is copied to the clipboard (via `navigator.clipboard` in the browser)

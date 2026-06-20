## ADDED Requirements

### Requirement: Dedicated session naming endpoint
The system SHALL expose `PATCH /api/sessions/:id/name` accepting a body `{ title: string }`. This endpoint SHALL update only the session's `title` field and return the updated session object. Unknown sessions SHALL return HTTP 404.

#### Scenario: Set session name
- **WHEN** `PATCH /api/sessions/:id/name` is called with `{ title: "My Session" }` for a valid session
- **THEN** the response status is 200 and the body contains the session with `title: "My Session"`

#### Scenario: Set name on unknown session
- **WHEN** `PATCH /api/sessions/nope/name` is called
- **THEN** the response status is 404

#### Scenario: Empty title clears the name
- **WHEN** `PATCH /api/sessions/:id/name` is called with `{ title: "" }`
- **THEN** the session's `title` is set to null

/**
 * Spec Templates - Create initial spec files
 *
 * Phase 1 - Spec System
 * Creates template files for new specs:
 * - spec.json - Spec metadata and state
 * - requirements.md - Acceptance criteria (R-###)
 * - design.md - Architecture decisions
 * - tasks.md - Implementation tasks (T-###)
 * - correctness.md - Property-based tests (P-###)
 */

import { promises as fs } from "fs";
import path from "path";
import { writeSpecState } from "./state";

const REQUIREMENTS_TEMPLATE = `# Requirements: {{slug}}

{{description}}

## Acceptance Criteria

### R-001
**When** a user visits the login page, **then** they should see email and password fields, **and** a submit button.

### R-002
**When** a user submits valid credentials, **then** they should be authenticated, **and** redirected to the dashboard.

### R-003
**When** a user submits invalid credentials, **then** they should see an error message, **and** remain on the login page.

## Non-Goals

- Social login (Google, GitHub, etc.)
- Password reset functionality
- Two-factor authentication
`;

const DESIGN_TEMPLATE = `# Design: {{slug}}

{{description}}

## Architecture

## Data Models

## API Endpoints

## User Flows

### Happy Path

### Error Handling

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| | |
`;

const TASKS_TEMPLATE = `# Tasks: {{slug}}

{{description}}

## Implementation Tasks

### T-001 — Implement login page
**Maps to requirements:** R-001, R-002, R-003

**Outcome:** User can log in with email/password

- [ ] Create login form component
- [ ] Add validation for email format
- [ ] Add validation for password presence
- [ ] Connect to authentication API

**Dependencies:**

### T-002 — Implement authentication API
**Maps to requirements:** R-002

**Outcome:** API endpoint validates credentials

- [ ] Create POST /auth/login endpoint
- [ ] Validate credentials against database
- [ ] Return JWT token on success
- [ ] Return 401 on failure

**Dependencies:** 

### T-003 — Add session management
**Maps to requirements:** R-002

**Outcome:** User session persists across requests

- [ ] Store JWT in httpOnly cookie
- [ ] Implement token refresh
- [ ] Add logout endpoint

**Dependencies:** T-002
`;

const CORRECTNESS_TEMPLATE = `# Correctness: {{slug}}

{{description}}

## Property-Based Tests

### P-001
**Property:** Login with valid credentials always succeeds

### P-002  
**Property:** Login with invalid credentials always fails

### P-003
**Property:** Authenticated requests include valid token

## Edge Cases

- Empty credentials
- Malformed email
- Expired token
- Concurrent login attempts
`;

/**
 * Write spec template files to a directory
 */
export async function writeSpecTemplate(
  specDir: string,
  slug: string,
  description: string
): Promise<void> {
  await fs.mkdir(specDir, { recursive: true });

  const replacements = {
    slug,
    description,
  };

  function replace(template: string): string {
    return template
      .replace(/\{\{slug\}\}/g, replacements.slug)
      .replace(/\{\{description\}\}/g, replacements.description);
  }

  const specJsonPath = path.join(specDir, "spec.json");
  await writeSpecState(specJsonPath, {
    feature_name: slug,
    phase: "init",
    approvals: {
      requirements: { generated: false, approved: false },
      design: { generated: false, approved: false },
      tasks: { generated: false, approved: false },
    },
    ready_for_implementation: false,
    language: "en",
  });

  await fs.writeFile(path.join(specDir, "requirements.md"), replace(REQUIREMENTS_TEMPLATE));
  await fs.writeFile(path.join(specDir, "design.md"), replace(DESIGN_TEMPLATE));
  await fs.writeFile(path.join(specDir, "tasks.md"), replace(TASKS_TEMPLATE));
  await fs.writeFile(path.join(specDir, "correctness.md"), replace(CORRECTNESS_TEMPLATE));
}

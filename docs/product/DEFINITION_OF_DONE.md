# LiTTree Definition of Done

> **Quality contract.** Every product feature must pass this before being
> called complete. A build passing TypeScript alone does not make a feature
> complete. This is a target standard — not all current code meets it yet.

## Status legend

| Label | Meaning |
|---|---|
| IMPLEMENTED | Verified in current production code |
| PARTIAL | Infrastructure exists, but the journey is incomplete |
| PLANNED | Approved product direction, not yet implemented |
| LATER | Intentionally outside the near-term release |

---

## The contract

| Area          | Requirement                                                                    | Status |
| ------------- | ------------------------------------------------------------------------------ | ------ |
| Functionality | Complete user outcome works end-to-end                                         | PARTIAL |
| Persistence   | Survives refresh, logout, and return                                           | PARTIAL |
| Security      | Ownership and permissions enforced server-side                                 | PARTIAL |
| Truth         | No fake state, invented activity, or false success                             | PARTIAL |
| Control       | User can stop, approve, reject, or undo                                        | PARTIAL |
| Recovery      | Failure gives a safe, clear next step                                          | PARTIAL |
| Mobile        | Core journey works at 360px width                                              | PARTIAL |
| Accessibility | Keyboard, screen-reader labels, contrast, and reduced motion                   | PARTIAL |
| Performance   | Meets established performance budget                                           | PARTIAL |
| Analytics     | Start, success, and failure are measured                                       | PLANNED |
| Testing       | Unit, integration, and browser tests exist                                     | PARTIAL |
| Operations    | Logs and audit records exist                                                   | PARTIAL |
| Rollback      | Release can be disabled or reverted via feature flag or deployment rollback    | PARTIAL |

## Detailed requirements

### Functionality

- The complete user outcome works, not just the happy path
- Edge cases are handled (empty state, error state, loading state)
- The feature connects to real backend systems, not mock data in production
- The user can complete the full loop: start → progress → result → next action

### Persistence

- Work survives page refresh
- Work survives logout and login
- Work survives session timeout
- Work is stored server-side, not only in local state
- Optimistic UI updates are reconciled with server state

### Security

- Ownership is enforced server-side (user A cannot access user B's project)
- Permissions are checked on every API call, not just the frontend
- Sensitive actions require explicit server-validated approval
- No secrets are exposed to the client
- No user input is trusted without validation

### Truth

- No fake "success" status when work has not actually completed
- No invented activity indicators (e.g., fake progress bars)
- No placeholder content presented as real content
- No fake metrics, testimonials, or user counts
- Status reflects actual server state, not frontend assumptions

### Control

- User can stop a running task
- User can approve or reject sensitive actions
- User can undo via checkpoint rollback
- User can cancel a mission before or during execution
- User can delete their data
- Stop actually stops the work, not just the UI

### Recovery

- Failures show what failed, not just "something went wrong"
- Failures show what was preserved
- Failures show whether credits were consumed
- Failures show whether a retry is safe
- Failures suggest a corrective action
- Technical details are available behind an expandable control
- Network errors offer a retry button
- Server errors explain the issue in plain language

### Mobile

- Core workflow works at 360px width
- Touch targets are at least 44px
- No horizontal overflow
- Mobile keyboard-safe layouts (inputs not hidden by keyboard)
- No important action available only through hover
- Responsive images and media

### Accessibility

- Keyboard navigation works for all interactive elements
- Screen-reader labels (aria-label, aria-describedby) on all controls
- Strong color contrast (WCAG AA minimum)
- Reduced-motion mode respected (prefers-reduced-motion)
- Captions for product videos
- Clear focus states
- Plain-language error messages
- No information conveyed only by color

### Performance

- Initial page load meets performance budget (LCP < 2.5s on 4G)
- Interactive actions respond within 100ms or show honest progress
- No blocking API calls on the critical render path
- Images are optimized and lazy-loaded
- No unnecessary re-renders in React

### Analytics

- Start event is fired when the user begins the flow
- Success event is fired when the user completes the flow
- Failure event is fired when the flow fails
- Cancelled event is fired when the user cancels
- Abandoned event is fired when the user leaves mid-flow
- Retried event is fired when the user retries after failure
- Events include relevant context (project ID, mission ID, etc.)
- Events do not include PII or secrets

### Testing

- Unit tests for business logic
- Integration tests for API routes
- Browser tests (Playwright) for user-facing flows
- Tests cover happy path and at least one error path
- Tests run in CI
- Tests are not skipped or marked as TODO

### Operations

- Server logs include relevant context (user ID, project ID, mission ID)
- Audit records exist for sensitive actions (approval, deletion, deployment)
- Error logs are structured and searchable
- No secrets in logs
- Logs are retained per the data retention policy

### Rollback

- Feature is behind a feature flag (for large features)
- Feature can be disabled without redeployment (if flag-controlled)
- Database migrations are reversible
- Deployment can be rolled back via Vercel
- Checkpoint rollback works for user-facing data changes

## Product acceptance scorecard

Do not call a feature complete until it passes:

| Area          | Required result                                           |
| ------------- | --------------------------------------------------------- |
| Clarity       | A new user understands it without explanation             |
| Speed         | Important actions respond quickly or show honest progress |
| Truth         | No invented statuses, activity, or results                |
| Control       | User can stop, approve, reject, or undo                   |
| Continuity    | Work survives refresh, logout, and return                 |
| Recovery      | Failures provide a clear next step                        |
| Mobile        | Core workflow works on a phone                            |
| Accessibility | Keyboard and screen-reader basics work                    |
| Trust         | Permissions and costs are visible                         |
| Value         | The feature creates a meaningful result                   |

## The most important rule

> **Every screen should help the user understand, create, decide, finish, or
> continue.** Anything that does none of those should be removed, hidden, or
> postponed.

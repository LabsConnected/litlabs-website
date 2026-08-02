# LiTTree Analytics Events

> **Product direction document.** Defines the target analytics event
> taxonomy. Most events are PLANNED — the analytics infrastructure does not
> exist yet. These are the events to instrument as features ship.

## Status legend

| Label | Meaning |
|---|---|
| IMPLEMENTED | Verified in current production code |
| PARTIAL | Infrastructure exists, but the journey is incomplete |
| PLANNED | Approved product direction, not yet implemented |
| LATER | Intentionally outside the near-term release |

---

## Current state — PLANNED

No analytics event system is currently implemented. The events below define
the target taxonomy. As each feature ships, instrument the corresponding
events.

## The core funnel

```
homepage_viewed              — PLANNED
   ↓
primary_cta_clicked          — PLANNED
   ↓
signup_started               — PLANNED
   ↓
signup_completed             — PLANNED
   ↓
onboarding_goal_selected     — PLANNED
   ↓
project_created              — PARTIAL (project creation exists, event not fired)
   ↓
first_mission_started        — PARTIAL (mission creation exists, event not fired)
   ↓
plan_approved                — PARTIAL (approval API exists, event not fired)
   ↓
first_result_created         — PLANNED
   ↓
result_reviewed              — PLANNED
   ↓
project_resumed              — PLANNED
   ↓
creation_published           — PLANNED
   ↓
creation_remixed             — PLANNED
   ↓
marketplace_opened           — PLANNED
   ↓
agent_installed              — PARTIAL (install flow exists, event not fired)
   ↓
agent_first_result           — PLANNED
```

## Event specifications

### Homepage and acquisition

#### `homepage_viewed` — PLANNED
- Triggered when the homepage finishes loading
- Properties: `referrer`, `landing_variant`, `device_type`, `anonymous_user_id`

#### `primary_cta_clicked` — PLANNED
- Triggered when the user clicks the primary CTA on the homepage
- Properties: `cta_text`, `cta_location`, `destination_route`, `anonymous_user_id`

#### `signup_started` — PLANNED
- Triggered when the user lands on the sign-up page
- Properties: `referrer`, `entry_path` (idea | existing_project | demo | direct)

#### `signup_completed` — PLANNED
- Triggered when the user successfully creates an account
- Properties: `user_id`, `method` (email | google | github), `time_to_complete_ms`

### Onboarding

#### `onboarding_goal_selected` — PLANNED
- Triggered when the user selects a goal during onboarding
- Properties: `user_id`, `goal` (build_website | create_brand | make_music | build_app | plan_campaign | connect_project | explore_demo | surprise_me)

#### `onboarding_path_selected` — PLANNED
- Triggered when the user selects an entry path
- Properties: `user_id`, `path` (start_with_idea | bring_existing | explore_demo)

#### `onboarding_completed` — PLANNED
- Triggered when the user finishes onboarding and enters Studio
- Properties: `user_id`, `time_to_complete_ms`, `goal`, `path`

#### `onboarding_abandoned` — PLANNED
- Triggered when the user leaves during onboarding
- Properties: `user_id`, `step`, `time_on_step_ms`

### Project lifecycle

#### `project_created` — PARTIAL
- Triggered when a project is successfully created
- Properties: `user_id`, `project_id`, `source_type` (managed | github | git_url | upload | website_import), `goal`, `template`
- Current state: project creation API exists, event not fired

#### `project_opened` — PLANNED
- Properties: `user_id`, `project_id`, `source` (dashboard | direct_link | notification | remix)

#### `project_resumed` — PLANNED
- Properties: `user_id`, `project_id`, `time_since_last_session_ms`, `last_mission_id`

#### `project_archived` — PLANNED
- Properties: `user_id`, `project_id`

#### `project_deleted` — PLANNED
- Properties: `user_id`, `project_id`

#### `project_exported` — PLANNED
- Properties: `user_id`, `project_id`, `export_format` (github | zip | files)

### Mission lifecycle

#### `mission_started` — PARTIAL
- Properties: `user_id`, `project_id`, `mission_id`, `goal`, `source`
- Current state: mission creation API exists, event not fired

#### `plan_presented` — PLANNED
- Properties: `user_id`, `project_id`, `mission_id`, `step_count`, `estimated_credits`

#### `plan_approved` — PARTIAL
- Properties: `user_id`, `project_id`, `mission_id`, `time_to_approve_ms`
- Current state: approval resolve API exists, event not fired

#### `plan_rejected` — PARTIAL
- Properties: `user_id`, `project_id`, `mission_id`, `rejection_reason`

#### `plan_modified` — PLANNED
- Properties: `user_id`, `project_id`, `mission_id`

#### `mission_step_completed` — PARTIAL
- Properties: `user_id`, `project_id`, `mission_id`, `step_index`, `step_label`
- Current state: step status tracked server-side, event not fired

#### `mission_completed` — PARTIAL
- Properties: `user_id`, `project_id`, `mission_id`, `duration_ms`, `credits_used`, `artifacts_count`

#### `mission_failed` — PARTIAL
- Properties: `user_id`, `project_id`, `mission_id`, `failure_reason`, `credits_consumed`, `retry_safe`

#### `mission_cancelled` — PARTIAL
- Properties: `user_id`, `project_id`, `mission_id`, `cancel_stage`

#### `mission_rolled_back` — PLANNED
- Properties: `user_id`, `project_id`, `mission_id`, `checkpoint_id`

### Approval

#### `approval_requested` — PARTIAL
- Properties: `user_id`, `project_id`, `mission_id`, `approval_id`, `action_type`
- Current state: approvals created server-side, event not fired

#### `approval_approved` — PARTIAL
- Properties: `user_id`, `project_id`, `approval_id`, `time_to_approve_ms`

#### `approval_rejected` — PARTIAL
- Properties: `user_id`, `project_id`, `approval_id`, `rejection_reason`

### Results

#### `first_result_created` — PLANNED
- Properties: `user_id`, `project_id`, `mission_id`, `artifact_type`, `time_to_first_result_ms`

#### `result_reviewed` — PLANNED
- Properties: `user_id`, `project_id`, `mission_id`, `artifact_id`, `artifact_type`

#### `result_downloaded` — PLANNED
- Properties: `user_id`, `project_id`, `artifact_id`, `artifact_type`, `format`

#### `result_published` — PLANNED
- Properties: `user_id`, `project_id`, `artifact_id`, `visibility`

### Checkpoint

#### `checkpoint_created` — PARTIAL
- Properties: `user_id`, `project_id`, `mission_id`, `checkpoint_id`, `trigger`
- Current state: checkpoint table exists, auto-create PLANNED

#### `checkpoint_restored` — PLANNED
- Properties: `user_id`, `project_id`, `checkpoint_id`, `missions_affected`

### Community

#### `creation_viewed` — PLANNED
- Properties: `viewer_user_id`, `creation_id`, `creator_id`, `referrer`

#### `creation_appreciated` — PLANNED
- Properties: `user_id`, `creation_id`

#### `creation_remixed` — PLANNED
- Properties: `user_id`, `creation_id`, `new_project_id`

#### `creation_commented` — PLANNED
- Properties: `user_id`, `creation_id`, `comment_length`

#### `creation_reported` — PLANNED
- Properties: `reporter_user_id`, `creation_id`, `reason`

### Marketplace

#### `marketplace_opened` — PLANNED
- Properties: `user_id`, `entry_point`

#### `agent_viewed` — PLANNED
- Properties: `user_id`, `agent_id`, `agent_slug`

#### `agent_purchased` — PARTIAL
- Properties: `user_id`, `agent_id`, `price`, `currency`, `payment_method`
- Current state: Stripe integration exists, event not fired

#### `agent_installed` — PARTIAL
- Properties: `user_id`, `agent_id`, `project_id`
- Current state: install flow exists, event not fired

#### `agent_first_result` — PLANNED
- Properties: `user_id`, `agent_id`, `project_id`, `mission_id`, `time_to_result_ms`

#### `agent_uninstalled` — PLANNED
- Properties: `user_id`, `agent_id`, `reason`

### Credits and payments

#### `credits_consumed` — PARTIAL
- Properties: `user_id`, `amount`, `action_type`, `project_id`, `mission_id`
- Current state: credit_ledger table exists, event not fired

#### `credits_purchased` — PARTIAL
- Properties: `user_id`, `amount`, `price`, `currency`

#### `subscription_started` — PARTIAL
- Properties: `user_id`, `plan_id`, `price`, `currency`

#### `subscription_cancelled` — PLANNED
- Properties: `user_id`, `plan_id`, `cancel_reason`

### Mode switching

#### `mode_switched` — PLANNED
- Properties: `user_id`, `project_id`, `from_mode`, `to_mode`

## Outcome events (for every funnel step)

For every funnel step, also track:

#### `{step}_failed`
- Properties: same as the step event, plus `failure_reason`

#### `{step}_cancelled`
- Properties: same as the step event

#### `{step}_abandoned`
- Properties: same as the step event, plus `time_on_step_ms`

#### `{step}_retried`
- Properties: same as the step event, plus `attempt_number`

## Key product metrics

Derived from the events above:

| Metric                              | Calculation                                    |
| ----------------------------------- | ---------------------------------------------- |
| Percentage reaching first result    | `first_result_created / signup_completed`      |
| Time to first result                | `avg(time_to_first_result_ms)`                 |
| Percentage returning to a project   | `project_resumed / first_result_created`       |
| Mission completion rate             | `mission_completed / mission_started`          |
| Approval completion rate            | `approval_approved / approval_requested`       |
| Result publish/export rate          | `result_published + result_downloaded / first_result_created` |
| Remix rate                          | `creation_remixed / creation_published`        |
| Agent install-to-result rate        | `agent_first_result / agent_installed`         |
| Onboarding completion rate          | `onboarding_completed / onboarding_goal_selected` |
| Plan approval rate                  | `plan_approved / plan_presented`               |

## Implementation notes

- Events are sent from the client for user-facing actions
- Events are sent from the server for state changes (mission, approval, payment)
- Events include a server-generated timestamp
- Events do not include PII or secrets
- Events are batched where possible to reduce network overhead
- Events are buffered offline and sent when connection is restored
- Anonymous events (pre-signup) use `anonymous_user_id` and are linked to
  `user_id` after signup

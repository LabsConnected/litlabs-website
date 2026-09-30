# Global LiTT entry foundation

This change is a deliberately narrow bridge into the existing Studio operator.
It does not add a chat controller, model router, provider call, or authorization rule.

## Implemented

- Authenticated AppShell entry persists during ordinary app navigation; its draft survives route changes.
- The entry opens a native modal: desktop compact panel and mobile bottom sheet with dynamic viewport height, scrolling, safe-area padding, and browser-managed focus/Escape behavior.
- The collapsed entry occupies normal layout space so it does not permanently cover page controls.
- Studio keeps its existing operator; no competing composer is rendered there.
- Home, Studio, Projects, Deployments, Marketplace, Settings, Connections, and billing requests resolve through existing routes. Project preview uses the existing station URL mapping.
- Other requests continue in canonical Studio through its existing `prompt`, `project`, and `conversation` URL contract. Same-owner conversation identity is reused only within the applicable project boundary.
- Submitted prompts carry a snapshot of the originating route, surface, URL project/entity, identity, and the two actually available bridge capabilities.
- Role is explicitly unknown and permissions are explicitly server-resolved. Descriptive client context does not authorize actions.

## Tested versus live verified

Context/navigation tests and component behavior tests cover fresh context after navigation, clearing stale project/entity references, same-account conversation continuity, project boundaries, dialog open/close, authenticated visibility, and absence of a second Studio composer.

The component tests mock navigation and native dialog methods. They do not prove browser focus, software keyboard behavior, layout at 390px, server authorization, preview generation, or production continuity.

## Remaining integration

PR #551 owns the reusable `litt-client` extraction and store context. Integrate that canonical runtime at the persistent authenticated layout before adding an in-place expanded transcript/run panel. The current bridge remains a navigation/composer entry, not the complete persistent operator acceptance.

Route context is rebuilt at submit time and displayed locally. It is not yet a dedicated context provider consumed continuously by an active background run. Server-resolved role/capability hydration and richer selected-entity registration remain integration work.

## Required browser acceptance after preview deployment

1. Sign in normally and open the entry on Dashboard. Start a draft; navigate to Deployments, Settings, and Projects. Reopen the entry and verify the draft persists and Current page changes without stale project/entity IDs.
2. Submit each canonical navigation request and check the resulting route, including Settings Connections and billing section.
3. Resume an existing owned project conversation through Studio, then switch projects and confirm no old conversation is carried into the new project.
4. At desktop and 390px, open/close with pointer and keyboard, verify focus returns, Escape closes, composer remains usable with the software keyboard, sheet scrolls, safe area is respected, and page controls are reachable when closed.
5. Sign out and sign in as another user. Verify no former-account draft or conversation identity is reused. Verify protected routes/actions retain server authorization.

Nothing in this lane is live verified by the code or unit tests alone.

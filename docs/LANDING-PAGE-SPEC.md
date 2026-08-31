# LiTTree Landing Page Specification

## Authority

READ THIS FILE FIRST before changing the landing page.

This file is authoritative.

Do not reinterpret or replace these decisions unless the user explicitly changes them.

## Product

Product: LiTTree LabStudios
Primary operator: LiTT

LiTT is the AI creative operating system that actually operates on a real project.

LiTT can:

- understand an idea
- form a mission
- plan work
- choose tools
- edit real files
- use terminal and git
- create media and assets
- preserve project context
- preview results
- verify work
- request approval for sensitive actions
- help ship finished work

## Locked Hero Message

Bring the idea.

LiTT builds the rest.

Note: `PRODUCT_IDENTITY.corePromise` in `src/config/product-truth.ts` still reads
"Bring the idea. LiTT helps you build the rest." and feeds the `/` metadata title.
The rendered hero is the shipped wording; reconcile the two deliberately, not by drift.

Supporting message:

One intelligent creative workspace where LiTT can plan, code, create,
operate tools, modify projects, verify results, remember context,
and help take an idea all the way to something real.

## Spark

Spark is removed from the landing-page story.

Do not render or mention Spark on the public landing page.

Remove:

- Spark landing copy
- Spark cards
- Spark agent-crew messaging
- LiTT + Spark messaging
- Crew navigation created specifically for Spark

Do not delete unrelated Spark backend infrastructure or routes.

This rule applies to the landing experience only.

## Core Execution Story

The landing page should visually communicate:

IDEA
-> LiTT WAKES UP
-> MISSION CREATED
-> PLAN
-> TOOL EXECUTION
-> FILES / ASSETS CHANGE
-> PREVIEW
-> VERIFY
-> APPROVAL WHEN NEEDED
-> RESULT READY

This should feel like one connected operating flow, not unrelated cards.

## Visual Direction

The experience should feel:

- premium
- cinematic
- dimensional
- alive
- futuristic without becoming gimmicky
- high-end
- unmistakably LiTT

Avoid:

- generic SaaS card walls
- flat template styling
- repetitive feature sections
- random gradients
- fake metrics
- fake testimonials
- fake company logos
- excessive copy
- childish robot presentation

LiTT's mascot must feel integrated into the operating system.

## Motion And Effects

Motion is part of the landing-page identity.

Use coordinated, performant effects.

### Hero depth

Use:

- layered ambient glow
- radial lighting
- subtle technical grid
- dimensional Studio surfaces
- foreground / background depth
- restrained parallax

### Cursor-reactive lighting

Desktop only.

Add a soft pointer-following spotlight to hero/product surfaces.

Do not replace the user's cursor.

### Live execution animation

Show believable execution states:

IDEA
AGENT ONLINE
PLANNING
TOOL EXECUTION
FILE CHANGE
VERIFYING
RESULT READY

Use:

- status pulses
- progress traces
- active-state illumination
- terminal cursor
- connecting execution path
- verification transition

### Processing scan

Use a subtle moving scan / processing light on active runtime surfaces.

Keep it restrained.

### Scroll reveals

Use tasteful:

- opacity
- translateY
- subtle scale/depth

Do not animate every element aggressively.

### Interactive surfaces

Where appropriate use:

- border illumination
- pointer-reactive lighting
- gentle elevation
- restrained perspective

### CTA

Primary CTA should have:

- premium glow
- responsive light
- clear hover state
- strong focus-visible state

### Ambient background

Use restrained:

- technical grid
- fine noise
- blurred energy fields
- light bloom
- slow gradient movement

Effects support the content hierarchy rather than compete with it.

## Performance

Prefer:

- transform
- opacity
- CSS animation
- requestAnimationFrame only where justified

Avoid unnecessary continuous React state renders.

Mobile should use simplified effects.

## Reduced Motion

Respect prefers-reduced-motion.

Disable or substantially reduce:

- parallax
- continuous decorative movement
- scan effects
- pointer-follow effects

The static design must still look complete.

## Navigation

No duplicate Agents navigation.

Preferred landing navigation:

- Capabilities
- How It Works
- Creations
- Studio
- Community
- Pricing

Keep Sign In and Start Free separate.

Do not use Crew as a major landing navigation destination.

## Landing Structure

1. Navigation
2. Hero
3. LiTT execution story
4. Capabilities
5. How LiTT works
6. Real product demonstration
7. What you can build
8. Creations
9. Why LiTT
10. Verifiable trust
11. Final CTA

## Capability Hierarchy

Clearly distinguish:

LIVE
BETA
COMING / ROADMAP

Organize around actions LiTT can actually perform:

- CODE
- FILES
- TERMINAL
- GIT
- MEMORY
- CREATIVE TOOLS
- PREVIEW
- APPROVALS
- DEPLOYMENT
- VOICE where accurate

Do not imply unavailable capabilities are production-ready.

## What Users Can Build

Focus on outcomes:

- WORKING PRODUCTS
- CREATIVE MEDIA
- BRANDS AND CAMPAIGNS
- AUTOMATIONS
- AGENT WORKFLOWS
- PROJECT COMPLETION

## Truth Rules

No fabricated metrics.

No fake testimonials.

No invented customers.

No fake customer logos.

No unsupported capability claims.

## Repetition Rule

Each important idea should get one strongest presentation.

Avoid repeatedly explaining:

- not a chatbot
- operating system
- real files
- mission execution
- project memory
- approvals
- idea-to-deployment

Shorter and stronger is preferred.

## Accessibility

Keep the skip-to-content link accessible and visually hidden until focused.

Decorative SVGs must not create stray visible text.

Maintain:

- keyboard navigation
- focus-visible states
- contrast
- semantic headings
- alt text
- responsive layouts

## Allowed Landing Scope

Allowed:

src/app/HomePageClient.tsx
src/app/landing-upgrade.css
src/components/landing/**
landing-only assets
landing-only components

Do not modify:

packages/litt-agent-core/**
packages/litt-cli/**
mission verification
model routing
authentication infrastructure
Supabase configuration
Clerk configuration
deployment infrastructure

## Editing Rule

For existing files:

- read the file first
- use small anchored edits
- prefer ASCII-only old_str anchors
- read back every mutation
- never call a failed or no-op mutation successful
- never declare success based only on a plan step

## Final Rule

Future landing work must begin by reading this document.

Preserve this direction unless the user explicitly changes it.
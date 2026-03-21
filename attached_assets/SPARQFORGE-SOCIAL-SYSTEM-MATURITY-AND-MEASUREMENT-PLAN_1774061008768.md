# SparqForge Social System Maturity and Measurement Plan

## Purpose

This document defines what SparqForge should measure, improve, and mature so that social strategy and product capability evolve together.

## Why this matters

Right now, SparqForge already tracks useful operational signals like generation cost, refinement history, template versions, and campaign states. That is strong. But it does not yet fully measure whether the system is getting better at brand execution, packet quality, or strategy support ([templates route](https://github.com/tonydye6/SparqForge/blob/c6816f9325b34d67838a845f3e504ae3b588e19b/artifacts/api-server/src/routes/templates.ts), [cost dashboard route set](https://github.com/tonydye6/SparqForge/blob/c6816f9325b34d67838a845f3e504ae3b588e19b/artifacts/api-server/src/routes/cost-logs.ts)).

## Maturity Stages

### Stage 1: Functional
The app can generate, review, schedule, and publish.

### Stage 2: Role-aware
The app understands subject references, style references, compositing-only assets, and context assets.

### Stage 3: Strategy-aware
The app understands content plans, campaign types, and which posts belong to which pillar and objective.

### Stage 4: Recommendation-aware
The app learns which asset packets, templates, and combinations produce better outcomes.

### Stage 5: Brand-memory aware
The app can help the team see whether the brand is becoming more legible and more consistent over time.

## What SparqForge Should Measure Beyond Cost and Refinements

### Asset packet quality
Measure:
- first-pass approval rate by packet type
- first-pass approval rate by asset class combination
- rejection rate by packet type
- average refinements by packet type

### Strategy quality
Measure:
- post count by pillar
- post count by audience
- post count by platform role
- post count by campaign type
- ratio of announcements to evergreen brand-building

### Brand quality
Measure:
- percentage of posts that clearly express the parent brand
- percentage of posts that are parent-brand vs. game-brand vs. product-system
- percentage of posts using approved high-freshness assets

### Operational quality
Measure:
- time from plan item to draft
- time from draft to approval
- time from approval to schedule
- platform success / failure rate

## Recommended New Analytics Objects

SparqForge should eventually add:
- packet performance summaries
- content pillar summaries
- audience mix summaries
- platform-role summaries
- campaign-type summaries

## Recommended Review Rhythm

### Weekly
Review:
- generated posts
- approval failures
- obvious asset or template problems

### Biweekly
Review:
- packet effectiveness
- platform execution health
- content mix balance

### Monthly
Review:
- whether the brand is becoming more legible
- whether content pillars are balanced
- whether the app is reducing strategy friction or adding it

## What else you may not have considered

### The product needs a strategy-memory layer
Without a content-plan object and pillar-level metadata, SparqForge can become a very capable content generator that still has weak strategic memory.

### The product needs asset retirement discipline
A flat asset library makes it too easy for stale or legacy references to quietly remain influential.

### The product needs publish-path awareness
A strong content plan should know whether a post is:
- publishable natively now
- reviewable but export-only
- blocked by missing platform capability

### The product needs postmortem intelligence
It should not only log refinements. It should log whether the original packet choice was right.

## Final Recommendation

The strongest version of SparqForge is not just an AI content tool. It is a strategy-aware brand operating system. To get there, the next wave of work should improve:
- asset intelligence
- packet intelligence
- planning intelligence
- measurement intelligence

# SparqMake Content Plan Import Schema

## Purpose

This document defines the CSV structure for importing planned content into SparqMake.

## Required Columns

- title
- campaign_name
- primary_platform
- secondary_platforms
- template_name
- pillar
- audience
- brand_layer
- objective
- content_type
- asset_packet_type
- core_message
- cta
- required_asset_roles
- planned_week
- planned_date
- notes

## Field Format Rules

### primary_platform
Single value:
- Instagram
- X
- LinkedIn
- TikTok
- YouTube

### secondary_platforms
Pipe-separated values, example:
`Instagram|TikTok|YouTube`

### required_asset_roles
Pipe-separated values, example:
`subject_reference|style_reference|context_card`

### planned_date
ISO date or blank

## Import Behavior

On import, SparqMake should:
- validate required fields
- map rows into SocialContentPlanItem records
- reject rows with invalid platform values
- preserve original CSV row order in a sortable field if helpful

## Recommended Extra Columns Later

- owner
- review_owner
- campaign_status
- source_url
- priority

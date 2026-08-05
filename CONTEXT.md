# Megazord Terminal

An ADE — Agentic Development Environment: an environment whose purpose is to coordinate a team
of AI agents that writes, tests and delivers, instead of editing files.

This document is **glossary only**. No implementation details, no specs.

Prose and identifiers here are English. The team speaks Brazilian Portuguese, so every term
carries its PT-BR spoken form — see [Spoken form](#spoken-form) for the full mapping. The
English term is the one that appears in code.

## Command

**Mission**:
An isolated unit of work with its own scope, mode, budget and definition of done. All work
happens inside one.
_Avoid_: task, job, session, conversation

**Briefing**:
The description of the expected outcome that opens a Mission. States the end, not the steps.
_Avoid_: prompt, request, input, requirement

**Mode**:
Who leads a Mission and how much autonomy exists — Free, Combination or Agentic.
_Avoid_: type, profile, level

**Core**:
The orchestrator of a Mission. Delegates, chases and consolidates, and owns no execution tool.
_Avoid_: maestro, master, coordinator, lead agent, conductor

**Delegation**:
The assignment of a slice of a Mission to a Zord, performed by the Core.
_Avoid_: handout, dispatch, assignment

## Decision flow

**Command**:
An intent submitted to a Mission, which the domain accepts or refuses.
_Avoid_: action, directive

**Event**:
A fact that happened to a Mission. Append-only, never revised.
_Avoid_: notification, signal

**Decision**:
The result of deciding a Command: the accepted Events, or a Refusal.
_Avoid_: ruling, judgement

## Team

**Zord**:
An executing agent, defined by the composition CLI + model + skills + effort. Born when
invoked, dies after delivering.
_Avoid_: agent, bot, worker, subagent

**Role**:
The canonical function of a Zord — scout, builder, reviewer or controller. Determines
permission, not just naming.
_Avoid_: position, kind, function

**Capability**:
A permission a Zord holds, either orchestrating or executing. The Core holds no executing one.
_Avoid_: privilege, entitlement, tool access

**Harness**:
The resolved bundle of CLI, model, effort and skills a Zord runs a given task with.
_Avoid_: config, setup, preset, profile

**Catalog**:
The registry of default Harness bundles, one per CLI, that a resolution falls back to when
neither the Roster nor the invocation specifies a field.
_Avoid_: registry, defaults, library

**Effort**:
How much reasoning budget a Zord spends on one invocation.
_Avoid_: depth, reasoning level

**Combination**:
A named formation of Zords, with a declared Roster, Gates and deliverable.
_Avoid_: squad, team, crew, formation

**Roster**:
The list of Roles in a Combination, with the Harness of each Role.
_Avoid_: lineup, cast, agent list

**Skill**:
An installable instruction block that specialises a Zord without changing code.
_Avoid_: prompt, rule, instruction, document

## Agreement and delivery

**Contract**:
The interface agreed between Zords before code exists, and the reference a delivery is accepted
or refused against.
_Avoid_: spec, interface, agreement, schema

**Handoff**:
The structured delivery of a Zord: scope, artifacts, reference Contract and declared Gaps.
_Avoid_: delivery, output, result, PR

**Gap**:
What a Handoff explicitly declares it did not cover.
_Avoid_: pending, debt, TODO

**Refusal**:
The rejection of a Handoff for violating its Contract, performed by the Core with no human
involvement.
_Avoid_: rejection, reproval, block

**Gate**:
A checkpoint where the Mission stops and waits for a human decision.
_Avoid_: approval, checkpoint, review, validation

**Delivery**:
The consolidated outcome of a Mission, with proof that it works.
_Avoid_: deploy, release, product

## Shared context

**Workspace**:
The project where Missions happen, and the sharing scope of the Cortex.
_Avoid_: repo, folder, project, directory

**Cortex**:
The fact memory shared by every Zord of a Workspace, which outlives the session.
_Avoid_: memory, cache, history, context

**Fact**:
One Cortex entry, attributed to who wrote it and to the Mission it came from.
_Avoid_: note, log, learning, memory

## Visible execution

**Pane**:
An isolated terminal with one Zord inside, visible in the Cockpit.
_Avoid_: window, tab, terminal, cell

**Cockpit**:
The Pane grid of a Mission.
_Avoid_: dashboard, screen, grid, panel

**Surface**:
An area of the product that solves one team-coordination problem.
_Avoid_: feature, module, page, screen

## Governance

**Meter**:
The live accounting of tokens and cost, per Pane, per Mission and per Combination.
_Avoid_: billing, cost dashboard, counter

**Cap**:
The spending limit of a Mission. Once reached, the Mission stops and asks for authorisation.
_Avoid_: budget, limit, quota

**Replay**:
The auditable event sequence of a Mission, including what was refused.
_Avoid_: log, history, trace, audit

## Spoken form

The team speaks PT-BR and the code is English. This table is the bridge: left is what is said
in conversation, right is what is written in code and in every artifact.

| Spoken (PT-BR) | Written (EN)  |
| -------------- | ------------- |
| missão         | `Mission`     |
| briefing       | `Briefing`    |
| modo           | `Mode`        |
| núcleo         | `Core`        |
| delegação      | `Delegation`  |
| comando        | `Command`     |
| evento         | `Event`       |
| decisão        | `Decision`    |
| zord           | `Zord`        |
| papel          | `Role`        |
| capability     | `Capability`  |
| harness        | `Harness`     |
| catálogo       | `Catalog`     |
| effort         | `Effort`      |
| combinação     | `Combination` |
| roster         | `Roster`      |
| skill          | `Skill`       |
| contrato       | `Contract`    |
| handoff        | `Handoff`     |
| lacuna         | `Gap`         |
| recusa         | `Refusal`     |
| gate           | `Gate`        |
| entrega        | `Delivery`    |
| workspace      | `Workspace`   |
| córtex         | `Cortex`      |
| fato           | `Fact`        |
| pane           | `Pane`        |
| cockpit        | `Cockpit`     |
| superfície     | `Surface`     |
| medidor        | `Meter`       |
| teto           | `Cap`         |
| replay         | `Replay`      |

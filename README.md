# Menerio

## What it is
Menerio is a central event hub for personal data.

It connects multiple apps into a single system by capturing and distributing events. Instead of isolated tools with their own data silos, Menerio acts as the backbone that keeps everything in sync.

Each connected app remains the owner of its data, while Menerio ensures that relevant changes are shared across the system.

## Why it exists
Most apps today operate in isolation. Data is fragmented, duplicated, and quickly becomes inconsistent.

Menerio solves this by introducing a simple principle:
- Every record has one clear owner
- All changes are emitted as events
- All connected apps stay in sync through a central event bus

This enables a system where:
- Data remains consistent across apps
- Ownership is always clear
- Integrations become simple and scalable

The goal is not to replace apps, but to connect them into a coherent system.

## Core Concepts

### Single Source of Truth
Each piece of data belongs to exactly one app. Other apps receive synchronized copies but never become the source of truth.

### Event-Based Architecture
All changes are emitted as events (e.g. `event.created`, `event.updated`). Menerio stores and distributes these events to subscribed apps.

### Hub-and-Spoke Model
Apps do not communicate directly with each other. All communication flows through Menerio as the central hub.

### Synchronization with Ownership
Changes made in one app propagate back to the owning app through Menerio, ensuring consistency without conflicts.

## Features (Current State)
- Central event ingestion and storage
- Event distribution to connected applications
- Basic data synchronization model
- Supabase-backed data layer
- Lovable-based frontend and application structure

## Tech Stack
- Lovable (frontend and application scaffolding)
- Supabase (database, auth, backend services)

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — app layers, frontend and backend structure
- [Project Structure](docs/PROJECT_STRUCTURE.md) — root folders and conventions
- [Data Model](docs/DATA_MODEL.md) — main database entities explained in plain English
- [Test Scenarios](docs/TEST_SCENARIOS.md) — end-to-end test coverage
- [Open Source Philosophy](OPEN_SOURCE.md) — principles and licensing rationale

## Getting Started

1. Clone the repository
2. Copy `.env.example` to `.env`
3. Fill in your environment variables
4. Start the development environment

## Open Source

This project is open source under the AGPL-3.0 license.

The goal is to build Menerio in public as a foundational system for connecting personal data and applications.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions and guidelines.

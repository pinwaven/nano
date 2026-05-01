# Nano AI Backend Documentation

Nano AI is a precision health ecosystem powered by Aliyun FC 3.0. It ingests biomarker data, estimates missing markers, calculates biological age, and delivers personalised nutrition plans via WeChat.

## Table of Contents

1. [Architecture Overview](architecture/README.md)
2. [EventBridge Integration](architecture/eventbridge.md)
3. [Kino Hardware System](architecture/kino-system.md)
4. [Biomarker Estimator](architecture/biomarker-estimator.md)
5. [Dots System](dots-system.md)
6. [Rewards System](architecture/rewards-system.md)
7. [Role System](architecture/role-system.md)
8. [User Deletion Lifecycle](architecture/user-deletion.md)
9. [Deployment Guide](deployment.md)
10. [Worker API Endpoints](api/worker-endpoints.md)
11. [Local Testing & Simulators](api/testing.md)
12. [FC Logging Setup](fc-logging-setup.md)
13. [Simulator Build & Deploy](simulator-build-deploy.md)

## Core Technologies

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 (Aliyun FC 3.0) |
| Database | PostgreSQL 14 (Aliyun PolarDB Serverless) |
| AI Engine | Aliyun DashScope (Qwen-Turbo) |
| Deployment | Serverless Devs (`s` CLI) |
| Admin UI | React SPA served by FC function |

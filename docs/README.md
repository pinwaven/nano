# Nano AI Backend Documentation

Nano AI is a precision health ecosystem powered by Aliyun FC 3.0. It ingests biomarker data, estimates missing markers, calculates biological age, and delivers personalised nutrition plans via WeChat.

## Table of Contents

1. [Architecture Overview](architecture/README.md)
2. [EventBridge Integration](architecture/eventbridge.md)
3. [Kino Hardware System](architecture/kino-system.md)
4. [Dots System](dots-system.md)
5. [Rewards System](architecture/rewards-system.md)
6. [Role System](architecture/role-system.md)
7. [Deployment Guide](deployment.md)
8. [Worker API Endpoints](api/worker-endpoints.md)
9. [Local Testing & Simulators](api/testing.md)
10. [FC Logging Setup](fc-logging-setup.md)
11. [Simulator Build & Deploy](simulator-build-deploy.md)

## Core Technologies

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 (Aliyun FC 3.0) |
| Database | PostgreSQL 14 (Aliyun PolarDB Serverless) |
| AI Engine | Aliyun DashScope (Qwen-Turbo) |
| Deployment | Serverless Devs (`s` CLI) |
| Admin UI | React SPA served by FC function |

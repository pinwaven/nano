# Nano AI Backend Documentation

Nano AI is a precision health ecosystem powered by Aliyun FC 3.0. It ingests biomarker data, estimates missing markers, calculates biological age, and delivers personalised nutrition plans via WeChat.

## Table of Contents

1. [AI Persona System (Nano vs Viva)](ai-persona/README.md)
2. [Architecture Overview](architecture/README.md)
3. [EventBridge Integration](architecture/eventbridge.md)
4. [Kino Hardware System](architecture/kino-system.md)
5. [Biomarker Estimator](architecture/biomarker-estimator.md)
6. [Dots System](dots-system.md)
7. [Rewards System](architecture/rewards-system.md)
8. [Role System](architecture/role-system.md)
9. [User Deletion Lifecycle](architecture/user-deletion.md)
10. [Deployment Guide](deployment.md)
11. [Worker API Endpoints](api/worker-endpoints.md)
12. [Local Testing & Simulators](api/testing.md)
13. [FC Logging Setup](fc-logging-setup.md)
14. [Simulator Build & Deploy](simulator-build-deploy.md)
15. [WeChat Multiterminal Apps (Donut)](architecture/wechat-multiterminal.md)
16. [WeChat Bluetooth Release Guide](wechat-bluetooth-release-guide.md)


## Core Technologies

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 (Aliyun FC 3.0) |
| Database | PostgreSQL 14 (Aliyun PolarDB Serverless) |
| AI Engine | Aliyun DashScope (Qwen-Turbo) |
| Deployment | Serverless Devs (`s` CLI) |
| Admin UI | React SPA served by FC function |

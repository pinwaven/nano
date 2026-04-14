# Nano AI Backend Documentation

Nano AI is a precision health ecosystem powered by Aliyun FC 3.0. It ingests biomarker data, estimates missing markers, calculates biological age, and delivers personalised nutrition plans via WeChat.

## Table of Contents

1. [Architecture Overview](architecture/README.md)
2. [Deployment Guide](deployment.md)
3. [Worker API Endpoints](api/worker-endpoints.md)
4. [Local Testing & Simulators](api/testing.md)
5. [FC Logging Setup](fc-logging-setup.md)
6. [Simulator Build & Deploy](simulator-build-deploy.md)

## Core Technologies

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 (Aliyun FC 3.0) |
| Database | PostgreSQL 14 (Aliyun PolarDB Serverless) |
| AI Engine | Aliyun DashScope (Qwen-Turbo) |
| Deployment | Serverless Devs (`s` CLI) |
| Admin UI | React SPA served by FC function |

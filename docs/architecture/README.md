# Architecture Overview

The Nano AI system is built with a serverless architecture using Aliyun Function Compute (FC 3.0).

## System Flow
1. **User Ingestion**: Questionnaire data is sent via HTTP POST to the `worker` function.
2. **Biomarker Capture**: Portable device test results (e.g., Kino chip) are uploaded.
3. **AI Processing**: 
   - **Estimation**: Missing biomarkers are estimated based on age and biometrics.
   - **BioAge**: Biological age is calculated across four functional dimensions (ILI, MRI, MFI, MVII).
4. **Report Generation**: On the first test, a detailed Markdown report and 14-day nutrition plan are generated.
5. **Periodic Assessment**: The `dispatcher` (cron-triggered) periodically checks for users who need new assessments.

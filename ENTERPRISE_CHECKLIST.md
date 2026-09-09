# SwitchCare Enterprise v10.2.3 - release checklist

## Functional
- [x] Authentication REST login
- [x] Token refresh
- [x] Create device
- [x] Edit device
- [x] Issue/Out
- [x] Return/In
- [x] 6-month cycle
- [x] Send for charging
- [x] Charge completion
- [x] Dedicated charge records
- [x] Dedicated usage records
- [x] Audit log
- [x] CSV export
- [x] GitHub Pages cache bust

## Data integrity
- [x] 10-digit material number check
- [x] Taiwan Power device number uniqueness
- [x] State transition validation
- [x] Return date >= issue date
- [x] Charge completion date >= send date
- [x] Re-entered stock starts a fresh cycle
- [x] Direct deletion not exposed in UI

## Next enterprise hardening
- Role/department authorization matrix
- MFA
- Attachment storage for inspection/charge documents
- ERP/SAP import reconciliation
- Scheduled notifications
- Automated backups/PITR
- Second-site disaster recovery
- Formal change-management / release process

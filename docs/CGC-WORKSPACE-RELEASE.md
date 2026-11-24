# CGC workspace release

The CGC workspace adds private drafts, saved centre preferences, review status, 100 MB file uploads with progress/retry handling, and general or submission-specific feedback links. Last-approved content remains public while replacements are reviewed.

## Access

- Registered users can browse and report issues.
- CGC contributors can draft, submit and edit their own work.
- CGC reviewers can review/publish CGC work across centres, without platform administration.
- Platform administrators retain existing access.

A saved centre is a form preference, not an access grant. Uploads do not automatically create catalogue records or DOIs.

## Validation

25 integration tests passed, including role isolation, drafts, publication snapshots, upload boundaries and the existing issue workflow. Frontend build, targeted lint, browser contributor/reviewer checks and upload tests through Nginx passed locally.

## Deployment

Production activation is pending. Apply migration 070 using the established migration process after backing up the database and uploaded files. Deploy the compatible API and frontend together; frontend switching alone is insufficient. Check every proxy layer permits the new upload size. Preserve signing settings, persistent uploads, existing services, databases and rollbacks. Do not deploy synthetic local test accounts or credentials. Retain the migration when rolling back; older API versions do not implement draft/public-snapshot semantics.


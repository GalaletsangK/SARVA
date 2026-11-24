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

Deployed on 24 November 2026 from PR #70, merge commit `d1314d8a28288735b0b7bcf989ee9b9b455693eb`. This records operator-reported deployment acceptance; centre-led functional testing remains pending.

- Database migration `070_cgc_workspace.sql` applied successfully; earlier migrations were skipped.
- SARVA API replaced after checking that the running and Compose database/sign-in settings matched. The API subsequently reported a healthy database connection.
- Host Nginx validated and reloaded with a 100 MB limit scoped to CGC file uploads; the general limit and WEF include were retained.
- Frontend switched from port 8091 to 8090. The previous frontend on 8091 remains retained.
- Latest frontend rollback: `sarva-frontend:rollback-bluegreen-20261124-082635`. Active candidate: `d6a3e40d6b5b35f79f3022943b51f55921d1df5e34db5fc74094941b46fef5c6`.
- The database dump was verified and CGC uploads copied before service replacement. Backend/frontend rollback images, configuration backups and persistent database/upload volumes were retained.
- Operator output confirmed HTTP 200 for SARVA home, SARVA API health, public CGC work, WEF Nexus, DS Lab home, DS Lab API health and the El Niño tracker.
- No cleanup or pruning has run. Deployment commands did not target DS Lab, the independent tracker database or the retained PostGIS recovery setup.

## Testing with the centres — pending

The deployment and HTTP checks above do not establish production browser/workflow acceptance. Test existing password/passkey sign-in; contributor draft/edit/upload/submit; reviewer changes and publication; private/public access; retention of the approved version during updates; and general/submission-specific feedback with centre users.

The 100 MB boundary was tested locally, not independently verified on production. A live upload larger than the former 10 MB limit is still needed. No post-deployment spatial-database query has been recorded for this release.

Retain the migration when rolling back; older API versions do not implement draft/public-snapshot semantics. Preserve the latest rollbacks and database/upload backups while centre testing proceeds.


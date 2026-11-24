# CGC permanent deletion — local implementation, 24 November 2026

This feature is implemented locally and has not been deployed to production.

Platform administrators can use Delete permanently separately from Archive/Restore. CGC reviewers cannot permanently delete submissions. Confirmation requires the exact word DELETE and a private message of 10–2000 characters. The preview shows the title, tracked file count and stored size.

Deletion removes the submission, its work history and tracked uploaded versions. A minimal deletion audit and private submitter notice remain. The notice is available under My notices; this does not send email. Imported records without a linked account cannot receive a notice, and the interface explains this.

File removal happens after the database transaction commits. Failed removal remains in a durable cleanup queue, with automatic retries and an administrator retry action. A deleted submission cannot be restored through Archive/Restore, even while file cleanup is pending.

Migration 071 records upload ownership and backfills current files and published snapshots. Older unreferenced upload versions cannot safely be attributed and are not deleted by guesswork. Existing backups remain governed by their separate retention policy.

Validation: 33 synthetic database integration tests passed, covering permissions, all tracked file versions, required confirmation/message, stale revisions, private notices, transaction rollback, cleanup retries, unsafe/shared files, revoked roles and existing submission/feedback workflows. Frontend production build passed. No production records or files were deleted.

Deployment requires migration 071 before the updated backend and frontend, using the established backup and frontend switch process. Centre testing remains pending.

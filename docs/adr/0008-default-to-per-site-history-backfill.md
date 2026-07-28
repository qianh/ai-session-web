# Default to per-site history backfill

When a user explicitly enables a supported AI site for the first time, BrainHub Capture defaults to backfilling all visible history for that site and then establishes an incremental watermark. Site permissions and progress remain independent. Disabling and re-enabling a site resumes its existing watermark; only an explicit reset starts another full backfill.

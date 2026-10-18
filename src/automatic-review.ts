export const AUTOMATIC_REVIEW_LIMIT = 3;

export function automaticReviewAllowed(
  records: readonly { scope: string; noteId: string; kind: string; id: string }[],
  note: { scope: string; id: string },
) {
  // Persisted results count across revisions, devices and app restarts. Legacy
  // results count too; failed requests and individual research links do not.
  return (
    new Set(
      records
        .filter(
          (record) => record.scope === note.scope && record.noteId === note.id && record.kind === 'analysis',
        )
        .map((record) => record.id),
    ).size < AUTOMATIC_REVIEW_LIMIT
  );
}

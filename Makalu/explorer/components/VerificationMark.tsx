export default function VerificationMark({ label = 'Verified token' }: { label?: string }) {
  return (
    <span className="inline-flex shrink-0 items-center text-emerald-600 dark:text-emerald-400" role="img" aria-label={label} title={label}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <path d="m9.1 3.5 1.3-1.3a2.3 2.3 0 0 1 3.2 0l1.3 1.3 1.9.1A2.3 2.3 0 0 1 19 5.8l.1 1.9 1.3 1.3a2.3 2.3 0 0 1 0 3.2l-1.3 1.3-.1 1.9a2.3 2.3 0 0 1-2.2 2.2l-1.9.1-1.3 1.3a2.3 2.3 0 0 1-3.2 0l-1.3-1.3-1.9-.1A2.3 2.3 0 0 1 5 15.4l-.1-1.9L3.6 12a2.3 2.3 0 0 1 0-3.2l1.3-1.3L5 5.8a2.3 2.3 0 0 1 2.2-2.2z" transform="translate(0 1)" />
        <path d="m8.5 12 2.2 2.2 4.8-4.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

import { scoreResume } from '@/lib/resume-enhance';

export function ScoreBadge({ content }: { content: string }) {
  const score = scoreResume(content);
  const tone = score >= 70 ? 'success' : score >= 45 ? 'warn' : 'danger';
  const cls = {
    success: 'border-success/30 bg-success/10 text-success',
    warn: 'border-warn/30 bg-warn/10 text-warn',
    danger: 'border-danger/30 bg-danger/10 text-danger',
  }[tone];
  return (
    <span
      className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-semibold tabular-nums ${cls}`}
    >
      ATS {score}
    </span>
  );
}

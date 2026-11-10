import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckBriefingView } from '@/components/checkcheck/CheckBriefingView';
import type { CheckRun } from '@/services/checkCheckService';
import { getSharedReport, type SharedReport } from '@/demo/api';
import { EvidenceNotes } from '@/demo/ReportPanel';
import { Shell } from '@/demo/Shell';

/** A shared report: opens without login, never indexed, and carries nothing about the person who ran it. */
export default function SharedReportPage() {
  const { id = '' } = useParams();
  const [report, setReport] = useState<SharedReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Belt and braces with the server's X-Robots-Tag header.
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow, noarchive';
    document.head.appendChild(meta);
    return () => {
      meta.remove();
    };
  }, []);

  useEffect(() => {
    let live = true;
    getSharedReport(id)
      .then((r) => {
        if (!live) return;
        setReport(r);
        document.title = `${r.subject.name} · CheckCheck report`;
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : 'This report was not found.');
      });
    return () => {
      live = false;
    };
  }, [id]);

  const run: CheckRun | null = report && {
    id: report.id,
    status: report.status,
    stop_reason: null,
    refusal: null,
    subject: report.subject,
    user_request: null,
    angle: null,
    contact_id: null,
    report: null,
    briefing_text: report.briefing_text,
    header: report.header,
    owner_edits: null,
    records: [],
    validation: report.validation,
    models: null,
    created_at: report.completed_at,
    completed_at: report.completed_at,
    expires_at: null,
  };

  return (
    <Shell>
      <main className="z-10 mx-auto w-full max-w-[820px] flex-1 space-y-6 px-3 pt-2 sm:px-6" data-testid="shared-report-page">
        {!report && !error && <p className="py-16 text-center font-inter text-sm text-[#858481]">Loading the report…</p>}
        {error && (
          <div className="py-16 text-center" data-testid="shared-error">
            <p className="font-inter text-lg font-semibold text-black">Report not available</p>
            <p className="mt-2 font-inter text-sm text-[#858481]">{error}</p>
          </div>
        )}
        {run && report && (
          <>
            <p className="px-1 font-inter text-[13px] text-[#858481]" data-testid="shared-banner">
              A shared CheckCheck report, put together from public sources. It describes the subject only; nothing about the person who ran it is included.
            </p>
            <CheckBriefingView run={run} editable={false} offerContact={false} hideContactPill />
            {report.evidence && <EvidenceNotes evidence={report.evidence} />}
          </>
        )}
        <div className="flex justify-center pt-2">
          <Link to="/" className="flex h-10 items-center rounded-full bg-black px-5 font-inter text-[13px] font-medium text-white no-underline hover:bg-gray-800">
            Run your own check
          </Link>
        </div>
      </main>
    </Shell>
  );
}

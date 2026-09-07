"use client";

import { useState } from "react";
import { exportResults } from "../../actions";
import { downloadCsv } from "@/lib/csv";

export default function ExportResultsButton({ courseId }: { courseId: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    setPending(true);
    setError(null);
    try {
      const res = await exportResults(courseId);
      if (res.error || !res.csv || !res.filename) {
        setError(res.error ?? "Could not build the export.");
        return;
      }
      downloadCsv(res.filename, res.csv);
    } catch {
      setError("Could not build the export.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={download}
        disabled={pending}
        className="btn-secondary"
      >
        {pending ? "Preparing…" : "Download results as CSV"}
      </button>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </div>
  );
}

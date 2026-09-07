// Small CSV helpers shared by the import and export features.

// Quote a field if it contains a delimiter, quote or newline (RFC 4180).
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// Join one row of values, quoting each as needed.
export function csvRow(values: (string | number)[]): string {
  return values.map((v) => csvField(String(v))).join(",");
}

// Join rows into a CSV document with a trailing newline.
export function csvDocument(rows: (string | number)[][]): string {
  return rows.map(csvRow).join("\n") + "\n";
}

// Browser-only: hand the user a generated CSV as a download.
export function downloadCsv(filename: string, csv: string) {
  // Prefix the BOM so Excel opens UTF-8 names (e.g. accented) correctly.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  // The anchor has to be in the document for the click to start a download in
  // some browsers, and the object URL has to outlive the click.
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

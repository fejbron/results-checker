import Link from "next/link";
import ResultsChecker from "./results-checker";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 py-6">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <span className="text-lg font-bold text-slate-900">Results Checker</span>
        <Link href="/admin" className="btn-secondary">
          Lecturer sign in
        </Link>
      </div>

      {/* Hero */}
      <header className="mt-10 text-center">
        <h1 className="text-3xl font-bold text-slate-900 sm:text-4xl">
          Check your results
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
          Enter your index number and PIN to view your scores across every course.
        </p>
      </header>

      <div className="mt-8">
        <ResultsChecker />
      </div>

      <footer className="mt-auto pt-10 text-center text-xs text-slate-400">
        Your PIN defaults to the last 4 digits of your index number.
      </footer>
    </main>
  );
}

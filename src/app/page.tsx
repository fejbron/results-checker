import Link from "next/link";
import ResultsChecker from "./results-checker";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-12">
      <div className="w-full max-w-3xl">
        <header className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-slate-900">Check your results</h1>
          <p className="mt-2 text-sm text-slate-500">
            Enter your index number and PIN to view your scores and grades.
          </p>
        </header>

        <ResultsChecker />

        <p className="mt-10 text-center text-sm text-slate-400">
          Lecturer?{" "}
          <Link href="/admin" className="font-medium text-indigo-600 hover:underline">
            Sign in to enter results
          </Link>
        </p>
      </div>
    </main>
  );
}

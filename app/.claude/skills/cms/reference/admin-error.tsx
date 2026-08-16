"use client";

/**
 * Graceful fallback for any uncaught error inside the admin area — e.g. a session
 * that expired mid-edit (actions throw "Not authorised") or a transient Blob
 * failure on a save. Without this, the owner would see Next's raw error screen.
 * The public site is unaffected; this only covers /admin.
 *
 * Installed by the Klaudius cms skill as `src/app/admin/error.tsx`. Owner-facing
 * strings below must be written in the operator's language if it isn't English.
 */
export default function AdminError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-[#F7F6F3] px-5 py-16">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-black text-[#292524] mb-2">Something went wrong</h1>
        <p className="text-[#57534E] text-sm mb-6">
          That didn&apos;t save — but your live site is unaffected. Try again, or sign in
          again if you&apos;ve been away for a while.
        </p>
        <div className="flex gap-3 justify-center">
          <button
            type="button"
            onClick={() => reset()}
            className="bg-[#292524] hover:bg-black text-white px-5 py-2.5 rounded-lg text-sm font-bold transition-colors"
          >
            Try again
          </button>
          <a
            href="/admin/login"
            className="px-5 py-2.5 rounded-lg text-sm font-semibold text-[#57534E] hover:text-[#292524] border border-[#292524]/15 inline-flex items-center"
          >
            Sign in again
          </a>
        </div>
      </div>
    </main>
  );
}

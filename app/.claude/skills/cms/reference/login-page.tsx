import LoginForm from "./LoginForm";

/**
 * Installed by the Klaudius cms skill as `src/app/admin/login/page.tsx`.
 * After copying: put the business name in the metadata title, and write the
 * owner-facing strings in the operator's language if it isn't English.
 */

export const metadata = {
  // cms-generate: append the business name, e.g. "Site editor — Acme Roofing"
  title: "Site editor",
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-[#1C1917] px-5 py-16">
      <div className="w-full max-w-sm">
        <h1 className="text-3xl font-black text-white mb-2">Site editor</h1>
        <p className="text-white/60 text-sm mb-8">
          Sign in to edit your website — your contact details, text, photos and
          reviews.
        </p>
        <LoginForm />
      </div>
    </main>
  );
}

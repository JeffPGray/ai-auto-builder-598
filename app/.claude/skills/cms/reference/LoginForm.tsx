"use client";

import { useActionState } from "react";
import { loginAction } from "@/lib/actions";

/**
 * Installed by the Klaudius cms skill as `src/app/admin/login/LoginForm.tsx`.
 *
 * NOTE: `useActionState` needs React 19 (Next.js 15+). On an older site
 * (React 18 / Next.js 14), use the `useFormState` hook from "react-dom"
 * instead and read pending state via `useFormStatus` in a child component.
 *
 * Owner-facing strings below must be written in the operator's language if it
 * isn't English.
 */

const initialState: { error?: string } = {};

export default function LoginForm() {
  const [state, formAction, isPending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <label htmlFor="password" className="block text-sm font-semibold text-white/80 mb-2">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="w-full bg-white/5 border border-white/15 rounded-lg px-4 py-3 text-white text-base focus:outline-none focus:ring-2 focus:ring-white/60 focus:border-transparent"
        />
      </div>

      {state?.error && <p className="text-sm text-[#FCA5A5]">{state.error}</p>}

      <button
        type="submit"
        disabled={isPending}
        className="w-full bg-white hover:bg-white/85 text-[#1C1917] py-3.5 rounded-lg font-bold text-base transition-colors disabled:opacity-60"
      >
        {isPending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../../lib/firebase";
import { request } from "../../lib/api";
import logo from "../../assets/logo.jpg";

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      console.log("email:", email);
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const t = await cred.user.getIdToken(true); // force fresh
      console.log("uid:", cred.user.uid);
      console.log("idToken prefix:", t.slice(0, 16), "… length:", t.length);
    } catch (e) {
      console.error("[AUTH] sign-in error", e);
    } finally {
      console.groupEnd();
    }
  };

  return (
    // ⬇️ Background: deep navy → warm coral (matches your screenshot)
    <div
      className="min-h-screen w-full flex items-center justify-center p-4
                    bg-gradient-to-r from-[#0B1E2E] via-[#2B3A49] to-[#ff7a59]"
    >
      {/* Home button (top-right) */}
      <Link
        to="/"
        className="fixed top-4 right-4 inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium text-white bg-white/10 border border-white/20 backdrop-blur hover:bg-white/20 transition"
      >
        Home
      </Link>
      {/* Glassy card with subtle border and shadow, centered */}
      <div className="w-full max-w-md">
        <div className="rounded-xl border border-white/15 bg-white/10 backdrop-blur-md shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
          <div className="p-6 sm:p-7">
            {/* Header */}
            <div className="mb-6 flex flex-col items-center">
              <img src={logo} alt="MMCY Logo" className="h-10 w-auto mb-3" />
              <h2 className="text-lg font-semibold text-white/95">Sign in</h2>
            </div>

            {/* Form */}
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-white/90">
                  Email
                </label>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                  placeholder="admin@example.com"
                  className="mt-1 w-full rounded-md border border-white/20 bg-white
                             px-3 py-2 text-sm text-slate-900
                             focus:outline-none focus:ring-2 focus:ring-white/40 focus:border-white/40"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-white/90">
                  Password
                </label>
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  placeholder="••••••••"
                  className="mt-1 w-full rounded-md border border-white/20 bg-white
                             px-3 py-2 text-sm text-slate-900
                             focus:outline-none focus:ring-2 focus:ring-white/40 focus:border-white/40"
                  required
                />
              </div>

              {error && <p className="text-sm text-red-200">{error}</p>}

              <p className="text-xs text-white/70">
                Tip: Admin demo is{" "}
                <span className="font-medium">admin@example.com</span> /{" "}
                <span className="font-mono">admin123</span>
              </p>

              {/* Primary CTA in the same coral tone */}
              <button
                type="submit"
                disabled={loading}
                className="mt-2 w-full rounded-md bg-[#ff7a59] px-4 py-2
                           text-white text-sm font-medium shadow
                           hover:brightness-110 active:brightness-95
                           disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading ? "Signing in…" : "Sign in"}
              </button>

              {/* Footer row */}
              <div className="mt-2 flex items-center justify-between text-[11px] text-white/70">
                <span>Need a role?</span>
                <a href="#" className="underline-offset-2 hover:underline">
                  Switch role (dev)
                </a>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

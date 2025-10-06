import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import logo from "../assets/logo.jpg";

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-white border-b border-slate-200/50 sticky top-0 z-50 shadow-sm">
        <div className="w-full px-6 h-20">
          <div className="flex items-center justify-between h-full">
            {/* Logo */}
            <div className="flex items-center">
              <img src={logo} alt="MMCY Logo" className="h-10 w-auto" />
            </div>

            {/* CTA Button */}
            <div className="flex items-center">
              <Link
                to="/login"
                className="inline-flex items-center px-6 py-2 bg-[#ff7a59] text-white font-medium rounded-lg hover:bg-[#e65a4a] transition-all duration-300 shadow-md hover:shadow-lg"
              >
                Sign in
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden lg:min-h-[calc(100vh-5rem)] 2xl:min-h-[calc(100vh-5rem)]">
        {/* Background Image with Overlay */}
        <div className="absolute inset-0 bg-gradient-to-r from-slate-800 via-slate-700 to-[#ff7a59] opacity-90">
          <div className="absolute inset-0 bg-black/20" />
        </div>

        {/* Decorative Pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 right-20 w-32 h-32 bg-white rounded-full" />
          <div className="absolute top-40 right-40 w-16 h-16 bg-white rounded-full" />
          <div className="absolute top-60 right-60 w-24 h-24 bg-white rounded-full" />
          <div className="absolute top-80 right-80 w-12 h-12 bg-white rounded-full" />
          <div className="absolute top-32 right-32 w-20 h-20 bg-white rounded-full" />
        </div>

        <div className="relative w-full px-6 py-20 lg:py-32 lg:min-h[calc(100vh-5rem)] lg:flex lg:items-center 2xl:min-h-[calc(100vh-5rem)]">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Content */}
            <div className="text-white">
              <h1 className="text-5xl lg:text-6xl xl:text-7xl 2xl:text-8xl font-bold leading-tight mb-6 max-w-4xl">
                Transform your assessments.
                <br />
                <span className="text-white/80">
                  <RotatingText />
                </span>
              </h1>
              <p className="text-xl xl:text-2xl 2xl:text-3xl leading-relaxed text-white/90 mb-8 max-w-2xl xl:max-w-3xl">
                Our AI-Powered Exam Platform helps you assess skills with
                intelligent question generation, adaptive testing, and
                comprehensive analytics—fast, fair, and at scale.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <Link
                  to="/login" // ✅ keep lowercase here too
                  className="inline-flex items-center px-8 py-4 bg-[#ff7a59] text-white font-semibold rounded-lg hover:bg-[#e65a4a] transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105"
                >
                  Get Started
                </Link>
              </div>
            </div>

            {/* Feature Cards */}
            <div className="grid gap-4">
              <button
                className="hover-zoom rounded-xl border border-white/15 bg-white/5 p-5 text-left shadow-lg backdrop-blur transition hover:bg-white/10 active:animate-zoom-pop animate-float-slow"
                onClick={() => { }}
                type="button"
              >
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-md bg-[#ff7a59] text-white grid place-items-center text-sm font-bold">
                    AI
                  </div>
                  <div>
                    <div className="text-white font-medium">Adaptive Engine</div>
                    <div className="text-white/70 text-sm">
                      Questions adjust in real-time for precision.
                    </div>
                  </div>
                </div>
              </button>

              <button
                className="hover-zoom rounded-xl border border-white/15 bg-white/5 p-5 text-left shadow-lg backdrop-blur transition hover:bg-white/10 active:animate-zoom-pop animate-float-slow"
                style={{ animationDelay: "100ms" }}
                onClick={() => { }}
                type="button"
              >
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-md bg-white/10 text-white grid place-items-center text-sm font-bold">
                    ∑
                  </div>
                  <div>
                    <div className="text-white font-medium">
                      AI Question Generation
                    </div>
                    <div className="text-white/70 text-sm">
                      High-quality items, on demand.
                    </div>
                  </div>
                </div>
              </button>

              <button
                className="hover-zoom rounded-xl border border-white/15 bg-white/5 p-5 text-left shadow-lg backdrop-blur transition hover:bg-white/10 active:animate-zoom-pop animate-float-slow"
                style={{ animationDelay: "200ms" }}
                onClick={() => { }}
                type="button"
              >
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-md bg-white/10 text-white grid place-items-center text-sm font-bold">
                    📊
                  </div>
                  <div>
                    <div className="text-white font-medium">
                      Insights & Analytics
                    </div>
                    <div className="text-white/70 text-sm">
                      See strengths, gaps, and trends instantly.
                    </div>
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/15 bg-gradient-to-r from-slate-800 via-slate-700 to-[#ff7a59]">
        <div className="w-full px-6 py-6 text-sm text-white/70">
          © {new Date().getFullYear()} AI-Powered Exam Platform · Transforming
          Assessment Technology
        </div>
      </footer>
    </div>
  );
}

function RotatingText() {
  const phrases = [
    "Assess skills with confidence.",
    "Hire faster with fairness.",
    "Train smarter with insights.",
  ];
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const id = setInterval(
      () => setIndex((v) => (v + 1) % phrases.length),
      2500
    );
    return () => clearInterval(id);
  }, []);
  return (
    <span className="inline-block min-h-[1.5em] align-top hover-zoom">
      <span key={index} className="inline-block">
        {phrases[index]}
      </span>
    </span>
  );
}

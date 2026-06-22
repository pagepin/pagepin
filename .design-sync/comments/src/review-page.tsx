/**
 * A realistic "hosted page" used as the backdrop for every comment-overlay card:
 * the real-overlay baseline injects comments.js over it, and each redesign concept
 * renders its own review UI on top. Element ids (#hero-title, #hero-cta, #feature-2,
 * #pricing) match the fixture thread selectors so anchors/pins resolve.
 *
 * It's a sample marketing page for a fictional product ("Orbit"); pages pagepin
 * hosts are arbitrary, but a clean, anchorable page makes the review UX legible.
 */
import { Activity, ArrowRight, BarChart3, Bell, Zap } from 'lucide-react';

export function ReviewPage() {
  return (
    <div className="min-h-screen bg-white text-ink-800">
      {/* top nav */}
      <header className="flex items-center justify-between border-b border-ink-100 px-8 py-4">
        <div className="flex items-center gap-2 font-bold tracking-tight text-ink-900">
          <span className="flex h-7 w-7 items-center justify-center rounded-panel bg-tide-600 text-white">
            <Activity className="h-4 w-4" />
          </span>
          Orbit
        </div>
        <nav className="hidden items-center gap-7 text-sm text-ink-500 sm:flex">
          <span>Product</span>
          <span>Pricing</span>
          <span>Docs</span>
          <span className="rounded-field bg-ink-900 px-3.5 py-1.5 font-semibold text-white">Sign in</span>
        </nav>
      </header>

      {/* hero */}
      <section className="mx-auto max-w-3xl px-8 pb-12 pt-16 text-center">
        <span className="inline-block rounded-chip bg-tide-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-tide-700">
          New · Realtime
        </span>
        <h1 id="hero-title" className="mt-5 text-4xl font-bold tracking-tight text-ink-900">
          Analytics for teams that ship
        </h1>
        <p id="hero-sub" className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-ink-500">
          Orbit turns your product events into answers — dashboards, alerts, and shareable reports your
          whole team can actually read.
        </p>
        <div className="mt-7 flex items-center justify-center gap-3">
          <button
            id="hero-cta"
            className="inline-flex items-center gap-2 rounded-field bg-tide-500 px-5 py-2.5 text-sm font-semibold text-white"
          >
            Start free <ArrowRight className="h-4 w-4" />
          </button>
          <button className="rounded-field border border-ink-200 px-5 py-2.5 text-sm font-semibold text-ink-600">
            Book a demo
          </button>
        </div>
      </section>

      {/* stats strip */}
      <section className="border-y border-ink-100 bg-ink-50">
        <div className="mx-auto grid max-w-3xl grid-cols-3 divide-x divide-ink-100">
          {[
            ['12.4M', 'events / day'],
            ['340ms', 'p95 query'],
            ['99.98%', 'uptime'],
          ].map(([n, l]) => (
            <div key={l} className="px-4 py-6 text-center">
              <div className="text-2xl font-bold text-ink-900">{n}</div>
              <div className="mt-1 text-xs text-ink-400">{l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* features */}
      <section className="mx-auto max-w-4xl px-8 py-14">
        <div className="grid gap-5 sm:grid-cols-3">
          {[
            { id: 'feature-1', icon: BarChart3, t: 'Live dashboards', b: 'Drag-and-drop charts that update as events land — no refresh, no waiting.' },
            { id: 'feature-2', icon: Zap, t: '8.2s to insight', b: 'Ask a question in plain language and Orbit builds the query and the chart.' },
            { id: 'feature-3', icon: Bell, t: 'Smart alerts', b: 'Anomaly detection pings the right channel before customers notice.' },
          ].map((f) => (
            <div id={f.id} key={f.id} className="rounded-card border border-ink-200 bg-white p-5 shadow-card">
              <span className="flex h-9 w-9 items-center justify-center rounded-panel bg-tide-50 text-tide-600">
                <f.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-3 text-sm font-bold text-ink-900">{f.t}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-500">{f.b}</p>
            </div>
          ))}
        </div>
      </section>

      {/* pricing band */}
      <section id="pricing" className="mx-auto mb-16 max-w-3xl rounded-card border border-ink-200 bg-gradient-to-b from-tide-50 to-white px-8 py-10 text-center">
        <h2 className="text-xl font-bold tracking-tight text-ink-900">Simple, montly pricing</h2>
        <p className="mt-2 text-sm text-ink-500">Start free. Scale to $49 / mo when your team grows past 5 seats.</p>
        <button className="mt-5 rounded-field bg-tide-600 px-5 py-2.5 text-sm font-semibold text-white">
          See plans
        </button>
      </section>

      <footer className="border-t border-ink-100 px-8 py-8 text-center text-xs text-ink-400">
        © Orbit, Inc. · Hosted on pagepin
      </footer>
    </div>
  );
}

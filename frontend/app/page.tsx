import { ShieldCheck, ArrowUpRight, LockKeyhole } from 'lucide-react'

export default function Page() {
  return (
    <main className="min-h-screen bg-slate-100 p-6 text-slate-900">
      <section className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-5xl items-center justify-end overflow-hidden rounded-3xl bg-slate-200 shadow-2xl">
        <div className="hidden flex-1 p-12 md:block">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-teal-700">Frontend preview</p>
          <h1 className="max-w-md text-5xl font-bold tracking-tight">A calmer way to capture context.</h1>
          <p className="mt-5 max-w-md leading-7 text-slate-600">This preview shows the redesigned extension surface. The production content script keeps its existing Chrome messaging and backend functions.</p>
        </div>
        <aside className="flex min-h-[calc(100vh-3rem)] w-full max-w-[368px] flex-col bg-slate-50 shadow-2xl">
          <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-6 py-5">
            <div className="grid h-9 w-9 gap-1 rounded-xl bg-teal-700 p-2"><span className="h-1 rounded bg-white" /><span className="h-1 w-3/4 rounded bg-white" /><span className="h-1 w-1/2 rounded bg-white" /></div>
            <div className="flex-1"><p className="text-[10px] font-bold uppercase tracking-[0.13em] text-teal-700">Privacy assistant</p><h2 className="text-lg font-bold">ScreenSafe</h2></div>
            <span className="h-2 w-2 rounded-full bg-emerald-500 ring-4 ring-emerald-100" aria-label="Ready" />
          </header>
          <div className="flex-1 px-6 py-8">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.13em] text-teal-700">Capture context</p>
            <h3 className="max-w-[270px] text-[28px] font-bold leading-tight tracking-[-0.045em]">What can we help you with?</h3>
            <p className="mt-3 text-[13px] leading-6 text-slate-500">Describe the issue and we&apos;ll securely capture the current screen for context.</p>
            <div className="mt-6 flex gap-2 rounded-xl border border-teal-200 bg-teal-50 p-3 text-[11px] leading-5 text-teal-900"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />Your screenshot is saved locally before it is sent.</div>
            <label className="mt-7 block text-xs font-bold" htmlFor="preview-request">Your request</label>
            <textarea id="preview-request" className="mt-2 min-h-36 w-full resize-y rounded-xl border border-slate-300 bg-white p-3 text-sm outline-none transition focus:border-teal-700 focus:ring-4 focus:ring-teal-700/10" placeholder="Tell us what you&apos;re seeing…" />
            <p className="mt-2 text-[11px] text-slate-400">Be as specific as you can. Include any error messages.</p>
          </div>
          <footer className="border-t border-slate-200 bg-white px-6 py-5"><button className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-teal-700 text-sm font-bold text-white transition hover:bg-teal-800"><ArrowUpRight className="h-5 w-5" />Submit &amp; capture</button><p className="mt-3 flex items-center justify-center gap-1 text-[10px] text-slate-400"><LockKeyhole className="h-3.5 w-3.5 text-teal-700" />Private by design</p></footer>
        </aside>
      </section>
    </main>
  )
}

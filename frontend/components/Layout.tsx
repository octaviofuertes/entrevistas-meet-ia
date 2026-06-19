'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';

const NAV = [
  { href: '/', label: 'Dashboard', icon: 'D' },
  { href: '/puestos', label: 'Puestos', icon: 'P' },
  { href: '/candidatos', label: 'Candidatos', icon: 'C' },
  { href: '/entrevistas', label: 'Entrevistas', icon: 'E' },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <div className="min-h-screen flex">
      <aside className="w-60 bg-white border-r border-slate-200 flex flex-col">
        <div className="px-6 py-5 border-b border-slate-200">
          <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">
            leIA
          </div>
          <div className="font-bold text-slate-900 leading-tight">Entrevistas Meet</div>
          <div className="text-xs text-slate-500 mt-1">v2.0 · leIA + Recall.ai</div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map((item) => {
            const active =
              item.href === '/' ? path === '/' : path?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  active
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-slate-700 hover:bg-slate-100'
                )}
              >
                <span className="w-6 h-6 rounded bg-slate-100 text-slate-700 grid place-items-center text-xs font-bold">
                  {item.icon}
                </span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="px-6 py-4 border-t border-slate-200 text-xs text-slate-500">
          Sistema de Entrevistas v2.0
          <br />
          Captions nativos de Meet · leIA
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-8 py-8">{children}</div>
      </main>
    </div>
  );
}
